import { useEffect, useState } from "react";
import type { Plan } from "./model";

function when(date?: string) {
  if (!date) return "";
  const d = new Date(date + "T12:00:00");
  if (isNaN(d.getTime())) return date;
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Props = {
  plan: Plan;
  /** A decision to show first (from the inspector). */
  highlight?: string | null;
  initialTab?: "decisions" | "questions";
  onHover: (links: string[] | null) => void;
  onResolve: (questionId: string) => void;
  onClose: () => void;
};

/** The project's decision records and open questions, from the design's "Plan · Decisions" panel. */
export function DecisionsPanel({ plan, highlight, initialTab = "decisions", onHover, onResolve, onClose }: Props) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const decisions = [...(plan.decisions ?? [])].reverse();
  const questions = plan.questions ?? [];
  const label = (id: string) => plan.components.find((c) => c.id === id)?.name ?? plan.tables?.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="inspector glass plan-decisions" onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => onHover(null)}>
      <div className="plan-dec-head">
        <div className="seg" style={{ flex: 1 }}>
          <button className={tab === "decisions" ? "on" : ""} onClick={() => setTab("decisions")}>
            Decisions <span className="faint">{decisions.length}</span>
          </button>
          <button className={tab === "questions" ? "on" : ""} onClick={() => setTab("questions")}>
            Open questions <span className="faint">{questions.length}</span>
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="insp-body" style={{ gap: 10, padding: 12 }}>
        {tab === "decisions" &&
          (decisions.length ? (
            decisions.map((d) => (
              <div key={d.id} className={`plan-dec ${highlight === d.id ? "on" : ""}`} onMouseEnter={() => onHover(d.links ?? [])}>
                <div className="faint" style={{ display: "flex", fontSize: 12 }}>
                  <span className="mono">ADR {d.id}</span>
                  <span style={{ marginLeft: "auto" }}>{when(d.date)}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.35 }}>{d.title}</div>
                <div className="faint" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                  Chosen <span className="plan-current">{d.chosen}</span>
                </div>
                {d.reason && <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{d.reason}</div>}
                {!!d.alts?.length && (
                  <div className="faint" style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontSize: 12 }}>
                    Considered
                    {d.alts.map((a) => (
                      <span key={a} className="plan-alt">{a}</span>
                    ))}
                  </div>
                )}
                {!!d.links?.length && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {d.links.map((l) => (
                      <span key={l} className="plan-link mono">{label(l)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>No decisions yet. Claude records them as you plan: every split, store or vendor choice, with the reason and the alternatives.</div>
          ))}
        {tab === "questions" &&
          (questions.length ? (
            questions.map((q) => (
              <div key={q.id} className="plan-dec" onMouseEnter={() => onHover(q.links ?? [])}>
                <div style={{ display: "flex", gap: 8, fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>
                  <span className="plan-q-dot" />
                  {q.text}
                </div>
                {q.detail && <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, paddingLeft: 15 }}>{q.detail}</div>}
                {!!q.links?.length && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingLeft: 15 }}>
                    {q.links.map((l) => (
                      <span key={l} className="plan-link mono">{label(l)}</span>
                    ))}
                  </div>
                )}
                <button className="btn small plan-ask" style={{ alignSelf: "flex-start", marginLeft: 15 }} onClick={() => onResolve(q.id)}>
                  ✦ Resolve with Claude
                </button>
              </div>
            ))
          ) : (
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>No open questions.</div>
          ))}
      </div>
    </div>
  );
}
