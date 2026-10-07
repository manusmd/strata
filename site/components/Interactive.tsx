"use client";

import { useState } from "react";
import { s } from "@/lib/style";

const mono = "var(--font-mono), monospace";
const G = "#3FB47C", W = "#F59E0B", R = "#F07171", V = "#8B5CF6";

/** "Missing pieces" illustration: a package the code imports, living in a repo outside the project. */
export function MissingDemo() {
  const [added, setAdded] = useState(false);
  return (
    <div className="dots" style={s("position:relative; height:330px; border-radius:18px; border:1px solid var(--line); background-color:var(--bg-2); background-size:20px 20px; overflow:hidden")}>
      <div style={s("position:absolute; left:8%; top:110px; width:190px; height:92px; box-sizing:border-box; border-radius:12px; background:var(--card); border:1px solid var(--card-border); box-shadow:0 10px 30px rgba(0,0,0,.25); padding:12px; display:flex; flex-direction:column; gap:7px")}>
        <div style={s("display:flex; align-items:center; gap:8px")}>
          <span style={s(`width:24px; height:24px; border-radius:7px; background:rgba(139,92,246,.16); color:#A78BFA; display:grid; place-items:center; font:600 9.5px ${mono}`)}>AP</span>
          <span style={s("font-weight:600; font-size:14px")}>api</span>
        </div>
        <div style={s("font-size:12.5px; color:var(--text-2); line-height:1.4")}>
          imports <span style={{ fontFamily: mono }}>@acme/shared-types</span> in 14 files
        </div>
      </div>
      <div style={s(`position:absolute; left:calc(8% + 190px); right:calc(6% + 226px); top:155px; border-top:1.5px ${added ? "solid" : "dashed"} ${added ? V : W}; transition:all .5s ease`)} />
      <div
        style={s(
          `position:absolute; right:6%; top:92px; width:226px; box-sizing:border-box; border-radius:12px; background:${added ? "var(--card)" : "rgba(245,158,11,.05)"}; border:1px ${added ? "solid" : "dashed"} ${added ? V : "rgba(245,158,11,.8)"}; box-shadow:${added ? "0 0 0 5px rgba(139,92,246,.14), 0 12px 34px rgba(139,92,246,.25)" : "none"}; padding:12px; display:flex; flex-direction:column; gap:10px; transition:all .5s ease`,
        )}
      >
        <div style={s("display:flex; align-items:center; gap:8px; min-width:0")}>
          <span style={s(`width:24px; height:24px; border-radius:7px; box-sizing:border-box; border:1px ${added ? "solid" : "dashed"} ${added ? V : W}; color:${added ? V : W}; display:grid; place-items:center; font:600 9.5px ${mono}; flex:none`)}>{added ? "ST" : "?"}</span>
          <span style={s(`font-weight:600; font-size:13px; font-family:${mono}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`)}>shared-types</span>
          <span style={s(`margin-left:auto; font-size:11.5px; padding:2px 7px; border-radius:5px; background:var(--chip); color:${added ? "var(--text-2)" : "var(--warn-text)"}; flex:none`)}>{added ? "Library" : "Missing"}</span>
        </div>
        <div style={s("font-size:12.5px; color:var(--text-2); line-height:1.45")}>
          {added ? "Added to Acme Cloud. 14 imports resolved." : "Found in ~/dev/shared-types · not in this project"}
        </div>
        <button
          onClick={() => setAdded(!added)}
          style={s(
            `align-self:flex-start; height:28px; padding:0 11px; border-radius:7px; border:${added ? "1px solid var(--line)" : "1px solid rgba(245,158,11,.5)"}; background:${added ? "transparent" : "rgba(245,158,11,.14)"}; color:${added ? "var(--text-2)" : "var(--warn-text)"}; font-size:12.5px; font-weight:500; cursor:pointer`,
          )}
        >
          {added ? "Undo" : "Add repo"}
        </button>
      </div>
      <div style={s("position:absolute; left:50%; bottom:16px; transform:translateX(-50%); width:max-content; max-width:88%; box-sizing:border-box; padding:9px 12px; border-radius:10px; background:var(--glass-strong); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); border:1px solid var(--glass-border); box-shadow:var(--shadow); font-size:12.5px; color:var(--text-2); text-align:center")}>
        shared-types is already in <b style={s("color:var(--text); font-weight:600")}>Internal Tools</b>. Add it here too?
      </div>
    </div>
  );
}

type Node = [name: string, x: number, y: number, w: number, badge?: "NEW" | "CHANGED" | "REMOVED"];
type Edge = [d: string, color: string, dash?: string];
const PROPOSED: { nodes: Node[]; edges: Edge[] } = {
  nodes: [["web-app", 0, 92, 110], ["api", 130, 92, 130, "CHANGED"], ["billing-service", 290, 20, 190, "NEW"], ["payment-service", 290, 160, 190, "REMOVED"], ["Stripe", 166, 172, 80]],
  edges: [["M110,115 C120,115 120,115 130,115", "var(--edge)"], ["M260,108 C275,108 275,43 290,43", G], ["M260,122 C275,122 275,183 290,183", R, "4 4"], ["M290,58 C268,58 278,195 246,195", G]],
};
const CURRENT: { nodes: Node[]; edges: Edge[] } = {
  nodes: [["web-app", 0, 92, 110], ["api", 130, 92, 130], ["payment-service", 290, 92, 190], ["Stripe", 340, 176, 90]],
  edges: [["M110,115 C120,115 120,115 130,115", "var(--edge)"], ["M260,115 C275,115 275,115 290,115", "var(--edge)"], ["M385,138 C385,155 385,160 385,176", "var(--edge)"]],
};
const BADGE = {
  NEW: { border: G, bg: "rgba(63,180,124,.16)", fg: "var(--ok-text)" },
  CHANGED: { border: W, bg: "rgba(245,158,11,.16)", fg: "var(--warn-text)" },
  REMOVED: { border: R, bg: "rgba(240,113,113,.16)", fg: "var(--err-text)" },
};

/** A canvas drawn as SVG, so it scales to any width. */
function Diagram({ data, label }: { data: { nodes: Node[]; edges: Edge[] }; label: string }) {
  return (
    <svg viewBox="-12 -10 504 250" role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {data.edges.map(([d, c, dash]) => (
        <path key={d} d={d} style={{ fill: "none", stroke: c, strokeWidth: 1.5, strokeDasharray: dash ?? "none" }} />
      ))}
      {data.nodes.map(([name, x, y, w, badge]) => {
        const b = badge ? BADGE[badge] : null;
        const bw = badge ? badge.length * 6.6 + 12 : 0;
        return (
          <g key={name} opacity={badge === "REMOVED" ? 0.75 : 1}>
            <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={45} rx={11} style={{ fill: badge === "REMOVED" ? "transparent" : "var(--card)", stroke: b ? b.border : "var(--card-border)", strokeDasharray: badge === "REMOVED" ? "4 3" : "none" }} />
            <text x={x + 10} y={y + 27} style={{ font: `600 12.5px ${mono}`, fill: "var(--text)", textDecoration: badge === "REMOVED" ? "line-through" : "none" }}>
              {name}
            </text>
            {b && (
              <>
                <rect x={x + w - 10 - bw} y={y + 14} width={bw} height={18} rx={5} style={{ fill: b.bg }} />
                <text x={x + w - 10 - bw / 2} y={y + 27} textAnchor="middle" style={{ font: `600 10px ${mono}`, fill: b.fg, letterSpacing: ".03em" }}>
                  {badge}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function CanvasDemo() {
  const [compare, setCompare] = useState(false);
  const panel = (data: typeof PROPOSED, label: string, max: string) => (
    <div style={{ flex: "1 1 440px", minWidth: 0, maxWidth: max, display: "flex", flexDirection: "column", gap: 8 }}>
      {compare && <div style={s(`font:500 12px ${mono}; color:var(--text-3)`)}>{label.toUpperCase()}</div>}
      <div className="dots" style={s("border-radius:14px; border:1px solid var(--line); background-color:var(--bg-2); background-size:18px 18px; overflow:hidden; padding:14px 16px")}>
        <Diagram data={data} label={`${label} architecture: ${data.nodes.map((n) => (n[4] ? `${n[0]} (${n[4].toLowerCase()})` : n[0])).join(", ")}`} />
      </div>
    </div>
  );
  return (
    <div className="glass-card" style={{ maxWidth: 1080, margin: "0 auto", borderRadius: 18, padding: "var(--canvas-pad)", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={s("display:flex; gap:10px; align-items:center; flex-wrap:wrap")}>
        <span style={s("width:22px; height:22px; border-radius:50%; background:#8B5CF6; color:#fff; display:grid; place-items:center; font-size:9.5px; font-weight:600; flex:none")}>ML</span>
        <b style={s("font-weight:500; font-size:14.5px; flex:1; min-width:200px")}>What would it take to move billing out of api?</b>
        <div role="tablist" aria-label="Canvas view" style={s("display:flex; gap:2px; padding:3px; border-radius:9px; background:var(--chip)")}>
          {([["Proposal", false], ["Compare with current", true]] as const).map(([label, v]) => (
            <button
              key={label}
              role="tab"
              aria-selected={compare === v}
              onClick={() => setCompare(v)}
              style={s(`height:28px; padding:0 12px; border-radius:6px; border:none; background:${compare === v ? "var(--card)" : "transparent"}; color:${compare === v ? "var(--text)" : "var(--text-2)"}; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap`)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p style={s("margin:0; font-size:14.5px; line-height:1.6; color:var(--text-2); max-width:760px; text-wrap:pretty")}>
        Create a <b style={{ color: "var(--text)", fontWeight: 600 }}>billing-service</b> that owns invoices and subscriptions. <b style={{ color: "var(--text)", fontWeight: 600 }}>api</b> keeps checkout but calls billing over HTTP. The old{" "}
        <b style={{ color: "var(--text)", fontWeight: 600 }}>payment-service</b> folds into it.
      </p>
      <div style={s("display:flex; flex-wrap:wrap; gap:16px; justify-content:center")}>
        {compare ? (
          <>
            {panel(CURRENT, "Current", "100%")}
            {panel(PROPOSED, "Proposed", "100%")}
          </>
        ) : (
          panel(PROPOSED, "Proposed", "640px")
        )}
      </div>
      <div style={s("display:flex; gap:18px; flex-wrap:wrap; font-size:13px; color:var(--text-2)")}>
        {(
          [
            ["NEW", "added by the proposal"],
            ["CHANGED", "keeps its name, new responsibilities"],
            ["REMOVED", "goes away"],
          ] as const
        ).map(([k, t]) => (
          <span key={k} style={s("display:flex; align-items:center; gap:7px")}>
            <span style={s(`font:600 10px ${mono}; padding:2px 6px; border-radius:5px; background:${BADGE[k].bg}; color:${BADGE[k].fg}`)}>{k}</span>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        const done = () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        };
        navigator.clipboard?.writeText(text).then(done, done) ?? done();
      }}
      style={s("height:32px; padding:0 12px; border-radius:7px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:13px; cursor:pointer; white-space:nowrap")}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** On phones: Strata is a Mac app, so offer to share or copy the link instead of downloading. */
export function ShareLink({ label = "Copy link", primary = false }: { label?: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = window.location.href.split("#")[0];
    try {
      if (navigator.share) await navigator.share({ title: "Strata for macOS", text: "A visual atlas for your codebase", url });
      else {
        await navigator.clipboard.writeText(url);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }
    } catch {}
  };
  return primary ? (
    <button className="btn-primary" onClick={share} style={{ boxShadow: "none" }}>
      {done ? "Link copied" : label}
    </button>
  ) : (
    <button onClick={share} style={s("border:none; background:transparent; color:var(--violet-text); font-size:14.5px; cursor:pointer; padding:4px")}>
      {done ? "Link copied — open it on your Mac" : label}
    </button>
  );
}
