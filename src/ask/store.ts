import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type AskMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; activity: string[]; done: boolean; error?: string; cost?: number; cancelled?: boolean };

export type Conversation = {
  sessionId: string | null;
  messages: AskMessage[];
  running: string | null; // ask id
};

export type ClaudeStatus = { available: boolean; path: string | null; version: string | null };
export type Usage = { fiveHour?: number; sevenDay?: number; resetsAt?: number };

type State = { conversations: Record<string, Conversation>; usage: Usage; status: ClaudeStatus | null };

let state: State = { conversations: {}, usage: {}, status: null };
const subscribers = new Set<() => void>();
const set = (next: State) => {
  state = next;
  subscribers.forEach((s) => s());
};
const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

const empty: Conversation = { sessionId: null, messages: [], running: null };
const askToProject = new Map<string, string>();

function update(projectId: string, fn: (c: Conversation) => Conversation) {
  const cur = state.conversations[projectId] ?? empty;
  set({ ...state, conversations: { ...state.conversations, [projectId]: fn(cur) } });
}

/** Mutates the last (assistant) message of the conversation that owns `askId`. */
function updateAnswer(askId: string, fn: (m: Extract<AskMessage, { role: "assistant" }>) => Partial<Extract<AskMessage, { role: "assistant" }>>) {
  const projectId = askToProject.get(askId);
  if (!projectId) return;
  update(projectId, (c) => {
    const msgs = [...c.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, ...fn(last) };
    return { ...c, messages: msgs };
  });
}

let listening = false;
function ensureListening() {
  if (listening) return;
  listening = true;
  listen<{ askId: string; event: any }>("ask-event", ({ payload: { askId, event: e } }) => {
    const projectId = askToProject.get(askId);
    if (!projectId) return;
    switch (e.type) {
      case "system":
        if (e.subtype === "init" && e.session_id) update(projectId, (c) => ({ ...c, sessionId: e.session_id }));
        if (e.subtype === "task_summary" && e.detail) updateAnswer(askId, (m) => ({ activity: [...m.activity, e.detail] }));
        break;
      case "stream_event":
        updateAnswer(askId, (m) => ({ text: m.text + (e.event?.delta?.text ?? "") }));
        break;
      case "assistant": {
        // Tool calls, as a fallback when no task summary describes them.
        for (const c of e.message?.content ?? []) {
          if (c.type !== "tool_use") continue;
          const target = c.input?.file_path ?? c.input?.pattern ?? c.input?.path ?? "";
          const line = `${c.name === "Read" ? "Reading" : c.name === "Grep" ? "Searching for" : "Looking for"} ${String(target).split("/").slice(-3).join("/")}`;
          updateAnswer(askId, (m) => (m.activity.some((a) => a.includes(String(target).split("/").pop() ?? "\u0000")) ? {} : { activity: [...m.activity, line] }));
        }
        break;
      }
      case "result":
        updateAnswer(askId, (m) => ({ text: m.text.trim() ? m.text : e.result ?? "", cost: e.total_cost_usd }));
        if (e.session_id) update(projectId, (c) => ({ ...c, sessionId: e.session_id }));
        break;
      case "rate_limit_event": {
        const w = e.rate_limit_info?.unifiedWindows ?? {};
        set({ ...state, usage: { fiveHour: w.five_hour?.utilization, sevenDay: w.seven_day?.utilization, resetsAt: w.five_hour?.resetsAt } });
        break;
      }
    }
  });
  listen<{ askId: string; ok: boolean; error: string | null }>("ask-done", ({ payload }) => {
    const projectId = askToProject.get(payload.askId);
    if (!projectId) return;
    updateAnswer(payload.askId, (m) => ({ done: true, error: payload.error ?? undefined, cancelled: !payload.ok && !payload.error ? true : m.cancelled }));
    update(projectId, (c) => ({ ...c, running: c.running === payload.askId ? null : c.running }));
  });
}

export const askStore = {
  async status(): Promise<ClaudeStatus> {
    if (state.status) return state.status;
    const s = await invoke<ClaudeStatus>("claude_status").catch(() => ({ available: false, path: null, version: null }));
    set({ ...state, status: s });
    return s;
  },

  async ask(projectId: string, question: string, context: string, dirs: string[], model: string | null) {
    ensureListening();
    const conv = state.conversations[projectId] ?? empty;
    if (conv.running) return;
    const askId = crypto.randomUUID();
    askToProject.set(askId, projectId);
    update(projectId, (c) => ({ ...c, running: askId, messages: [...c.messages, { role: "user", text: question }, { role: "assistant", text: "", activity: [], done: false }] }));
    try {
      await invoke("ask_start", { request: { askId, question, context, dirs, sessionId: conv.sessionId, model } });
    } catch (e) {
      updateAnswer(askId, () => ({ done: true, error: String(e) }));
      update(projectId, (c) => ({ ...c, running: null }));
    }
  },

  cancel(projectId: string) {
    const id = state.conversations[projectId]?.running;
    if (id) invoke("ask_cancel", { askId: id }).catch(() => {});
  },

  reset(projectId: string) {
    this.cancel(projectId);
    update(projectId, () => empty);
  },
};

export function useConversation(projectId: string): Conversation {
  return useSyncExternalStore(subscribe, () => state.conversations[projectId] ?? empty);
}

export function useAskMeta(): { usage: Usage; status: ClaudeStatus | null } {
  const usage = useSyncExternalStore(subscribe, () => state.usage);
  const status = useSyncExternalStore(subscribe, () => state.status);
  return { usage, status };
}
