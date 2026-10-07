import { useEffect, useMemo } from "react";
import type { Graph, Project } from "../api";
import { StrataLogo } from "../components/StrataLogo";
import type { WorkspacePackage } from "../map/archModel";
import type { Lens } from "../routes";
import { summaryStore } from "../summary/store";
import { buildContext, suggestions } from "./context";
import { Composer, MessageList, useAskModel, useRefResolver } from "./Conversation";
import type { Ref } from "./Markdown";
import { askStore, quickKey, useAskMeta, useConversation } from "./store";
import { canvasBlocks } from "../canvas/CanvasView";
import { CANVAS_INSTRUCTIONS } from "../canvas/spec";

type Props = {
  project: Project;
  graph: Graph | null;
  workspace: WorkspacePackage[];
  lens: Lens;
  onOpen: (ref: Ref) => void;
  onClose: () => void;
  /** A question to send right away (from ⌘K). */
  request: { q: string; n: number } | null;
  /** Turns this quick conversation into a saved chat and shows it. */
  onSaveAsChat: (chatId: string) => void;
};

let lastSentRequest = 0;

export function AskPanel({ project, graph, workspace, lens, onOpen, onClose, request, onSaveAsChat }: Props) {
  const key = quickKey(project.id);
  const conv = useConversation(key);
  const { status } = useAskMeta();
  const [model, setModel] = useAskModel();
  const resolve = useRefResolver(project, graph, workspace);

  useEffect(() => {
    askStore.status();
  }, []);

  const context = () => `${buildContext(project, graph, workspace, lens, summaryStore.texts(project.id))}\n\n${CANVAS_INSTRUCTIONS}`;
  const send = (question: string) => askStore.ask(key, question, context(), project.repos.map((r) => r.path), model || null);
  const renderBlock = canvasBlocks({
    project,
    graph,
    workspace,
    onOpen,
    onFix: (error) => send(`The canvas you drew couldn't be read: ${error} Please send the complete canvas again as strictly valid JSON in a strata-canvas block.`),
  });

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
        {conv.messages.length > 0 && !conv.running && (
          <button
            className="btn small ghost"
            title="Keep this conversation in the project's chats"
            onClick={async () => {
              const id = await askStore.saveQuickAsChat(project.id);
              if (id) {
                askStore.reset(key);
                onSaveAsChat(id);
              }
            }}
          >
            Save as chat
          </button>
        )}
        {conv.messages.length > 0 && (
          <button className="btn small ghost" onClick={() => askStore.reset(key)} title="Start a new conversation">
            New
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close (⌘J)">
          ×
        </button>
      </div>

      <div className="ask-body">
        {unavailable && (
          <div className="insp-warn">
            Ask Strata uses the Claude Code CLI with your own Claude subscription, but no <span className="mono">claude</span> command was found. Install Claude Code, run{" "}
            <span className="mono">claude</span> once in a terminal to sign in, then reopen this panel.
          </div>
        )}
        <MessageList
          convKey={key}
          resolve={resolve}
          onRef={onOpen}
          renderBlock={renderBlock}
          empty={
            !unavailable && (
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
            )
          }
        />
      </div>

      <Composer convKey={key} onSend={send} placeholder={conv.messages.length ? "Ask a follow-up…" : "How does checkout work?"} autoFocus model={model} setModel={setModel} disabled={!!unavailable} />
    </div>
  );
}
