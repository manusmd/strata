import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph, Project } from "../api";
import { buildArchModel, KIND_COLOR, type WorkspacePackage } from "../map/archModel";
import { buildDbModel } from "../map/dbModel";
import { summaryStore, useSummaries } from "../summary/store";
import { pageInput, type PageInput } from "./inputs";
import { wordDiff } from "./links";
import { buildOutline, componentFacts, dataFacts, edgeBetween, GROUPS, makeCtx, runChecklist, sectionFacts, type Chip, type DocsCtx, type FactRow, type PageDef } from "./outline";
import { Diff, MiniMap, Prose, RefChip, relTime, type ChipProps } from "./parts";
import { changedFiles, docsStore, useDocs, type Block, type StoredPage } from "./store";
import { DocsExport, savedTarget } from "./DocsExport";
import { exportFiles } from "./markdown";
import { api } from "../api";

type Status = "fresh" | "stale" | "none" | "writing";

type Props = {
  project: Project;
  graph: Graph;
  workspace: WorkspacePackage[];
  pageId: string;
  onPage: (id: string) => void;
  /** Opens a reference in its lens; `from` is the page it was clicked on (for "Back to Docs"). */
  onOpen: (chip: Chip, from: PageDef) => void;
};

const STATUS_DOT: Record<Status, { bg: string; border: string; anim?: string }> = {
  fresh: { bg: "#3FB47C", border: "#3FB47C" },
  stale: { bg: "#F59E0B", border: "#F59E0B" },
  none: { bg: "transparent", border: "var(--edge-strong)" },
  writing: { bg: "#8B5CF6", border: "#8B5CF6", anim: "strataPulse 1.1s infinite" },
};

export function DocsView({ project, graph, workspace, pageId, onPage, onOpen }: Props) {
  const arch = useMemo(() => buildArchModel(graph, project.repos, workspace), [graph, project.repos, workspace]);
  const db = useMemo(() => buildDbModel(graph, project.repos), [graph, project.repos]);
  const ctx = useMemo(() => makeCtx(project, graph, arch, db), [project, graph, arch, db]);
  const defs = useMemo(() => buildOutline(ctx), [ctx]);
  const summaryEntries = useSummaries(project.id);
  const summaries = useMemo(() => summaryStore.texts(project.id), [project.id, summaryEntries]);
  // One page that can't be described mustn't take the whole Docs lens down: it gets an empty input instead.
  const inputs = useMemo(
    () =>
      new Map(
        defs.map((d) => {
          try {
            return [d.id, pageInput(ctx, d, summaries)];
          } catch (e) {
            console.error(`docs: couldn't prepare ${d.id}`, e);
            return [d.id, { hash: "error", prompt: "", files: [], inputs: {}, slots: [] } as PageInput];
          }
        }),
      ),
    [defs, ctx, summaries],
  );
  const docs = useDocs(project.id);

  useEffect(() => {
    docsStore.load(project.id);
  }, [project.id]);

  const statusOf = (d: PageDef): Status => (docs.pending[d.id] ? "writing" : !docs.pages[d.id] ? "none" : docs.pages[d.id].hash !== inputs.get(d.id)!.hash ? "stale" : "fresh");
  const def = defs.find((d) => d.id === pageId) ?? defs[0];
  const stored = docs.pages[def.id];
  const input = inputs.get(def.id)!;
  const written = defs.filter((d) => docs.pages[d.id]);
  const stale = defs.filter((d) => statusOf(d) === "stale");

  // Width decides the layout: tree as a drawer when narrow, the right rail only when wide.
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    if (!root.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(root.current);
    return () => ro.disconnect();
  }, []);
  const narrow = width < 860;
  const rail = width >= 1180;
  const [drawer, setDrawer] = useState(false);
  const [exporting, setExporting] = useState(false);

  const center = useRef<HTMLDivElement>(null);
  const go = (id: string) => {
    onPage(id);
    setDrawer(false);
    center.current?.scrollTo({ top: 0 });
  };
  const write = (d: PageDef) => docsStore.write(project, ctx, d, summaries, true);
  const writeAll = (list: PageDef[]) => docsStore.writeAll(project, ctx, list, summaries);

  const chipProps: ChipProps = {
    ctx,
    summaries,
    onOpen: (chip) => onOpen(chip, def),
    docsPageOf: (chip) => {
      const target = chip.kind === "component" ? defs.find((d) => d.node === chip.target) : chip.kind === "table" ? defs.find((d) => d.tables?.includes(chip.target!)) : undefined;
      return target && target.id !== def.id ? () => go(target.id) : null;
    },
  };

  // "Keep in sync": every saved page re-exports the docs to the remembered folder.
  const firstRev = useRef(docs.rev);
  useEffect(() => {
    if (docs.rev === firstRev.current) return;
    const target = savedTarget(project.id);
    if (!target?.sync || !target.dir) return;
    const t = setTimeout(() => {
      const files = exportFiles(ctx, defs, docs.pages, target.dir).map(({ path, content }) => ({ path, content }));
      api.writeFiles(target.dir, files).catch((e) => console.error("docs sync failed", e));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.rev]);

  // The flow tour lights up the path in the rail.
  const [tour, setTour] = useState<number | null>(null);
  useEffect(() => setTour(null), [def.id]);

  const nothingYet = written.length === 0 && !docs.run && !Object.keys(docs.pending).length;

  return (
    <div ref={root} className="docs-view">
      <div className="docs-bar">
        {narrow && (
          <button className="btn small" onClick={() => setDrawer((o) => !o)}>
            <span className="docs-burger" /> Pages
          </button>
        )}
        <span className="muted" style={{ whiteSpace: "nowrap" }}>Docs</span>
        <span className="faint">/</span>
        <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: def.mono ? "var(--mono)" : undefined }}>{def.title}</span>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setExporting(true)}>
          Export
        </button>
      </div>

      {narrow && drawer && <div className="docs-scrim-drawer" onClick={() => setDrawer(false)} />}
      <nav className={`docs-tree-pane ${narrow ? "drawer" : ""} ${narrow && drawer ? "open" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Pages</span>
          <span className="faint" style={{ fontSize: 12 }}>{defs.length}</span>
          {narrow && (
            <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => setDrawer(false)}>
              ×
            </button>
          )}
        </div>
        {GROUPS.map((g) => {
          const items = defs.filter((d) => d.group === g);
          if (!items.length) return null;
          return (
            <div key={g} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div className="faint" style={{ padding: "0 8px 4px", fontSize: 12, fontWeight: 600 }}>{g}</div>
              {items.map((d) => {
                const s = STATUS_DOT[statusOf(d)];
                return (
                  <div key={d.id} className={`docs-tree-item ${d.id === def.id ? "on" : ""}`} onClick={() => go(d.id)}>
                    <span className="docs-dot" style={{ background: s.bg, borderColor: s.border, animation: s.anim }} />
                    <span className={d.mono ? "mono" : undefined} style={{ fontSize: d.mono ? 12.5 : 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.title}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="docs-tree-foot">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span className="docs-legend"><span className="docs-dot" style={{ background: "#3FB47C", borderColor: "#3FB47C" }} />Fresh</span>
            <span className="docs-legend"><span className="docs-dot" style={{ background: "#F59E0B", borderColor: "#F59E0B" }} />Out of date</span>
            <span className="docs-legend"><span className="docs-dot" />Not written</span>
          </div>
          <div style={{ lineHeight: 1.45 }}>Structure comes from the scan. Prose is written by Claude.</div>
        </div>
      </nav>

      <div ref={center} className="docs-center" style={{ left: narrow ? 0 : 248, right: rail ? 248 : 0 }}>
        {docs.run && <RunBar run={docs.run} title={defs.find((d) => d.id === docs.run!.current)?.title ?? "…"} onPause={() => docsStore.togglePause(project.id)} />}
        {nothingYet && def.kind === "start" ? (
          <div className="docs-empty">
            <div className="docs-empty-icon">✦</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", marginTop: 4 }}>The outline is ready</div>
            <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
              Strata built {defs.length} pages from the scan of {project.repos.map((r) => r.name).join(", ")}. Facts come straight from the code; Claude writes the explanations around them.
            </div>
            <button className="btn plan-primary" style={{ height: 40, padding: "0 18px", fontSize: 14, marginTop: 8 }} onClick={() => writeAll(defs)}>
              ✦ Write all docs
            </button>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {defs.length} pages · about {Math.max(1, Math.round((defs.length * 25) / 2 / 60))} minutes · you can keep working
            </div>
            <button className="btn small ghost" onClick={() => write(def)}>
              Only write this page
            </button>
          </div>
        ) : (
          <Page
            key={def.id}
            ctx={ctx}
            defs={defs}
            def={def}
            stored={stored}
            input={input}
            status={statusOf(def)}
            error={docs.errors[def.id]}
            chipProps={chipProps}
            onWrite={() => write(def)}
            onGo={go}
            tour={tour}
            setTour={setTour}
            rail={rail}
          />
        )}
      </div>

      {rail && (
        <aside className="docs-rail">
          {def.kind === "flow" && (
            <div className="card docs-card" style={{ overflow: "hidden" }}>
              <div className="docs-card-head">
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Path</span>
                <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => onOpen({ kind: "component", label: "", target: def.steps![0] }, def)}>
                  Architecture ↗
                </button>
              </div>
              <MiniMap ctx={ctx} vertical={def.steps} highlight={tour === null ? undefined : new Set(def.steps!.slice(0, tour + 1))} onPick={(id) => onOpen({ kind: "component", label: "", target: id }, def)} />
            </div>
          )}
          {!(nothingYet && def.kind === "start") && <Outline def={def} stored={stored} center={center} />}
          <div className="card docs-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>Freshness</div>
            <div style={{ fontSize: 14, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600 }}>{written.length - stale.length}</span> of {defs.length} pages up to date
            </div>
            <div className="docs-fresh-bar">
              <div style={{ width: `${((written.length - stale.length) / defs.length) * 100}%`, background: "#3FB47C" }} />
              <div style={{ width: `${(stale.length / defs.length) * 100}%`, background: "#F59E0B" }} />
            </div>
            {stale.slice(0, 4).map((d) => (
              <div key={d.id} className="docs-fresh-row" onClick={() => go(d.id)}>
                <span className="docs-dot" style={{ background: "#F59E0B", borderColor: "#F59E0B", width: 6, height: 6 }} />
                <span className={d.mono ? "mono" : undefined} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{staleWhy(docs.pages[d.id], inputs.get(d.id)!)}</span>
              </div>
            ))}
            {stale.length > 4 && <div className="faint" style={{ fontSize: 12, paddingLeft: 14 }}>+ {stale.length - 4} more</div>}
            {(stale.length > 0 || written.length < defs.length) && (
              <button className="btn small" style={{ justifyContent: "center", height: 30 }} disabled={!!docs.run} onClick={() => writeAll(stale.length ? stale : defs.filter((d) => !docs.pages[d.id]))}>
                <span style={{ color: "var(--arch)" }}>✦</span> {stale.length ? `Refresh ${stale.length}` : `Write ${defs.length - written.length} more`}
              </button>
            )}
            <div className="faint" style={{ fontSize: 12, lineHeight: 1.45 }}>Facts are always live. Prose is only rewritten when you ask.</div>
          </div>
        </aside>
      )}

      {exporting && <DocsExport project={project} ctx={ctx} defs={defs} pages={docs.pages} onClose={() => setExporting(false)} />}
    </div>
  );
}

function staleWhy(page: StoredPage | undefined, input: PageInput): string {
  if (!page) return "";
  const n = changedFiles(page, input.inputs).length;
  return n ? `${n} ${n === 1 ? "file" : "files"}` : "changed";
}

function RunBar({ run, title, onPause }: { run: { total: number; done: number; paused: boolean }; title: string; onPause: () => void }) {
  const left = run.total - run.done;
  const mins = Math.max(1, Math.round((left * 25) / 2 / 60));
  return (
    <div className="docs-run">
      <span className="plan-spin" style={{ animationPlayState: run.paused ? "paused" : "running" }} />
      <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {run.paused ? "Paused" : `Writing ${title}`} · {run.done} of {run.total}
      </span>
      <div className="docs-run-bar">
        <div style={{ width: `${(run.done / run.total) * 100}%` }} />
      </div>
      <span className="faint" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>about {mins} min left</span>
      <button className="btn small" style={{ marginLeft: "auto" }} onClick={onPause}>
        {run.paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}

function Outline({ def, stored, center }: { def: PageDef; stored?: StoredPage; center: React.RefObject<HTMLDivElement | null> }) {
  const heads = (stored?.blocks ?? []).filter((b) => b.heading && def.kind !== "flow").map((b) => ({ key: b.key, label: b.heading! }));
  const extra = def.kind === "start" ? [{ key: "run", label: "How to run it locally" }, { key: "map", label: "Architecture" }] : def.kind === "data" ? [{ key: "tables", label: "Tables" }] : [];
  const all = def.kind === "glossary" ? [] : [...heads, ...extra];
  if (all.length < 2) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div className="faint" style={{ fontSize: 12, fontWeight: 600, padding: "0 10px 6px" }}>On this page</div>
      {all.map((h) => (
        <div key={h.key} className="docs-outline-item" onClick={() => center.current?.querySelector(`#doc-${CSS.escape(h.key)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {h.label}
        </div>
      ))}
    </div>
  );
}

type PageProps = {
  ctx: DocsCtx;
  defs: PageDef[];
  def: PageDef;
  stored?: StoredPage;
  input: PageInput;
  status: Status;
  error?: string;
  chipProps: ChipProps;
  onWrite: () => void;
  onGo: (id: string) => void;
  tour: number | null;
  setTour: (n: number | null | ((n: number | null) => number | null)) => void;
  /** The rail shows the flow's path; without it, the page does. */
  rail: boolean;
};

function Page({ ctx, defs, def, stored, input, status, error, chipProps, onWrite, onGo, tour, setTour, rail }: PageProps) {
  const projectId = ctx.project.id;
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const changed = stored ? changedFiles(stored, input.inputs) : [];
  const updated = (stored?.blocks ?? []).filter((b) => b.prev);
  const node = def.node ? ctx.arch.byId.get(def.node) : undefined;
  const writing = status === "writing";

  // Leaving the page counts as having seen what changed.
  useEffect(() => () => void (updated.length && docsStore.clearPrev(projectId, def.id)), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: { label: string; color?: string; mono?: boolean }[] = [];
  if (node) {
    chips.push({ label: node.kind, color: KIND_COLOR[node.kind] });
    if (node.repoId) chips.push({ label: `${ctx.repoName(node.repoId)}${node.unit?.dir ? ` · ${node.unit.dir}` : ""}`, mono: true });
  }
  const meta = writing ? "Claude is writing…" : stored ? `${stored.read.length ? `Written from ${stored.read.length} ${stored.read.length === 1 ? "file" : "files"} · ` : ""}${relTime(stored.writtenAt)}` : "Not written yet";

  const prose = (b: Block) => (
    <ProseBlock
      key={b.key}
      ctx={ctx}
      block={b}
      stale={status === "stale"}
      read={stored?.read ?? []}
      chipProps={chipProps}
      editing={editing?.key === b.key ? editing : null}
      onEdit={() => setEditing({ key: b.key, draft: b.text })}
      onDraft={(draft) => setEditing({ key: b.key, draft })}
      onCancel={() => setEditing(null)}
      onSave={() => {
        docsStore.edit(projectId, def.id, b.key, editing!.draft);
        setEditing(null);
      }}
      onSuggestion={(accept) => docsStore.resolveSuggestion(projectId, def.id, b.key, accept)}
      showDiff={showDiff}
    />
  );
  const blocks = stored?.blocks ?? [];
  const placeholder = (n = 2) =>
    writing ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 0" }}>
        {Array.from({ length: n * 3 }, (_, i) => (
          <div key={i} className="docs-skel" style={{ width: `${[96, 88, 64, 92, 80, 55][i % 6]}%` }} />
        ))}
      </div>
    ) : !stored ? (
      <div className="docs-unwritten">
        <span style={{ color: "var(--arch)" }}>✦</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Claude hasn't written this page yet</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>The facts above come from the scan. Claude adds the explanations{input.files.length ? `, reading ${input.files.length} files` : ""}.</div>
        </div>
        <button className="btn small plan-primary" onClick={onWrite}>
          ✦ Write page
        </button>
      </div>
    ) : null;

  return (
    <div className="docs-page-col">
      {status === "stale" && stored && (
        <div className="docs-stale">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span className="docs-dot" style={{ background: "#F59E0B", borderColor: "#F59E0B", width: 8, height: 8, marginTop: 7 }} />
            <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.75 }}>
              <span style={{ fontWeight: 600, color: "var(--warn-text)" }}>Out of date</span> —{" "}
              {changed.length ? (
                <>
                  {changed.length} {changed.length === 1 ? "file" : "files"} changed since this page was written (
                  {changed.slice(0, 3).map((l, i) => {
                    const f = ctx.fileByLabel.get(l);
                    return (
                      <span key={l}>
                        {i > 0 && ", "}
                        {f ? <RefChip chip={{ kind: "file", label: f.path ?? l, target: f.id }} {...chipProps} /> : <code className="doc-code">{l}</code>}
                      </span>
                    );
                  })}
                  {changed.length > 3 ? `, ${changed.length - 3} more` : ""}).
                </>
              ) : (
                "what this page describes changed since it was written."
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, paddingLeft: 18 }}>
            <button className="btn small docs-amber" onClick={onWrite}>
              ✦ Refresh page
            </button>
          </div>
        </div>
      )}
      {updated.length > 0 && status !== "stale" && (
        <div className="docs-updated">
          <span style={{ color: "var(--arch)" }}>✦</span>
          <span style={{ flex: 1 }}>
            Refreshed {relTime(stored!.writtenAt)} · {updated.length} {updated.length === 1 ? "paragraph" : "paragraphs"} changed
          </span>
          <button className="link-btn" onClick={() => setShowDiff((s) => !s)}>
            {showDiff ? "Hide changes" : "Show what changed"}
          </button>
        </div>
      )}
      {error && !writing && (
        <div className="error-banner" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn small" onClick={onWrite}>
            Try again
          </button>
        </div>
      )}

      <header className="docs-head-block">
        <div className="faint" style={{ fontSize: 12.5 }}>{def.group}</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <h1 className={`docs-title ${def.mono ? "mono" : ""}`}>{def.kind === "start" ? ctx.project.name : def.title}</h1>
          {stored && (
            <button className="btn small docs-regen" disabled={writing} onClick={onWrite}>
              <span style={{ color: "var(--arch)" }}>✦</span> {writing ? "Writing…" : "Regenerate"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} className="faint">
          {chips.map((c) => (
            <span key={c.label} className={`docs-hchip ${c.mono ? "mono" : ""}`}>
              {c.color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />}
              {c.label}
            </span>
          ))}
          <span style={{ fontSize: 12.5 }}>{meta}</span>
        </div>
      </header>

      {def.kind === "start" && (
        <>
          {blocks.length ? blocks.map(prose) : placeholder()}
          <RunChecklist ctx={ctx} />
          <div id="doc-map" className="card docs-card" style={{ overflow: "hidden" }}>
            <div className="docs-card-head">
              <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--arch)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Architecture</span>
              <span className="faint" style={{ fontSize: 12 }}>read-only · click a component</span>
            </div>
            <MiniMap ctx={ctx} onPick={(id) => chipProps.onOpen({ kind: "component", label: "", target: id })} />
          </div>
          <ReadNext defs={defs} onGo={onGo} />
        </>
      )}

      {def.kind === "component" && (
        <>
          <Facts title="At a glance" rows={componentFacts(ctx, def.node!)} chipProps={chipProps} />
          {blocks.length ? blocks.map(prose) : placeholder(3)}
        </>
      )}

      {def.kind === "section" && (
        <>
          <Facts title="In this part of the system" rows={sectionFacts(ctx, def.members!)} chipProps={chipProps} />
          {blocks.length ? blocks.map(prose) : placeholder()}
        </>
      )}

      {def.kind === "data" && (
        <>
          <Facts title="At a glance" rows={dataFacts(ctx, def.tables!)} chipProps={chipProps} />
          {blocks.length ? blocks.map(prose) : placeholder()}
          <div id="doc-tables" className="docs-h2">Tables</div>
          <div className="docs-tables">
            {def.tables!.map((id) => {
              const t = ctx.db.tables.get(id);
              if (!t) return null;
              return (
                <div key={id} className="card docs-table-card" onClick={() => chipProps.onOpen({ kind: "table", label: t.name, target: t.id })}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {t.columns.length} columns · {t.writers.length ? `written in ${t.writers.length} ${t.writers.length === 1 ? "file" : "files"}` : "not written by code"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {def.kind === "flow" && <FlowSteps ctx={ctx} def={def} blocks={blocks} chipProps={chipProps} placeholder={placeholder(1)} prose={prose} active={tour} setActive={setTour} rail={rail} />}

      {def.kind === "glossary" && (blocks.length ? [...blocks].sort((a, b) => (a.heading ?? "").localeCompare(b.heading ?? "")).map(prose) : placeholder(3))}
    </div>
  );
}

function Facts({ title, rows, chipProps }: { title: string; rows: FactRow[]; chipProps: ChipProps }) {
  if (!rows.length) return null;
  return (
    <div className="card docs-card">
      <div className="docs-card-head">
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span className="docs-from-scan">
          <span />
          from scan · live
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="docs-fact-row">
          <span className="faint" style={{ fontSize: 12.5 }}>{r.label}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {r.items.map((i, n) => (i.kind === "text" || i.kind === "env" ? <span key={n} className="doc-chip static mono">{i.label}{i.sub && <span className="doc-chip-sub">{i.sub}</span>}</span> : <RefChip key={n} chip={i} {...chipProps} />))}
          </div>
        </div>
      ))}
    </div>
  );
}

type ProseBlockProps = {
  ctx: DocsCtx;
  block: Block;
  stale: boolean;
  read: string[];
  chipProps: ChipProps;
  editing: { key: string; draft: string } | null;
  onEdit: () => void;
  onDraft: (d: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onSuggestion: (accept: boolean) => void;
  showDiff: boolean;
  /** Flow steps render their own heading. */
  bare?: boolean;
};

function ProseBlock({ ctx, block: b, stale, read, chipProps, editing, onEdit, onDraft, onCancel, onSave, onSuggestion, showDiff, bare }: ProseBlockProps) {
  const [sources, setSources] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = before) => {
    const el = ta.current;
    if (!el || !editing) return;
    const { selectionStart: s, selectionEnd: e } = el;
    onDraft(editing.draft.slice(0, s) + before + editing.draft.slice(s, e) + after + editing.draft.slice(e));
    requestAnimationFrame(() => el.focus());
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} id={`doc-${b.key}`}>
      {b.heading && !bare && <div className={b.key.startsWith("term:") ? "docs-h3" : "docs-h2"}>{b.heading}</div>}
      <div className={`docs-prose ${b.human ? "human" : ""} ${stale && !b.human ? "stale" : ""}`}>
        {b.human && (
          <div className="faint" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span className="docs-mine">✎ Written by you</span>
            {b.editedAt ? `edited ${relTime(b.editedAt)}` : ""}
          </div>
        )}
        {editing ? (
          <div className="docs-editor">
            <div className="docs-editor-tools">
              <button title="Bold" style={{ fontWeight: 700 }} onClick={() => wrap("**")}>B</button>
              <button title="Code" className="mono" onClick={() => wrap("`")}>{"`"}</button>
              <button title="Link a file" className="mono" onClick={() => wrap("[[file:", "]]")}>file</button>
              <button title="Link a component" className="mono" onClick={() => wrap("[[component:", "]]")}>comp</button>
              <button title="Link a table" className="mono" onClick={() => wrap("[[table:", "]]")}>table</button>
              <span className="faint" style={{ marginLeft: "auto", fontSize: 12, paddingRight: 6 }}>Markdown</span>
            </div>
            <textarea
              ref={ta}
              autoFocus
              value={editing.draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onCancel();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave();
              }}
            />
            <div className="docs-editor-foot">
              <span className="faint" style={{ flex: 1, fontSize: 12 }}>Saving marks this block as yours. Claude won't overwrite it.</span>
              <button className="btn small" onClick={onCancel}>Cancel</button>
              <button className="btn small plan-primary" disabled={!editing.draft.trim()} onClick={onSave}>Save</button>
            </div>
          </div>
        ) : (
          <div className="docs-text">
            <Prose text={b.text} {...chipProps} />
          </div>
        )}
        {!editing && (
          <div className="docs-block-foot">
            {!b.human && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "var(--arch)" }}>✦</span>Written by Claude
              </span>
            )}
            {stale && !b.human && <span style={{ color: "var(--warn-text)", fontWeight: 500 }}>Out of date</span>}
            {read.length > 0 && (
              <button className="link-btn faint" onClick={() => setSources((s) => !s)}>
                Sources · {read.length} {sources ? "▴" : "▾"}
              </button>
            )}
            <button className="link-btn faint docs-edit" onClick={onEdit}>
              ✎ Edit
            </button>
          </div>
        )}
        {sources && (
          <div className="docs-sources">
            {read.map((l) => {
              const f = ctx.fileByLabel.get(l);
              return (
                <div key={l} className="docs-source mono" onClick={() => f && chipProps.onOpen({ kind: "file", label: f.path ?? l, target: f.id })} style={{ cursor: f ? "pointer" : "default" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: f ? "var(--code)" : "var(--edge)" }} />
                  <span className="faint">{l.split("/")[0]}/</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.split("/").slice(1).join("/")}</span>
                  {!f && <span className="faint">not found</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showDiff && b.prev && (
        <div className="docs-diff">
          <div className="docs-diff-head">What changed</div>
          <div className="docs-diff-row">
            <span className="faint">Before</span>
            <div className="muted"><Diff runs={wordDiff(b.prev, b.text)} show="del" /></div>
          </div>
          <div className="docs-diff-row" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="faint">Now</span>
            <div className="muted"><Diff runs={wordDiff(b.prev, b.text)} show="add" /></div>
          </div>
        </div>
      )}
      {b.human && b.suggestion && (
        <div className="docs-suggestion">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ color: "var(--arch)" }}>✦</span>
            <span style={{ fontWeight: 600 }}>Claude suggests an update</span>
            <span className="faint" style={{ fontSize: 12 }}>the code changed since you wrote this</span>
          </div>
          <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
            <Diff runs={wordDiff(b.text, b.suggestion)} show="add" />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn small plan-primary" onClick={() => onSuggestion(true)}>Accept</button>
            <button className="btn small" onClick={() => onSuggestion(false)}>Dismiss</button>
            <span className="faint" style={{ marginLeft: "auto", fontSize: 12 }}>Your text stays as is until you accept.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RunChecklist({ ctx }: { ctx: DocsCtx }) {
  const items = useMemo(() => runChecklist(ctx), [ctx]);
  const key = `strata-docs-run-${ctx.project.id}`;
  const [done, setDone] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setDone((d) => {
      const n = new Set(d);
      n.has(id) ? n.delete(id) : n.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...n]));
      } catch {}
      return n;
    });
  if (!items.length) return null;
  return (
    <>
      <div id="doc-run" className="docs-h2">How to run it locally</div>
      <div className="card docs-card">
        <div className="docs-card-head">
          <span className="muted" style={{ fontSize: 12.5 }}>Checklist for your machine</span>
          <span className="docs-from-scan">
            <span />
            from scan · {items.filter((i) => done.has(i.id)).length} of {items.length} done
          </span>
        </div>
        {items.map((c) => {
          const on = done.has(c.id);
          return (
            <div key={c.id} className="docs-check-row" onClick={() => toggle(c.id)}>
              <span className={`docs-checkbox ${on ? "on" : ""}`}>{on ? "✓" : ""}</span>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: on ? "var(--text-3)" : undefined, textDecoration: on ? "line-through" : undefined }}>
                {c.text}
                {c.code && (
                  <>
                    {": "}
                    <code className="doc-code">{c.code}</code>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ReadNext({ defs, onGo }: { defs: PageDef[]; onGo: (id: string) => void }) {
  const picks = [defs.find((d) => d.kind === "flow"), defs.find((d) => d.kind === "section"), defs.find((d) => d.kind === "data"), defs.find((d) => d.kind === "glossary")].filter((d): d is PageDef => !!d);
  const desc: Record<string, string> = { flow: "Follow a request through the system, step by step.", section: "The parts of the system, column by column.", data: "The tables, who owns them and who writes them.", glossary: "The business words you'll meet in the code." };
  if (!picks.length) return null;
  return (
    <>
      <div className="docs-h2">Read next</div>
      <div className="docs-next">
        {picks.map((d) => (
          <div key={d.id} className="card docs-next-card" onClick={() => onGo(d.id)}>
            <span className="faint" style={{ fontSize: 12 }}>{d.group}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {d.title} <span className="faint" style={{ fontWeight: 400 }}>→</span>
            </span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{desc[d.kind]}</span>
          </div>
        ))}
      </div>
    </>
  );
}

type FlowProps = {
  ctx: DocsCtx;
  def: PageDef;
  blocks: Block[];
  chipProps: ChipProps;
  placeholder: React.ReactNode;
  prose: (b: Block) => React.ReactNode;
  active: number | null;
  setActive: PageProps["setTour"];
  rail: boolean;
};

function FlowSteps({ ctx, def, blocks, chipProps, placeholder, prose, active, setActive, rail }: FlowProps) {
  const steps = def.steps!;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    setActive((a) => (a === null ? 0 : a));
    const t = setInterval(() => setActive((a) => (a === null || a >= steps.length - 1 ? (setPlaying(false), a) : a + 1)), 2600);
    return () => clearInterval(t);
  }, [playing, steps.length]);
  useEffect(() => {
    if (active !== null) document.getElementById(`doc-step:${active}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active]);
  const intro = blocks.find((b) => b.key === "intro");
  return (
    <>
      {intro ? prose(intro) : placeholder}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className={`btn ${playing ? "" : "plan-primary"}`} onClick={() => (playing ? (setPlaying(false), setActive(null)) : setPlaying(true))}>
          <span style={{ fontSize: 11 }}>{playing ? "■" : "▶"}</span> {playing ? "Stop tour" : "Play as tour"}
        </button>
        <span className="faint" style={{ fontSize: 12.5 }}>{playing ? `Step ${(active ?? 0) + 1} of ${steps.length}` : "Steps one by one, with the path highlighted"}</span>
      </div>
      <div className="docs-steps">
        {steps.map((id, i) => {
          const n = ctx.cv.byId.get(id);
          const b = blocks.find((x) => x.key === `step:${i}`);
          const edge = i < steps.length - 1 ? edgeBetween(ctx, id, steps[i + 1]) : undefined;
          const on = active === i;
          return (
            <div key={id} id={`doc-step:${i}`} className={`docs-step ${on ? "on" : ""}`} onMouseEnter={() => !playing && setActive(i)} onMouseLeave={() => !playing && setActive(null)}>
              <div className="docs-step-rail">
                <span className="docs-step-num mono">{i + 1}</span>
                {i < steps.length - 1 && <div className="docs-step-line" />}
              </div>
              <div style={{ paddingBottom: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div className="card docs-step-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {n && <RefChip chip={{ kind: "component", label: n.name, target: n.id }} {...chipProps} />}
                    <span className="faint" style={{ fontSize: 12.5 }}>{n?.kind}</span>
                  </div>
                  {b ? (
                    <div className="docs-text" style={{ fontSize: 14.5, color: "var(--text-2)" }}>
                      <Prose text={b.text} {...chipProps} />
                    </div>
                  ) : (
                    <div className="faint" style={{ fontSize: 13 }}>{n?.detail}</div>
                  )}
                </div>
                {edge && <div className="mono faint" style={{ fontSize: 11.5, paddingLeft: 4 }}>↓ {edge.kind} · {edge.reasons.slice(0, 2).join(" · ")}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {active !== null && !rail && (
        <div className="card docs-card" style={{ overflow: "hidden" }}>
          <MiniMap ctx={ctx} highlight={new Set(steps.slice(0, active + 1))} onPick={(id) => chipProps.onOpen({ kind: "component", label: "", target: id })} />
        </div>
      )}
    </>
  );
}
