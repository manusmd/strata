import type { Drift, DriftStatus } from "./drift";
import type { Plan } from "./model";

const COLORS: Record<DriftStatus, [string, string]> = { BUILT: ["#3FB47C", "#05210F"], MISSING: ["#F59E0B", "#2B1900"], UNPLANNED: ["#6366F1", "#fff"], DIFFERENT: ["#F07171", "#2E0B0B"] };
const Badge = ({ s }: { s: DriftStatus }) => (
  <span className="drift-badge" style={{ background: COLORS[s][0], color: COLORS[s][1] }}>
    {s}
  </span>
);

type Props = { plan: Plan; drift: Drift; busy: boolean; onSelect: (id: string) => void; onExplain: () => void; onUpdatePlan: () => void };

/** The design's "Plan vs. code" card: how much is built, what's missing, what's extra, where it deviates. */
export function DriftCard({ plan, drift, busy, onSelect, onExplain, onUpdatePlan }: Props) {
  const total = plan.components.length;
  const built = total - drift.missing.length;
  const count = (s: DriftStatus) => [...drift.status.values()].filter((x) => x === s).length;
  return (
    <div className="drift-card glass" onPointerDown={(e) => e.stopPropagation()}>
      <div className="faint" style={{ fontSize: 12, fontWeight: 600 }}>Plan vs. code</div>
      <div>
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {built} of {total}
        </span>
        <span className="muted" style={{ fontSize: 13 }}> planned components built</span>
      </div>
      <div className="drift-bar">
        {built > 0 && <div className="built" style={{ flex: built }} />}
        {drift.missing.length > 0 && <div className="missing" style={{ flex: drift.missing.length }} />}
      </div>
      <div className="drift-counts">
        <span><Badge s="BUILT" />{count("BUILT")}</span>
        <span><Badge s="MISSING" />{drift.missing.length}</span>
        <span><Badge s="UNPLANNED" />{drift.unplanned.length}</span>
        <span><Badge s="DIFFERENT" />{count("DIFFERENT")}</span>
      </div>
      {drift.findings.slice(0, 5).map((f, i) => (
        <button key={i} className="drift-finding" onClick={() => onSelect(f.component)}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{f.text}</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {f.detail}
            {f.file && (
              <>
                {" "}Found in <span className="mono" style={{ fontSize: 12 }}>{f.file}</span>
              </>
            )}
          </div>
        </button>
      ))}
      {drift.findings.length > 5 && <div className="faint" style={{ fontSize: 12 }}>+ {drift.findings.length - 5} more deviations</div>}
      {drift.findings.length === 0 && built > 0 && <div className="drift-ok">✓ The built parts follow the plan.</div>}
      {(drift.missing.length > 0 || drift.unplanned.length > 0 || drift.tables.planned > 0) && (
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          {drift.missing.length > 0 && (
            <div>
              <span style={{ color: "var(--warn-text)" }}>Missing:</span> {drift.missing.map((c) => c.name).join(", ")}
            </div>
          )}
          {drift.unplanned.length > 0 && (
            <div>
              <span style={{ color: "#A5B4FC" }}>Unplanned:</span> {drift.unplanned.map((n) => n.name).join(", ")}
            </div>
          )}
          {drift.tables.planned > 0 && (
            <div>
              <span style={{ color: "var(--teal-text)" }}>Tables:</span> {drift.tables.found.length} of {drift.tables.planned} in the schema
              {drift.tables.missing.length > 0 && drift.tables.missing.length <= 6 ? ` (missing ${drift.tables.missing.join(", ")})` : ""}
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="btn small plan-primary" style={{ height: 32, justifyContent: "center" }} disabled={busy} onClick={onExplain}>
          ✦ Explain with Claude
        </button>
        <button className="btn small" style={{ height: 32, justifyContent: "center" }} disabled={!drift.unplanned.length && !drift.findings.some((f) => f.edge)} onClick={onUpdatePlan}>
          Update plan from code
        </button>
      </div>
    </div>
  );
}
