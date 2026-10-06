import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph, Project } from "../api";
import { StrataLogo } from "../components/StrataLogo";
import { buildArchModel, type WorkspacePackage } from "../map/archModel";
import type { Lens } from "../routes";
import { buildContext, suggestions } from "./context";
import { Markdown, type Ref } from "./Markdown";
import { askStore, useAskMeta, useConversation } from "./store";

type Props = {
  project: Project;
  graph: Graph | null;
  workspace: WorkspacePackage[];
  lens: Lens;
  onOpen: (ref: Ref) => void;
  onClose: () => void;
  /** A question to send right away (from ⌘K). */
  request: { q: string; n: number } | null;
};

let lastSentRequest = 0;

const MODELS = [
  { id: "", label: "Default model" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku · fastest" },
];

export function AskPanel({ project, graph, workspace, lens, onOpen, onClose, request }: Props) {
  const conv = useConversation(project.id);
  const { usage, status } = useAskMeta();
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => {
    try {
      return localStorage.getItem("strata-ask-model") ?? "";
    } catch {
      return "";
    }
  });
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    askStore.status();
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [conv.messages]);

  // Lookups for turning names in answers into clickable references.
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
    return { repoByName, files, fileIds, tables, arch, byPathSuffix };
  }, [graph, project.repos, workspace]);

  const resolve = (href: string | null, label: string): Ref | null => {
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
        const t = index.tables.find((x) => x.name.toLowerCase() === name && (rest.length < 2 || x.repoId === index.repoByName.get(rest[0].toLowerCase()))) ?? index.tables.find((x) => x.name.toLowerCase() === name);
        return t ? { kind: "table", id: t.id, label } : null;
      }
      if (kind === "node") {
        const name = decodeURIComponent(rest.join("/")).toLowerCase();
        const n = index.arch?.nodes.find((x) => x.name.toLowerCase() === name || x.unit?.packageName.toLowerCase() === name);
        return n ? { kind: "node", id: n.id, label } : null;
      }
      return null;
    }
    // Plain `inline code`: a file path or a table name we know.
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

  const send = (q: string) => {
    const question = q.trim();
    if (!question || conv.running) return;
    setInput("");
    askStore.ask(project.id, question, buildContext(project, graph, workspace, lens), project.repos.map((r) => r.path), model || null);
  };

  useEffect(() => {
    // Module-level, so reopening the panel doesn't resend an old ⌘K question.
    if (request && lastSentRequest !== request.n) {
      lastSentRequest = request.n;
      send(request.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const ideas = useMemo(() => suggestions(project, graph, workspace), [project, graph, workspace]);
  const unavailable = status && !status.available;

  return (
    <div className="ask glass">
      <div className="ask-header">
        <StrataLogo size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Ask Strata</div>
          <div className="faint" style={{ fontSize: 11.5 }}>{project.name} · reads your code with Claude</div>
        </div>
        {conv.messages.length > 0 && (
          <button className="btn small ghost" onClick={() => askStore.reset(project.id)} title="Start a new conversation">
            New
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close (⌘J)">
          ×
        </button>
      </div>

      <div className="ask-body" ref={scroller}>
        {unavailable && (
          <div className="insp-warn">
            Ask Strata uses the Claude Code CLI with your own Claude subscription, but no <span className="mono">claude</span> command was found. Install Claude Code, run{" "}
            <span className="mono">claude</span> once in a terminal to sign in, then reopen this panel.
          </div>
        )}

        {conv.messages.length === 0 && !unavailable && (
          <div className="ask-empty">
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Ask anything about {project.name}. Claude starts from Strata’s map and reads the actual code to answer — files, tables and services in the answer are clickable.
            </div>
            <div className="ask-ideas">
              {ideas.map((q) => (
                <button key={q} className="ask-idea" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

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
              {m.text ? <Markdown text={m.text} resolve={resolve} onRef={onOpen} /> : !m.done && <div className="ask-thinking">Thinking…</div>}
              {m.error && <div className="error-banner">{m.error}</div>}
              {m.cancelled && <div className="faint" style={{ fontSize: 12 }}>Stopped.</div>}
            </div>
          ),
        )}
      </div>

      <div className="ask-footer">
        <form
          className="ask-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={conv.messages.length ? "Ask a follow-up…" : "How does checkout work?"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={!!unavailable}
          />
          {conv.running ? (
            <button type="button" className="btn small" onClick={() => askStore.cancel(project.id)}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn small accent" disabled={!input.trim() || !!unavailable}>
              Ask
            </button>
          )}
        </form>
        <div className="ask-meta">
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              try {
                localStorage.setItem("strata-ask-model", e.target.value);
              } catch {}
            }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span>Read-only</span>
          {usage.fiveHour !== undefined && <span title="Your Claude subscription's 5-hour usage window">{Math.round(usage.fiveHour * 100)}% of 5h limit</span>}
        </div>
      </div>
    </div>
  );
}
