import { useState, type ReactNode } from "react";

export type LegendGroup = { title: string; items: { icon: ReactNode; label: ReactNode }[] };

const KEY = "strata-legend-open";

/** The map's key: a small button in the bottom-left corner that opens into a grouped list. */
export function MapLegend({ summary, groups }: { summary: string; groups: LegendGroup[] }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? "0" : "1");
    } catch {}
  };
  return (
    <div className={`map-legend ${open ? "open" : ""}`}>
      <button className="map-legend-head" onClick={toggle} aria-expanded={open} title={open ? "Hide the legend" : "Show the legend"}>
        <span className="map-legend-i">i</span>
        <span className="map-legend-sum">{summary}</span>
        <span className="faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="map-legend-body">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <div key={g.title} className="map-legend-group">
                <div className="map-legend-title">{g.title}</div>
                {g.items.map((it, i) => (
                  <div key={i} className="map-legend-row">
                    <span className="map-legend-icon">{it.icon}</span>
                    <span>{it.label}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
