import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";

export type Pt = { x: number; y: number };
export type RoutedData = { points: Pt[]; label?: string; labelBox?: { x: number; y: number; w: number; h: number }; className: string };

/** SVG path through ELK's bend points, with rounded corners. */
export function roundedPath(pts: Pt[], r = 8) {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const towards = (p: Pt, q: Pt, len: number) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: p.x + ((q.x - p.x) / l) * len, y: p.y + ((q.y - p.y) / l) * len };
    };
    const p1 = towards(b, a, r1);
    const p2 = towards(b, c, r1);
    d += ` L${p1.x},${p1.y} Q${b.x},${b.y} ${p2.x},${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

/** An edge drawn along ELK's route (around boxes), with its label where ELK reserved room for it. */
export const RoutedEdge = memo(({ data, markerEnd }: EdgeProps<Edge<RoutedData>>) => {
  if (!data) return null;
  const b = data.labelBox;
  return (
    <>
      <BaseEdge path={roundedPath(data.points)} markerEnd={markerEnd} />
      {data.label && b && (
        <EdgeLabelRenderer>
          <div className={`flow-label ${data.className}`} style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }} title={data.label}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
