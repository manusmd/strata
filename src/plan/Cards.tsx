import { useState } from "react";
import { COMPLEXITY, type PlanOption, type Question } from "./blocks";
import { PlanCanvas } from "./PlanCanvas";

/** Claude's clarifying questions: tap an answer per question, then let Claude draw. */
export function QuestionsCard({ questions, answered, busy, onSubmit }: { questions: Question[]; answered: boolean; busy: boolean; onSubmit: (picks: (string | null)[]) => void }) {
  const [picks, setPicks] = useState<(string | null)[]>(() => questions.map(() => null));
  const n = picks.filter(Boolean).length;
  if (answered) {
    return (
      <div className="plan-qs answered">
        <span style={{ color: "var(--ok-text, #5FD39A)" }}>✓</span>
        <span>Answered · {questions.length} questions</span>
      </div>
    );
  }
  return (
    <div className="plan-qs">
      {questions.map((q, qi) => (
        <div key={qi} className="plan-q">
          <div style={{ fontSize: 13, fontWeight: 500 }}>{q.q}</div>
          {q.options.length > 0 && (
            <div className="plan-chips">
              {q.options.map((o) => (
                <button key={o} className={`plan-chip ${picks[qi] === o ? "on" : ""}`} onClick={() => setPicks((p) => p.map((x, i) => (i === qi ? (x === o ? null : o) : x)))}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="plan-qs-foot">
        <span className="faint" style={{ fontSize: 12, flex: 1 }}>{n ? `${n} of ${questions.length} answered · skip the rest if you like` : "Or answer in your own words below."}</span>
        <button className="btn small plan-primary" disabled={busy} onClick={() => onSubmit(picks)}>
          Draw first draft
        </button>
      </div>
    </div>
  );
}

/** In the chat: the options Claude proposed, and which one the canvas shows. */
export function OptionsCard({ options, current, onOpen }: { options: PlanOption[]; current: string | null; onOpen: () => void }) {
  return (
    <div className="plan-opts-card">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((o) => (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>{o.title}</span>
            {o.recommended && <span className="plan-rec">✦ Recommended</span>}
            {current === o.id && <span className="plan-current">On canvas</span>}
          </div>
        ))}
      </div>
      <button className="btn small" onClick={onOpen}>
        Compare {options.length} options →
      </button>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ width: 14, height: 5, borderRadius: 2, background: i <= value ? (value >= 4 ? "#F59E0B" : "#8B5CF6") : "var(--chip)" }} />
      ))}
    </span>
  );
}

/** The options side by side, from the design's "Plan · Options" screen. */
export function OptionsView({ projectName, basis, options, current, onUse, onMix, onBack }: { projectName: string; basis: string; options: PlanOption[]; current: string | null; onUse: (o: PlanOption) => void; onMix: (o: PlanOption) => void; onBack: () => void }) {
  const [used, setUsed] = useState<string | null>(null);
  const chosen = options.find((o) => o.id === used);
  return (
    <div className="plan-options">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--violet-text)" }}>✦ Claude proposed {options.length} options</div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>Pick a shape for {projectName}</div>
          {basis && <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>Based on: {basis}</div>}
        </div>
        <button className="btn small" onClick={onBack}>
          Back to canvas
        </button>
      </div>
      {chosen && (
        <div className="plan-banner">
          <span style={{ color: "var(--ok-text, #5FD39A)" }}>✓</span>
          <span style={{ flex: 1 }}>“{chosen.title}” is now the plan. Earlier versions stay in the history.</span>
          <button className="btn small" onClick={onBack}>
            View canvas
          </button>
        </div>
      )}
      <div className="plan-options-grid">
        {options.map((o) => {
          const isCurrent = current === o.id;
          return (
            <div key={o.id} className={`plan-option ${isCurrent ? "current" : ""}`}>
              <div className="plan-option-canvas dots">
                <PlanCanvas plan={o.plan} interactive={false} direction="RIGHT" />
                <div className="plan-option-badges">
                  {o.recommended && <span className="plan-rec">✦ Recommended</span>}
                  {isCurrent && <span className="plan-current">Current plan</span>}
                </div>
              </div>
              <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{o.title}</div>
                {o.tagline && <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: -4 }}>{o.tagline}</div>}
                <div className="faint" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  Complexity <Meter value={o.complexity} /> <span style={{ color: "var(--text-2)" }}>{COMPLEXITY[o.complexity - 1]}</span>
                  <span style={{ marginLeft: "auto" }}>{o.plan.components.length} components</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  {o.pros.map((p) => (
                    <div key={p} className="plan-pro">
                      <span style={{ color: "var(--ok-text, #5FD39A)" }}>+</span>
                      {p}
                    </div>
                  ))}
                  {o.cons.map((p) => (
                    <div key={p} className="plan-pro muted">
                      <span style={{ color: "var(--err-text)" }}>−</span>
                      {p}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 6 }}>
                  <button
                    className={`btn small grow-btn ${isCurrent ? "" : "plan-primary"}`}
                    disabled={isCurrent}
                    onClick={() => {
                      setUsed(o.id);
                      onUse(o);
                    }}
                  >
                    {isCurrent ? "In use" : "Use this"}
                  </button>
                  <button className="btn small" onClick={() => onMix(o)}>
                    Mix…
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
