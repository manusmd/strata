import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { Graph, Project } from "../api";
import { buildCodeModel, type CodeModel, type MapItem } from "./model";
import { CLUSTER_W, COLLAPSED_ROWS, HEADER_H, PAD, ROW_H, layoutCodeModel, visibleFiles, type Layout } from "./layout";
import { nodeTypes, type Highlight } from "./nodes";
import { Inspector, type Selection } from "./Inspector";
import { LEVEL_ZOOM, ZoomWatcher, type ZoomLevel } from "./zoom";

export type { ZoomLevel } from "./zoom";

type Props = {
  project: Project;
  graph: Graph;
  onLevel: (l: ZoomLevel) => void;
  /** Bumped by the toolbar to jump to a zoom level. */
  zoomRequest: { level: ZoomLevel; n: number } | null;
  /** File to select and center, e.g. when coming from the Database view. */
  focus: string | null;
  onOpenTable: (tableId: string) => void;
};


function ZoomTo({ request }: { request: Props["zoomRequest"] }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!request) return;
    const { x, y, zoom } = rf.getViewport();
    const target = LEVEL_ZOOM[request.level];
    // Zoom around the center of the screen.
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    const w = el?.clientWidth ?? 1000;
    const h = el?.clientHeight ?? 700;
    const cx = (w / 2 - x) / zoom;
    const cy = (h / 2 - y) / zoom;
    rf.setViewport({ x: w / 2 - cx * target, y: h / 2 - cy * target, zoom: target }, { duration: 350 });
  }, [request, rf]);
  return null;
}

/** Whether a cluster or group sits (anywhere) inside `ancestor`. */
function isInside(model: CodeModel, id: string, ancestor: string): boolean {
  for (let cur = model.parentOf.get(id); cur; cur = model.parentOf.get(cur)) if (cur === ancestor) return true;
  return false;
}

function buildFlow(model: CodeModel, layout: Layout, expanded: Set<string>, project: Project, onToggle: (id: string) => void, sel: Selection | null) {
  // Which files/clusters relate to the selection.
  const related = new Set<string>();
  let selectedFile: string | null = null;
  if (sel?.kind === "file") {
    const f = model.files.get(sel.id);
    if (f) {
      selectedFile = f.id;
      for (const id of [...f.imports, ...f.importedBy]) related.add(id);
      for (const id of [...f.imports, ...f.importedBy]) related.add(model.files.get(id)!.clusterId);
      related.add(f.clusterId);
    }
  } else if (sel?.kind === "cluster") {
    for (const e of [...model.clusterEdges, ...model.ghostEdges]) {
      if (e.source === sel.id) related.add(e.target);
      if (e.target === sel.id) related.add(e.source);
    }
  } else if (sel?.kind === "ghost") {
    for (const e of model.ghostEdges) if (e.target === sel.id) related.add(e.source);
  } else if (sel?.kind === "group") {
    for (const c of model.clusters.values()) if (isInside(model, c.id, sel.id)) related.add(c.id);
  }
  const hl = (id: string): Highlight => (!sel ? null : id === sel.id ? "selected" : related.has(id) ? "related" : "dim");

  const nodes: Node[] = [];
  const shownFile = new Set<string>();
  for (const repo of model.repos) {
    const box = layout.boxes.get(repo.id);
    if (!box) continue;
    nodes.push({
      id: repo.id,
      type: "repo",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { repo, color: project.color, highlight: sel ? (sel.kind === "repo" && sel.id === repo.id ? "selected" : null) : null },
      draggable: false,
      selectable: true,
      zIndex: 0,
    });
    const addItems = (items: MapItem[], parentId: string, depth: number) => {
      for (const it of items) {
        if (it.kind === "group") {
          const gb = layout.boxes.get(it.id);
          if (!gb) continue;
          nodes.push({
            id: it.id,
            type: "folder",
            parentId,
            position: { x: gb.x, y: gb.y },
            width: gb.width,
            height: gb.height,
            data: { group: it, highlight: hl(it.id) },
            className: `d${Math.min(depth, 4)}`,
            draggable: false,
            zIndex: depth,
          });
          // Overview label, drawn above everything so content never covers it. Only the
          // deepest of the top two folder levels gets one (a parent's label would sit
          // in the same corner as its first child's), so it shows the full path.
          const lead = depth === 2 || (depth === 1 && !it.children.some((c) => c.kind === "group"));
          if (lead)
            nodes.push({
              id: `label:${it.id}`,
              type: "label",
              parentId: it.id,
              position: { x: 10, y: 8 },
              width: 10,
              height: 10,
              data: { text: it.dir.replace(/\/src$/, ""), meta: `${it.fileCount} files` },
              className: "map-label-node",
              draggable: false,
              selectable: false,
              zIndex: 1000,
            });
          addItems(it.children, it.id, depth + 1);
          continue;
        }
        const c = it.cluster;
        const cb = layout.boxes.get(c.id);
        if (!cb) continue;
        nodes.push({
          id: c.id,
          type: "cluster",
          parentId,
          position: { x: cb.x, y: cb.y },
          width: cb.width,
          height: cb.height,
          data: { cluster: c, label: it.label, expanded: expanded.has(c.id), onToggle, highlight: hl(c.id) },
          className: `d${Math.min(depth, 4)}`,
          draggable: false,
          zIndex: depth,
        });
        visibleFiles(c, expanded).forEach((f, i) => {
          shownFile.add(f.id);
          nodes.push({
            id: f.id,
            type: "file",
            parentId: c.id,
            extent: "parent",
            position: { x: PAD, y: HEADER_H + i * ROW_H },
            width: CLUSTER_W - PAD * 2,
            height: ROW_H - 4,
            data: { file: f, highlight: hl(f.id) },
            draggable: false,
            zIndex: depth + 1,
          });
        });
      }
    };
    nodes.push({
      id: `label:${repo.id}`,
      type: "label",
      parentId: repo.id,
      position: { x: 18, y: 14 },
      width: 10,
      height: 10,
      data: { text: repo.name, meta: `${repo.fileCount} files`, repo: true, color: project.color },
      className: "map-label-node",
      draggable: false,
      selectable: false,
      zIndex: 1001,
    });
    addItems(repo.items, repo.id, 1);
  }
  for (const g of model.ghosts) {
    const b = layout.boxes.get(g.id);
    if (!b) continue;
    nodes.push({ id: g.id, type: "ghost", position: { x: b.x, y: b.y }, width: b.width, height: b.height, data: { ghost: g, highlight: hl(g.id) }, draggable: false, zIndex: 1 });
  }

  const edges: Edge[] = [];
  const width = (n: number) => Math.min(4, 1 + Math.log2(n) * 0.6);
  for (const e of model.clusterEdges) {
    const active = sel && (e.source === sel.id || e.target === sel.id || (sel.kind === "group" && (related.has(e.source) || related.has(e.target))));
    // Edges between neighbours in the same folder are shown; long cross-map ones only on selection.
    const local = model.parentOf.get(e.source) === model.parentOf.get(e.target);
    edges.push({
      id: `c:${e.source}>${e.target}`,
      source: e.source,
      target: e.target,
      className: `map-edge ${local ? "local" : "far"} ${e.count === 1 ? "weak" : ""} ${active ? "active" : sel ? "dim" : ""}`,
      style: { strokeWidth: width(e.count) },
      zIndex: 1,
    });
  }
  for (const e of model.ghostEdges) {
    const active = sel && (e.source === sel.id || e.target === sel.id);
    edges.push({ id: `g:${e.source}>${e.target}`, source: e.source, target: e.target, className: `map-edge ghost ${active ? "active" : sel ? "dim" : ""}`, zIndex: 1 });
  }
  // File-level edges only for the selected file, so the map never turns into a hairball.
  if (selectedFile) {
    const f = model.files.get(selectedFile)!;
    const endpoint = (id: string) => (shownFile.has(id) ? id : model.files.get(id)!.clusterId);
    for (const t of f.imports) edges.push({ id: `f:${f.id}>${t}`, source: f.id, target: endpoint(t), className: "map-edge file out", zIndex: 3 });
    for (const s of f.importedBy) edges.push({ id: `f:${s}>${f.id}`, source: endpoint(s), target: f.id, className: "map-edge file in", zIndex: 3 });
  }
  return { nodes, edges };
}

function CodeMapInner({ project, graph, onLevel, zoomRequest, focus, onOpenTable }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const model = useMemo(() => buildCodeModel(graph, project.repos), [graph, project.repos]);
  // A focused file deep inside a big folder needs that folder expanded to be visible.
  const focusCluster = (id: string | null) => {
    const f = id ? model.files.get(id) : undefined;
    const c = f ? model.clusters.get(f.clusterId) : undefined;
    return c && c.files.indexOf(f!) >= COLLAPSED_ROWS ? c.id : null;
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([focusCluster(focus)].filter(Boolean) as string[]));
  const [layout, setLayout] = useState<Layout | null>(null);
  const [sel, setSel] = useState<Selection | null>(focus && model.files.has(focus) ? { kind: "file", id: focus } : null);
  const firstLayout = useRef(true);
  const pendingFocus = useRef<string | null>(focus);

  useEffect(() => {
    let cancelled = false;
    layoutCodeModel(model, expanded).then((l) => !cancelled && setLayout(l));
    return () => {
      cancelled = true;
    };
  }, [model, expanded]);

  useEffect(() => {
    if (!layout) return;
    const target = pendingFocus.current;
    if (target && model.files.has(target)) {
      const duration = firstLayout.current ? 0 : 400;
      pendingFocus.current = null;
      firstLayout.current = false;
      requestAnimationFrame(() => rf.fitView({ nodes: [{ id: target }], maxZoom: 1.1, minZoom: 0.8, duration }));
    } else if (firstLayout.current) {
      firstLayout.current = false;
      requestAnimationFrame(() => rf.fitView({ padding: 0.08, maxZoom: 1 }));
    }
  }, [layout, rf, model]);

  // Jumping here again (another file) while the map is already open.
  useEffect(() => {
    if (!focus || !model.files.has(focus)) return;
    setSel({ kind: "file", id: focus });
    const c = focusCluster(focus);
    pendingFocus.current = focus;
    if (c) setExpanded((cur) => new Set(cur).add(c));
    else if (layout) {
      pendingFocus.current = null;
      rf.fitView({ nodes: [{ id: focus }], maxZoom: 1.1, minZoom: 0.8, duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const flow = useMemo(() => (layout ? buildFlow(model, layout, expanded, project, toggle, sel) : { nodes: [], edges: [] }), [model, layout, expanded, project, toggle, sel]);

  return (
    <div ref={container} className="map" data-level="file">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        minZoom={0.05}
        maxZoom={2.5}
        onlyRenderVisibleElements
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSel({ kind: (n.type === "folder" ? "group" : n.type) as Selection["kind"], id: n.id })}
        onPaneClick={() => setSel(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
        <MiniMap className="map-minimap" pannable zoomable nodeColor={(n) => (n.type === "ghost" ? "#F59E0B" : n.type === "repo" ? project.color + "22" : n.type === "cluster" ? project.color + "99" : "transparent")} nodeStrokeWidth={0} />
        <ZoomWatcher container={container} onLevel={onLevel} />
        <ZoomTo request={zoomRequest} />
      </ReactFlow>
      {!layout && <div className="map-loading">Laying out the map…</div>}
      <div className="map-legend">
        <span><i className="lg-line" /> imports</span>
        <span><i className="lg-line out" /> selected → uses</span>
        <span><i className="lg-line in" /> used by → selected</span>
        <span><i className="lg-line ghost" /> missing</span>
      </div>
      {sel && <Inspector model={model} project={project} sel={sel} onSelect={setSel} onOpenTable={onOpenTable} onClose={() => setSel(null)} />}
    </div>
  );
}

export function CodeMap(props: Props) {
  return (
    <ReactFlowProvider>
      <CodeMapInner {...props} />
    </ReactFlowProvider>
  );
}
