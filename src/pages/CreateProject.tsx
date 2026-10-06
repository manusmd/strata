import { useState } from "react";
import { PROJECT_COLORS, initials, pickFolders, shortPath } from "../api";
import { StrataLogo } from "../components/StrataLogo";

type Props = {
  first: boolean;
  onCancel: (() => void) | null;
  onCreate: (name: string, color: string, paths: string[]) => Promise<void>;
};

const STEPS = [
  ["Name", "Give the system a name and an icon."],
  ["Repos", "Add every repo that belongs to it."],
  ["Scan", "We parse, link and summarise."],
];

export function CreateProject({ first, onCancel, onCreate }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFolders() {
    const picked = await pickFolders();
    setPaths((cur) => [...cur, ...picked.filter((p) => !cur.includes(p))]);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name, color, paths);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="page dots" data-tauri-drag-region>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 160, height: 120, display: "grid", placeItems: "center", background: "radial-gradient(closest-side, rgba(99,102,241,.16), transparent)" }}>
          <StrataLogo size={84} />
        </div>
        <h1 className="title" style={{ marginTop: 8, textAlign: "center" }}>
          {first ? "Create your first project" : "New project"}
        </h1>
        <div className="subtitle" style={{ textAlign: "center", maxWidth: 380, lineHeight: 1.5 }}>
          A project is one software system. Add every repo that belongs to it and Strata maps them together.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, width: "100%", margin: "28px 0 18px" }}>
          {STEPS.map(([title, desc], i) => (
            <div key={title} style={{ borderTop: `2px solid ${i <= step ? "var(--code)" : "var(--line)"}`, paddingTop: 8 }}>
              <div className="mono" style={{ fontSize: 11, color: i <= step ? "var(--code)" : "var(--text-3)" }}>
                0{i + 1}
              </div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{title}</div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
                {desc}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ width: "100%", padding: 18, animation: "strataPop .25s ease-out" }}>
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) setStep(1);
              }}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}>Project name</span>
                <input className="input" autoFocus value={name} placeholder="e.g. Acme Cloud" onChange={(e) => setName(e.target.value)} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}>Icon</span>
                <div className="swatches">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`swatch ${c === color ? "on" : ""}`}
                      style={{ background: c + "2A", color: c }}
                      onClick={() => setColor(c)}
                    >
                      {initials(name || "Project")}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="faint" style={{ fontSize: 12, flex: 1 }}>You can rename it or add repos later.</span>
                {onCancel && (
                  <button type="button" className="btn ghost" onClick={onCancel}>
                    Cancel
                  </button>
                )}
                <button type="submit" className="btn primary" disabled={!name.trim()}>
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="project-tile" style={{ width: 24, height: 24, borderRadius: 7, background: color + "2A", color, fontSize: 9 }}>
                  {initials(name)}
                </div>
                <span style={{ fontWeight: 600, flex: 1 }}>{name}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {paths.length} {paths.length === 1 ? "repo" : "repos"}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                {paths.map((p) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span className="chip" style={{ height: 20, fontSize: 10.5 }}>DIR</span>
                    <span className="mono" style={{ fontSize: 12.5 }}>{p.split("/").pop()}</span>
                    <span className="faint mono" style={{ fontSize: 11.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shortPath(p)}
                    </span>
                    <button className="icon-btn" title="Remove" onClick={() => setPaths((cur) => cur.filter((x) => x !== p))}>
                      ×
                    </button>
                  </div>
                ))}
                {paths.length === 0 && <div className="faint" style={{ padding: "16px 12px", fontSize: 12.5 }}>No repos added yet. You can also start empty.</div>}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn small" onClick={addFolders}>
                  + Local folder
                </button>
                <button className="btn small" disabled title="Coming soon">
                  + GitHub repo
                </button>
              </div>

              {error && <div className="error-banner">{error}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button className="btn ghost" onClick={() => setStep(0)}>
                  Back
                </button>
                <div style={{ flex: 1 }} />
                <button className="btn primary" disabled={busy} onClick={create}>
                  {paths.length ? "Create project" : "Create empty project"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="faint" style={{ fontSize: 12, marginTop: 18 }}>
          Your code stays on this Mac unless you turn on AI summaries.
        </div>
      </div>
    </div>
  );
}
