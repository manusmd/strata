import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Graph, Project } from "../api";
import { ProjectTile } from "../components/ProjectTile";
import { StrataLogo } from "../components/StrataLogo";
import { buildArchModel, KIND_COLOR, type WorkspacePackage } from "../map/archModel";
import { buildContext, suggestions } from "../ask/context";
import { Composer, MessageList, useAskModel, useRefResolver } from "../ask/Conversation";
import type { Ref } from "../ask/Markdown";
import { askStore, chatKey, useAskMeta, useChats, useConversation } from "../ask/store";
import { SummarySection } from "../summary/SummarySection";
import { summaryStore } from "../summary/store";
import { projectSubject } from "../summary/subjects";
import { canvasBlocks } from "../canvas/CanvasView";
import { CANVAS_INSTRUCTIONS } from "../canvas/spec";

type Props = {
  project: Project;
  graph: Graph | null;
  workspace: WorkspacePackage[];
  chatId: string | null;
  setChatId: (id: string | null) => void;
  onOpen: (ref: Ref) => void;
};

/** Chat list previews are plain text: drop Markdown marks and strata links. */
const plain = (t: string | null) => (t ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`_#>]+/g, "").trim();

function ago(secs: number) {
  const d = Date.now() / 1000 - secs;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(secs * 1000).toLocaleDateString();
}

export function ProjectHome({ project, graph, workspace, chatId, setChatId, onOpen }: Props) {
  const chats = useChats(project.id);
  const { status } = useAskMeta();
  const [model, setModel] = useAskModel();
  const resolve = useRefResolver(project, graph, workspace);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    askStore.loadChats(project.id);
    askStore.status();
  }, [project.id]);
  useEffect(() => {
    if (chatId) askStore.loadChat(chatId);
  }, [chatId]);

  const context = () => `${buildContext(project, graph, workspace, "home", summaryStore.texts(project.id))}\n\n${CANVAS_INSTRUCTIONS}`;
  const dirs = project.repos.map((r) => r.path);

  const startChat = async (question: string) => {
    const id = await askStore.createChat(project.id, question);
    setChatId(id);
    askStore.ask(chatKey(id), question, context(), dirs, model || null);
  };
  const send = (question: string) => (chatId ? askStore.ask(chatKey(chatId), question, context(), dirs, model || null) : startChat(question));
  const renderBlock = canvasBlocks({
    project,
    graph,
    workspace,
    onOpen,
    onFix: (error) => chatId && askStore.ask(chatKey(chatId), `The canvas you drew couldn't be read: ${error} Please send the complete canvas again as strictly valid JSON in a strata-canvas block.`, context(), dirs, model || null),
  });

  const shown = chats.filter((c) => !filter || c.title.toLowerCase().includes(filter.toLowerCase()) || c.preview?.toLowerCase().includes(filter.toLowerCase()));
  const unavailable = status && !status.available;

  return (
    <div className="home">
      <aside className="home-list">
        <button className="btn primary home-new" onClick={() => setChatId(null)}>
          ✦ New chat
        </button>
        {chats.length > 3 && <input className="input home-filter" placeholder="Filter chats" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <div className="home-chats">
          <div className={`home-chat ${!chatId ? "on" : ""}`} onClick={() => setChatId(null)}>
            <div className="home-chat-title">Overview</div>
            <div className="home-chat-preview">{project.name} at a glance</div>
          </div>
          {shown.map((c) => (
            <div key={c.id} className={`home-chat ${c.id === chatId ? "on" : ""}`} onClick={() => setChatId(c.id)}>
              <div className="home-chat-title">{c.title}</div>
              <div className="home-chat-preview">{plain(c.preview) || `${c.messages} messages`}</div>
              <div className="home-chat-time">{ago(c.updatedAt)}</div>
            </div>
          ))}
          {chats.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: "8px 10px" }}>No chats yet. Ask something to start one.</div>}
        </div>
      </aside>

      <section className="home-main">
        {chatId ? (
          <ChatView project={project} chatId={chatId} title={chats.find((c) => c.id === chatId)?.title ?? "Chat"} resolve={resolve} onOpen={onOpen} renderBlock={renderBlock} onDelete={async () => {
            await askStore.deleteChat(project.id, chatId);
            setChatId(null);
          }}>
            <Composer convKey={chatKey(chatId)} onSend={send} placeholder="Ask a follow-up…" autoFocus model={model} setModel={setModel} disabled={!!unavailable} big />
          </ChatView>
        ) : (
          <Overview project={project} graph={graph} workspace={workspace} onAsk={startChat} chats={chats} openChat={setChatId}>
            <Composer convKey="home:draft" onSend={startChat} placeholder={`Ask anything about ${project.name} — a new chat starts`} autoFocus model={model} setModel={setModel} disabled={!!unavailable} big />
          </Overview>
        )}
      </section>
    </div>
  );
}

function ChatView({ project, chatId, title, resolve, onOpen, renderBlock, onDelete, children }: { project: Project; chatId: string; title: string; resolve: ReturnType<typeof useRefResolver>; onOpen: (r: Ref) => void; renderBlock: (lang: string, body: string, done: boolean) => ReactNode | null; onDelete: () => void; children: ReactNode }) {
  const key = chatKey(chatId);
  const conv = useConversation(key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setDraft(title);
    setConfirm(false);
  }, [title, chatId]);
  return (
    <div className="chat">
      <div className="chat-header">
        {editing ? (
          <input
            className="input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft !== title) askStore.renameChat(project.id, chatId, draft.trim());
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <div className="chat-title" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {title}
          </div>
        )}
        <span className="faint" style={{ fontSize: 12 }}>{conv.messages.filter((m) => m.role === "user").length} questions</span>
        {confirm ? (
          <>
            <button className="btn small ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn small danger" onClick={onDelete}>Delete chat</button>
          </>
        ) : (
          <button className="btn small ghost" onClick={() => setConfirm(true)} title="Delete this chat">
            Delete
          </button>
        )}
      </div>
      <div className="chat-body">
        <div className="chat-column">
          <MessageList convKey={key} resolve={resolve} onRef={onOpen} renderBlock={renderBlock} empty={<div className="faint" style={{ padding: 24 }}>Loading…</div>} />
        </div>
      </div>
      <div className="chat-composer">{children}</div>
    </div>
  );
}

function Overview({ project, graph, workspace, onAsk, chats, openChat, children }: { project: Project; graph: Graph | null; workspace: WorkspacePackage[]; onAsk: (q: string) => void; chats: ReturnType<typeof useChats>; openChat: (id: string) => void; children: ReactNode }) {
  const arch = useMemo(() => (graph ? buildArchModel(graph, project.repos, workspace) : null), [graph, project.repos, workspace]);
  const ideas = useMemo(
    () => [...suggestions(project, graph, workspace), "How could we improve the architecture? Draw the proposal as a canvas.", "Draw the request flow of the most important user action."].slice(0, 5),
    [project, graph, workspace],
  );
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of arch?.nodes ?? []) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [arch]);
  const files = graph?.nodes.filter((n) => n.kind === "file").length ?? 0;
  const tables = graph?.nodes.filter((n) => n.kind === "table").length ?? 0;
  const subject = useMemo(() => (arch && graph ? () => projectSubject(project, arch, graph, summaryStore.texts(project.id)) : null), [arch, graph, project]);

  return (
    <div className="overview">
      <div className="overview-column">
        <div className="overview-head">
          <ProjectTile name={project.name} color={project.color} logo={project.logo} size={44} />
          <div style={{ flex: 1 }}>
            <h1 className="title" style={{ fontSize: 26 }}>{project.name}</h1>
            <div className="overview-repos">
              {project.repos.map((r) => (
                <span key={r.id} className="chip" title={r.path}>
                  <span className="repo-dot" style={{ width: 6, height: 6, background: r.scanStatus === "ok" ? "var(--ok)" : r.scanStatus === "failed" ? "var(--err)" : "var(--text-3)" }} />
                  {r.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {subject && <SummarySection subject={subject} />}

        {graph && (
          <div className="overview-stats">
            <div><b>{files.toLocaleString()}</b><span>files</span></div>
            <div><b>{tables}</b><span>tables</span></div>
            {counts.slice(0, 4).map(([k, n]) => (
              <div key={k} style={{ ["--kind" as any]: KIND_COLOR[k as keyof typeof KIND_COLOR] }}>
                <b className="kind">{n}</b>
                <span>{k === "Library" ? (n === 1 ? "library" : "libraries") : `${k.toLowerCase()}${n === 1 || k === "External" ? "" : "s"}`}</span>
              </div>
            ))}
          </div>
        )}

        <div className="overview-ask">
          <div className="overview-ask-head">
            <StrataLogo size={20} /> Start a chat about {project.name}
          </div>
          {children}
          <div className="overview-ideas">
            {ideas.map((q) => (
              <button key={q} className="ask-idea" onClick={() => onAsk(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>

        {chats.length > 0 && (
          <div className="overview-recent">
            <div className="insp-label">Recent chats</div>
            <div className="overview-recent-grid">
              {chats.slice(0, 4).map((c) => (
                <div key={c.id} className="card overview-recent-card" onClick={() => openChat(c.id)}>
                  <div className="home-chat-title">{c.title}</div>
                  <div className="home-chat-preview">{plain(c.preview) || `${c.messages} messages`}</div>
                  <div className="home-chat-time">{ago(c.updatedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
