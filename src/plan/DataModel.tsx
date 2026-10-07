import { memo, useEffect, useMemo, useRef, useState } from "react";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { RoutedEdge, type Pt } from "../map/RoutedEdge";
import type { Plan, PlanColumn, PlanTable } from "./model";

const W = 230, HEAD = 52, ROW = 26, ADD = 30;
const height = (t: PlanTable) => HEAD + Math.max(1, t.columns.length) * ROW + ADD;
const elk = new ELK();

type CardData = { t: PlanTable; owner: string | null; selected: boolean; dim: boolean; onAddColumn: (c: PlanColumn) => void; onRemoveColumn: (name: string) => void; onOwner: () => void };

/** "name type" → a column; "id" alone becomes the primary key. */
function parseColumn(text: string): PlanColumn | null {
  const [name, ...rest] = text.trim().split(/\s+/);
  if (!name) return null;
  const type = rest.join(" ") || undefined;
  return { name, type, pk: name === "id" || undefined };
}

const TableCard = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { t } = data;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className={`plan-table ${data.selected ? "sel" : ""}`} style={{ opacity: data.dim ? 0.35 : 1 }}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
      <div className="plan-table-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "#14B8A6" }} />
          <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
        </div>
        {data.owner ? (
          <button className="plan-owner nodrag" onClick={(e) => (e.stopPropagation(), data.onOwner())} title="Show the owning component">
            {data.owner}
          </button>
        ) : (
          <span className="faint" style={{ fontSize: 11 }}>no owner</span>
        )}
      </div>
      {t.columns.map((c) => (
        <div key={c.name} className="plan-col mono">
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          <span className="faint" style={{ fontSize: 11.5 }}>{c.type}{c.nullable ? "?" : ""}</span>
          <span className="plan-key" style={{ color: c.pk ? "#F59E0B" : "#818CF8" }}>{c.pk ? "PK" : c.fk ? "FK" : ""}</span>
          <button className="plan-col-x nodrag" onClick={(e) => (e.stopPropagation(), data.onRemoveColumn(c.name))} aria-label={`Remove ${c.name}`}>
            ×
          </button>
        </div>
      ))}
      {t.columns.length === 0 && <div className="plan-col faint" style={{ fontSize: 12 }}>No columns yet</div>}
      {adding ? (
        <div className="plan-col-add nodrag" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            className="mono"
            value={draft}
            placeholder="name type ↵"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => (setAdding(false), setDraft(""))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
              if (e.key === "Enter") {
                const col = parseColumn(draft);
                if (col && !t.columns.some((c) => c.name === col.name)) data.onAddColumn(col);
                setDraft("");
              }
            }}
          />
        </div>
      ) : (
        <button className="plan-col-addbtn nodrag" onClick={(e) => (e.stopPropagation(), setAdding(true))}>
          + Add column
        </button>
      )}
    </div>
  );
});

const nodeTypes = { table: TableCard };
const edgeTypes = { routed: RoutedEdge };

type Props = {
  plan: Plan;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Ids to keep bright (hovering a decision); others dim. */
  focus?: Set<string> | null;
  onChangeTable: (t: PlanTable) => void;
  onShowOwner: (componentId: string) => void;
};

function Inner({ plan, selected, onSelect, focus, onChangeTable, onShowOwner }: Props) {
  const rf = useReactFlow();
  const tables = plan.tables ?? [];
  const [laid, setLaid] = useState<{ boxes: Map<string, { x: number; y: number }>; routes: Map<string, Pt[]> } | null>(null);
  const fitted = useRef("");
  const rels = useMemo(() => tables.flatMap((t) => t.columns.filter((c) => c.fk && c.fk !== t.id).map((c) => ({ from: t.id, to: c.fk!, col: c.name }))), [tables]);
  const shape = JSON.stringify([tables.map((t) => [t.id, t.columns.length]), rels]);

  useEffect(() => {
    let cancelled = false;
    const graph: ElkNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": "70",
        "elk.spacing.nodeNode": "30",
        "elk.spacing.componentComponent": "50",
        "elk.padding": "[top=40,left=30,bottom=30,right=30]",
      },
      children: tables.map((t) => ({ id: t.id, width: W, height: height(t) })),
      edges: rels.map((r, i) => ({ id: `r${i}`, sources: [r.from], targets: [r.to] })),
    };
    elk
      .layout(graph)
      .then((res) => {
        if (cancelled) return;
        const boxes = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
        const routes = new Map<string, Pt[]>();
        for (const e of (res.edges ?? []) as ElkExtendedEdge[]) {
          const s = e.sections?.[0];
          if (s) routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
        }
        setLaid({ boxes, routes });
        const ids = tables.map((t) => t.id).sort().join(",");
        if (ids !== fitted.current) {
          fitted.current = ids;
          requestAnimationFrame(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 }));
        }
      })
      .catch((e) => console.error("data model layout failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, rf]);

  const owners = new Map(plan.components.map((c) => [c.id, c.name]));
  const flow = useMemo(() => {
    if (!laid) return { nodes: [] as Node[], edges: [] as Edge[] };
    const related = new Set<string>();
    if (selected) for (const r of rels) if (r.from === selected || r.to === selected) related.add(r.from === selected ? r.to : r.from);
    const nodes: Node[] = tables.flatMap((t) => {
      const b = laid.boxes.get(t.id);
      if (!b) return [];
      const dim = focus ? !focus.has(t.id) : !!selected && t.id !== selected && !related.has(t.id);
      return [
        {
          id: t.id,
          type: "table",
          position: b,
          width: W,
          height: height(t),
          draggable: false,
          data: {
            t,
            owner: t.owner ? owners.get(t.owner) ?? null : null,
            selected: t.id === selected,
            dim,
            onAddColumn: (c: PlanColumn) => onChangeTable({ ...t, columns: [...t.columns, c] }),
            onRemoveColumn: (name: string) => onChangeTable({ ...t, columns: t.columns.filter((c) => c.name !== name) }),
            onOwner: () => t.owner && onShowOwner(t.owner),
          },
        },
      ];
    });
    const edges: Edge[] = rels.flatMap((r, i) => {
      const points = laid.routes.get(`r${i}`);
      if (!points) return [];
      const active = !!selected && (r.from === selected || r.to === selected);
      return [
        {
          id: `r${i}`,
          type: "routed",
          source: r.from,
          target: r.to,
          className: `plan-rel ${active ? "active" : selected ? "dim" : ""}`,
          data: { points, label: active ? r.col : undefined, className: "" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "#14B8A6" },
        },
      ];
    });
    return { nodes, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, plan, selected, focus]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        minZoom={0.15}
        maxZoom={2}
        onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
      </ReactFlow>
    </div>
  );
}

export function DataModel(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
