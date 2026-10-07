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
  loaded?: boolean;
};

export type ClaudeStatus = { available: boolean; path: string | null; version: string | null };
export type Usage = { fiveHour?: number; sevenDay?: number; resetsAt?: number };
export type ChatSummary = { id: string; projectId: string; title: string; sessionId: string | null; createdAt: number; updatedAt: number; messages: number; preview: string | null };

/** Conversation keys: `quick:<projectId>` for the ⌘J panel, `chat:<chatId>` for saved chats. */
export const quickKey = (projectId: string) => `quick:${projectId}`;
export const chatKey = (chatId: string) => `chat:${chatId}`;
const chatIdOf = (key: string) => (key.startsWith("chat:") ? key.slice(5) : null);

type State = { conversations: Record<string, Conversation>; usage: Usage; status: ClaudeStatus | null; chats: Record<string, ChatSummary[]> };

let state: State = { conversations: {}, usage: {}, status: null, chats: {} };
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
const askToKey = new Map<string, string>();

function update(key: string, fn: (c: Conversation) => Conversation) {
  const cur = state.conversations[key] ?? empty;
  set({ ...state, conversations: { ...state.conversations, [key]: fn(cur) } });
}

type Answer = Extract<AskMessage, { role: "assistant" }>;
function updateAnswer(askId: string, fn: (m: Answer) => Partial<Answer>) {
  const key = askToKey.get(askId);
  if (!key) return;
  update(key, (c) => {
    const msgs = [...c.messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, ...fn(last) };
    return { ...c, messages: msgs };
  });
}

const lastAnswer = (key: string) => {
  const m = state.conversations[key]?.messages;
  const last = m?.[m.length - 1];
  return last?.role === "assistant" ? last : null;
};

let listening = false;
function ensureListening() {
  if (listening) return;
  listening = true;
  listen<{ askId: string; event: any }>("ask-event", ({ payload: { askId, event: e } }) => {
    const key = askToKey.get(askId);
    if (!key) return;
    switch (e.type) {
      case "system":
        if (e.subtype === "init" && e.session_id) {
          update(key, (c) => ({ ...c, sessionId: e.session_id }));
          const chat = chatIdOf(key);
          if (chat) invoke("update_chat", { chatId: chat, sessionId: e.session_id }).catch(() => {});
        }
        if (e.subtype === "task_summary" && e.detail) updateAnswer(askId, (m) => ({ activity: [...m.activity, e.detail] }));
        break;
      case "stream_event":
        updateAnswer(askId, (m) => ({ text: m.text + (e.event?.delta?.text ?? "") }));
        break;
      case "assistant":
        for (const c of e.message?.content ?? []) {
          if (c.type !== "tool_use") continue;
          const target = String(c.input?.file_path ?? c.input?.pattern ?? c.input?.path ?? "");
          const line = `${c.name === "Read" ? "Reading" : c.name === "Grep" ? "Searching for" : "Looking for"} ${target.split("/").slice(-3).join("/")}`;
          updateAnswer(askId, (m) => (m.activity.some((a) => a.includes(target.split("/").pop() ?? "\u0000")) ? {} : { activity: [...m.activity, line] }));
        }
        break;
      case "result":
        updateAnswer(askId, (m) => ({ text: m.text.trim() ? m.text : e.result ?? "", cost: e.total_cost_usd }));
        if (e.session_id) update(key, (c) => ({ ...c, sessionId: e.session_id }));
        break;
      case "rate_limit_event": {
        const w = e.rate_limit_info?.unifiedWindows ?? {};
        set({ ...state, usage: { fiveHour: w.five_hour?.utilization, sevenDay: w.seven_day?.utilization, resetsAt: w.five_hour?.resetsAt } });
        break;
      }
    }
  });
  listen<{ askId: string; ok: boolean; error: string | null }>("ask-done", ({ payload }) => {
    const key = askToKey.get(payload.askId);
    if (!key) return;
    updateAnswer(payload.askId, (m) => ({ done: true, error: payload.error ?? undefined, cancelled: !payload.ok && !payload.error ? true : m.cancelled }));
    update(key, (c) => ({ ...c, running: c.running === payload.askId ? null : c.running }));
    // Saved chats keep the finished answer.
    const chat = chatIdOf(key);
    const answer = lastAnswer(key);
    if (chat && answer) {
      const content = { text: answer.text, activity: answer.activity, error: answer.error, cost: answer.cost, cancelled: answer.cancelled };
      invoke("append_chat_message", { chatId: chat, role: "assistant", content }).then(() => refreshChatsFor(chat)).catch(() => {});
    }
  });
}

// Which project a chat belongs to, for refreshing that project's chat list.
const chatProject = new Map<string, string>();
function refreshChatsFor(chatId: string) {
  const p = chatProject.get(chatId);
  if (p) askStore.loadChats(p);
}

export const askStore = {
  async status(): Promise<ClaudeStatus> {
    if (state.status) return state.status;
    const s = await invoke<ClaudeStatus>("claude_status").catch(() => ({ available: false, path: null, version: null }));
    set({ ...state, status: s });
    return s;
  },

  async ask(key: string, question: string, context: string, dirs: string[], model: string | null) {
    ensureListening();
    const conv = state.conversations[key] ?? empty;
    if (conv.running) return;
    const askId = crypto.randomUUID();
    askToKey.set(askId, key);
    update(key, (c) => ({ ...c, running: askId, messages: [...c.messages, { role: "user", text: question }, { role: "assistant", text: "", activity: [], done: false }] }));
    const chat = chatIdOf(key);
    if (chat) invoke("append_chat_message", { chatId: chat, role: "user", content: { text: question } }).catch(() => {});
    try {
      await invoke("ask_start", { request: { askId, question, context, dirs, sessionId: conv.sessionId, model } });
    } catch (e) {
      updateAnswer(askId, () => ({ done: true, error: String(e) }));
      update(key, (c) => ({ ...c, running: null }));
    }
  },

  cancel(key: string) {
    const id = state.conversations[key]?.running;
    if (id) invoke("ask_cancel", { askId: id }).catch(() => {});
  },

  reset(key: string) {
    this.cancel(key);
    update(key, () => empty);
  },

  // ---- Saved chats ----

  async loadChats(projectId: string) {
    const chats = await invoke<ChatSummary[]>("list_chats", { projectId }).catch(() => [] as ChatSummary[]);
    for (const c of chats) chatProject.set(c.id, projectId);
    set({ ...state, chats: { ...state.chats, [projectId]: chats } });
  },

  async loadChat(chatId: string) {
    const key = chatKey(chatId);
    if (state.conversations[key]?.loaded || state.conversations[key]?.running) return;
    const rows = await invoke<{ role: string; content: any }[]>("chat_messages", { chatId }).catch(() => []);
    const projectId = chatProject.get(chatId);
    const session = projectId ? state.chats[projectId]?.find((c) => c.id === chatId)?.sessionId ?? null : null;
    const messages: AskMessage[] = rows.map((r) =>
      r.role === "user"
        ? { role: "user", text: r.content?.text ?? "" }
        : { role: "assistant", text: r.content?.text ?? "", activity: r.content?.activity ?? [], done: true, error: r.content?.error, cost: r.content?.cost, cancelled: r.content?.cancelled },
    );
    update(key, () => ({ sessionId: session, messages, running: null, loaded: true }));
  },

  /** A new, empty chat. The title is the first question, shortened. */
  async createChat(projectId: string, firstQuestion: string): Promise<string> {
    const title = firstQuestion.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
    const id = await invoke<string>("create_chat", { projectId, title });
    chatProject.set(id, projectId);
    update(chatKey(id), () => ({ ...empty, loaded: true }));
    await this.loadChats(projectId);
    return id;
  },

  /** Turns the quick ⌘J conversation into a saved chat that continues the same Claude session. */
  async saveQuickAsChat(projectId: string): Promise<string | null> {
    const quick = state.conversations[quickKey(projectId)];
    const first = quick?.messages.find((m) => m.role === "user");
    if (!quick || !first) return null;
    const id = await this.createChat(projectId, first.text);
    for (const m of quick.messages) {
      const content = m.role === "user" ? { text: m.text } : { text: m.text, activity: m.activity, error: m.error, cost: m.cost };
      await invoke("append_chat_message", { chatId: id, role: m.role, content });
    }
    if (quick.sessionId) await invoke("update_chat", { chatId: id, sessionId: quick.sessionId });
    update(chatKey(id), () => ({ sessionId: quick.sessionId, messages: quick.messages, running: null, loaded: true }));
    await this.loadChats(projectId);
    return id;
  },

  async renameChat(projectId: string, chatId: string, title: string) {
    await invoke("update_chat", { chatId, title });
    await this.loadChats(projectId);
  },

  async deleteChat(projectId: string, chatId: string) {
    this.cancel(chatKey(chatId));
    await invoke("delete_chat", { chatId });
    await this.loadChats(projectId);
  },
};

export function useConversation(key: string): Conversation {
  return useSyncExternalStore(subscribe, () => state.conversations[key] ?? empty);
}

export function useChats(projectId: string): ChatSummary[] {
  return useSyncExternalStore(subscribe, () => state.chats[projectId] ?? NO_CHATS);
}
const NO_CHATS: ChatSummary[] = [];

export function useAskMeta(): { usage: Usage; status: ClaudeStatus | null } {
  const usage = useSyncExternalStore(subscribe, () => state.usage);
  const status = useSyncExternalStore(subscribe, () => state.status);
  return { usage, status };
}
