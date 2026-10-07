import { useEffect, useMemo, useState } from "react";
import { Graph, Project, Repo, ScanProgress, api, shortPath } from "../api";
import { StrataLogo } from "../components/StrataLogo";
import { CodeMap, type ZoomLevel } from "../map/CodeMap";
import { DbMap } from "../map/DbMap";
import { ArchMap } from "../map/ArchMap";
import type { WorkspacePackage } from "../map/archModel";
import { AskPanel } from "../ask/AskPanel";
import { ProjectHome } from "../home/ProjectHome";
import { PlanView } from "../plan/PlanView";
import { focusOn, type Focus } from "../map/focus";
import { AiContext } from "../summary/SummarySection";
import { summaryStore, useSummaries } from "../summary/store";
import { archSubject, tableSubject, type Subject } from "../summary/subjects";
import { buildArchModel } from "../map/archModel";
import { buildDbModel } from "../map/dbModel";
import { useSectionPlan } from "../sections/useSections";
import { LENSES, Lens } from "../routes";

export type Progress = Record<string, ScanProgress>;

const LEVELS: ZoomLevel[] = ["System", "Module", "File", "Symbol"];

export const hasMap = (p: Project) => p.repos.some((r) => r.scanStatus === "ok" || (r.scanStatus === "scanning" && r.lastScanAt));
const isScanning = (p: Project) => p.repos.some((r) => r.scanStatus === "scanning");

type ToolbarProps = {
  project: Project;
  lens: Lens;
  setLens: (l: Lens) => void;
  level: ZoomLevel;
  onLevel: (l: ZoomLevel) => void;
  onRescan: () => void;
  askOpen: boolean;
  onToggleAsk: () => void;
};

export function ProjectToolbar({ project, lens, setLens, level, onLevel, onRescan, askOpen, onToggleAsk }: ToolbarProps) {
  // The map controls only make sense once there is a graph to look at.
  const ready = hasMap(project);
  const title = ready ? undefined : "Available after the first repo is scanned";
  const levelsActive = ready && lens === "code";

  return (
    <>
      <div className={levelsActive ? "" : "disabled-ui"} title={title} style={{ display: lens === "home" || lens === "plan" ? "none" : "flex", gap: 2, fontSize: 12.5, marginLeft: 6 }}>
        {LEVELS.map((l) => (
          <button key={l} className={`level-btn ${l === level ? "on" : ""}`} onClick={() => onLevel(l)}>
            {l}
          </button>
        ))}
      </div>
      <div className="spacer" data-tauri-drag-region />
      <div className="seg">
        {LENSES.map((l) => (
          <button key={l.id} className={`${lens === l.id ? "on" : ""} ${ready || l.id === "home" || l.id === "plan" ? "" : "disabled-ui"}`} title={l.id === "home" || l.id === "plan" ? undefined : title} onClick={() => setLens(l.id)}>
            <span className="dot" style={{ background: l.color }} />
            {l.label}
          </button>
        ))}
      </div>
      <div className="spacer" data-tauri-drag-region />
      {ready && (
        <button className="btn small ghost" onClick={onRescan} disabled={isScanning(project)} title="Scan all repos again">
          {isScanning(project) ? "Scanning…" : "↻ Rescan"}
        </button>
      )}
      {ready && lens !== "home" && lens !== "plan" && (
        <button className={`btn small ask-toggle ${askOpen ? "on" : ""}`} onClick={onToggleAsk} title="Ask Strata (⌘J)">
          <span style={{ color: "var(--arch)" }}>✦</span> Ask Strata
        </button>
      )}
    </>
  );
}

function reusable(project: Project, all: Project[]): { repo: Repo; from: string }[] {
  const mine = new Set(project.repos.map((r) => r.id));
  const seen = new Set<string>();
  const out: { repo: Repo; from: string }[] = [];
  for (const p of all) {
    if (p.id === project.id) continue;
    for (const r of p.repos) {
      if (mine.has(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ repo: r, from: p.name });
    }
  }
  return out;
}

function RepoScanRow({ repo, progress }: { repo: Repo; progress?: ScanProgress }) {
  const scanning = repo.scanStatus === "scanning";
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const color = { ok: "var(--ok)", failed: "var(--err)", scanning: "var(--code)", never: "var(--text-3)" }[repo.scanStatus];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
        <span className="repo-dot" style={{ background: color, animation: scanning ? "strataPulse 1.2s infinite" : undefined }} />
        <span className="mono">{repo.name}</span>
        <span className="faint mono" style={{ fontSize: 11.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {repo.remote ?? shortPath(repo.path)}
        </span>
        <span className="faint" style={{ fontSize: 11.5 }}>
          {scanning
            ? progress?.total
              ? `${progress.done}/${progress.total} files`
              : "Reading files…"
            : repo.scanStatus === "ok" && repo.stats
              ? `${repo.stats.files} files`
              : repo.scanStatus === "failed"
                ? "Failed"
                : repo.alsoIn.length
                  ? `also in ${repo.alsoIn.join(", ")}`
                  : ""}
        </span>
      </div>
      {scanning && (
        <div className="progress" style={{ marginLeft: 17 }}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      {repo.scanStatus === "failed" && repo.scanError && (
        <div style={{ marginLeft: 17, fontSize: 12, color: "var(--err-text)" }}>{repo.scanError}</div>
      )}
    </div>
  );
}

type Props = {
  project: Project;
  allProjects: Project[];
  lens: Lens;
  setLens: (l: Lens) => void;
  progress: Progress;
  onAddFolder: () => void;
  onReuse: (repo: Repo) => void;
  onAddRepoPath: (path: string) => void;
  onScan: () => void;
  onLevel: (l: ZoomLevel) => void;
  zoomRequest: { level: ZoomLevel; n: number } | null;
  askOpen: boolean;
  onCloseAsk: () => void;
  /** Reports the loaded graph and workspace packages, for the ⌘K index. */
  onData: (graph: Graph | null, workspace: WorkspacePackage[]) => void;
  /** Jump requests from ⌘K: select something in one of the lenses. */
  jump: { lens: Lens; id: string; n: number } | null;
  /** A question to send to Ask Strata (from ⌘K). */
  askRequest: { q: string; n: number } | null;
  onEnableAi: () => void;
  onOpenSettings: () => void;
};

export function ProjectView({ project, allProjects, lens, setLens, progress, onAddFolder, onReuse, onAddRepoPath, onScan, onLevel, zoomRequest, askOpen, onCloseAsk, onData, jump, askRequest, onEnableAi, onOpenSettings }: Props) {
  const [graph, setGraph] = useState<Graph | null>(null);
  // Where to land when jumping between lenses (a file in Code, a table in Database).
  const [focus, setFocus] = useState<{ code: Focus | null; db: Focus | null; arch: Focus | null }>({ code: null, db: null, arch: null });
  // AI sections per lens, remembered per project.
  const sectionsKey = `strata-sections-${project.id}`;
  const [sectionsOn, setSectionsOn] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(sectionsKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const toggleSections = (lensId: string, on: boolean) => {
    const next = { ...sectionsOn, [lensId]: on };
    setSectionsOn(next);
    try {
      localStorage.setItem(sectionsKey, JSON.stringify(next));
    } catch {}
    if (on && project.aiMode === "off") onEnableAi();
  };
  const sectionLens = lens === "code" || lens === "arch" || lens === "db" ? lens : null;
  const sectionsEnabled = !!sectionLens && !!sectionsOn[sectionLens] && project.aiMode !== "off";

  // The chat open on the Overview (null = the project overview itself).
  const [chatId, setChatId] = useState<string | null>(null);
  const openRef = (ref: { kind: "file" | "table" | "node"; id: string }) => {
    const key = ref.kind === "file" ? "code" : ref.kind === "table" ? "db" : "arch";
    setFocus((f) => ({ ...f, [key]: focusOn(ref.id) }));
    setLens(key);
  };
  // Packages every repo in the workspace provides, to trace "missing" imports to a repo.
  const [workspace, setWorkspace] = useState<WorkspacePackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Reload the graph whenever any repo finishes a scan.
  const scanKey = project.repos.map((r) => `${r.id}@${r.lastScanAt ?? 0}`).join(",");

  useEffect(() => onData(graph, workspace), [graph, workspace, onData]);

  useEffect(() => {
    summaryStore.load(project.id);
  }, [project.id]);

  // "auto" mode: write summaries for every component and table in the background.
  const summaries = useSummaries(project.id);
  const pregen = useMemo<Subject[]>(() => {
    if (project.aiMode !== "auto" || !graph) return [];
    const arch = buildArchModel(graph, project.repos, workspace);
    const db = buildDbModel(graph, project.repos);
    return [
      ...arch.nodes.map((n) => archSubject(project, arch, graph, n.id)),
      ...[...db.tables.keys()].map((id) => tableSubject(project, db, id)),
    ].filter((x): x is Subject => !!x);
  }, [project, graph, workspace]);
  useEffect(() => {
    for (const subj of pregen) if (summaryStore.needs(project.id, subj) && !summaryStore.get(project.id, subj.nodeId)?.error) summaryStore.request(project, subj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pregen]);
  const pregenLeft = pregen.filter((p) => summaries[p.nodeId]?.pending).length;
  const sections = useSectionPlan(project, sectionLens, graph, workspace, sectionsEnabled);

  useEffect(() => {
    if (!jump) return;
    setFocus((f) => ({ ...f, [jump.lens]: focusOn(jump.id) }));
    setLens(jump.lens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  // Planned projects without code open on their plan.
  const planned = project.repos.length === 0 && (!!project.hasPlan || !!project.brief);
  useEffect(() => {
    if (planned && lens === "home") setLens("plan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, lens]);

  useEffect(() => {
    api.workspacePackages().then((w) => setWorkspace(w ?? [])).catch(() => setWorkspace([]));
  }, [scanKey, allProjects.length]);

  useEffect(() => {
    if (!hasMap(project)) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    api
      .getGraph(project.id)
      .then((g) => !cancelled && setGraph(g))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, scanKey]);

  if (lens === "plan" || (planned && lens === "home")) return <PlanView project={project} graph={graph} workspace={workspace} onOpen={openRef} onAddRepo={onAddRepoPath} />;

  if (project.repos.length === 0) {
    const suggestions = reusable(project, allProjects);
    return (
      <div className="page dots" style={{ display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="card" style={{ width: 64, height: 64, display: "grid", placeItems: "center", borderRadius: 16 }}>
            <StrataLogo size={38} mono color="var(--text-2)" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 18 }}>{project.name} has no repos yet</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Add the repositories that make up this system, or plan it with Claude first: describe the idea and Strata draws the architecture.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="btn primary" onClick={onAddFolder}>
              Add local folder
            </button>
            <button className="btn" onClick={() => setLens("plan")}>
              <span style={{ color: "var(--arch)" }}>✦</span> Plan it with Claude
            </button>
          </div>
          {suggestions.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 12, marginTop: 28, marginBottom: 10 }}>
                or reuse a repo from another project
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {suggestions.map(({ repo, from }) => (
                  <button key={repo.id} className="btn small" onClick={() => onReuse(repo)}>
                    <span className="mono">{repo.name}</span>
                    <span className="faint" style={{ fontSize: 11.5 }}>{from}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (lens === "home") {
    return (
      <AiContext.Provider value={{ project, enable: onEnableAi, openSettings: onOpenSettings }}>
        <ProjectHome project={project} graph={graph} workspace={workspace} chatId={chatId} setChatId={setChatId} onOpen={openRef} />
      </AiContext.Provider>
    );
  }

  if (!hasMap(project)) {
    const scanning = isScanning(project);
    return (
      <div className="page dots" style={{ display: "grid", placeItems: "center" }}>
        <div className="card glass" style={{ width: 500, padding: 22, animation: "strataPop .25s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StrataLogo size={40} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{scanning ? `Mapping ${project.name}…` : `Ready to map ${project.name}`}</div>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
                {scanning ? "Parsing files, resolving imports and finding symbols." : `${project.repos.length} ${project.repos.length === 1 ? "repo" : "repos"} connected`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "18px 0" }}>
            {project.repos.map((r) => (
              <RepoScanRow key={r.id} repo={r} progress={progress[r.id]} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="faint" style={{ fontSize: 12, flex: 1 }}>Everything runs locally. Nothing leaves this Mac.</span>
            <button className="btn accent" disabled={scanning} onClick={onScan}>
              {scanning ? "Scanning…" : project.repos.some((r) => r.scanStatus === "failed") ? "Retry scan" : "Scan repos"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) return <div className="error-banner" style={{ margin: 20 }}>{error}</div>;
  if (!graph) return <div className="page dots" />;

  const scanningNow = project.repos.filter((r) => r.scanStatus === "scanning");
  return (
    <AiContext.Provider value={{ project, enable: onEnableAi, openSettings: onOpenSettings }}>
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      {lens === "arch" ? (
        <ArchMap
          project={project}
          graph={graph}
          workspace={workspace}
          onOpenFile={(id) => {
            setFocus((f) => ({ ...f, code: id ? focusOn(id) : null }));
            setLens("code");
          }}
          onOpenTable={(id) => {
            setFocus((f) => ({ ...f, db: id ? focusOn(id) : null }));
            setLens("db");
          }}
          onAddRepo={onAddRepoPath}
          focus={focus.arch}
          plan={sections.plan}
        />
      ) : lens === "db" ? (
        <DbMap
          project={project}
          graph={graph}
          focus={focus.db}
          plan={sections.plan}
          onOpenFile={(id) => {
            setFocus((f) => ({ ...f, code: id ? focusOn(id) : null }));
            setLens("code");
          }}
        />
      ) : (
        <CodeMap
          project={project}
          graph={graph}
          onLevel={onLevel}
          zoomRequest={zoomRequest}
          focus={focus.code}
          plan={sections.plan}
          onOpenTable={(id) => {
            setFocus((f) => ({ ...f, db: id ? focusOn(id) : null }));
            setLens("db");
          }}
        />
      )}
      {sectionLens && (
        <div className="sections-toggle glass">
          <button className={!sectionsOn[sectionLens] ? "on" : ""} onClick={() => toggleSections(sectionLens, false)}>
            Structure
          </button>
          <button className={sectionsOn[sectionLens] ? "on" : ""} onClick={() => toggleSections(sectionLens, true)} title="Let Claude group this map into sections by domain">
            <span className="ai-spark">✦</span> AI sections
          </button>
          {sectionsEnabled && sections.pending && <Organizing />}
          {sectionsEnabled && sections.error && !sections.pending && (
            <button className="sections-retry" title={sections.error} onClick={() => sections.retry()}>
              Failed · retry
            </button>
          )}
        </div>
      )}
      {scanningNow.length > 0 && (
        <div className="glass scan-pill">
          <span className="repo-dot" style={{ background: "var(--code)", animation: "strataPulse 1.2s infinite" }} />
          Rescanning {scanningNow.map((r) => r.name).join(", ")}
          {scanningNow.map((r) => progress[r.id]).filter(Boolean).map((p) => ` · ${p!.done}/${p!.total}`)}
        </div>
      )}
    </div>
      {askOpen && (
        <AskPanel
          project={project}
          graph={graph}
          workspace={workspace}
          lens={lens}
          request={askRequest}
          onClose={onCloseAsk}
          onSaveAsChat={(id) => {
            setChatId(id);
            onCloseAsk();
            setLens("home");
          }}
          onOpen={(ref) => {
            const key = ref.kind === "file" ? "code" : ref.kind === "table" ? "db" : "arch";
            setFocus((f) => ({ ...f, [key]: focusOn(ref.id) }));
            setLens(key);
          }}
        />
      )}
      {pregenLeft > 0 && (
        <div className="glass scan-pill" style={{ top: "auto", bottom: 14, left: "50%" }}>
          <span className="ai-spark">✦</span> Writing summaries · {pregenLeft} left
        </div>
      )}
    </div>
    </AiContext.Provider>
  );
}

/** "Organizing… 12s": a plan for a big lens takes a while, so show that it's moving. */
function Organizing() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="sections-status" title="Claude is grouping the items of this lens into sections">Organizing…{secs >= 3 ? ` ${secs}s` : ""}</span>;
}
