import { useState } from "react";
import { PROJECT_COLORS, type PlanBrief } from "../api";
import { StrataLogo } from "../components/StrataLogo";

/** First step of a new project: map code that exists, or plan something that doesn't yet. */
export function NewProjectChoice({ first, onMap, onPlan, onCancel }: { first: boolean; onMap: () => void; onPlan: () => void; onCancel: (() => void) | null }) {
  return (
    <div className="page dots" data-tauri-drag-region>
      <div className="choice-glow" />
      <div style={{ position: "relative", maxWidth: 880, margin: "0 auto", padding: "72px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <StrataLogo size={44} />
          <h1 className="title" style={{ marginTop: 6 }}>{first ? "Create your first project" : "New project"}</h1>
          <div className="subtitle">Map code you already have, or plan something that doesn’t exist yet.</div>
        </div>
        <div className="choice-grid">
          <button className="choice-card" onClick={onMap}>
            <div className="choice-art">
              <span style={{ borderColor: "#6366F1", background: "rgba(99,102,241,.14)" }} />
              <i />
              <span style={{ borderColor: "#8B5CF6", background: "rgba(139,92,246,.14)" }} />
              <i />
              <span style={{ borderColor: "#14B8A6", background: "rgba(20,184,166,.14)" }} />
            </div>
            <div className="choice-title">Map existing repos</div>
            <div className="choice-text">Point Strata at your repos. It scans them and draws Code, Architecture and Database maps.</div>
            <div className="choice-foot">
              <span style={{ flex: 1 }}>Local folders</span>
              <span style={{ color: "var(--text)" }}>Continue →</span>
            </div>
          </button>
          <button className="choice-card plan" onClick={onPlan}>
            <div className="choice-art dashed">
              <span />
              <i />
              <span />
              <i />
              <span className="teal" />
              <b>✦</b>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="choice-title">Plan from scratch</span>
              <span className="plan-rec">✦ New</span>
            </div>
            <div className="choice-text">Describe an idea and plan the architecture with Claude before any code exists.</div>
            <div className="choice-foot">
              <span style={{ flex: 1 }}>Chat · Canvas · Versions</span>
              <span style={{ color: "var(--text)" }}>Continue →</span>
            </div>
          </button>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>Planned projects can add repos later.</div>
        {onCancel && (
          <button className="btn ghost small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

const STACK = ["TypeScript", "Python", "Go", "Rust", "Java / Kotlin", "Ruby", "PHP"];
const HOSTING = ["Vercel", "AWS", "Fly.io", "VPS / Hetzner", "Self-hosted"];
const SCALE = ["< 1k", "1k–50k", "50k+"];
const TEAM = ["Just me", "Small team", "Several teams"];

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="plan-chips">
      {options.map((o) => (
        <button type="button" key={o} className={`plan-chip ${value.includes(o) ? "on" : ""}`} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Segments({ options, value, onChange }: { options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="seg plan-seg">
      {options.map((o) => (
        <button type="button" key={o} className={value === o ? "on" : ""} onClick={() => onChange(value === o ? null : o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** "Plan from scratch": the idea in plain words plus optional constraints. Claude asks the rest. */
export function PlanForm({ onBack, onCreate }: { onBack: () => void; onCreate: (name: string, color: string, brief: PlanBrief) => Promise<void> }) {
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [stack, setStack] = useState<string[]>([]);
  const [hosting, setHosting] = useState<string[]>([]);
  const [scale, setScale] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [svc, setSvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const color = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
      await onCreate(name.trim(), color, { idea: idea.trim(), stack, hosting, scale: scale ?? undefined, team: team ?? undefined, services });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="page dots" data-tauri-drag-region style={{ display: "grid", placeItems: "center" }}>
      <div className="choice-glow" />
      <form
        className="plan-form glass"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && idea.trim() && !busy) start();
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" className="icon-btn" onClick={onBack} style={{ border: "1px solid var(--line)" }} title="Back">
            ←
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 8 }}>
              Plan from scratch <span style={{ color: "var(--arch)", fontSize: 15 }}>✦</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Describe it in plain words. Claude asks the rest.</div>
          </div>
        </div>
        <label className="plan-field">
          <span>Project name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meterly" />
        </label>
        <label className="plan-field">
          <span>What are you building?</span>
          <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A few sentences: who it’s for and what it does." />
        </label>
        <div className="plan-divider">
          Constraints <span style={{ fontWeight: 400 }}>· optional</span>
          <i />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 18px" }}>
          <div className="plan-field">
            <span>Preferred stack</span>
            <Chips options={STACK} value={stack} onChange={setStack} />
          </div>
          <div className="plan-field">
            <span>Hosting</span>
            <Chips options={HOSTING} value={hosting} onChange={setHosting} />
          </div>
          <div className="plan-field">
            <span>Expected users in year one</span>
            <Segments options={SCALE} value={scale} onChange={setScale} />
          </div>
          <div className="plan-field">
            <span>Team size</span>
            <Segments options={TEAM} value={team} onChange={setTeam} />
          </div>
          <div className="plan-field" style={{ gridColumn: "span 2" }}>
            <span>Must-use services</span>
            <div className="plan-tags-input">
              {services.map((s) => (
                <span key={s} className="plan-tag">
                  {s}
                  <button type="button" onClick={() => setServices(services.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                value={svc}
                onChange={(e) => setSvc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = svc.trim();
                    if (v && !services.includes(v)) setServices([...services, v]);
                    setSvc("");
                  }
                }}
                placeholder="Add a service and press Enter (e.g. Stripe)"
              />
            </div>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <span className="faint" style={{ flex: 1, fontSize: 12.5 }}>The plan stays in Strata; add repos whenever you start building.</span>
          <button type="button" className="btn ghost" onClick={onBack}>
            Cancel
          </button>
          <button type="submit" className="btn plan-primary" disabled={!name.trim() || !idea.trim() || busy}>
            ✦ Start planning
          </button>
        </div>
      </form>
    </div>
  );
}
