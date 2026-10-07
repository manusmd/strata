import { useEffect, useState } from "react";
import { initials, KIND_COLOR, PLAN_TYPES, TYPE_STYLE, type Plan, type PlanComponent } from "./model";

type Props = {
  plan: Plan;
  component: PlanComponent;
  onChange: (next: PlanComponent) => void;
  onSelect: (id: string) => void;
  onAsk: (c: PlanComponent) => void;
  onShowTable: (id: string) => void;
  onShowDecision: (id: string) => void;
  onShowQuestions: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** A text field that saves on every change but keeps its own value while typing. */
function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, (v: string) => (setDraft(v), commit(v))] as const;
}

export function PlanInspector({ plan, component: c, onChange, onSelect, onAsk, onShowTable, onShowDecision, onShowQuestions, onDelete, onClose }: Props) {
  const style = TYPE_STYLE[c.type];
  const [name, setName] = useDraft(c.name, (v) => v.trim() && onChange({ ...c, name: v }));
  const [resp, setResp] = useDraft(c.resp ?? "", (v) => onChange({ ...c, resp: v || undefined }));
  const [lives, setLives] = useDraft(c.lives ?? "", (v) => onChange({ ...c, lives: v || undefined }));
  const [tech, setTech] = useState("");
  const [note, setNote] = useState("");
  const byId = new Map(plan.components.map((x) => [x.id, x]));
  const ownTables = (plan.tables ?? []).filter((t) => t.owner === c.id);
  const decisions = (plan.decisions ?? []).filter((d) => d.links?.includes(c.id));
  const questions = (plan.questions ?? []).filter((q) => q.links?.includes(c.id));
  const talks = plan.connections
    .filter((e) => e.from === c.id || e.to === c.id)
    .map((e) => ({ out: e.from === c.id, other: byId.get(e.from === c.id ? e.to : e.from), e }))
    .filter((t) => t.other);

  return (
    <div className="inspector glass plan-insp" onPointerDown={(e) => e.stopPropagation()}>
      <div className="plan-insp-head">
        <div className="plan-tile big" style={{ ["--kind" as any]: style.color }}>
          {initials(c)}
        </div>
        <input className="plan-insp-name" value={name} onChange={(e) => setName(e.target.value)} title="Rename" />
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="faint" style={{ fontSize: 12, padding: "0 14px 12px 58px", borderBottom: "1px solid var(--line)" }}>
        Planned component · {c.type}
      </div>
      <div className="insp-body" style={{ gap: 16 }}>
        <label className="plan-field">
          <span>Responsibility</span>
          <textarea value={resp} onChange={(e) => setResp(e.target.value)} placeholder="What is it responsible for?" rows={3} />
        </label>
        <div className="plan-field">
          <span>Type</span>
          <div className="plan-chips">
            {PLAN_TYPES.map((t) => (
              <button key={t} className={`plan-chip ${t === c.type ? "on" : ""}`} onClick={() => onChange({ ...c, type: t })}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="plan-field">
          <span>Tech</span>
          <div className="plan-chips">
            {(c.tech ?? []).map((t) => (
              <span key={t} className="plan-tag mono">
                {t}
                <button onClick={() => onChange({ ...c, tech: (c.tech ?? []).filter((x) => x !== t) })} aria-label={`Remove ${t}`}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="plan-add"
              value={tech}
              placeholder="+ Add"
              onChange={(e) => setTech(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tech.trim()) {
                  onChange({ ...c, tech: [...(c.tech ?? []), tech.trim()] });
                  setTech("");
                }
              }}
            />
          </div>
        </div>
        <label className="plan-field">
          <span>Lives in</span>
          <input className="mono" value={lives} onChange={(e) => setLives(e.target.value)} placeholder="apps/web, services/api, Managed service…" />
        </label>
        {talks.length > 0 && (
          <div className="plan-field">
            <span>Talks to</span>
            {talks.map(({ out, other, e }, i) => (
              <div key={i} className="insp-row link" onClick={() => onSelect(other!.id)}>
                <span className="faint" style={{ width: 12 }}>{out ? "→" : "←"}</span>
                <span className="mono grow">{other!.name}</span>
                {e.label && (
                  <span className="plan-proto" style={{ ["--kind" as any]: KIND_COLOR[e.kind ?? "uses"] }}>
                    {e.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {ownTables.length > 0 && (
          <div className="plan-field">
            <span>Owns tables</span>
            <div className="plan-chips">
              {ownTables.map((t) => (
                <button key={t.id} className="plan-owned mono" onClick={() => onShowTable(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {decisions.length > 0 && (
          <div className="plan-field">
            <span>Linked decisions</span>
            {decisions.map((d) => (
              <button key={d.id} className="plan-dec-link" onClick={() => onShowDecision(d.id)}>
                <span className="mono faint">{d.id}</span> {d.title}
              </button>
            ))}
          </div>
        )}
        {questions.length > 0 && (
          <div className="plan-field">
            <span>Open questions</span>
            {questions.map((q) => (
              <button key={q.id} className="plan-q-link" onClick={onShowQuestions}>
                <span className="plan-q-dot" />
                {q.text}
              </button>
            ))}
          </div>
        )}
        <div className="plan-field">
          <span>Notes</span>
          {(c.notes ?? []).map((n, i) => (
            <div key={i} className="plan-note">
              <span style={{ flex: 1 }}>{n}</span>
              <button onClick={() => onChange({ ...c, notes: (c.notes ?? []).filter((_, j) => j !== i) })} aria-label="Remove note">
                ×
              </button>
            </div>
          ))}
          <input
            value={note}
            placeholder="Add a note and press Enter"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) {
                onChange({ ...c, notes: [...(c.notes ?? []), note.trim()] });
                setNote("");
              }
            }}
          />
        </div>
      </div>
      <div className="insp-actions">
        <button className="btn grow-btn plan-ask" onClick={() => onAsk(c)}>
          ✦ Ask Claude about this component
        </button>
        <button className="btn" onClick={onDelete} title="Delete component" style={{ color: "var(--err-text)" }}>
          ⌫
        </button>
      </div>
    </div>
  );
}
