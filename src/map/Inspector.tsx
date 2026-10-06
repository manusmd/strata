import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Project } from "../api";
import { clusterLabel, type CodeModel, type FileInfo } from "./model";

export type Selection = { kind: "repo" | "group" | "cluster" | "file" | "ghost"; id: string };

type Props = {
  model: CodeModel;
  project: Project;
  sel: Selection;
  onSelect: (s: Selection) => void;
  onOpenTable: (tableId: string) => void;
  onClose: () => void;
};

const KIND_ICON: Record<string, string> = { function: "ƒ", class: "C", type: "T", const: "k" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insp-section">
      <div className="insp-label">{title}</div>
      {children}
    </div>
  );
}

function FileLink({ file, onSelect, note }: { file: FileInfo; onSelect: Props["onSelect"]; note?: string }) {
  return (
    <div className="insp-row link" onClick={() => onSelect({ kind: "file", id: file.id })} title={file.path}>
      <span className="insp-bullet" />
      <span className="mono grow">{file.path}</span>
      {note && <span className="faint">{note}</span>}
    </div>
  );
}

function Header({ mono, title, meta, kind, color, dashed }: { mono: string; title: string; meta: string; kind: string; color: string; dashed?: boolean }) {
  return (
    <div className="insp-header">
      <div className="insp-tile" style={{ background: color + "24", color, borderStyle: dashed ? "dashed" : "solid", borderColor: color + "80" }}>
        {mono}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="insp-title">{title}</div>
        <div className="insp-meta">{meta}</div>
      </div>
      <span className="insp-kind">{kind}</span>
    </div>
  );
}

const absPath = (project: Project, repoId: string, rel: string) => {
  const repo = project.repos.find((r) => r.id === repoId);
  return repo ? (rel ? `${repo.path}/${rel}` : repo.path) : rel;
};

export function Inspector({ model, project, sel, onSelect, onOpenTable, onClose }: Props) {
  const repoName = (id: string) => project.repos.find((r) => r.id === id)?.name ?? "repo";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (sel.kind === "file") {
    const f = model.files.get(sel.id);
    if (!f) return null;
    const abs = absPath(project, f.repoId, f.path);
    const exported = f.symbols.filter((s) => s.meta?.exported).length;
    body = (
      <>
        <Header mono={f.name.split(".").pop()!.toUpperCase().slice(0, 3)} title={f.name} meta={`${f.path} · ${f.lines} lines`} kind="File" color="#6366F1" />
        <div className="insp-chips">
          <span className="chip">
            <span className="repo-dot" style={{ width: 6, height: 6, background: project.color }} />
            {repoName(f.repoId)}
          </span>
          <span className="chip">{f.imports.length} imports</span>
          <span className="chip">{f.importedBy.length} importers</span>
        </div>
        {f.parseError && <div className="insp-warn">Tree-sitter hit syntax it couldn’t fully parse. Symbols may be incomplete.</div>}
        <Section title={`Symbols · ${f.symbols.length}${exported ? ` (${exported} exported)` : ""}`}>
          {f.symbols.length === 0 && <div className="faint insp-empty">No top-level declarations.</div>}
          {f.symbols.map((s) => (
            <div key={s.id} className="insp-row link" onClick={() => openPath(abs).catch(() => {})} title={`Line ${s.meta?.line}`}>
              <span className="insp-sym">{KIND_ICON[s.meta?.symbolKind] ?? "·"}</span>
              <span className="mono grow">
                {s.name}
                {s.meta?.symbolKind === "function" ? "()" : ""}
              </span>
              {s.meta?.exported && <span className="insp-exp">export</span>}
              <span className="faint">{s.meta?.lines} ln</span>
            </div>
          ))}
        </Section>
        {f.tables.length > 0 && (
          <Section title={`Database · ${f.tables.length} tables`}>
            {f.tables.map((t) => (
              <div key={t.id} className="insp-row link" onClick={() => onOpenTable(t.id)} title="Show in Database view">
                <span className="db-key fk">▦</span>
                <span className="mono grow">{t.name}</span>
                {t.read && <span className="db-use r">read</span>}
                {t.write && <span className="db-use w">write</span>}
              </div>
            ))}
          </Section>
        )}
        <Section title={`Imports · ${f.imports.length}`}>
          {f.imports.map((id) => (
            <FileLink key={id} file={model.files.get(id)!} onSelect={onSelect} />
          ))}
          {f.packages.map((p) => (
            <div key={p} className="insp-row">
              <span className="insp-bullet pkg" />
              <span className="mono grow">{p}</span>
              <span className="faint">package</span>
            </div>
          ))}
          {f.imports.length + f.packages.length === 0 && <div className="faint insp-empty">Imports nothing.</div>}
        </Section>
        <Section title={`Imported by · ${f.importedBy.length}`}>
          {f.importedBy.map((id) => (
            <FileLink key={id} file={model.files.get(id)!} onSelect={onSelect} />
          ))}
          {f.importedBy.length === 0 && <div className="faint insp-empty">Nothing imports this file. An entry point, or dead code?</div>}
        </Section>
      </>
    );
    actions = (
      <>
        <button className="btn accent grow-btn" onClick={() => openPath(abs).catch(() => {})}>
          Open file
        </button>
        <button className="btn" onClick={() => revealItemInDir(abs).catch(() => {})}>
          Reveal
        </button>
      </>
    );
  } else if (sel.kind === "cluster") {
    const c = model.clusters.get(sel.id);
    if (!c) return null;
    const lines = c.files.reduce((n, f) => n + f.lines, 0);
    const outs = model.clusterEdges.filter((e) => e.source === c.id).sort((a, b) => b.count - a.count);
    const ins = model.clusterEdges.filter((e) => e.target === c.id).sort((a, b) => b.count - a.count);
    const pkgs = new Map<string, number>();
    for (const f of c.files) for (const p of f.packages) pkgs.set(p, (pkgs.get(p) ?? 0) + 1);
    const folderRow = (id: string, count: number) => {
      const other = model.clusters.get(id);
      const ghost = model.ghosts.find((g) => g.id === id);
      return (
        <div key={id} className="insp-row link" onClick={() => onSelect({ kind: other ? "cluster" : "ghost", id })}>
          <span className={`insp-bullet ${ghost ? "warn" : ""}`} />
          <span className="mono grow">{other ? `${repoName(other.repoId)}/${clusterLabel(other)}` : ghost?.name}</span>
          <span className="faint">{count}×</span>
        </div>
      );
    };
    body = (
      <>
        <Header mono="DIR" title={clusterLabel(c)} meta={`${repoName(c.repoId)} · ${c.files.length} files · ${lines.toLocaleString()} lines`} kind="Folder" color="#8B5CF6" />
        <Section title={`Uses · ${outs.length} folders`}>
          {outs.map((e) => folderRow(e.target, e.count))}
          {model.ghostEdges.filter((e) => e.source === c.id).map((e) => folderRow(e.target, e.count))}
          {outs.length === 0 && <div className="faint insp-empty">Doesn’t import other folders.</div>}
        </Section>
        <Section title={`Used by · ${ins.length} folders`}>
          {ins.map((e) => folderRow(e.source, e.count))}
          {ins.length === 0 && <div className="faint insp-empty">No other folder imports this one.</div>}
        </Section>
        <Section title={`Packages · ${pkgs.size}`}>
          {[...pkgs].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => (
            <div key={p} className="insp-row">
              <span className="insp-bullet pkg" />
              <span className="mono grow">{p}</span>
              <span className="faint">{n} files</span>
            </div>
          ))}
          {pkgs.size === 0 && <div className="faint insp-empty">No package imports.</div>}
        </Section>
      </>
    );
    actions = (
      <button className="btn grow-btn" onClick={() => revealItemInDir(absPath(project, c.repoId, c.dir)).catch(() => {})}>
        Reveal in Finder
      </button>
    );
  } else if (sel.kind === "group") {
    const dir = sel.id.slice(sel.id.indexOf(":group:") + 7);
    const repoId = sel.id.slice(0, sel.id.indexOf(":group:"));
    const inside = [...model.clusters.values()].filter((c) => c.repoId === repoId && (c.dir === dir || c.dir.startsWith(dir + "/")));
    const ids = new Set(inside.map((c) => c.id));
    const files = inside.reduce((n, c) => n + c.files.length, 0);
    const lines = inside.reduce((n, c) => n + c.files.reduce((m, f) => m + f.lines, 0), 0);
    const outs = new Map<string, number>();
    const ins = new Map<string, number>();
    for (const e of model.clusterEdges) {
      if (ids.has(e.source) && !ids.has(e.target)) outs.set(e.target, (outs.get(e.target) ?? 0) + e.count);
      if (ids.has(e.target) && !ids.has(e.source)) ins.set(e.source, (ins.get(e.source) ?? 0) + e.count);
    }
    const row = ([id, n]: [string, number]) => {
      const c = model.clusters.get(id)!;
      return (
        <div key={id} className="insp-row link" onClick={() => onSelect({ kind: "cluster", id })}>
          <span className="insp-bullet" />
          <span className="mono grow">{c.dir || "/"}</span>
          <span className="faint">{n}×</span>
        </div>
      );
    };
    body = (
      <>
        <Header mono="DIR" title={dir} meta={`${repoName(repoId)} · ${files} files · ${lines.toLocaleString()} lines`} kind="Folder" color="#8B5CF6" />
        <Section title={`Uses · ${outs.size} folders outside`}>
          {[...outs].sort((a, b) => b[1] - a[1]).slice(0, 15).map(row)}
          {outs.size === 0 && <div className="faint insp-empty">Self-contained.</div>}
        </Section>
        <Section title={`Used by · ${ins.size} folders outside`}>
          {[...ins].sort((a, b) => b[1] - a[1]).slice(0, 15).map(row)}
          {ins.size === 0 && <div className="faint insp-empty">Nothing outside uses this folder.</div>}
        </Section>
        <Section title={`Sub-folders · ${inside.length}`}>
          {inside.slice(0, 30).map((c) => (
            <div key={c.id} className="insp-row link" onClick={() => onSelect({ kind: "cluster", id: c.id })}>
              <span className="insp-bullet" />
              <span className="mono grow">{c.dir.slice(dir.length + 1) || "./"}</span>
              <span className="faint">{c.files.length}</span>
            </div>
          ))}
        </Section>
      </>
    );
    actions = (
      <button className="btn grow-btn" onClick={() => revealItemInDir(absPath(project, repoId, dir)).catch(() => {})}>
        Reveal in Finder
      </button>
    );
  } else if (sel.kind === "ghost") {
    const g = model.ghosts.find((x) => x.id === sel.id);
    if (!g) return null;
    const users = [...model.files.values()].filter((f) => f.packages.includes(g.name));
    body = (
      <>
        <Header mono="?" title={g.name} meta={`Not declared · imported in ${g.repoIds.map(repoName).join(", ")}`} kind="Missing" color="#F59E0B" dashed />
        <div className="insp-warn">
          This package is imported but not listed in any package.json of this project. If it lives in another repo of yours, add that repo to the project to complete the map.
        </div>
        <Section title={`Imported in · ${users.length} files`}>
          {users.map((f) => (
            <FileLink key={f.id} file={f} onSelect={onSelect} />
          ))}
        </Section>
      </>
    );
  } else if (sel.kind === "repo") {
    const r = model.repos.find((x) => x.id === sel.id);
    const repo = project.repos.find((x) => x.id === sel.id);
    if (!r || !repo) return null;
    const s = repo.stats;
    body = (
      <>
        <Header mono={r.name.slice(0, 2).toUpperCase()} title={r.name} meta={repo.remote ?? repo.path} kind="Repo" color={project.color} />
        {s && (
          <div className="insp-stats">
            <div><b>{s.files}</b><span>files</span></div>
            <div><b>{s.symbols}</b><span>symbols</span></div>
            <div><b>{s.imports}</b><span>imports</span></div>
            <div><b>{s.packages}</b><span>packages</span></div>
          </div>
        )}
        {s && s.unresolved > 0 && <div className="insp-note">{s.unresolved} relative imports couldn’t be resolved to a file.</div>}
        <Section title={`Folders · ${r.clusters.length}`}>
          {r.clusters.slice(0, 40).map((c) => (
            <div key={c.id} className="insp-row link" onClick={() => onSelect({ kind: "cluster", id: c.id })}>
              <span className="insp-bullet" />
              <span className="mono grow">{clusterLabel(c)}</span>
              <span className="faint">{c.files.length}</span>
            </div>
          ))}
        </Section>
      </>
    );
    actions = (
      <button className="btn grow-btn" onClick={() => revealItemInDir(repo.path).catch(() => {})}>
        Reveal in Finder
      </button>
    );
  }

  return (
    <div className="inspector glass">
      <button className="icon-btn insp-close" onClick={onClose} title="Close (Esc)">
        ×
      </button>
      <div className="insp-body">{body}</div>
      {actions && <div className="insp-actions">{actions}</div>}
    </div>
  );
}
