import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, shortPath, type Project } from "../api";
import { Markdown } from "../ask/Markdown";
import { generateDocs, roadmapPrompt, type DocFile } from "./docs";
import type { Plan } from "./model";
import { PlanCanvas } from "./PlanCanvas";

type Props = { project: Project; plan: Plan; version: number | null; onAddRepo: (path: string) => void; onClose: () => void };

const ROADMAP = "ROADMAP.md";
const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/** Where the docs probably belong: the project's repo, or a new folder next to the user's other repos. */
async function suggestFolder(project: Project): Promise<string> {
  if (project.repos[0]) return project.repos[0].path;
  const all = await api.listProjects().catch(() => [] as Project[]);
  const parents = new Map<string, number>();
  for (const r of all.flatMap((p) => p.repos)) {
    const parent = r.path.replace(/\/[^/]+\/?$/, "");
    parents.set(parent, (parents.get(parent) ?? 0) + 1);
  }
  const parent = [...parents].sort((a, b) => b[1] - a[1])[0]?.[0];
  return parent ? `${parent}/${kebab(project.name)}` : "";
}

/** "Generate docs": pick files, preview them, write them to a folder (from the design's "Plan · Generate docs"). */
export function GenerateDocs({ project, plan, version, onAddRepo, onClose }: Props) {
  const base = useMemo(() => generateDocs(project.name, project.brief, plan, version), [project.name, project.brief, plan, version]);
  const [roadmap, setRoadmap] = useState<{ state: "idle" | "drafting" | "ready" | "error"; content?: string; error?: string }>({ state: "idle" });
  const files: DocFile[] = useMemo(
    () => [...base.slice(0, 3), { path: ROADMAP, title: "Roadmap", group: "root" as const, content: roadmap.content ?? "" }, ...base.slice(3)],
    [base, roadmap.content],
  );
  const [checked, setChecked] = useState<Set<string>>(() => new Set(base.map((f) => f.path)));
  const [current, setCurrent] = useState("ARCHITECTURE.md");
  const [folder, setFolder] = useState("");
  const [git, setGit] = useState(project.repos.length === 0);
  const [existing, setExisting] = useState<string[]>([]);
  const [phase, setPhase] = useState<{ kind: "select" } | { kind: "writing" } | { kind: "done"; count: number } | { kind: "error"; error: string }>({ kind: "select" });

  useEffect(() => {
    suggestFolder(project).then((f) => setFolder((cur) => cur || f));
  }, [project]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = files.filter((f) => checked.has(f.path) && (f.path !== ROADMAP || roadmap.state === "ready"));
  useEffect(() => {
    if (!folder.startsWith("/")) return setExisting([]);
    const t = setTimeout(() => {
      invoke<string[]>("docs_existing", { dir: folder, paths: selected.map((f) => f.path) }).then(setExisting).catch(() => setExisting([]));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, selected.length]);

  const draftRoadmap = async () => {
    setRoadmap({ state: "drafting" });
    try {
      const content = await invoke<string>("draft_roadmap", { prompt: roadmapPrompt(project.name, project.brief, plan), model: "sonnet" });
      setRoadmap({ state: "ready", content });
      setChecked((c) => new Set([...c, ROADMAP]));
    } catch (e) {
      setRoadmap({ state: "error", error: String(e) });
    }
  };

  const write = async () => {
    setPhase({ kind: "writing" });
    try {
      const count = await invoke<number>("write_docs", { dir: folder, files: selected.map(({ path, content }) => ({ path, content })), git });
      setPhase({ kind: "done", count });
    } catch (e) {
      setPhase({ kind: "error", error: String(e) });
    }
  };

  const toggle = (path: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  const groupToggle = (paths: string[]) =>
    setChecked((c) => {
      const all = paths.every((p) => c.has(p));
      const n = new Set(c);
      for (const p of paths) (all ? n.delete(p) : n.add(p));
      return n;
    });

  // The tree: root files, then folders with their files.
  const tree = useMemo(() => {
    const rows: { label: string; path?: string; folder?: string[]; depth: number }[] = [];
    const root = files.filter((f) => !f.path.includes("/") );
    rows.push(...root.map((f) => ({ label: f.path, path: f.path, depth: 0 })));
    const nested = files.filter((f) => f.path.includes("/"));
    const dirs = [...new Set(nested.map((f) => f.path.split("/")[0]))];
    for (const d of dirs) {
      const inDir = nested.filter((f) => f.path.split("/")[0] === d);
      rows.push({ label: `${d}/`, folder: inDir.map((f) => f.path), depth: 0 });
      const sub = new Map<string, DocFile[]>();
      for (const f of inDir) {
        const parts = f.path.split("/");
        const key = parts.length > 2 ? parts.slice(1, -1).join("/") : "";
        sub.set(key, [...(sub.get(key) ?? []), f]);
      }
      for (const [k, fs] of sub) {
        if (k) rows.push({ label: `${k}/`, folder: fs.map((f) => f.path), depth: 1 });
        for (const f of fs) rows.push({ label: f.path.split("/").pop()!, path: f.path, depth: k ? 2 : 1 });
      }
    }
    return rows;
  }, [files]);

  const doc = files.find((f) => f.path === current) ?? files[0];
  const isRepo = project.repos.some((r) => r.path.replace(/\/$/, "") === folder.replace(/\/$/, ""));

  return (
    <div className="docs-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docs-modal glass">
        <div className="docs-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Generate docs</div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 1 }}>From plan v{version} · Markdown for humans and coding agents</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        {phase.kind === "done" ? (
          <div className="docs-done">
            <div className="docs-done-icon">✓</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Wrote {phase.count} files</div>
            <div className="mono muted" style={{ fontSize: 13 }}>{shortPath(folder)}</div>
            <div className="muted" style={{ fontSize: 13.5, maxWidth: 460, lineHeight: 1.55, textAlign: "center" }}>
              Claude Code and other agents now find the rules in AGENTS.md and CLAUDE.md. Once there's code, add the folder as a repo and Strata compares the code with the plan.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => revealItemInDir(`${folder}/ARCHITECTURE.md`).catch(() => {})}>
                Reveal in Finder
              </button>
              {!isRepo && (
                <button
                  className="btn plan-primary"
                  onClick={() => {
                    onAddRepo(folder);
                    onClose();
                  }}
                >
                  Add as repo
                </button>
              )}
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="docs-body">
              <div className="docs-tree">
                <div className="faint" style={{ padding: "4px 8px 8px", fontSize: 12, fontWeight: 600 }}>Files</div>
                {tree.map((r) => {
                  const paths = r.folder ?? [r.path!];
                  const on = paths.filter((p) => checked.has(p) && (p !== ROADMAP || roadmap.state === "ready")).length;
                  const state = on === paths.length ? "all" : on ? "some" : "none";
                  return (
                    <div
                      key={r.label + r.depth + (r.path ?? "")}
                      className={`docs-row ${r.path === current ? "on" : ""}`}
                      style={{ paddingLeft: 8 + r.depth * 16 }}
                      onClick={() => (r.path ? setCurrent(r.path) : groupToggle(paths))}
                    >
                      <span
                        className={`docs-check ${state}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.path === ROADMAP && roadmap.state !== "ready") return setCurrent(ROADMAP);
                          r.folder ? groupToggle(paths) : toggle(r.path!);
                        }}
                      >
                        {state === "all" ? "✓" : state === "some" ? "–" : ""}
                      </span>
                      <span className={`mono ${r.folder ? "docs-dir" : ""}`} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.label}
                      </span>
                      {r.path === ROADMAP && roadmap.state !== "ready" && <span className="plan-rec" style={{ marginLeft: "auto", fontSize: 10.5 }}>✦</span>}
                    </div>
                  );
                })}
              </div>
              <div className="docs-preview">
                <div className="docs-path mono">
                  {doc.path}
                  <span className="faint" style={{ marginLeft: "auto", fontFamily: "inherit", fontSize: 12 }}>Preview</span>
                </div>
                <div className="docs-page">
                  {doc.path === ROADMAP && roadmap.state !== "ready" ? (
                    <div className="docs-roadmap">
                      <div style={{ fontSize: 16, fontWeight: 600 }}>Roadmap</div>
                      <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>Claude turns the plan into 3–5 milestones in build order: a walking skeleton first, risky integrations early, hardening last.</div>
                      {roadmap.state === "error" && <div className="error-banner">{roadmap.error}</div>}
                      <button className="btn plan-primary" style={{ alignSelf: "flex-start" }} disabled={roadmap.state === "drafting"} onClick={draftRoadmap}>
                        {roadmap.state === "drafting" ? (
                          <>
                            <span className="plan-spin" style={{ borderColor: "rgba(255,255,255,.35)", borderTopColor: "#fff" }} /> Drafting…
                          </>
                        ) : (
                          "✦ Draft with Claude"
                        )}
                      </button>
                    </div>
                  ) : doc.path.endsWith(".json") ? (
                    <pre className="docs-json mono">{doc.content}</pre>
                  ) : (
                    <div className="docs-md">
                      <Markdown
                        text={doc.content}
                        resolve={() => null}
                        onRef={() => {}}
                        renderBlock={(lang) =>
                          lang === "mermaid" ? (
                            <div className="docs-mermaid">
                              <div className="mono faint" style={{ fontSize: 11.5 }}>```mermaid · rendered</div>
                              <div style={{ height: 260, position: "relative" }}>
                                <PlanCanvas plan={plan} interactive={false} />
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="docs-foot">
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <span className="muted" style={{ fontSize: 12.5 }}>Write to</span>
                    <input className="docs-folder mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/path/to/folder" />
                    <button
                      className="btn small"
                      onClick={async () => {
                        const picked = await open({ directory: true, multiple: false, title: "Write the docs to…" });
                        if (typeof picked === "string") setFolder(picked);
                      }}
                    >
                      Choose…
                    </button>
                  </div>
                  <label className="docs-toggle">
                    <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
                    <span className="docs-switch" />
                    Also create git repository
                  </label>
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {phase.kind === "error" ? (
                    <span style={{ color: "var(--err-text)" }}>{phase.error}</span>
                  ) : existing.length ? (
                    <span style={{ color: "var(--warn-text)" }}>
                      Overwrites {existing.length} existing {existing.length === 1 ? "file" : "files"}: {existing.slice(0, 3).join(", ")}
                      {existing.length > 3 ? "…" : ""}
                    </span>
                  ) : (
                    <>
                      The plan is saved as <span className="mono">.strata/plan.json</span> next to the docs. The folder is created if needed.
                    </>
                  )}
                </div>
              </div>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn plan-primary" style={{ minWidth: 130 }} disabled={!folder.startsWith("/") || !selected.length || phase.kind === "writing"} onClick={write}>
                {phase.kind === "writing" ? "Writing…" : existing.length ? `Overwrite & write ${selected.length}` : `Write ${selected.length} files`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
