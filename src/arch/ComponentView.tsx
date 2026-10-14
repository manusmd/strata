import { memo, useEffect, useMemo, useState } from "react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { Graph } from "../api";
import { KIND_COLOR, type ArchModel, type ArchNode } from "../map/archModel";
import { MapLegend } from "../map/MapLegend";
import { buildComponents, COMP_COLOR, COMP_COLUMN, type Component } from "./components";
import { ARCH_ROLE } from "./roles";

const W = 230, H = 84, OW = 200, OH = 58;
const elk = new ELK();

const CompCard = memo(({ data }: NodeProps<Node<{ c: Component; hl: "on" | "near" | "dim" | null }>>) => (
  <div className={`arch-card comp-card hl-${data.hl === "on" ? "selected" : data.hl === "near" ? "related" : "none"}`} style={{ ["--kind" as any]: COMP_COLOR[data.c.kind], opacity: data.hl === "dim" ? 0.35 : 1 }}>
    <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
    <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
    <div className="arch-top">
      <span className="arch-name" title={data.c.name}>{data.c.name}</span>
      <span className="arch-kind">{data.c.kind}</span>
    </div>
    <div className="arch-detail">{data.c.detail}</div>
  </div>
));

const SHAPE: Partial<Record<ArchNode["kind"], string>> = { Database: "db", Cache: "db", Queue: "db", Storage: "db", Search: "db", External: "ext", AI: "ext", Mail: "ext" };
const OutsideCard = memo(({ data }: NodeProps<Node<{ n: ArchNode; hl: "on" | "near" | "dim" | null }>>) => (
  <div className={`arch-card comp-out ${SHAPE[data.n.kind] ? `shape-${SHAPE[data.n.kind]}` : ""}`} style={{ ["--kind" as any]: KIND_COLOR[data.n.kind], opacity: data.hl === "dim" ? 0.35 : 1 }}>
    <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
    <div className="arch-top">
      <span className="arch-name">{data.n.name}</span>
      <span className="arch-kind">{data.n.kind}</span>
    </div>
  </div>
));

const nodeTypes = { comp: CompCard, out: OutsideCard };

type Props = {
  container: ArchNode;
  full: ArchModel;
  graph: Graph;
  /** Files of the container. */
  files: string[];
  onOpenFile: (fileId: string) => void;
  /** Opens a library or another container's own view. */
  onOpenPart: (id: string) => void;
};

/** C4 level 3 for one container: its components, how they import each other, and what they use outside. */
export function ComponentView({ container, full, graph, files, onOpenFile, onOpenPart }: Props) {
  const rf = useReactFlow();
  const m = useMemo(() => buildComponents(container, full, graph, files), [container, full, graph, files]);
  const [laid, setLaid] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  // Outside, left to right: other containers and libraries, then datastores, then external systems.
  const outCol = (n: ArchNode) => 3 + (ARCH_ROLE[n.kind] >= 5 ? 2 : ARCH_ROLE[n.kind] === 4 ? 1 : 0);
  // By default: the strongest lines between components, and what they use outside except libraries.
  const visible = useMemo(() => {
    const isLib = (id: string) => full.byId.get(id)?.kind === "Library";
    const inner = m.edges.filter((e) => e.target.startsWith("comp:")).sort((a, b) => b.weight - a.weight);
    const strong = new Set(inner.slice(0, 28).map((e) => e.id));
    return m.edges.filter((e) => (e.target.startsWith("comp:") ? strong.has(e.id) : !isLib(e.target)));
  }, [m, full]);

  useEffect(() => {
    let cancelled = false;
    const graphElk: ElkNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.partitioning.activate": "true",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.spacing.nodeNode": "22",
        "elk.separateConnectedComponents": "false",
        "elk.padding": "[top=70,left=30,bottom=30,right=30]",
      },
      children: [
        ...m.components.map((c) => ({ id: c.id, width: W, height: H, layoutOptions: { "elk.partitioning.partition": String(COMP_COLUMN[c.kind]) } })),
        ...m.outside.map((o) => ({ id: o.id, width: OW, height: OH + (SHAPE[o.node.kind] === "db" ? 8 : 0), layoutOptions: { "elk.partitioning.partition": String(outCol(o.node)) } })),
      ],
      edges: visible.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
    elk.layout(graphElk).then((r) => {
      if (cancelled) return;
      setLaid(new Map((r.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])));
      requestAnimationFrame(() => rf.fitView({ padding: 0.08, maxZoom: 1 }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, visible]);

  const flow = useMemo(() => {
    if (!laid) return { nodes: [] as Node[], edges: [] as Edge[] };
    const near = new Set<string>();
    if (sel) for (const e of m.edges) if (e.source === sel || e.target === sel) near.add(e.source === sel ? e.target : e.source);
    const hl = (id: string) => (!sel ? null : id === sel ? "on" : near.has(id) ? "near" : "dim");
    const nodes: Node[] = [
      ...m.components.flatMap((c) => (laid.get(c.id) ? [{ id: c.id, type: "comp", position: laid.get(c.id)!, width: W, height: H, draggable: false, data: { c, hl: hl(c.id) } }] : [])),
      ...m.outside.flatMap((o) => (laid.get(o.id) ? [{ id: o.id, type: "out", position: laid.get(o.id)!, width: OW, height: OH + (SHAPE[o.node.kind] === "db" ? 8 : 0), draggable: false, data: { n: o.node, hl: hl(o.id) } }] : [])),
    ];
    // The selected component shows all its lines (libraries too); otherwise the default set.
    const shown = sel ? m.edges.filter((e) => e.source === sel || e.target === sel) : visible;
    const edges: Edge[] = shown.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      className: `arch-edge k-${e.kind === "imports" ? "imports" : e.kind} ${sel ? "active" : ""}`,
      label: sel ? e.label : undefined,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      labelClassName: "arch-edge-label",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: sel ? undefined : { strokeWidth: Math.min(3, 0.8 + e.weight / 8) },
    }));
    return { nodes, edges };
  }, [laid, m, sel, visible]);

  const selected = sel ? m.components.find((c) => c.id === sel) : undefined;
  const fileRows = useMemo(() => {
    if (!selected) return [];
    const importers = new Map<string, number>();
    const inside = new Set(selected.files);
    for (const e of graph.edges) if (e.kind === "imports" && inside.has(e.dst)) importers.set(e.dst, (importers.get(e.dst) ?? 0) + 1);
    const path = new Map(graph.nodes.map((n) => [n.id, n.path ?? n.name]));
    return [...selected.files].sort((a, b) => (importers.get(b) ?? 0) - (importers.get(a) ?? 0)).map((f) => ({ id: f, path: path.get(f) ?? f, used: importers.get(f) ?? 0 }));
  }, [selected, graph]);

  return (
    <>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => (n.type === "comp" ? setSel(n.id === sel ? null : n.id) : setSel(null))}
        onNodeDoubleClick={(_, n) => n.type === "out" && full.byId.get(n.id)?.unit && onOpenPart(n.id)}
        onPaneClick={() => setSel(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
      </ReactFlow>
      {!laid && <div className="map-loading">Finding the components…</div>}
      {selected && (
        <aside className="inspector glass comp-panel">
          <button className="icon-btn insp-close" onClick={() => setSel(null)}>
            ×
          </button>
          <div className="insp-body">
            <div className="insp-header">
              <div className="insp-tile" style={{ background: COMP_COLOR[selected.kind] + "24", color: COMP_COLOR[selected.kind], borderColor: COMP_COLOR[selected.kind] + "80" }}>
                {selected.kind === "Pages" ? "PG" : selected.kind === "API routes" ? "API" : selected.kind === "UI components" ? "UI" : selected.kind === "Feature module" ? "MOD" : "</>"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="insp-title">{selected.name}</div>
                <div className="insp-meta mono">{selected.dir}</div>
              </div>
              <span className="insp-kind">{selected.kind}</span>
            </div>
            <div className="insp-chips">
              <span className="chip">{selected.detail}</span>
            </div>
            <div className="insp-section">
              <div className="insp-label">Uses</div>
              {m.edges
                .filter((e) => e.source === selected.id)
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 12)
                .map((e) => {
                  const other = m.components.find((c) => c.id === e.target)?.name ?? full.byId.get(e.target)?.name ?? e.target;
                  return (
                    <div key={e.id} className="insp-row link" onClick={() => (e.target.startsWith("comp:") ? setSel(e.target) : full.byId.get(e.target)?.unit && onOpenPart(e.target))}>
                      <span className="insp-bullet" />
                      <span className="mono grow">{other}</span>
                      <span className="faint">{e.label}</span>
                    </div>
                  );
                })}
            </div>
            <div className="insp-section">
              <div className="insp-label">Files · {fileRows.length}</div>
              {fileRows.slice(0, 40).map((f) => (
                <div key={f.id} className="insp-row link" onClick={() => onOpenFile(f.id)} title={f.path}>
                  <span className="insp-bullet" />
                  <span className="mono grow">{f.path.slice(selected.dir.length + 1) || f.path}</span>
                  {f.used > 0 && <span className="faint">{f.used}×</span>}
                </div>
              ))}
              {fileRows.length > 40 && <div className="faint" style={{ fontSize: 12, padding: "2px 6px" }}>+ {fileRows.length - 40} more</div>}
            </div>
          </div>
        </aside>
      )}
      <MapLegend
        summary={`${m.components.length} components · ${m.outside.length} used outside`}
        groups={[
          {
            title: "Components",
            items: (["Pages", "API routes", "Feature module", "UI components", "Code"] as const)
              .filter((k) => m.components.some((c) => c.kind === k))
              .map((k) => ({ icon: <i className="lg-dot" style={{ background: COMP_COLOR[k] }} />, label: `${m.components.filter((c) => c.kind === k).length} ${k.toLowerCase()}` })),
          },
          {
            title: "Lines",
            items: [
              { icon: <i className="lg-line" />, label: "imports (thicker = more); select a component for all" },
              { icon: <i className="lg-line" style={{ borderColor: "var(--db)" }} />, label: "reads or writes data" },
              { icon: <i className="lg-shape ext" />, label: "external system" },
            ],
          },
        ]}
      />
    </>
  );
}
