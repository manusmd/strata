import { openPath } from "@tauri-apps/plugin-opener";
import type { Project } from "../api";
import { ORIGIN_LABEL, type DbModel } from "./dbModel";
import { SummarySection } from "../summary/SummarySection";
import { tableSubject } from "../summary/subjects";

type Props = {
  model: DbModel;
  project: Project;
  id: string;
  onSelect: (id: string) => void;
  onOpenFile: (fileId: string) => void;
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

export function DbInspector({ model, project, id, onSelect, onOpenFile, onClose }: Props) {
  const repoName = (rid: string) => project.repos.find((r) => r.id === rid)?.name ?? "repo";
  const table = model.tables.get(id);
  const ghost = model.ghosts.find((g) => g.id === id);
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (table) {
    const refsOut = model.relations.filter((r) => r.from === table.id);
    const refsIn = model.relations.filter((r) => r.to === table.id);
    const users = new Map<string, { read: boolean; write: boolean }>();
    for (const f of table.readers) users.set(f, { ...(users.get(f) ?? { read: false, write: false }), read: true });
    for (const f of table.writers) users.set(f, { ...(users.get(f) ?? { read: false, write: false }), write: true });
    const repo = project.repos.find((r) => r.id === table.repoId);
    const schemaPath = repo ? `${repo.path}/${table.source}` : table.source;
    const tableName = (tid: string) => model.tables.get(tid)?.name ?? model.ghosts.find((g) => g.id === tid)?.name ?? tid;

    body = (
      <>
        <div className="insp-header">
          <div className="insp-tile" style={{ background: "#14B8A624", color: "#14B8A6", borderColor: "#14B8A680" }}>▦</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="insp-title">{table.name}</div>
            <div className="insp-meta">
              {ORIGIN_LABEL[table.origin]}
              {table.model && table.model !== table.name ? ` · ${table.model}` : ""} · {table.columns.length} columns
            </div>
          </div>
          <span className="insp-kind">Table</span>
        </div>
        <div className="insp-chips">
          <span className="chip">
            <span className="repo-dot" style={{ width: 6, height: 6, background: project.color }} />
            {repoName(table.repoId)}
          </span>
          <span className="chip" title={table.source}>
            {table.source.split("/").pop()}:{table.line}
          </span>
        </div>

        <SummarySection subject={() => tableSubject(project, model, table.id)} />

        <Section title={`Used by code · ${users.size} files`}>
          {[...users].map(([fid, u]) => (
            <div key={fid} className="insp-row link" onClick={() => onOpenFile(fid)} title="Show in Code view">
              <span className="insp-bullet" />
              <span className="mono grow">{model.fileNames.get(fid)?.path ?? fid}</span>
              {u.read && <span className="db-use r">read</span>}
              {u.write && <span className="db-use w">write</span>}
            </div>
          ))}
          {users.size === 0 && <div className="faint insp-empty">No code reads or writes this table, or it’s accessed in a way Strata can’t see yet.</div>}
        </Section>

        <Section title={`References · ${refsOut.length}`}>
          {refsOut.map((r) => (
            <div key={r.id} className="insp-row link" onClick={() => onSelect(r.to)}>
              <span className="insp-bullet" style={{ background: "var(--db)" }} />
              <span className="mono grow">
                {r.fromColumn} → {tableName(r.to)}.{r.toColumn}
              </span>
            </div>
          ))}
          {refsOut.length === 0 && <div className="faint insp-empty">No foreign keys.</div>}
        </Section>

        <Section title={`Referenced by · ${refsIn.length}`}>
          {refsIn.map((r) => (
            <div key={r.id} className="insp-row link" onClick={() => onSelect(r.from)}>
              <span className="insp-bullet" style={{ background: "var(--db)" }} />
              <span className="mono grow">
                {tableName(r.from)}.{r.fromColumn}
              </span>
            </div>
          ))}
          {refsIn.length === 0 && <div className="faint insp-empty">No other table points here.</div>}
        </Section>

        <Section title={`Columns · ${table.columns.length}`}>
          {table.columns.map((c) => (
            <div key={c.name} className="insp-row">
              <span className={`db-key ${c.pk ? "pk" : c.fk ? "fk" : ""}`}>{c.pk ? "PK" : c.fk ? "FK" : ""}</span>
              <span className="mono grow">{c.name}</span>
              <span className="faint mono">
                {c.type}
                {c.nullable && !c.pk ? "?" : ""}
                {c.unique ? " · unique" : ""}
              </span>
            </div>
          ))}
        </Section>
      </>
    );
    actions = (
      <button className="btn grow-btn" onClick={() => openPath(schemaPath).catch(() => {})}>
        Open schema file
      </button>
    );
  } else if (ghost) {
    body = (
      <>
        <div className="insp-header">
          <div className="insp-tile" style={{ background: "#F59E0B24", color: "#F59E0B", borderColor: "#F59E0B80", borderStyle: "dashed" }}>?</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="insp-title">{ghost.name}</div>
            <div className="insp-meta">Referenced but not defined in this project</div>
          </div>
          <span className="insp-kind">Missing</span>
        </div>
        <div className="insp-warn">
          A foreign key points at this table, but none of the connected repos defines it. It probably lives in another service’s schema — add that repo to complete the map.
        </div>
        <Section title="Referenced by">
          {ghost.referencedBy.map((tid) => (
            <div key={tid} className="insp-row link" onClick={() => onSelect(tid)}>
              <span className="insp-bullet" style={{ background: "var(--db)" }} />
              <span className="mono grow">{model.tables.get(tid)?.name}</span>
            </div>
          ))}
        </Section>
      </>
    );
  } else return null;

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
