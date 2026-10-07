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
import type { Plan } from "../sections/plan";
import { fontsReady, lineCount, MONO, SANS, textWidth } from "./measure";

const NODE_W = 248;
const elk = new ELK();

type Size = { nameLines: number; detailLines: number; height: number };

/** Measured so long names and details wrap inside the card instead of being cut. */
function cardSize(n: ArchNode): Size {
  const inner = NODE_W - 28 - 3;
  const kind = textWidth(n.kind, `11px ${SANS}`) + 14;
  const nameLines = lineCount(n.name, `600 13.5px ${MONO}`, inner - 26 - 18 - kind, 3);
  const detailLines = lineCount(n.detail, `12px ${SANS}`, inner, 3);
  return { nameLines, detailLines, height: 27 + Math.max(26, nameLines * 18) + 6 + detailLines * 16 + 6 + 20 };
}

type CardData = { node: ArchNode; highlight: Highlight; repoName: string | null; color: string; size: Size };

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
        <span className="arch-name wrap" style={{ WebkitLineClamp: data.size.nameLines }}>{node.name}</span>
        <span className="arch-kind">{node.kind}</span>
      </div>
      <div className="arch-detail wrap" style={{ WebkitLineClamp: data.size.detailLines }}>{node.detail}</div>
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

const SectionFrame = memo(({ data }: NodeProps<Node<{ name: string; description: string; count: number }>>) => (
  <div className="section-frame">
    <div className="section-head">
      <span className="ai-spark">✦</span>
      <span className="section-name">{data.name}</span>
      <span className="section-count">{data.count}</span>
    </div>
    <div className="section-desc">{data.description}</div>
  </div>
));

const nodeTypes = { arch: ArchCard, section: SectionFrame };

const flowInside = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.partitioning.activate": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "24",
  "elk.padding": "[top=56,left=20,bottom=20,right=20]",
};

/** With AI sections: each section is a frame with its own left-to-right flow; frames are packed. */
async function layoutSections(model: ArchModel, plan: Plan, sizes: Map<string, Size>): Promise<Layout> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.6", "elk.spacing.nodeNode": "40" },
    children: plan.sections.map((sec, i) => {
      const members = new Set(sec.members);
      return {
        id: `sec:${i}`,
        layoutOptions: flowInside,
        children: model.nodes.filter((n) => members.has(n.id)).map((n) => ({ id: n.id, width: NODE_W, height: sizes.get(n.id)!.height, layoutOptions: { "elk.partitioning.partition": String(n.layer) } })),
        edges: model.edges.filter((e) => members.has(e.source) && members.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };
    }),
  };
  const result = await elk.layout(graph);
  const boxes: Layout["boxes"] = new Map();
  for (const sec of result.children ?? []) {
    boxes.set(sec.id, { x: sec.x ?? 0, y: sec.y ?? 0, width: sec.width ?? 0, height: sec.height ?? 0 });
    for (const c of sec.children ?? []) boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
  }
  return { boxes };
}

/** Columns: clients → services → libraries → data & external. */
async function layoutArch(model: ArchModel, sizes: Map<string, Size>): Promise<Layout> {
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
    children: model.nodes.map((n) => ({ id: n.id, width: NODE_W, height: sizes.get(n.id)!.height, layoutOptions: { "elk.partitioning.partition": String(n.layer) } })),
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
  /** AI sections: group components into domain frames. */
  plan?: Plan | null;
};

function ArchMapInner({ project, graph, workspace, onOpenFile, onOpenTable, onAddRepo, focus: focusReq, plan = null }: Props) {
  const focus = focusReq?.id ?? null;
  const container = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const model = useMemo(() => buildArchModel(graph, project.repos, workspace), [graph, project.repos, workspace]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [sizes, setSizes] = useState<Map<string, Size>>(new Map());
  const [sel, setSel] = useState<string | null>(focus);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fontsReady()
      .then(() => {
        const sz = new Map(model.nodes.map((n) => [n.id, cardSize(n)]));
        return (plan ? layoutSections(model, plan, sz) : layoutArch(model, sz)).then((l) => ({ l, sz }));
      })
      .then(({ l, sz }) => {
        if (cancelled) return;
        setSizes(sz);
        setLayout(l);
        requestAnimationFrame(() => rf.fitView({ padding: 0.1, maxZoom: 1, duration: fitted.current ? 300 : 0 }));
      })
      .catch((e) => console.error("architecture layout failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, plan]);

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
    const frames: Node[] = (plan?.sections ?? []).flatMap((sec, i) => {
      const b = layout.boxes.get(`sec:${i}`);
      return b ? [{ id: `sec:${i}`, type: "section", position: { x: b.x, y: b.y }, width: b.width, height: b.height, data: { name: sec.name, description: sec.description, count: sec.members.length }, draggable: false, selectable: false, zIndex: 0 }] : [];
    });
    const nodes: Node[] = [
      ...frames,
      ...model.nodes.flatMap((n) => {
        const b = layout.boxes.get(n.id);
        const size = sizes.get(n.id);
        const section = plan?.sectionOf.get(n.id);
        return b && size
          ? [{ id: n.id, type: "arch", parentId: section !== undefined ? `sec:${section}` : undefined, position: { x: b.x, y: b.y }, width: NODE_W, height: b.height, data: { node: n, highlight: hl(n.id), repoName: project.repos.length > 1 || n.unit ? repoName(n.repoId) : null, color: project.color, size }, draggable: false, zIndex: 2 }]
          : [];
      }),
    ];
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
  }, [layout, sizes, model, sel, project, plan]);

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
        <MiniMap className="map-minimap" pannable zoomable nodeColor={(n) => (n.type === "arch" ? KIND_COLOR[(n.data as CardData).node.kind] + "AA" : "rgba(139, 92, 246, 0.08)")} nodeStrokeWidth={0} />
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
