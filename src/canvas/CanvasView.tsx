import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { Graph, Project } from "../api";
import { ArchMap } from "../map/ArchMap";
import { ArchInspector } from "../map/ArchInspector";
import { fontsReady, lineCount, MONO, SANS, textWidth } from "../map/measure";
import type { Ref } from "../ask/Markdown";
import { buildArchModel, KIND_COLOR, type ArchModel, type WorkspacePackage } from "../map/archModel";
import { parseCanvas, type Canvas, type CanvasEdge, type CanvasNode, type CanvasStatus } from "./spec";

const CARD_W = 260;
const elk = new ELK();

const TYPE_COLOR: Record<string, string> = { ...KIND_COLOR, Step: "#8B5CF6", Actor: "#6366F1", Note: "#9B9A97" };
const STATUS_LABEL = { existing: "", new: "NEW", changed: "CHANGED", removed: "REMOVED" } as const;
const STATUS_COLOR: Record<CanvasStatus, string | null> = { existing: null, new: "#3FB47C", changed: "#F59E0B", removed: "#F07171" };
const KIND_EDGE_COLOR: Record<CanvasEdge["kind"], string> = { calls: "#8B5CF6", step: "#8B5CF6", data: "#14B8A6", uses: "#9B9A97" };
const STATUS_TEXT: Record<CanvasStatus, string> = {
  existing: "Exists today",
  new: "New in this proposal",
  changed: "Changed by this proposal",
  removed: "Removed by this proposal",
};

const monogram = (label: string) => label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** Lines of name and note a card needs, and its height, so nothing is cut off. */
function cardSize(n: CanvasNode, linked: boolean) {
  const inner = CARD_W - 24 - 3;
  const badge = STATUS_LABEL[n.status] ? textWidth(STATUS_LABEL[n.status], `600 9.5px ${MONO}`) + 16 : textWidth(n.type, `11px ${SANS}`) + 14;
  const nameLines = lineCount(n.label, `600 13.5px ${MONO}`, inner - 26 - 18 - badge, 3);
  const detailLines = lineCount(n.note ?? n.type, `11.5px ${SANS}`, inner, 4);
  const footer = n.status !== "existing" || linked;
  return { nameLines, detailLines, footer, height: 23 + Math.max(26, nameLines * 18) + 5 + detailLines * 16 + (footer ? 5 + 18 : 0) };
}

type Highlight = "selected" | "related" | "dim" | null;
type CardData = { node: CanvasNode; refId: string | null; size: ReturnType<typeof cardSize>; highlight: Highlight; onRef: (id: string) => void };

const CanvasCard = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { node, size } = data;
  return (
    <div className={`canvas-card st-${node.status} ${node.type === "Note" ? "note" : ""} hl-${data.highlight ?? "none"}`} style={{ ["--kind" as any]: TYPE_COLOR[node.type] ?? "#8B5CF6" }}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
      <div className="arch-top">
        <span className="arch-mono">{monogram(node.label)}</span>
        <span className="arch-name wrap" style={{ WebkitLineClamp: size.nameLines }}>{node.label}</span>
        {STATUS_LABEL[node.status] ? <span className={`canvas-status st-${node.status}`}>{STATUS_LABEL[node.status]}</span> : <span className="arch-kind">{node.type}</span>}
      </div>
      <div className="arch-detail wrap" style={{ WebkitLineClamp: size.detailLines }}>{node.note ?? node.type}</div>
      {size.footer && (
        <div className="canvas-foot">
          {node.status !== "existing" && <span className="arch-kind">{node.type}</span>}
          {data.refId && (
            <button
              className="canvas-ref nodrag"
              onClick={(e) => {
                e.stopPropagation();
                data.onRef(data.refId!);
              }}
              title="Show the real component in the Architecture view"
            >
              ↗ on map
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const GroupBox = memo(({ data }: NodeProps<Node<{ label: string }>>) => (
  <div className="canvas-group">
    <span>{data.label}</span>
  </div>
));

type Pt = { x: number; y: number };
type RoutedData = { points: Pt[]; label?: string; labelBox?: { x: number; y: number; w: number; h: number }; className: string };

/** SVG path through ELK's bend points, with rounded corners. */
function roundedPath(pts: Pt[], r = 8) {
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
const RoutedEdge = memo(({ data, markerEnd }: EdgeProps<Edge<RoutedData>>) => {
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

const nodeTypes = { card: CanvasCard, group: GroupBox };
const edgeTypes = { routed: RoutedEdge };

type Box = { x: number; y: number; w: number; h: number };
type Routed = { points: Pt[]; label?: Box };

async function layout(canvas: Canvas, sizes: Map<string, ReturnType<typeof cardSize>>) {
  await fontsReady();
  const grouped = new Map<string, CanvasNode[]>();
  const loose: CanvasNode[] = [];
  for (const n of canvas.nodes) (n.group ? grouped.set(n.group, [...(grouped.get(n.group) ?? []), n]) : loose.push(n));
  const leaf = (n: CanvasNode) => ({ id: n.id, width: CARD_W, height: sizes.get(n.id)!.height });
  const labelFont = `500 11px ${MONO}`;
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "12",
      "elk.spacing.edgeLabel": "4",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.componentComponent": "40",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
      // Absolute coordinates for everything, so edges and labels need no translating.
      "org.eclipse.elk.json.shapeCoords": "ROOT",
      "org.eclipse.elk.json.edgeCoords": "ROOT",
    },
    children: [
      ...[...grouped].map(([g, ns]) => ({ id: `group:${g}`, layoutOptions: { "elk.padding": "[top=44,left=18,bottom=18,right=18]" }, children: ns.map(leaf) })),
      ...loose.map(leaf),
    ],
    edges: canvas.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
      labels: e.label ? [{ id: `e${i}:l`, text: e.label, width: Math.min(220, textWidth(e.label, labelFont) + 14), height: 20 }] : [],
    })),
  };
  const result = await elk.layout(graph);
  const boxes = new Map<string, Box>();
  for (const c of result.children ?? []) {
    boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
    for (const k of c.children ?? []) boxes.set(k.id, { x: k.x ?? 0, y: k.y ?? 0, w: k.width ?? 0, h: k.height ?? 0 });
  }
  const routes = new Map<string, Routed>();
  for (const e of (result.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    if (!s) continue;
    const l = e.labels?.[0];
    routes.set(e.id, {
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
      label: l ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 } : undefined,
    });
  }
  return { boxes, routes };
}

/** Resolves a node's `ref` (a component name) to the real architecture node. */
export function refResolver(arch: ArchModel | null) {
  return (ref?: string) => {
    if (!ref || !arch) return null;
    const r = ref.toLowerCase();
    return arch.nodes.find((n) => n.name.toLowerCase() === r || n.unit?.packageName.toLowerCase() === r)?.id ?? null;
  };
}

type DiagramProps = {
  canvas: Canvas;
  resolveRef: (ref?: string) => string | null;
  onRef: (id: string) => void;
  interactive: boolean;
  sel: string | null;
  onSelect: (id: string | null) => void;
};

function Diagram({ canvas, resolveRef, onRef, interactive, sel, onSelect }: DiagramProps) {
  const rf = useReactFlow();
  // Through a ref, so a new click handler doesn't re-run the layout.
  const onRefLatest = useRef(onRef);
  onRefLatest.current = onRef;
  const [laid, setLaid] = useState<{ boxes: Map<string, Box>; routes: Map<string, Routed>; sizes: Map<string, ReturnType<typeof cardSize>> } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fontsReady()
      .then(() => {
        const sizes = new Map(canvas.nodes.map((n) => [n.id, cardSize(n, !!resolveRef(n.ref))]));
        return layout(canvas, sizes).then((l) => ({ ...l, sizes }));
      })
      .then((l) => {
        if (cancelled) return;
        setLaid(l);
        requestAnimationFrame(() => rf.fitView({ padding: 0.08, maxZoom: 1 }));
      })
      .catch((e) => {
        console.error("canvas layout failed", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canvas, resolveRef, rf]);

  const flow = useMemo(() => {
    if (!laid) return { nodes: [] as Node[], edges: [] as Edge[] };
    const related = new Set<string>();
    if (sel) for (const e of canvas.edges) if (e.from === sel || e.to === sel) related.add(e.from === sel ? e.to : e.from);
    const hl = (id: string): Highlight => (!sel ? null : id === sel ? "selected" : related.has(id) ? "related" : "dim");
    const groupLabel = new Map(canvas.groups.map((g) => [`group:${g.id}`, g.label]));
    const nodes: Node[] = [];
    for (const [id, b] of laid.boxes) {
      if (id.startsWith("group:")) nodes.push({ id, type: "group", position: { x: b.x, y: b.y }, width: b.w, height: b.h, data: { label: groupLabel.get(id) ?? id.slice(6) }, draggable: false, selectable: false, zIndex: 0 });
    }
    for (const n of canvas.nodes) {
      const b = laid.boxes.get(n.id);
      if (!b) continue;
      nodes.push({
        id: n.id,
        type: "card",
        position: { x: b.x, y: b.y },
        width: b.w,
        height: b.h,
        data: { node: n, refId: resolveRef(n.ref), size: laid.sizes.get(n.id)!, highlight: hl(n.id), onRef: (id: string) => onRefLatest.current(id) },
        draggable: false,
        zIndex: 2,
      });
    }
    const edges: Edge[] = canvas.edges.flatMap((e, i) => {
      const r = laid.routes.get(`e${i}`);
      if (!r) return [];
      const active = !!sel && (e.from === sel || e.to === sel);
      return [
        {
          id: `e${i}`,
          type: "routed",
          source: e.from,
          target: e.to,
          className: `canvas-edge k-${e.kind} st-${e.status} ${active ? "active" : sel ? "dim" : ""}`,
          animated: e.status === "new",
          data: { points: r.points, label: e.label, labelBox: r.label, className: `k-${e.kind} st-${e.status} ${active ? "active" : sel ? "dim" : ""}` },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: STATUS_COLOR[e.status] ?? KIND_EDGE_COLOR[e.kind] },
          zIndex: active ? 4 : 1,
        },
      ];
    });
    return { nodes, edges };
  }, [laid, canvas, sel, resolveRef]);

  return (
    <>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        zoomOnScroll={interactive}
        panOnDrag
        preventScrolling={interactive}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => n.type === "card" && onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
        {interactive && <Controls showInteractive={false} className="canvas-controls" />}
      </ReactFlow>
      {!laid && !failed && <div className="map-loading">Laying out the canvas…</div>}
      {failed && <div className="map-loading">This canvas couldn’t be laid out.</div>}
    </>
  );
}

/** What the canvas says about a node, plus its connections within the canvas. */
function CanvasFacts({ canvas, node, onSelect }: { canvas: Canvas; node: CanvasNode; onSelect: (id: string) => void }) {
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const out = canvas.edges.filter((e) => e.from === node.id);
  const inc = canvas.edges.filter((e) => e.to === node.id);
  const group = canvas.groups.find((g) => g.id === node.group)?.label;
  const row = (e: CanvasEdge, other: string, i: number) => {
    const o = byId.get(other);
    if (!o) return null;
    return (
      <div key={`${other}-${i}`} className="insp-row link" onClick={() => onSelect(other)}>
        <span className="insp-bullet" style={{ background: TYPE_COLOR[o.type] ?? "#8B5CF6" }} />
        <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span className="mono" style={{ fontSize: 12 }}>{o.label}</span> {e.label && <span className="faint" style={{ fontSize: 11.5 }}>{e.label}</span>}
        </span>
        {e.status !== "existing" && <span className={`canvas-status st-${e.status}`}>{STATUS_LABEL[e.status]}</span>}
      </div>
    );
  };
  return (
    <div className="canvas-facts">
      <div className="insp-label">In this canvas</div>
      <div className="insp-chips">
        <span className={`canvas-status st-${node.status}`} style={node.status === "existing" ? { color: "var(--text-2)", background: "var(--chip)" } : undefined}>{STATUS_TEXT[node.status]}</span>
        {group && <span className="chip">{group}</span>}
      </div>
      {node.note && <div className="insp-note" style={{ lineHeight: 1.5 }}>{node.note}</div>}
      {inc.length > 0 && (
        <div className="insp-section">
          <div className="insp-label">From · {inc.length}</div>
          {inc.map((e, i) => row(e, e.from, i))}
        </div>
      )}
      {out.length > 0 && (
        <div className="insp-section">
          <div className="insp-label">To · {out.length}</div>
          {out.map((e, i) => row(e, e.to, i))}
        </div>
      )}
    </div>
  );
}

type InspectorProps = {
  canvas: Canvas;
  id: string;
  arch: ArchModel | null;
  project: Project;
  graph: Graph | null;
  resolveRef: (ref?: string) => string | null;
  onSelect: (id: string | null) => void;
  onOpen: (ref: Ref) => void;
};

/** Clicking a canvas node: the real component's inspector when it exists today, else what the canvas says. */
function CanvasInspector({ canvas, id, arch, project, graph, resolveRef, onSelect, onOpen }: InspectorProps) {
  const node = canvas.nodes.find((n) => n.id === id);
  if (!node) return null;
  const refId = resolveRef(node.ref);
  const facts = <CanvasFacts canvas={canvas} node={node} onSelect={onSelect} />;
  if (refId && arch && graph && arch.byId.has(refId)) {
    return (
      <ArchInspector
        model={arch}
        project={project}
        graph={graph}
        id={refId}
        banner={facts}
        // A component also on the canvas is selected there; others open on the map.
        onSelect={(other) => {
          const there = canvas.nodes.find((n) => resolveRef(n.ref) === other);
          if (there) onSelect(there.id);
          else onOpen({ kind: "node", id: other, label: other });
        }}
        onOpenFile={(fid) => onOpen({ kind: "file", id: fid, label: fid })}
        onOpenTable={(tid) => tid && onOpen({ kind: "table", id: tid, label: tid })}
        onAddRepo={() => {}}
        onClose={() => onSelect(null)}
      />
    );
  }
  const color = TYPE_COLOR[node.type] ?? "#8B5CF6";
  return (
    <div className="inspector glass">
      <button className="icon-btn insp-close" onClick={() => onSelect(null)} title="Close (Esc)">
        ×
      </button>
      <div className="insp-body">
        <div className="insp-header">
          <div className="insp-tile" style={{ background: color + "24", color, borderColor: color + "80", borderStyle: node.status === "removed" ? "dashed" : "solid" }}>
            {monogram(node.label)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="insp-title" style={{ whiteSpace: "normal" }}>{node.label}</div>
            <div className="insp-meta">{node.ref ? `Refers to “${node.ref}”, which isn’t on the map` : node.status === "new" ? "Doesn’t exist yet" : node.type}</div>
          </div>
          <span className="insp-kind">{node.type}</span>
        </div>
        {facts}
      </div>
    </div>
  );
}

function Counts({ canvas }: { canvas: Canvas }) {
  const c = { new: 0, changed: 0, removed: 0 };
  for (const n of canvas.nodes) if (n.status !== "existing") c[n.status]++;
  return (
    <span className="canvas-counts">
      {c.new > 0 && <span className="canvas-status st-new">{c.new} new</span>}
      {c.changed > 0 && <span className="canvas-status st-changed">{c.changed} changed</span>}
      {c.removed > 0 && <span className="canvas-status st-removed">{c.removed} removed</span>}
    </span>
  );
}

type Props = { canvas: Canvas; warnings: string[]; project: Project; graph: Graph | null; workspace: WorkspacePackage[]; onOpen: (ref: Ref) => void };

/** A canvas inside a chat answer: preview, plus full screen and a side-by-side comparison. */
export function CanvasBlock({ canvas, warnings, project, graph, workspace, onOpen }: Props) {
  const [open, setOpen] = useState<null | "full" | "compare">(null);
  const [sel, setSel] = useState<string | null>(null);
  // Leaving the canvas for the real map closes it.
  const leave = (ref: Ref) => {
    setOpen(null);
    setSel(null);
    onOpen(ref);
  };
  const arch = useMemo(() => (graph ? buildArchModel(graph, project.repos, workspace) : null), [graph, project.repos, workspace]);
  const resolveRef = useMemo(() => refResolver(arch), [arch]);
  const isProposal = canvas.nodes.some((n) => n.status !== "existing") || canvas.edges.some((e) => e.status !== "existing");

  useEffect(() => {
    if (!open) return;
    // Esc first deselects, then closes.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSel((s) => {
        if (!s) setOpen(null);
        return null;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const header = (
    <div className="canvas-head">
      <span className="canvas-kind">{isProposal ? "Proposal" : canvas.kind === "flow" ? "Flow" : "Diagram"}</span>
      <span className="canvas-title">{canvas.title}</span>
      <Counts canvas={canvas} />
    </div>
  );

  return (
    <div className="canvas-block">
      {header}
      {canvas.description && <div className="canvas-desc">{canvas.description}</div>}
      <div className="canvas-preview" onDoubleClick={() => setOpen("full")}>
        <ReactFlowProvider>
          <Diagram
            canvas={canvas}
            resolveRef={resolveRef}
            onRef={(id) => leave({ kind: "node", id, label: id })}
            interactive={false}
            sel={null}
            onSelect={(id) => {
              // The preview is small: a click opens the canvas with that item selected.
              if (!id) return;
              setSel(id);
              setOpen("full");
            }}
          />
        </ReactFlowProvider>
      </div>
      <div className="canvas-actions">
        <button className="btn small" onClick={() => setOpen("full")}>
          Open
        </button>
        {canvas.kind === "architecture" && graph && (
          <button className="btn small" onClick={() => setOpen("compare")}>
            Compare with current
          </button>
        )}
        {warnings.length > 0 && <span className="faint" style={{ fontSize: 11.5 }}>{warnings.join(" ")}</span>}
        <span className="canvas-legend">
          <i className="st-new" /> new <i className="st-changed" /> changed <i className="st-removed" /> removed
        </span>
      </div>

      {open && (
        <div className="canvas-full">
          <div className="canvas-full-bar">
            {header}
            {canvas.kind === "architecture" && graph && (
              <div className="seg" style={{ marginLeft: "auto" }}>
                <button className={open === "full" ? "on" : ""} onClick={() => setOpen("full")}>Canvas</button>
                <button className={open === "compare" ? "on" : ""} onClick={() => setOpen("compare")}>Side by side with current</button>
              </div>
            )}
            <button className="icon-btn" style={{ marginLeft: canvas.kind === "architecture" && graph ? 8 : "auto" }} onClick={() => (setOpen(null), setSel(null))} title="Close (Esc)">
              ×
            </button>
          </div>
          <div className={`canvas-full-body ${open === "compare" ? "split" : ""}`}>
            <div className="canvas-pane">
              {open === "compare" && <div className="canvas-pane-label">{isProposal ? "Proposed" : "Canvas"}</div>}
              <ReactFlowProvider>
                <Diagram canvas={canvas} resolveRef={resolveRef} onRef={(id) => leave({ kind: "node", id, label: id })} interactive sel={sel} onSelect={setSel} />
              </ReactFlowProvider>
              {sel && <CanvasInspector canvas={canvas} id={sel} arch={arch} project={project} graph={graph} resolveRef={resolveRef} onSelect={setSel} onOpen={leave} />}
            </div>
            {open === "compare" && graph && (
              <div className="canvas-pane">
                <div className="canvas-pane-label">Current architecture</div>
                <ArchMap
                  project={project}
                  graph={graph}
                  workspace={workspace}
                  onOpenFile={(id) => leave({ kind: "file", id, label: id })}
                  onOpenTable={(id) => id && leave({ kind: "table", id, label: id })}
                  onAddRepo={() => {}}
                  focus={null}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CanvasPending() {
  return (
    <div className="canvas-block pending">
      <div className="canvas-head">
        <span className="canvas-kind">Canvas</span>
        <span className="canvas-title">Drawing…</span>
      </div>
      <div className="canvas-preview ai-shimmer-box" />
    </div>
  );
}

export function CanvasError({ error, onFix }: { error: string; onFix?: () => void }) {
  return (
    <div className="canvas-block error">
      <div className="canvas-head">
        <span className="canvas-kind">Canvas</span>
        <span className="canvas-title">Couldn’t be drawn</span>
      </div>
      <div className="canvas-desc">{error}</div>
      {onFix && (
        <div className="canvas-actions">
          <button className="btn small" onClick={onFix}>
            Ask Claude to fix it
          </button>
        </div>
      )}
    </div>
  );
}

// Parsed canvases by source text: answers re-render while streaming, the canvas shouldn't.
const parsedCache = new Map<string, ReturnType<typeof parseCanvas>>();

/** `renderBlock` for chats: turns ```strata-canvas blocks into canvases. */
export function canvasBlocks(opts: { project: Project; graph: Graph | null; workspace: WorkspacePackage[]; onOpen: (ref: Ref) => void; onFix?: (error: string) => void }) {
  return (lang: string, body: string, done: boolean): ReactNode | null => {
    if (lang !== "strata-canvas") return null;
    if (!done) return <CanvasPending />;
    let parsed = parsedCache.get(body);
    if (!parsed) {
      parsed = parseCanvas(body);
      parsedCache.set(body, parsed);
    }
    if (!parsed.ok) return <CanvasError error={parsed.error} onFix={opts.onFix ? () => opts.onFix!((parsed as { error: string }).error) : undefined} />;
    return <CanvasBlock canvas={parsed.canvas} warnings={parsed.warnings} project={opts.project} graph={opts.graph} workspace={opts.workspace} onOpen={opts.onOpen} />;
  };
}
