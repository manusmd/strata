import { memo, useEffect, useMemo, useRef, useState } from "react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { Graph, Project } from "../api";
import { KIND_COLOR, buildArchModel, type ArchModel, type ArchNode, type WorkspacePackage } from "./archModel";
import type { Highlight } from "./nodes";
import { ArchInspector } from "./ArchInspector";
import type { Layout } from "./layout";
import { ZoomWatcher } from "./zoom";
import type { Focus } from "./focus";

const NODE_W = 248;
const NODE_H = 96;
const elk = new ELK();

type CardData = { node: ArchNode; highlight: Highlight; repoName: string | null; color: string };

const initials = (name: string) => {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ");
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
};

const ArchCard = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { node } = data;
  const color = KIND_COLOR[node.kind];
  const missing = node.kind === "Missing";
  return (
    <div className={`arch-card ${missing ? "missing" : ""} hl-${data.highlight ?? "none"}`} style={{ ["--kind" as any]: color }}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
      <div className="arch-top">
        <span className="arch-mono">{missing ? "?" : initials(node.name)}</span>
        <span className="arch-name">{node.name}</span>
        <span className="arch-kind">{node.kind}</span>
      </div>
      <div className="arch-detail">{node.detail}</div>
      <div className="arch-bottom">
        {data.repoName && (
          <span className="chip arch-chip">
            <span className="repo-dot" style={{ width: 6, height: 6, background: data.color }} />
            {data.repoName}
            {node.unit?.dir ? ` · ${node.unit.dir}` : ""}
          </span>
        )}
        {node.unit && <span className="faint">{node.unit.files} files</span>}
        {missing && node.missing?.repo && <span className="arch-add">Add repo</span>}
      </div>
      <div className="arch-far">{node.name}</div>
    </div>
  );
});

const nodeTypes = { arch: ArchCard };

/** Columns: clients → services → libraries → data & external. */
async function layoutArch(model: ArchModel): Promise<Layout> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "30",
      "elk.spacing.componentComponent": "40",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.separateConnectedComponents": "false",
    },
    children: model.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H, layoutOptions: { "elk.partitioning.partition": String(n.layer) } })),
    edges: model.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const result = await elk.layout(graph);
  return { boxes: new Map((result.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 }])) };
}

type Props = {
  project: Project;
  graph: Graph;
  workspace: WorkspacePackage[];
  onOpenFile: (fileId: string) => void;
  onOpenTable: (tableId: string | null) => void;
  onAddRepo: (path: string) => void;
  /** Component to select and center, e.g. from an Ask Strata answer. */
  focus: Focus | null;
};

function ArchMapInner({ project, graph, workspace, onOpenFile, onOpenTable, onAddRepo, focus: focusReq }: Props) {
  const focus = focusReq?.id ?? null;
  const container = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const model = useMemo(() => buildArchModel(graph, project.repos, workspace), [graph, project.repos, workspace]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [sel, setSel] = useState<string | null>(focus);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    layoutArch(model).then((l) => !cancelled && setLayout(l));
    return () => {
      cancelled = true;
    };
  }, [model]);

  useEffect(() => {
    if (layout && !fitted.current) {
      fitted.current = true;
      requestAnimationFrame(() => rf.fitView({ padding: 0.12, maxZoom: 1 }));
    }
  }, [layout, rf]);

  useEffect(() => {
    if (!focus) return;
    setSel(focus);
    if (fitted.current) rf.fitView({ nodes: [{ id: focus }], maxZoom: 1, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq, rf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flow = useMemo(() => {
    if (!layout) return { nodes: [] as Node[], edges: [] as Edge[] };
    const related = new Set<string>();
    if (sel) for (const e of model.edges) if (e.source === sel || e.target === sel) related.add(e.source === sel ? e.target : e.source);
    const hl = (id: string): Highlight => (!sel ? null : id === sel ? "selected" : related.has(id) ? "related" : "dim");
    const repoName = (id: string | null) => (id ? project.repos.find((r) => r.id === id)?.name ?? null : null);
    const nodes: Node[] = model.nodes.flatMap((n) => {
      const b = layout.boxes.get(n.id);
      return b ? [{ id: n.id, type: "arch", position: { x: b.x, y: b.y }, width: NODE_W, height: NODE_H, data: { node: n, highlight: hl(n.id), repoName: project.repos.length > 1 || n.unit ? repoName(n.repoId) : null, color: project.color }, draggable: false }] : [];
    });
    const edges: Edge[] = model.edges.map((e) => {
      const active = !!sel && (e.source === sel || e.target === sel);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        className: `arch-edge k-${e.kind} ${e.inferred ? "inferred" : ""} ${e.target.startsWith("missing:") ? "missing" : ""} ${active ? "active" : sel ? "dim" : ""}`,
        label: active ? e.reasons.join(" · ") : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelClassName: "arch-edge-label",
        animated: active && e.kind === "calls",
        zIndex: active ? 3 : 1,
      };
    });
    return { nodes, edges };
  }, [layout, model, sel, project]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of model.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [model]);

  return (
    <div ref={container} className="map" data-level="file">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={2}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSel(n.id)}
        onPaneClick={() => setSel(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
        <MiniMap className="map-minimap" pannable zoomable nodeColor={(n) => KIND_COLOR[(n.data as CardData).node.kind] + "AA"} nodeStrokeWidth={0} />
        <ZoomWatcher container={container} onLevel={() => {}} />
      </ReactFlow>
      {!layout && <div className="map-loading">Laying out the architecture…</div>}
      <div className="map-legend">
        <span>
          {Object.entries(counts)
            .map(([k, n]) => `${n} ${k === "Library" ? (n === 1 ? "library" : "libraries") : k.toLowerCase() + (n === 1 || ["Missing", "External", "Infra"].includes(k) ? "" : "s")}`)
            .join(" · ")}
        </span>
        <span><i className="lg-line" style={{ borderColor: "var(--arch)" }} /> calls</span>
        <span><i className="lg-line" style={{ borderColor: "var(--db)" }} /> data</span>
        <span><i className="lg-line" /> imports / uses</span>
        <span><i className="lg-line ghost" /> missing · inferred</span>
      </div>
      {sel && model.byId.has(sel) && (
        <ArchInspector model={model} project={project} graph={graph} id={sel} onSelect={setSel} onOpenFile={onOpenFile} onOpenTable={onOpenTable} onAddRepo={onAddRepo} onClose={() => setSel(null)} />
      )}
    </div>
  );
}

export function ArchMap(props: Props) {
  return (
    <ReactFlowProvider>
      <ArchMapInner {...props} />
    </ReactFlowProvider>
  );
}
