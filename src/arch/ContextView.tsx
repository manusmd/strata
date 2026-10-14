import { memo, useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { edgeLabel, KIND_COLOR, type ArchModel, type ArchNode } from "../map/archModel";
import type { Actor } from "./actors";
import { ARCH_ROLE } from "./roles";

const ACTOR_W = 210, ACTOR_H = 92, SYS_W = 340, EXT_W = 230, EXT_H = 64, GAP = 22;

/** A person: who uses the system and what for. */
const ActorCard = memo(({ data }: NodeProps<Node<{ a: Actor; parts: string; dim: boolean }>>) => (
  <div className="ctx-actor" style={{ opacity: data.dim ? 0.4 : 1 }}>
    <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
    <svg className="ctx-person" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5" />
    </svg>
    <div style={{ minWidth: 0 }}>
      <div className="ctx-actor-name">
        {data.a.name}
        {data.a.ai && <span className="ai-spark" title="Named by Claude"> ✦</span>}
      </div>
      <div className="ctx-actor-desc">{data.a.description}</div>
      <div className="ctx-actor-parts mono">{data.parts}</div>
    </div>
  </div>
));

/** The whole system as one box, with what's inside listed. */
const SystemBox = memo(({ data }: NodeProps<Node<{ name: string; parts: ArchNode[]; onOpen: () => void }>>) => (
  <div className="ctx-system" onDoubleClick={data.onOpen}>
    <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
    <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
    <div className="ctx-system-kind">Software system</div>
    <div className="ctx-system-name">{data.name}</div>
    <div className="ctx-system-sub">
      {data.parts.length} parts · {data.parts.filter((p) => p.unit).length} that run, {data.parts.filter((p) => !p.unit).length} that store data
    </div>
    <div className="ctx-system-parts">
      {data.parts.map((p) => (
        <span key={p.id} className="ctx-chip mono">
          <span style={{ width: 6, height: 6, borderRadius: 2, background: KIND_COLOR[p.kind] }} />
          {p.name}
        </span>
      ))}
    </div>
    <button className="link-btn ctx-system-open" onClick={data.onOpen}>
      Show the containers →
    </button>
  </div>
));

const ExternalCard = memo(({ data }: NodeProps<Node<{ n: ArchNode; dim: boolean }>>) => (
  <div className="ctx-external" style={{ opacity: data.dim ? 0.4 : 1 }}>
    <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
    <div className="ctx-external-name mono">{data.n.name}</div>
    <div className="ctx-external-desc">{data.n.detail}</div>
  </div>
));

const nodeTypes = { actor: ActorCard, system: SystemBox, external: ExternalCard };

type Props = {
  projectName: string;
  /** The container view: what's inside the system, and what it talks to outside. */
  model: ArchModel;
  actors: Actor[];
  onOpenContainers: () => void;
  onSelect: (id: string | null) => void;
};

/** C4 level 1: the system as one box, the people who use it, and the systems it depends on. */
export function ContextView({ projectName, model, actors, onOpenContainers, onSelect }: Props) {
  const rf = useReactFlow();
  const [hover, setHover] = useState<string | null>(null);
  const inside = useMemo(() => model.nodes.filter((n) => ARCH_ROLE[n.kind] < 5 && n.kind !== "Missing").sort((a, b) => ARCH_ROLE[a.kind] - ARCH_ROLE[b.kind]), [model]);
  const insideIds = useMemo(() => new Set(inside.map((n) => n.id)), [inside]);
  const outside = useMemo(() => model.nodes.filter((n) => !insideIds.has(n.id) && n.kind !== "Missing"), [model, insideIds]);

  const flow = useMemo(() => {
    const sysH = Math.max(260, 150 + Math.ceil(inside.length / 2) * 30);
    const actorsH = actors.length * (ACTOR_H + GAP) - GAP;
    const extH = outside.length * (EXT_H + GAP) - GAP;
    const height = Math.max(sysH, actorsH, extH);
    const sysX = ACTOR_W + 170;
    const extX = sysX + SYS_W + 190;
    const name = (id: string) => model.byId.get(id)?.name ?? id;
    // What the system sends to each external system, summed up from its parts' lines.
    const toExternal = new Map<string, string[]>();
    for (const e of model.edges) if (insideIds.has(e.source) && !insideIds.has(e.target) && !e.minor) toExternal.set(e.target, [...(toExternal.get(e.target) ?? []), edgeLabel({ ...e, via: undefined }, model)]);
    const related = hover ? new Set([hover, ...(actors.find((a) => a.id === hover) ? ["system"] : []), ...(toExternal.has(hover) ? ["system"] : [])]) : null;

    const nodes: Node[] = [
      ...actors.map((a, i) => ({
        id: a.id,
        type: "actor",
        position: { x: 0, y: (height - actorsH) / 2 + i * (ACTOR_H + GAP) },
        width: ACTOR_W,
        height: ACTOR_H,
        draggable: false,
        data: { a, parts: a.uses.map(name).join(" · "), dim: !!related && !related.has(a.id) },
      })),
      { id: "system", type: "system", position: { x: sysX, y: (height - sysH) / 2 }, width: SYS_W, height: sysH, draggable: false, data: { name: projectName, parts: inside, onOpen: onOpenContainers } },
      ...outside.map((n, i) => ({
        id: n.id,
        type: "external",
        position: { x: extX, y: (height - extH) / 2 + i * (EXT_H + GAP) },
        width: EXT_W,
        height: EXT_H,
        draggable: false,
        data: { n, dim: !!related && !related.has(n.id) },
      })),
    ];
    const edges: Edge[] = [
      ...actors.map((a) => ({
        id: `e:${a.id}`,
        source: a.id,
        target: "system",
        label: `uses ${a.uses.map(name).join(", ")}`,
        className: `arch-edge k-calls ${related && !related.has(a.id) ? "dim" : ""}`,
        labelClassName: "arch-edge-label quiet",
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      })),
      ...[...toExternal].map(([target, labels]) => ({
        id: `e:sys>${target}`,
        source: "system",
        target,
        label: [...new Set(labels)].slice(0, 2).join(" · "),
        className: `arch-edge k-uses ${related && !related.has(target) ? "dim" : ""}`,
        labelClassName: "arch-edge-label quiet",
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      })),
    ];
    return { nodes, edges };
  }, [actors, inside, insideIds, outside, model, projectName, onOpenContainers, hover]);

  // Refit when users or external systems change (e.g. Claude named the users).
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.18, maxZoom: 1, duration: 200 }), 50);
    return () => clearTimeout(t);
  }, [rf, actors, outside.length]);

  return (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      nodeTypes={nodeTypes}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeMouseEnter={(_, n) => n.type !== "system" && setHover(n.id)}
      onNodeMouseLeave={() => setHover(null)}
      onNodeClick={(_, n) => (n.type === "external" ? onSelect(n.id) : n.type === "system" ? undefined : onSelect(null))}
      onPaneClick={() => onSelect(null)}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
    </ReactFlow>
  );
}
