import { memo, useEffect, useMemo, useRef, useState } from "react";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { fontsReady, MONO, textWidth } from "../map/measure";
import { RoutedEdge, type Pt } from "../map/RoutedEdge";
import { initials, KIND_COLOR, TYPE_STYLE, type Plan, type PlanComponent, type PlanType } from "./model";

export type Badge = "NEW" | "CHANGED" | "REMOVED" | "BUILT" | "MISSING" | "UNPLANNED" | "DIFFERENT";
const BADGE: Record<Badge, [string, string]> = {
  NEW: ["#3FB47C", "#05210F"],
  CHANGED: ["#F59E0B", "#2B1900"],
  REMOVED: ["#F07171", "#2E0B0B"],
  BUILT: ["#3FB47C", "#05210F"],
  MISSING: ["#F59E0B", "#2B1900"],
  UNPLANNED: ["#6366F1", "#FFFFFF"],
  DIFFERENT: ["#F07171", "#2E0B0B"],
};

const W = 176, H = 62;
const elk = new ELK();
// Columns: what users touch, what serves it, where data lives, what's outside.
const COLUMN: Record<PlanType, number> = { App: 0, Service: 1, Worker: 1, Library: 1, Queue: 2, Database: 2, External: 3 };

type CardData = { c: PlanComponent; selected: boolean; dim: boolean; badge: Badge | null; glow: boolean };

const PlanCard = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { c, badge } = data;
  const style = TYPE_STYLE[c.type];
  const removed = badge === "REMOVED";
  const sub = c.tech?.length ? c.tech.join(" · ") : c.type;
  return (
    <div
      className={`plan-card ${data.selected ? "sel" : ""} ${data.glow ? "glow" : ""} ${removed ? "removed" : ""} ${badge ? `b-${badge.toLowerCase()}` : ""}`}
      style={{ ["--kind" as any]: style.color, opacity: data.dim ? 0.35 : removed ? 0.6 : 1 }}
      title={c.resp}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
      <div className="plan-tile">{initials(c)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="plan-name">{c.name}</div>
        <div className="plan-sub">{sub}</div>
      </div>
      {badge && (
        <div className="plan-badge" style={{ background: BADGE[badge][0], color: BADGE[badge][1] }}>
          {badge}
        </div>
      )}
    </div>
  );
});

const nodeTypes = { plan: PlanCard };
const edgeTypes = { routed: RoutedEdge };

type Box = { x: number; y: number };
type Laid = { boxes: Map<string, Box>; routes: Map<string, { points: Pt[]; label?: { x: number; y: number; w: number; h: number } }> };

async function layout(plan: Plan, direction: "RIGHT" | "DOWN"): Promise<Laid> {
  await fontsReady();
  const font = `500 11px ${MONO}`;
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.partitioning.activate": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.nodeNode": "36",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "12",
      "elk.spacing.componentComponent": "60",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.separateConnectedComponents": "false",
      "elk.padding": "[top=30,left=30,bottom=30,right=30]",
    },
    children: plan.components.map((c) => ({ id: c.id, width: W, height: H, layoutOptions: { "elk.partitioning.partition": String(COLUMN[c.type]) } })),
    edges: plan.connections.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
      labels: e.label ? [{ id: `e${i}:l`, text: e.label, width: Math.min(200, textWidth(e.label, font) + 14), height: 20 }] : [],
    })),
  };
  const result = await elk.layout(graph);
  const boxes = new Map((result.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  const routes: Laid["routes"] = new Map();
  for (const e of (result.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    if (!s) continue;
    const l = e.labels?.[0];
    routes.set(e.id, { points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint], label: l ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 } : undefined });
  }
  return { boxes, routes };
}

type Props = {
  plan: Plan;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Status badges, e.g. when comparing versions. */
  badges?: Map<string, Badge>;
  /** Components to light up briefly (just changed). */
  glow?: Set<string>;
  /** Ids to keep bright, e.g. what a hovered decision is about; the rest dims. */
  focus?: Set<string> | null;
  interactive?: boolean;
  /** RIGHT for the wide canvas; DOWN fits narrow panes (comparing versions). */
  direction?: "RIGHT" | "DOWN";
  /** Bottom toolbar actions (interactive canvases only). */
  onAdd?: () => void;
  onDelete?: () => void;
};

function Inner({ plan, selected = null, onSelect, badges, glow, focus, interactive = true, direction = "RIGHT", onAdd, onDelete }: Props) {
  const rf = useReactFlow();
  const [laid, setLaid] = useState<Laid | null>(null);
  const [zoom, setZoom] = useState(1);
  const fittedFor = useRef("");
  const box = useRef<HTMLDivElement>(null);

  // Refit when the canvas changes size (chat opened or closed, window resized).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const ro = new ResizeObserver(([e]) => {
      const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (size === last) return;
      const first = !last;
      last = size;
      if (first) return;
      clearTimeout(t);
      t = setTimeout(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 200 }), 250);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [rf]);

  // Re-layout when the structure changes, not when a description is edited.
  const shape = useMemo(() => JSON.stringify([plan.components.map((c) => [c.id, c.type]), plan.connections.map((e) => [e.from, e.to, e.label])]), [plan]);
  useEffect(() => {
    let cancelled = false;
    layout(plan, direction)
      .then((l) => {
        if (cancelled) return;
        setLaid(l);
        // Fit when components were added or removed; keep the viewport for smaller changes.
        const ids = direction + plan.components.map((c) => c.id).sort().join(",");
        if (ids !== fittedFor.current) {
          fittedFor.current = ids;
          requestAnimationFrame(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 }));
        }
      })
      .catch((e) => console.error("plan layout failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, direction, rf]);

  const flow = useMemo(() => {
    if (!laid) return { nodes: [] as Node[], edges: [] as Edge[] };
    const related = new Set<string>();
    if (selected) for (const e of plan.connections) if (e.from === selected || e.to === selected) related.add(e.from === selected ? e.to : e.from);
    const nodes: Node[] = plan.components.flatMap((c) => {
      const b = laid.boxes.get(c.id);
      if (!b) return [];
      return [
        {
          id: c.id,
          type: "plan",
          position: b,
          width: W,
          height: H,
          draggable: false,
          data: { c, selected: c.id === selected, dim: focus ? !focus.has(c.id) : !!selected && c.id !== selected && !related.has(c.id), badge: badges?.get(c.id) ?? null, glow: !!glow?.has(c.id) },
        },
      ];
    });
    const edges: Edge[] = plan.connections.flatMap((e, i) => {
      const r = laid.routes.get(`e${i}`);
      if (!r) return [];
      const active = !!selected && (e.from === selected || e.to === selected);
      const color = KIND_COLOR[e.kind ?? "uses"];
      const cls = `plan-edge k-${e.kind ?? "uses"} ${active ? "active" : selected ? "dim" : ""}`;
      return [
        {
          id: `e${i}`,
          type: "routed",
          source: e.from,
          target: e.to,
          className: cls,
          data: { points: r.points, label: e.label, labelBox: r.label, className: active ? "active" : selected ? "dim" : "" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          zIndex: active ? 4 : 1,
        },
      ];
    });
    return { nodes, edges };
  }, [laid, plan, selected, badges, glow, focus]);

  return (
    <div ref={box} style={{ position: "absolute", inset: 0 }}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        panOnDrag
        minZoom={0.1}
        maxZoom={2}
        onMove={(_, v) => setZoom(v.zoom)}
        onNodeClick={(_, n) => onSelect?.(n.id)}
        onPaneClick={() => onSelect?.(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
      </ReactFlow>
      {interactive && (
        <div className="plan-toolbar glass">
          {onAdd && (
            <button onClick={onAdd} style={{ fontWeight: 500 }}>
              + Component
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} disabled={!selected}>
              Delete
            </button>
          )}
          <span className="plan-toolbar-sep" />
          <button onClick={() => rf.zoomOut({ duration: 150 })} aria-label="Zoom out">
            −
          </button>
          <span className="mono" style={{ width: 42, textAlign: "center", fontSize: 12, color: "var(--text-2)" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => rf.zoomIn({ duration: 150 })} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 })}>Fit</button>
        </div>
      )}
    </div>
  );
}

export function PlanCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
