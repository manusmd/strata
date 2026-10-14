import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, shortPath, type Project } from "../api";
import { exportFiles } from "./markdown";
import type { DocsCtx, PageDef } from "./outline";
import type { StoredPage } from "./store";

type Props = { project: Project; ctx: DocsCtx; defs: PageDef[]; pages: Record<string, StoredPage>; onClose: () => void };

/** Remembered per project: where the docs go and whether refreshes re-export them. */
export type ExportTarget = { dir: string; sync: boolean };
export const exportKey = (projectId: string) => `strata-docs-export-${projectId}`;
export function savedTarget(projectId: string): ExportTarget | null {
  try {
    return JSON.parse(localStorage.getItem(exportKey(projectId)) ?? "null");
  } catch {
    return null;
  }
}

/** Markdown with a little color: headings, links, code. */
function MdLine({ line }: { line: string }) {
  if (/^#{1,6} /.test(line)) return <span style={{ color: "var(--violet-text)", fontWeight: 600 }}>{line}</span>;
  if (/^<!--/.test(line)) return <span className="faint">{line}</span>;
  const parts = line.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[/.test(p) ? (
          <span key={i} style={{ color: "var(--indigo-text)" }}>{p}</span>
        ) : /^`/.test(p) ? (
          <span key={i} style={{ color: "var(--teal-text)" }}>{p}</span>
        ) : /^\*\*/.test(p) ? (
          <span key={i} style={{ fontWeight: 600 }}>{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function DocsExport({ project, ctx, defs, pages, onClose }: Props) {
  const saved = savedTarget(project.id);
  const [dir, setDir] = useState(saved?.dir ?? project.repos[0]?.path ?? "");
  const [sync, setSync] = useState(saved?.sync ?? false);
  const files = useMemo(() => exportFiles(ctx, defs, pages, dir || "/"), [ctx, defs, pages, dir]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));
  const [current, setCurrent] = useState(files[0]?.path);
  const [phase, setPhase] = useState<{ kind: "select" } | { kind: "writing" } | { kind: "done"; count: number } | { kind: "error"; error: string }>({ kind: "select" });
  const unwritten = defs.filter((d) => !pages[d.id]).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doc = files.find((f) => f.path === current) ?? files[0];
  const repoOfDir = project.repos.find((r) => r.path.replace(/\/$/, "") === dir.replace(/\/$/, ""));
  const toggle = (path: string) =>
    setChecked((c) => {
      const n = new Set(c);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  const run = async () => {
    setPhase({ kind: "writing" });
    try {
      const count = await api.writeFiles(dir, files.filter((f) => checked.has(f.path)).map(({ path, content }) => ({ path, content })));
      try {
        localStorage.setItem(exportKey(project.id), JSON.stringify({ dir, sync }));
      } catch {}
      setPhase({ kind: "done", count });
    } catch (e) {
      setPhase({ kind: "error", error: String(e) });
    }
  };

  // Folder rows, then files, like the file tree in a repo.
  const rows = useMemo(() => {
    const out: { label: string; path?: string; depth: number }[] = [];
    let lastDir = "";
    for (const f of [...files].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))) {
      const parts = f.path.split("/");
      const d = parts.slice(0, -1).join("/");
      if (d !== lastDir && parts.length > 2) out.push({ label: `${parts.slice(1, -1).join("/")}/`, depth: 1 });
      lastDir = d;
      out.push({ label: parts[parts.length - 1], path: f.path, depth: parts.length - 1 });
    }
    return [{ label: "docs/", depth: 0 }, ...out];
  }, [files]);

  return (
    <div className="docs-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docs-modal glass">
        <div className="docs-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Export docs</div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 1 }}>
              {files.length} pages as Markdown · for GitHub, your wiki and coding agents{unwritten ? ` · ${unwritten} not written yet (facts only)` : ""}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
        {phase.kind === "done" ? (
          <div className="docs-done">
            <div style={{ fontSize: 34 }}>✓</div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{phase.count} files written</div>
            <div className="muted mono" style={{ fontSize: 12.5 }}>{shortPath(dir)}/docs</div>
            {sync && <div className="faint" style={{ fontSize: 12.5 }}>Refreshed pages are written here again automatically.</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => revealItemInDir(`${dir}/docs/README.md`).catch(() => {})}>
                Reveal in Finder
              </button>
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
                {rows.map((r, i) => (
                  <div key={`${r.label}${i}`} className={`docs-row ${r.path && r.path === doc?.path ? "on" : ""}`} style={{ paddingLeft: 8 + r.depth * 16 }} onClick={() => r.path && setCurrent(r.path)}>
                    {r.path ? (
                      <span
                        className={`docs-check ${checked.has(r.path) ? "all" : "none"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r.path!);
                        }}
                      >
                        {checked.has(r.path) ? "✓" : ""}
                      </span>
                    ) : (
                      <span style={{ width: 15 }} />
                    )}
                    <span className={`mono ${r.path ? "" : "docs-dir"}`} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="docs-preview">
                <div className="docs-path mono">
                  {doc?.path}
                  <span className="faint" style={{ marginLeft: "auto", fontFamily: "inherit", fontSize: 12 }}>Markdown source</span>
                </div>
                <div className="docs-md-src mono">
                  {doc?.content.split("\n").map((l, i) => (
                    <div key={i}>
                      <span className="faint">{i + 1}</span>
                      <span>
                        <MdLine line={l} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="docs-foot">
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {project.repos.length > 0 && (
                    <div className="seg" style={{ height: 30 }}>
                      {project.repos.map((r) => (
                        <button key={r.id} className={repoOfDir?.id === r.id ? "on" : ""} onClick={() => setDir(r.path)}>
                          {r.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="mono muted" style={{ fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir ? `${shortPath(dir)}/docs` : "No folder"}</span>
                  <button
                    className="btn small"
                    onClick={async () => {
                      const picked = await open({ directory: true, multiple: false, title: "Export the docs to…" });
                      if (typeof picked === "string") setDir(picked);
                    }}
                  >
                    Change…
                  </button>
                  <label className="docs-sync" onClick={() => setSync((s) => !s)}>
                    <span className={`docs-switch ${sync ? "on" : ""}`}>
                      <span />
                    </span>
                    Keep in sync<span className="faint">· re-export on refresh</span>
                  </label>
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  Links become relative Markdown links, e.g. <span className="mono muted">[createOrder()](../../src/orders/create.ts)</span>
                </div>
                {phase.kind === "error" && <div className="error-banner">{phase.error}</div>}
              </div>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn plan-primary" disabled={!dir.startsWith("/") || !checked.size || phase.kind === "writing"} onClick={run}>
                {phase.kind === "writing" ? "Exporting…" : `Export ${checked.size} files`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
