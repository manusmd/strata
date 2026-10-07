import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Graph, Project } from "../api";
import { buildArchModel, type WorkspacePackage } from "../map/archModel";
import { Markdown, type Ref } from "./Markdown";
import { askStore, useAskMeta, useConversation } from "./store";

/** Turns `strata:` links and known paths/table names in answers into references. */
export function useRefResolver(project: Project, graph: Graph | null, workspace: WorkspacePackage[]) {
  const index = useMemo(() => {
    const repoByName = new Map(project.repos.map((r) => [r.name.toLowerCase(), r.id]));
    const files = (graph?.nodes ?? []).filter((n) => n.kind === "file" && n.path);
    const fileIds = new Set(files.map((f) => f.id));
    const tables = (graph?.nodes ?? []).filter((n) => n.kind === "table");
    const arch = graph ? buildArchModel(graph, project.repos, workspace) : null;
    const byPathSuffix = (p: string) => {
      const clean = p.replace(/^\.?\//, "").replace(/:\d+(-\d+)?$/, "");
      const hits = files.filter((f) => f.path === clean || f.path!.endsWith(`/${clean}`));
      return hits.length === 1 ? hits[0] : hits.find((f) => f.path === clean);
    };
    return { repoByName, fileIds, tables, arch, byPathSuffix };
  }, [graph, project.repos, workspace]);

  return (href: string | null, label: string): Ref | null => {
    if (href?.startsWith("strata:")) {
      const [kind, ...rest] = href.slice(7).split("/");
      if (kind === "file" && rest.length >= 2) {
        const repoId = index.repoByName.get(rest[0].toLowerCase());
        const path = rest.slice(1).join("/").replace(/:\d+(-\d+)?$/, "");
        const id = repoId ? `${repoId}:${path}` : null;
        if (id && index.fileIds.has(id)) return { kind: "file", id, label };
        const f = index.byPathSuffix(path);
        return f ? { kind: "file", id: f.id, label } : null;
      }
      if (kind === "table" && rest.length >= 1) {
        const name = rest[rest.length - 1].toLowerCase();
        const t =
          index.tables.find((x) => x.name.toLowerCase() === name && (rest.length < 2 || x.repoId === index.repoByName.get(rest[0].toLowerCase()))) ??
          index.tables.find((x) => x.name.toLowerCase() === name);
        return t ? { kind: "table", id: t.id, label } : null;
      }
      if (kind === "node") return resolveNode(decodeURIComponent(rest.join("/")), label);
      return null;
    }
    if (!href && /[/.]/.test(label) && !/\s/.test(label)) {
      const f = index.byPathSuffix(label);
      if (f) return { kind: "file", id: f.id, label };
    }
    if (!href && /^\w+$/.test(label)) {
      const t = index.tables.find((x) => x.name === label);
      if (t) return { kind: "table", id: t.id, label };
    }
    return null;
  };

  function resolveNode(name: string, label: string): Ref | null {
    const n = index.arch?.nodes.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.unit?.packageName.toLowerCase() === name.toLowerCase());
    return n ? { kind: "node", id: n.id, label } : null;
  }
}

type Resolve = ReturnType<typeof useRefResolver>;

/** The messages of one conversation. `renderExtra` lets the chat home add canvases. */
export function MessageList({ convKey, resolve, onRef, empty, renderBlock }: { convKey: string; resolve: Resolve; onRef: (r: Ref) => void; empty?: ReactNode; renderBlock?: (lang: string, body: string, done: boolean) => ReactNode | null }) {
  const conv = useConversation(convKey);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [conv.messages]);
  if (conv.messages.length === 0) return <>{empty}</>;
  return (
    <>
      {conv.messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="ask-q">
            {m.text}
          </div>
        ) : (
          <div key={i} className="ask-a">
            {m.activity.length > 0 && (
              <div className="ask-activity">
                {(m.done ? m.activity.slice(-1) : m.activity.slice(-3)).map((a, j, arr) => (
                  <div key={j} className={!m.done && j === arr.length - 1 ? "live" : ""}>
                    {m.done && m.activity.length > 1 ? `${m.activity.length} steps · ${a}` : a}
                  </div>
                ))}
              </div>
            )}
            {m.text ? (
              <Markdown text={m.text} resolve={resolve} onRef={onRef} renderBlock={renderBlock ? (lang, body, closed) => renderBlock(lang, body, closed && m.done) : undefined} />
            ) : (
              !m.done && <div className="ask-thinking">Thinking…</div>
            )}
            {m.error && <div className="error-banner">{m.error}</div>}
            {m.cancelled && <div className="faint" style={{ fontSize: 12 }}>Stopped.</div>}
          </div>
        ),
      )}
      <div ref={end} />
    </>
  );
}

export const MODELS = [
  { id: "", label: "Default model" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku · fastest" },
];

export function useAskModel(): [string, (m: string) => void] {
  const [model, setModel] = useState(() => {
    try {
      return localStorage.getItem("strata-ask-model") ?? "";
    } catch {
      return "";
    }
  });
  return [
    model,
    (m) => {
      setModel(m);
      try {
        localStorage.setItem("strata-ask-model", m);
      } catch {}
    },
  ];
}

/** Input, stop button, model picker and plan usage. */
export function Composer({ convKey, onSend, placeholder, autoFocus, model, setModel, disabled, big, prefill, hint }: { convKey: string; onSend: (q: string) => void; placeholder: string; autoFocus?: boolean; model: string; setModel: (m: string) => void; disabled?: boolean; big?: boolean; /** Puts text in the input (each new `n`), e.g. "Ask Claude about this component". */ prefill?: { text: string; n: number } | null; hint?: string }) {
  const conv = useConversation(convKey);
  const { usage } = useAskMeta();
  const [input, setInput] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, convKey]);
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [prefill]);
  const send = () => {
    const q = input.trim();
    if (!q || conv.running) return;
    setInput("");
    onSend(q);
  };
  return (
    <div className={`ask-footer ${big ? "big" : ""}`}>
      <form
        className="ask-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={ref}
          rows={big ? 2 : 1}
          value={input}
          placeholder={placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={disabled}
        />
        {conv.running ? (
          <button type="button" className="btn small" onClick={() => askStore.cancel(convKey)}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn small accent" disabled={!input.trim() || disabled}>
            Ask
          </button>
        )}
      </form>
      <div className="ask-meta">
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span>{hint ?? "Read-only"}</span>
        {usage.fiveHour !== undefined && <span title="Your Claude subscription's 5-hour usage window">{Math.round(usage.fiveHour * 100)}% of 5h limit</span>}
      </div>
    </div>
  );
}
