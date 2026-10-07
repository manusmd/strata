import { useEffect, useState } from "react";
import { diff, type Plan } from "./model";
import { PlanCanvas, type Badge } from "./PlanCanvas";
import { planStore, type VersionInfo } from "./store";

function ago(secs: number) {
  const d = Date.now() / 1000 - secs;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(secs * 1000).toLocaleDateString();
}

export const countLabel = (v: VersionInfo) =>
  [v.changes.added.length && `+${v.changes.added.length}`, v.changes.changed.length && `~${v.changes.changed.length}`, v.changes.removed.length && `−${v.changes.removed.length}`].filter(Boolean).join(" ");

/** The toolbar's version popover: every change is a version; compare or restore any of them. */
export function HistoryPopover({ versions, current, onCompare, onRestore, onClose }: { versions: VersionInfo[]; current: number | null; onCompare: (v: number) => void; onRestore: (v: number) => void; onClose: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="plan-history glass" onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ padding: "8px 10px", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Version history</span>
        <span className="faint" style={{ fontSize: 12 }}>Saved on every change</span>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {versions.map((v) => {
          const cur = v.version === current;
          return (
            <div key={v.version} className={`plan-ver ${hover === v.version ? "on" : ""}`} onMouseEnter={() => setHover(v.version)}>
              <span className={`plan-ver-dot ${cur ? "cur" : ""}`} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>v{v.version}</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.title}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{ago(v.createdAt)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
                  <span className="mono faint" style={{ fontSize: 11.5, flex: 1 }}>{countLabel(v)}</span>
                  {cur && <span className="plan-cur">Current</span>}
                  {hover === v.version && !cur && (
                    <>
                      <button className="btn small" onClick={() => onCompare(v.version)}>Compare</button>
                      <button className="btn small ghost" onClick={() => onRestore(v.version)}>Restore</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Two versions side by side: what the newer one added, changed and removed. */
export function CompareView({ projectId, from, to, onRestore, onDone }: { projectId: string; from: number; to: number; onRestore: (v: number) => void; onDone: () => void }) {
  const [plans, setPlans] = useState<[Plan, Plan] | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([planStore.planAt(projectId, from), planStore.planAt(projectId, to)]).then((p) => !cancelled && setPlans(p));
    return () => {
      cancelled = true;
    };
  }, [projectId, from, to]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  if (!plans) return <div className="map-loading">Loading versions…</div>;
  const d = diff(plans[0], plans[1]);
  const left = new Map<string, Badge>(d.removed.map((id) => [id, "REMOVED"]));
  const right = new Map<string, Badge>([...d.added.map((id) => [id, "NEW"] as const), ...d.changed.map((id) => [id, "CHANGED"] as const)]);
  return (
    <div className="plan-compare" onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>Comparing</span>
        <span className="plan-vchip">v{from}</span>
        <span className="faint">→</span>
        <span className="plan-vchip on">v{to}</span>
        <span className="plan-count new">NEW {d.added.length}</span>
        <span className="plan-count changed">CHANGED {d.changed.length}</span>
        <span className="plan-count removed">REMOVED {d.removed.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => onRestore(from)}>Restore v{from}</button>
        <button className="btn small primary" onClick={onDone}>Done</button>
      </div>
      <div className="plan-compare-panes">
        {(
          [
            [from, plans[0], left],
            [to, plans[1], right],
          ] as const
        ).map(([v, p, badges]) => (
          <div key={v} className="plan-pane">
            <div className="plan-pane-head">
              <span style={{ fontWeight: 500 }}>v{v}</span>
              <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>{p.components.length} components</span>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <PlanCanvas plan={p} badges={badges} interactive={false} direction="DOWN" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
