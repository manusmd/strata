import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, Project } from "../api";
import { Composer, MessageList, useAskModel, useRefResolver } from "../ask/Conversation";
import type { Ref } from "../ask/Markdown";
import { askStore, chatKey, useAskMeta, useConversation } from "../ask/store";
import type { WorkspacePackage } from "../map/archModel";
import { hashOf } from "../summary/subjects";
import { applyEdit, parseEdit, slug, withShape, type Plan, type PlanComponent, type PlanTable } from "./model";
import { PlanCanvas } from "./PlanCanvas";
import { CompareView, HistoryPopover } from "./PlanHistory";
import { DataModel } from "./DataModel";
import { DecisionsPanel } from "./DecisionsPanel";
import { GenerateDocs } from "./GenerateDocs";
import { DriftCard } from "./DriftCard";
import { comparePlan, computeDrift, driftReport, planFromCode } from "./drift";
import { buildArchModel } from "../map/archModel";
import { PlanInspector } from "./PlanInspector";
import { briefText, planContext } from "./prompt";
import { parseOptions, parseQuestions, type PlanOption } from "./blocks";
import { OptionsCard, OptionsView, QuestionsCard } from "./Cards";
import { planStore, usePlan } from "./store";

type Props = { project: Project; graph: Graph | null; workspace: WorkspacePackage[]; onOpen: (ref: Ref) => void; onAddRepo: (path: string) => void };

const BLOCK = /```strata-plan[^\n]*\n([\s\S]*?)```/g;
const OPTIONS = /```strata-options[^\n]*\n([\s\S]*?)```/g;
const sourceOf = (body: string) => `claude:${hashOf(body.trim())}`;
const optionsKey = (body: string) => hashOf(body.trim());
/** Version source of a picked option; the latest version's source tells which option is on the canvas. */
const optionSource = (key: string, id: string) => `option:${key}:${id}`;

/** Picking an option: the new shape, the data model and decisions kept, and a "Shape" decision recorded (or updated). */
function pickOption(current: Plan, options: PlanOption[], o: PlanOption): Plan {
  const next = withShape(current, o.plan);
  const prev = current.decisions?.find((d) => d.title.startsWith("Shape:"));
  return applyEdit(next, {
    title: "",
    ops: [{ op: "decide", decision: { id: prev?.id, title: `Shape: ${o.title}`, chosen: o.title, reason: [o.tagline, ...o.pros.slice(0, 2)].filter(Boolean).join(" · "), alts: options.filter((x) => x.id !== o.id).map((x) => x.title), links: [] } }],
  }).plan;
}

/** The plan chat's answer card for a ```strata-plan block: what changed, and Undo. */
function EditCard({ projectId, body, done, onFix }: { projectId: string; body: string; done: boolean; onFix: (error: string) => void }) {
  const p = usePlan(projectId);
  if (!done) {
    return (
      <div className="plan-edit pending">
        <span className="plan-spin" /> Updating the plan…
      </div>
    );
  }
  const parsed = parseEdit(body);
  if (!parsed.ok) {
    return (
      <div className="plan-edit error">
        <div style={{ fontWeight: 600, color: "var(--err-text)" }}>Claude couldn’t update the plan</div>
        <div className="faint" style={{ fontSize: 12.5 }}>{parsed.error} The canvas is unchanged.</div>
        <div>
          <button className="btn small" onClick={() => onFix(parsed.error)}>
            Ask Claude to fix it
          </button>
        </div>
      </div>
    );
  }
  const v = p.versions.find((x) => x.source === sourceOf(body));
  if (!v) {
    return (
      <div className="plan-edit pending">
        <span className="plan-spin" /> Applying “{parsed.edit.title}”…
      </div>
    );
  }
  const latest = v.version === p.version;
  const items = [
    ...v.changes.added.map((n) => ["+", n, "var(--ok-text, #5FD39A)"]),
    ...v.changes.changed.map((n) => ["~", n, "var(--warn-text)"]),
    ...v.changes.removed.map((n) => ["−", n, "var(--err-text)"]),
  ];
  return (
    <div className="plan-edit">
      <span className="faint" style={{ fontSize: 12 }}>Changes</span>
      <div className="plan-edit-items mono">
        {items.length ? items.map(([s, n, c], i) => <span key={i} style={{ color: c }}>{s} {n}</span>) : <span className="faint">none</span>}
      </div>
      <span className="mono faint" style={{ fontSize: 11.5 }}>v{v.version}</span>
      {latest && (
        <button className="plan-undo" onClick={() => planStore.restore(projectId, v.version - 1, `Undo: ${v.title}`)}>
          Undo
        </button>
      )}
    </div>
  );
}

export function PlanView({ project, graph, workspace, onOpen, onAddRepo }: Props) {
  const p = usePlan(project.id);
  const key = p.chatId ? chatKey(p.chatId) : "plan:loading";
  const conv = useConversation(key);
  const { status } = useAskMeta();
  const [model, setModel] = useAskModel();
  const resolve = useRefResolver(project, graph, workspace);
  const [sel, setSel] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [history, setHistory] = useState(false);
  const [compare, setCompare] = useState<number | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  // The options Claude proposed, opened side by side on the stage.
  const [optionsOpen, setOptionsOpen] = useState<{ key: string; options: PlanOption[] } | null>(null);
  // Architecture or the planned data model.
  const [view, setView] = useState<"arch" | "data" | "code">("arch");
  const [tableSel, setTableSel] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<{ tab: "decisions" | "questions"; highlight: string | null } | null>(null);
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    planStore.load(project.id);
    askStore.status();
  }, [project.id]);

  const dirs = project.repos.map((r) => r.path);
  const send = useCallback(
    (q: string) => {
      if (!p.chatId) return;
      askStore.ask(chatKey(p.chatId), q, planContext(project, p.plan, p.version, graph, workspace), dirs, model || null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.chatId, p.plan, p.version, project, graph, workspace, model],
  );

  // Apply the plan edits of Claude's latest answer once it's complete (each only once, see `source`).
  const applying = useRef(new Set<string>());
  useEffect(() => {
    if (!p.loaded || !p.chatId) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== "assistant" || !last.done || last.error) return;
    for (const m of last.text.matchAll(BLOCK)) {
      const source = sourceOf(m[1]);
      if (applying.current.has(source) || planStore.versionFor(project.id, source)) continue;
      const parsed = parseEdit(m[1]);
      if (!parsed.ok) continue;
      applying.current.add(source);
      planStore.applyClaude(project.id, parsed.edit, source).finally(() => applying.current.delete(source));
    }
    // Options: on an empty plan, the recommended one becomes the first draft.
    for (const m of last.text.matchAll(OPTIONS)) {
      const key = optionsKey(m[1]);
      const parsed = parseOptions(m[1]);
      if (!parsed.ok || applying.current.has(key) || p.versions.some((v) => v.source?.startsWith(`option:${key}:`)) || planStore.current(project.id).components.length) continue;
      const rec = parsed.options.find((o) => o.recommended) ?? parsed.options[0];
      applying.current.add(key);
      planStore.save(project.id, pickOption(planStore.current(project.id), parsed.options, rec), `Picked “${rec.title}”`, optionSource(key, rec.id)).finally(() => applying.current.delete(key));
    }
  }, [conv.messages, p.loaded, p.chatId, p.versions, project.id]);

  // A project planned from scratch starts by sending its brief to Claude.
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current || !p.loaded || !p.chatId || !conv.loaded || conv.running || conv.messages.length || p.plan.components.length || !project.brief?.idea) return;
    kicked.current = true;
    send(`Here's what I want to build:\n${briefText(project.brief)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.loaded, p.chatId, conv.loaded, conv.messages.length]);

  // Just-changed components glow for a moment.
  const glow = useMemo(() => {
    const h = p.highlight;
    return h && h.until > Date.now() ? new Set([...h.changes.added, ...h.changes.changed]) : undefined;
  }, [p.highlight]);
  useEffect(() => {
    if (!p.highlight) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, p.highlight.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [p.highlight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !compare && !history) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compare, history]);

  const save = (next: Plan, title: string, source: string, amend = false) => planStore.save(project.id, next, title, source, { amend, highlight: !amend });
  const selected = view === "arch" ? p.plan.components.find((c) => c.id === sel) ?? null : null;
  const updateTable = (t: PlanTable) => save(applyEdit(p.plan, { title: "", ops: [{ op: "table", table: t }] }).plan, `Edited ▦ ${t.name}`, `manual-table:${t.id}`, true);
  const openDecisions = (tab: "decisions" | "questions", highlight: string | null = null) => {
    setSel(null);
    setDecisions({ tab, highlight });
  };
  const focus = useMemo(() => (focusIds ? new Set(focusIds) : null), [focusIds]);
  const tableCount = p.plan.tables?.length ?? 0;
  // Plan vs. code, once there is code.
  const hasCode = !!graph && project.repos.length > 0;
  const arch = useMemo(() => (hasCode && graph ? buildArchModel(graph, project.repos, workspace) : null), [hasCode, graph, project.repos, workspace]);
  const drift = useMemo(() => (arch && graph && p.plan.components.length ? computeDrift(p.plan, arch, graph, project) : null), [arch, graph, p.plan, project]);
  const compared = useMemo(() => (drift ? comparePlan(p.plan, drift) : null), [drift, p.plan]);
  useEffect(() => {
    if (view === "code" && !drift) setView("arch");
  }, [view, drift]);
  const openQs = p.plan.questions?.length ?? 0;
  const updateComponent = (c: PlanComponent) => save({ ...p.plan, components: p.plan.components.map((x) => (x.id === c.id ? c : x)) }, `Edited ${c.name}`, `manual:${c.id}`, true);
  const remove = (id: string) => {
    const c = p.plan.components.find((x) => x.id === id);
    if (!c) return;
    save(applyEdit(p.plan, { title: "", ops: [{ op: "remove", id }] }).plan, `Removed ${c.name}`, `manual-remove:${id}:${Date.now()}`);
    setSel(null);
  };
  const add = () => {
    const name = "new-component";
    const next = applyEdit(p.plan, { title: "", ops: [{ op: "add", component: { id: slug(name), name, type: "Service" } }] }).plan;
    const added = next.components[next.components.length - 1];
    save(next, "Added a component", `manual-add:${added.id}:${Date.now()}`).then(() => setSel(added.id));
  };

  // Question blocks the user has already answered (a later message of theirs exists).
  const answered = useMemo(() => {
    const out = new Set<string>();
    conv.messages.forEach((m, i) => {
      if (m.role !== "assistant" || !conv.messages.slice(i + 1).some((x) => x.role === "user")) return;
      for (const b of m.text.matchAll(/```strata-questions[^\n]*\n([\s\S]*?)```/g)) out.add(b[1].trim());
    });
    return out;
  }, [conv.messages]);
  const latestSource = p.versions[0]?.source ?? "";
  const currentOption = (key: string) => (latestSource.startsWith(`option:${key}:`) ? latestSource.slice(`option:${key}:`.length).split(":")[0] : null);
  const useOption = (key: string, options: PlanOption[], o: PlanOption) => save(pickOption(p.plan, options, o), `Picked “${o.title}”`, `${optionSource(key, o.id)}:${Date.now()}`);
  const basis = project.brief
    ? [project.brief.scale && `${project.brief.scale} users`, project.brief.team?.toLowerCase(), ...(project.brief.stack ?? []), ...(project.brief.services ?? [])].filter(Boolean).join(" · ")
    : "";

  // The options need the room: the chat steps aside while they're open.
  const chatBefore = useRef(true);
  const openOptions = (o: { key: string; options: PlanOption[] }) => {
    setSel(null);
    setCompare(null);
    chatBefore.current = chatOpen;
    setChatOpen(false);
    setOptionsOpen(o);
  };
  const closeOptions = () => {
    setOptionsOpen(null);
    setChatOpen(chatBefore.current);
  };

  const unavailable = status && !status.available;
  const empty = p.loaded && p.plan.components.length === 0;
  const chatW = chatOpen ? 380 : 56;

  if (!p.loaded) return <div className="page dots" />;
  if (p.error) return <div className="error-banner" style={{ margin: 20 }}>{p.error}</div>;

  return (
    <div className="plan-view">
      <aside className="plan-chat" style={{ width: chatW }}>
        {chatOpen ? (
          <>
            <div className="plan-chat-head">
              <span style={{ color: "var(--arch)" }}>✦</span>
              <b style={{ fontSize: 13 }}>Plan chat</b>
              <span className="faint" style={{ fontSize: 12 }}>with Claude</span>
              <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => setChatOpen(false)} title="Collapse chat">
                ‹
              </button>
            </div>
            <div className="ask-body">
              {unavailable && (
                <div className="insp-warn">
                  Planning uses the Claude Code CLI with your own Claude subscription, but no <span className="mono">claude</span> command was found. Install Claude Code and run <span className="mono">claude</span> once to sign in.
                </div>
              )}
              <MessageList
                convKey={key}
                resolve={resolve}
                onRef={onOpen}
                renderBlock={(lang, body, done) => {
                  const fix = (error: string, kind: string) => send(`Your ${kind} couldn't be read: ${error} Please send it again as strictly valid JSON in one ${kind} block.`);
                  if (lang === "strata-plan") return <EditCard projectId={project.id} body={body} done={done} onFix={(e) => fix(e, "strata-plan")} />;
                  if (lang === "strata-questions") {
                    if (!done) return <div className="plan-edit pending"><span className="plan-spin" /> Writing questions…</div>;
                    const q = parseQuestions(body);
                    if (!q.ok) return <div className="plan-edit error"><div className="faint" style={{ fontSize: 12.5 }}>{q.error}</div><button className="btn small" onClick={() => fix(q.error, "strata-questions")}>Ask Claude to fix it</button></div>;
                    return (
                      <QuestionsCard
                        questions={q.questions}
                        answered={answered.has(body.trim())}
                        busy={!!conv.running}
                        onSubmit={(picks) => {
                          const lines = q.questions.map((x, i) => (picks[i] ? `- ${x.q} ${picks[i]}` : null)).filter(Boolean);
                          send(`${lines.length ? `My answers:\n${lines.join("\n")}\n\n` : ""}Please propose options and draw the first draft.`);
                        }}
                      />
                    );
                  }
                  if (lang === "strata-options") {
                    if (!done) return <div className="plan-edit pending"><span className="plan-spin" /> Sketching options…</div>;
                    const o = parseOptions(body);
                    if (!o.ok) return <div className="plan-edit error"><div className="faint" style={{ fontSize: 12.5 }}>{o.error}</div><button className="btn small" onClick={() => fix(o.error, "strata-options")}>Ask Claude to fix it</button></div>;
                    const key = optionsKey(body);
                    return <OptionsCard options={o.options} current={currentOption(key)} onOpen={() => openOptions({ key, options: o.options })} />;
                  }
                  return null;
                }}
                empty={
                  !unavailable && (
                    <div className="ask-empty">
                      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
                        {p.plan.components.length
                          ? `Ask Claude to change the plan of ${project.name}: add a component, split one up, or question a decision.`
                          : project.repos.length
                            ? `Plan the next step for ${project.name}. Claude starts from the current architecture and draws the plan on the canvas.`
                            : `Describe what you’re building in a few sentences: who it’s for and what it does. Claude asks the rest and draws a first draft.`}
                      </div>
                      <div className="ask-ideas">
                        {(p.plan.components.length
                          ? ["What are the weak spots of this plan?", "Add a background worker for slow jobs", "Which components could be merged?"]
                          : project.repos.length
                            ? ["Draw the current architecture as a plan", "How should we split the biggest service?"]
                            : ["A SaaS for usage-based billing with a customer dashboard", "A mobile app with a backend for booking appointments"]
                        ).map((q) => (
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
            <Composer
              convKey={key}
              onSend={send}
              placeholder={empty ? "Describe what you’re building…" : "Ask for a change, e.g. “add a worker for emails”"}
              model={model}
              setModel={setModel}
              disabled={!!unavailable || !p.chatId}
              prefill={prefill}
              hint="Changes apply to the canvas"
            />
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12, gap: 6 }}>
            <button className="icon-btn plan-chat-open" onClick={() => setChatOpen(true)} title="Open plan chat">
              ✦
            </button>
            <span className="faint" style={{ fontSize: 11 }}>Chat</span>
          </div>
        )}
      </aside>

      <section className={`plan-stage dots ${(selected || decisions) && compare === null ? "has-insp" : ""}`}>
        {optionsOpen ? (
          <OptionsView
            projectName={project.name}
            basis={basis}
            options={optionsOpen.options}
            current={currentOption(optionsOpen.key)}
            onUse={(o) => useOption(optionsOpen.key, optionsOpen.options, o)}
            onMix={(o) => {
              closeOptions();
              setChatOpen(true);
              setPrefill({ text: `Start from “${o.title}”, but `, n: Date.now() });
            }}
            onBack={closeOptions}
          />
        ) : compare !== null && p.version !== null ? (
          <CompareView
            projectId={project.id}
            from={compare}
            to={p.version}
            onRestore={(v) => {
              planStore.restore(project.id, v);
              setCompare(null);
            }}
            onDone={() => setCompare(null)}
          />
        ) : (
          <>
            {!empty && view === "code" && compared && drift && (
              <>
                <PlanCanvas plan={compared.plan} badges={compared.badges} selected={sel} onSelect={setSel} />
                <DriftCard
                  plan={p.plan}
                  drift={drift}
                  busy={!!conv.running}
                  onSelect={setSel}
                  onExplain={() => {
                    setChatOpen(true);
                    send(`Compare the plan with the code. Strata found:\n${driftReport(p.plan, drift)}\n\nLook at the relevant code, explain each deviation, and recommend for each whether the code or the plan should change. If the plan should change, update it in one strata-plan block.`);
                  }}
                  onUpdatePlan={() => {
                    save(planFromCode(p.plan, drift), "Updated from code", `from-code:${Date.now()}`);
                    setView("arch");
                  }}
                />
              </>
            )}
            {!empty && view === "arch" && <PlanCanvas plan={p.plan} selected={sel} onSelect={(id) => (setSel(id), id && setDecisions(null))} glow={glow} focus={focus} onAdd={add} onDelete={() => sel && remove(sel)} />}
            {!empty && view === "data" && (tableCount ? (
              <DataModel
                plan={p.plan}
                selected={tableSel}
                onSelect={setTableSel}
                focus={focus}
                onChangeTable={updateTable}
                onShowOwner={(id) => {
                  setView("arch");
                  setSel(id);
                }}
              />
            ) : (
              <div className="plan-empty">
                <div className="plan-empty-art">
                  <span />
                  <span />
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text-2)" }}>No tables planned yet</div>
                <div className="faint" style={{ fontSize: 13, maxWidth: 340, lineHeight: 1.5 }}>Claude plans the main tables and which component owns each one.</div>
                <button className="btn small plan-primary" disabled={!!conv.running} onClick={() => send("Plan the data model: the main tables with their key columns, each owned by one component.")} style={{ marginTop: 6 }}>
                  ✦ Plan the data model
                </button>
              </div>
            ))}
            {empty && conv.running && (
              <div className="plan-empty">
                <div className="plan-skeleton">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span key={i} style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <div style={{ fontSize: 14, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="plan-spin" />
                  {conv.messages.filter((m) => m.role === "user").length > 1 ? "Claude is drawing the first draft…" : "Claude is reading your idea…"}
                </div>
              </div>
            )}
            {empty && !conv.running && (
              <div className="plan-empty">
                <div className="plan-empty-art">
                  <span />
                  <span />
                  <span />
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: "var(--text-2)" }}>{conv.running ? "Claude is thinking…" : "Your architecture appears here"}</div>
                <div className="faint" style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.5 }}>Describe the idea in the chat. Claude asks what it needs to know and draws the first draft on this canvas.</div>
                <button className="btn small" onClick={add} style={{ marginTop: 6 }}>
                  + Add a component yourself
                </button>
              </div>
            )}
            <div className={`plan-label ${empty ? "" : "below"}`}>
              <span className="mono" style={{ color: "var(--text-2)" }}>{view === "arch" ? "Plan" : view === "data" ? "Data model · planned" : "Plan vs. code"}</span>
              {p.version !== null && (
                <>
                  <span>·</span>
                  <span>{view === "arch" ? `${p.plan.components.length} components` : view === "data" ? `${tableCount} tables` : `${project.repos.length} ${project.repos.length === 1 ? "repo" : "repos"}`}</span>
                </>
              )}
            </div>
            {!empty && (
              <div className="seg plan-lens">
                <button className={view === "arch" ? "on" : ""} onClick={() => (setView("arch"), setTableSel(null))}>
                  <span className="dot" style={{ background: "var(--arch)" }} />
                  Architecture
                </button>
                <button className={view === "data" ? "on" : ""} onClick={() => (setView("data"), setSel(null))}>
                  <span className="dot" style={{ background: "var(--db)" }} />
                  Data model{tableCount ? <span className="faint"> {tableCount}</span> : null}
                </button>
                {drift && (
                  <button className={view === "code" ? "on" : ""} onClick={() => (setView("code"), setSel(null), setDecisions(null))} title="Compare the plan with the scanned code">
                    <span className="dot" style={{ background: "var(--code)" }} />
                    Compare with code
                    {drift.findings.length + drift.missing.length > 0 && <span className="faint"> {drift.findings.length + drift.missing.length}</span>}
                  </button>
                )}
              </div>
            )}
            {conv.running && !empty && (
              <div className="plan-pill glass">
                <span className="plan-spin" /> Claude is working on the plan…
              </div>
            )}
            {p.version !== null && (
              <div className="plan-top-right">
                <button className={`plan-ver-btn ${decisions ? "on" : ""}`} onClick={() => (decisions ? setDecisions(null) : openDecisions(openQs && !(p.plan.decisions?.length) ? "questions" : "decisions"))} title="Decisions and open questions">
                  Decisions
                  {openQs > 0 && <span className="plan-open">{openQs} open</span>}
                </button>
                <button className={`plan-ver-btn ${history ? "on" : ""}`} onClick={() => setHistory((h) => !h)} title="Version history">
                  <span className="plan-ver-icon" />
                  <span className="mono">v{p.version}</span>
                </button>
                <button className="plan-ver-btn plan-docs-btn" onClick={() => setDocsOpen(true)} title="Export the plan as Markdown guidelines">
                  Generate docs
                </button>
              </div>
            )}
            {decisions && (
              <DecisionsPanel
                plan={p.plan}
                initialTab={decisions.tab}
                highlight={decisions.highlight}
                onHover={setFocusIds}
                onResolve={(id) => {
                  const q = p.plan.questions?.find((x) => x.id === id);
                  if (!q) return;
                  setChatOpen(true);
                  send(`Let's resolve open question ${q.id}: ${q.text}${q.detail ? ` (${q.detail})` : ""} What do you recommend? Record the decision and resolve the question.`);
                }}
                onClose={() => (setDecisions(null), setFocusIds(null))}
              />
            )}
            {history && (
              <HistoryPopover
                versions={p.versions}
                current={p.version}
                onClose={() => setHistory(false)}
                onCompare={(v) => {
                  setHistory(false);
                  setSel(null);
                  setCompare(v);
                }}
                onRestore={(v) => {
                  setHistory(false);
                  planStore.restore(project.id, v);
                }}
              />
            )}
            {selected && (
              <PlanInspector
                key={selected.id}
                plan={p.plan}
                component={selected}
                onChange={updateComponent}
                onSelect={setSel}
                onDelete={() => remove(selected.id)}
                onClose={() => setSel(null)}
                onAsk={(c) => {
                  setChatOpen(true);
                  setPrefill({ text: `About ${c.name}: `, n: Date.now() });
                }}
                onShowTable={(id) => {
                  setView("data");
                  setSel(null);
                  setTableSel(id);
                }}
                onShowDecision={(id) => openDecisions("decisions", id)}
                onShowQuestions={() => openDecisions("questions")}
              />
            )}
          </>
        )}
      </section>
      {docsOpen && p.version !== null && <GenerateDocs project={project} plan={p.plan} version={p.version} onAddRepo={onAddRepo} onClose={() => setDocsOpen(false)} />}
    </div>
  );
}

