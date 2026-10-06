import type { Graph, Project } from "../api";
import { KIND_COLOR, type ArchEdge, type ArchModel } from "./archModel";

type Props = {
  model: ArchModel;
  project: Project;
  graph: Graph;
  id: string;
  onSelect: (id: string) => void;
  onOpenFile: (fileId: string) => void;
  onOpenTable: (tableId: string | null) => void;
  onAddRepo: (path: string) => void;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insp-section">
      <div className="insp-label">{title}</div>
      {children}
    </div>
  );
}

const ENTRY = /^(main|index|server|app|cli|worker|entry)\.(m?[tj]sx?)$/;

export function ArchInspector({ model, project, graph, id, onSelect, onOpenFile, onOpenTable, onAddRepo, onClose }: Props) {
  const n = model.byId.get(id);
  if (!n) return null;
  const color = KIND_COLOR[n.kind];
  const out = model.edges.filter((e) => e.source === id);
  const inc = model.edges.filter((e) => e.target === id);
  const filePath = new Map(graph.nodes.filter((x) => x.kind === "file").map((f) => [f.id, f.path ?? f.id]));
  const repoName = (rid: string | null) => project.repos.find((r) => r.id === rid)?.name;

  const edgeRow = (e: ArchEdge, other: string) => {
    const o = model.byId.get(other)!;
    return (
      <div key={e.id} className="insp-row link" onClick={() => onSelect(other)} title={e.inferred ? "Inferred from configuration, not seen as a direct call" : undefined}>
        <span className="insp-bullet" style={{ background: KIND_COLOR[o.kind] }} />
        <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span className="mono" style={{ fontSize: 12 }}>{o.name}</span> <span className="faint" style={{ fontSize: 11.5 }}>{e.reasons.slice(0, 2).join(" · ")}{e.inferred ? " (likely)" : ""}</span>
        </span>
      </div>
    );
  };
  const fileRow = (fid: string, note?: string) => (
    <div key={fid} className="insp-row link" onClick={() => onOpenFile(fid)} title="Show in Code view">
      <span className="insp-bullet" />
      <span className="mono grow">{filePath.get(fid) ?? fid}</span>
      {note && <span className="faint">{note}</span>}
    </div>
  );

  let body: React.ReactNode;
  let actions: React.ReactNode = null;

  if (n.unit) {
    const files = [...model.fileUnit].filter(([, u]) => u === id).map(([f]) => f);
    const fileSet = new Set(files);
    const importers = new Map<string, number>();
    for (const e of graph.edges) if (e.kind === "imports" && fileSet.has(e.dst) && !fileSet.has(e.src)) importers.set(e.dst, (importers.get(e.dst) ?? 0) + 1);
    const entries = files.filter((f) => ENTRY.test((filePath.get(f) ?? "").split("/").pop() ?? "")).sort((a, b) => (filePath.get(a) ?? "").split("/").length - (filePath.get(b) ?? "").split("/").length).slice(0, 4);
    const popular = [...importers].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const tables = new Map<string, { read: boolean; write: boolean }>();
    for (const e of graph.edges) {
      if ((e.kind === "reads" || e.kind === "writes") && fileSet.has(e.src)) {
        const t = tables.get(e.dst) ?? { read: false, write: false };
        t[e.kind === "reads" ? "read" : "write"] = true;
        tables.set(e.dst, t);
      }
    }
    const tableName = (tid: string) => tid.slice(tid.indexOf(":table:") + 7);
    body = (
      <>
        <div className="insp-chips">
          <span className="chip">
            <span className="repo-dot" style={{ width: 6, height: 6, background: project.color }} />
            {repoName(n.repoId)}
          </span>
          <span className="chip">{n.unit.dir || "/"}</span>
          <span className="chip">{n.unit.files} files · {n.unit.lines.toLocaleString()} lines</span>
          {n.unit.ports.map((p) => (
            <span key={p} className="chip">:{p}</span>
          ))}
        </div>
        <Section title={`Talks to · ${out.length}`}>
          {out.map((e) => edgeRow(e, e.target))}
          {out.length === 0 && <div className="faint insp-empty">No outgoing connections found.</div>}
        </Section>
        <Section title={`Used by · ${inc.length}`}>
          {inc.map((e) => edgeRow(e, e.source))}
          {inc.length === 0 && <div className="faint insp-empty">Nothing in this project depends on it.</div>}
        </Section>
        {tables.size > 0 && (
          <Section title={`Tables · ${tables.size}`}>
            {[...tables].slice(0, 12).map(([tid, t]) => (
              <div key={tid} className="insp-row link" onClick={() => onOpenTable(tid)} title="Show in Database view">
                <span className="db-key fk">▦</span>
                <span className="mono grow">{tableName(tid)}</span>
                {t.read && <span className="db-use r">read</span>}
                {t.write && <span className="db-use w">write</span>}
              </div>
            ))}
          </Section>
        )}
        {entries.length > 0 && <Section title="Entry points">{entries.map((f) => fileRow(f))}</Section>}
        {popular.length > 0 && <Section title="Most used from outside">{popular.map(([f, c]) => fileRow(f, `${c}×`))}</Section>}
      </>
    );
  } else if (n.datastore) {
    const usage = new Map<string, number>();
    for (const e of graph.edges) if ((e.kind === "reads" || e.kind === "writes") && n.datastore.tables.includes(e.dst)) usage.set(e.dst, (usage.get(e.dst) ?? 0) + 1);
    const top = [...n.datastore.tables].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0)).slice(0, 10);
    body = (
      <>
        <div className="insp-chips">
          <span className="chip">{n.datastore.tables.length} tables</span>
          {n.infra?.image && <span className="chip">{n.infra.image}</span>}
          {n.infra?.ports.map((p) => <span key={p} className="chip">:{p}</span>)}
        </div>
        <Section title={`Used by · ${inc.length}`}>{inc.map((e) => edgeRow(e, e.source))}</Section>
        <Section title="Most used tables">
          {top.map((tid) => (
            <div key={tid} className="insp-row link" onClick={() => onOpenTable(tid)}>
              <span className="db-key fk">▦</span>
              <span className="mono grow">{tid.slice(tid.indexOf(":table:") + 7)}</span>
              <span className="faint">{usage.get(tid) ?? 0} files</span>
            </div>
          ))}
        </Section>
      </>
    );
    actions = (
      <button className="btn accent grow-btn" style={{ background: "var(--db)" }} onClick={() => onOpenTable(null)}>
        Open Database view
      </button>
    );
  } else if (n.missing) {
    const files = inc.flatMap((e) => e.files);
    body = (
      <>
        <div className="insp-warn">
          {n.missing.repo ? (
            <>
              <b>{n.missing.packageName}</b> comes from the repo <b>{n.missing.repo.repoName}</b>
              {n.missing.repo.projects.length ? `, which is in ${n.missing.repo.projects.join(", ")}` : ""}. Add it here too to complete the map.
            </>
          ) : (
            <>
              <b>{n.missing.packageName}</b> is imported but no package.json in this project declares it. If it’s one of your own packages, add the repo that publishes it.
            </>
          )}
        </div>
        <Section title={`Imported by · ${inc.length} parts`}>{inc.map((e) => edgeRow(e, e.source))}</Section>
        <Section title={`Files · ${files.length}`}>{files.slice(0, 20).map((f) => fileRow(f))}</Section>
      </>
    );
    if (n.missing.repo) {
      const path = n.missing.repo.path;
      actions = (
        <button className="btn accent grow-btn" style={{ background: "var(--warn)" }} onClick={() => onAddRepo(path)}>
          Add {n.missing.repo.repoName} to project
        </button>
      );
    }
  } else {
    // External service or compose infrastructure.
    const files = [...new Set(inc.flatMap((e) => e.files))];
    body = (
      <>
        <div className="insp-chips">
          {n.external?.via.map((v) => <span key={v} className="chip">{v}</span>)}
          {n.infra?.image && <span className="chip">{n.infra.image}</span>}
          {n.infra?.ports.map((p) => <span key={p} className="chip">:{p}</span>)}
          {n.infra?.file && <span className="chip">{n.infra.file}</span>}
        </div>
        <Section title={`Used by · ${inc.length}`}>
          {inc.map((e) => edgeRow(e, e.source))}
          {inc.length === 0 && <div className="faint insp-empty">Defined in docker-compose; no code was seen talking to it directly.</div>}
        </Section>
        {out.length > 0 && <Section title={`Depends on · ${out.length}`}>{out.map((e) => edgeRow(e, e.target))}</Section>}
        {files.length > 0 && <Section title={`Files · ${files.length}`}>{files.slice(0, 20).map((f) => fileRow(f))}</Section>}
      </>
    );
  }

  return (
    <div className="inspector glass">
      <button className="icon-btn insp-close" onClick={onClose} title="Close (Esc)">
        ×
      </button>
      <div className="insp-body">
        <div className="insp-header">
          <div className="insp-tile" style={{ background: color + "24", color, borderColor: color + "80", borderStyle: n.kind === "Missing" ? "dashed" : "solid" }}>
            {n.kind === "Missing" ? "?" : n.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="insp-title">{n.name}</div>
            <div className="insp-meta">{n.unit?.packageName && n.unit.packageName !== n.name ? `${n.unit.packageName} · ` : ""}{n.detail}</div>
          </div>
          <span className="insp-kind">{n.kind}</span>
        </div>
        {body}
      </div>
      {actions && <div className="insp-actions">{actions}</div>}
    </div>
  );
}
