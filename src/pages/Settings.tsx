import { useEffect, useState } from "react";
import { PROJECT_COLORS, Project, initials, shortPath, timeAgo, type AiMode } from "../api";
import { summaryStore, useSummaries } from "../summary/store";
import { ProjectTile } from "../components/ProjectTile";

type Props = {
  project: Project;
  onSave: (name: string, color: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (repoId: string) => void;
  onRescan: (repoId: string) => void;
  onSetAi: (mode: AiMode, model: string) => void;
  onDelete: () => void;
};

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 34 }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
          {desc}
        </div>
      </div>
      {children}
    </section>
  );
}

const AI_MODES: { id: AiMode; title: string; desc: string }[] = [
  { id: "off", title: "Off", desc: "Nothing leaves this Mac." },
  { id: "click", title: "On click", desc: "Write a summary when you select something." },
  { id: "auto", title: "On click + pre-generate", desc: "Also summarize every component and table in the background." },
];
const AI_MODELS = [
  { id: "haiku", label: "Haiku — fastest, lightest on your plan" },
  { id: "sonnet", label: "Sonnet — more thorough" },
  { id: "opus", label: "Opus — most capable, slowest" },
];

export function Settings({ project, onSave, onAddRepo, onRemoveRepo, onRescan, onSetAi, onDelete }: Props) {
  const summaries = useSummaries(project.id);
  const stored = Object.values(summaries).filter((e) => e.summary).length;
  useEffect(() => {
    summaryStore.load(project.id);
  }, [project.id]);
  const [name, setName] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(project.name);
    setConfirmDelete(false);
  }, [project.id, project.name]);

  // Changes save automatically, like in the design.
  function commitName() {
    if (name.trim() && name.trim() !== project.name) onSave(name, project.color);
    else setName(project.name);
  }

  return (
    <div className="page">
      <div className="page-inner page-narrow">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <ProjectTile name={project.name} color={project.color} logo={project.logo} size={42} />
          <div>
            <h1 className="title" style={{ fontSize: 26 }}>{project.name}</h1>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
              Project settings · Changes save automatically
            </div>
          </div>
        </div>

        <Section title="General" desc="How this project shows up in your workspace.">
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 14 }}>
            <span className="muted">Name</span>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <span className="muted">Icon</span>
            <div className="swatches">
              {PROJECT_COLORS.map((c) => (
                <button key={c} className={`swatch ${c === project.color ? "on" : ""}`} style={{ background: c + "2A", color: c }} onClick={() => onSave(project.name, c)}>
                  {initials(project.name)}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Repositories" desc="Everything Strata maps for this project. A repo can belong to several projects.">
          <div className="card" style={{ overflow: "hidden" }}>
            {project.repos.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--line)" }}>
                <span className="repo-dot" style={{ background: { ok: "var(--ok)", failed: "var(--err)", scanning: "var(--code)", never: "var(--text-3)" }[r.scanStatus] }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 12.5 }}>{r.name}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.remote ? `${r.remote} · ` : "Local · "}
                    {shortPath(r.path)} · {r.scanStatus === "never" ? "not scanned" : `scanned ${timeAgo(r.lastScanAt)}`}
                    {r.alsoIn.length > 0 && ` · also in ${r.alsoIn.join(", ")}`}
                  </div>
                  {r.scanStatus === "failed" && r.scanError && <div style={{ fontSize: 12, color: "var(--err-text)", marginTop: 2 }}>{r.scanError}</div>}
                </div>
                <button className="btn small" disabled={r.scanStatus === "scanning"} onClick={() => onRescan(r.id)}>
                  {r.scanStatus === "scanning" ? "Scanning…" : r.scanStatus === "never" ? "Scan" : "Rescan"}
                </button>
                <button className="btn small ghost" style={{ color: "var(--err-text)" }} onClick={() => onRemoveRepo(r.id)}>
                  Remove
                </button>
              </div>
            ))}
            <div className="sb-row muted" style={{ borderRadius: 0, height: 40, padding: "0 14px" }} onClick={onAddRepo}>
              + Add repo to project
            </div>
          </div>
        </Section>

        <Section title="AI summaries" desc="Short explanations of files, folders, components and tables, written by Claude through your Claude Code login.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {AI_MODES.map((m) => (
              <button key={m.id} className={`ai-mode ${project.aiMode === m.id ? "on" : ""}`} onClick={() => onSetAi(m.id, project.aiModel)}>
                <span className="ai-radio" />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{m.title}</span>
                <span className="faint" style={{ fontSize: 12, lineHeight: 1.4 }}>{m.desc}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 14 }}>
            <span className="muted">Model</span>
            <select className="input" style={{ maxWidth: 320 }} value={project.aiModel} onChange={(e) => onSetAi(project.aiMode, e.target.value)}>
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className="muted">Stored</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="faint">{stored} {stored === 1 ? "summary" : "summaries"} · reused until the code changes</span>
              {stored > 0 && (
                <button className="btn small ghost" onClick={() => summaryStore.clear(project.id)}>
                  Clear
                </button>
              )}
            </div>
          </div>
          {project.aiMode !== "off" && (
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              The selected item’s code and what Strata knows about it are sent to Claude. Summaries are stored only on this Mac.
            </div>
          )}
        </Section>

        <Section title="Danger zone" desc="This can’t be undone.">
          <div style={{ borderRadius: 12, border: "1px solid rgba(240,113,113,.35)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Delete project</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>
                Removes the map and saved views. Repos stay connected to other projects; your files are never touched.
              </div>
            </div>
            {confirmDelete ? (
              <>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button className="btn danger" onClick={onDelete}>
                  Delete {project.name}
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                Delete project
              </button>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
