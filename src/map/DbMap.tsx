import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { Graph, Project } from "../api";
import { buildDbModel, type DbModel } from "./dbModel";
import { layoutDbModel, visibleColumns } from "./dbLayout";
import { DbGroupNode, DbRepoNode, GhostTableNode, TableNode } from "./dbNodes";
import { LabelNode, type Highlight } from "./nodes";
import { DbInspector } from "./DbInspector";
import type { Layout } from "./layout";
import { ZoomWatcher } from "./zoom";
import type { Focus } from "./focus";
import type { Plan } from "../sections/plan";

const nodeTypes = { table: TableNode, ghostTable: GhostTableNode, dbRepo: DbRepoNode, dbGroup: DbGroupNode, label: LabelNode };

type Props = {
  project: Project;
  graph: Graph;
  /** Table to select and center, e.g. when coming from the Code view. */
  focus: Focus | null;
  onOpenFile: (fileId: string) => void;
  /** AI sections: group tables by domain instead of by schema file. */
  plan?: Plan | null;
};

function buildFlow(model: DbModel, layout: Layout, expanded: Set<string>, project: Project, onToggle: (id: string) => void, sel: string | null) {
  const related = new Set<string>();
  const relatedCols = new Map<string, Set<string>>();
  const mark = (table: string, col: string) => relatedCols.set(table, (relatedCols.get(table) ?? new Set()).add(col));
  if (sel) {
    for (const r of model.relations) {
      if (r.from === sel || r.to === sel) {
        related.add(r.from);
        related.add(r.to);
        mark(r.from, r.fromColumn);
        mark(r.to, r.toColumn);
      }
    }
  }
  const hl = (id: string): Highlight => (!sel ? null : id === sel ? "selected" : related.has(id) ? "related" : "dim");

  const nodes: Node[] = [];
  for (const r of model.repos) {
    const box = layout.boxes.get(`db:${r.id}`);
    if (!box) continue;
    const repoId = `db:${r.id}`;
    nodes.push({ id: repoId, type: "dbRepo", position: { x: box.x, y: box.y }, width: box.width, height: box.height, data: { name: r.name, count: r.tables.length, color: project.color }, draggable: false, selectable: false, zIndex: 0 });
    nodes.push({
      id: `label:${repoId}`,
      type: "label",
      parentId: repoId,
      position: { x: 18, y: 14 },
      width: 10,
      height: 10,
      data: { text: r.name, meta: `${r.tables.length} tables`, repo: true, color: project.color },
      className: "map-label-node",
      draggable: false,
      selectable: false,
      zIndex: 1000,
    });
    const groupOf = new Map<string, string>();
    for (const g of r.groups) {
      const gb = layout.boxes.get(g.id);
      if (!gb) continue;
      const anySel = sel ? g.tables.some((t) => t.id === sel || related.has(t.id)) : false;
      nodes.push({ id: g.id, type: "dbGroup", parentId: repoId, position: { x: gb.x, y: gb.y }, width: gb.width, height: gb.height, data: { label: g.label, count: g.tables.length, highlight: sel ? (anySel ? null : "dim") : null }, draggable: false, selectable: false, zIndex: 1 });
      nodes.push({ id: `label:${g.id}`, type: "label", parentId: g.id, position: { x: 10, y: 8 }, width: 10, height: 10, data: { text: g.label, meta: `${g.tables.length} tables` }, className: "map-label-node", draggable: false, selectable: false, zIndex: 1000 });
      for (const t of g.tables) groupOf.set(t.id, g.id);
    }
    for (const t of r.tables) {
      const b = layout.boxes.get(t.id);
      if (!b) continue;
      nodes.push({
        id: t.id,
        type: "table",
        parentId: groupOf.get(t.id) ?? repoId,
        position: { x: b.x, y: b.y },
        width: b.width,
        height: b.height,
        data: { table: t, expanded: expanded.has(t.id), onToggle, highlight: hl(t.id), related: relatedCols.get(t.id) ?? new Set(), hubCount: model.hubs.get(t.id) },
        draggable: false,
        zIndex: 2,
      });
    }
    for (const g of model.ghosts.filter((x) => x.repoId === r.id)) {
      const b = layout.boxes.get(g.id);
      if (!b) continue;
      nodes.push({ id: g.id, type: "ghostTable", parentId: repoId, position: { x: b.x, y: b.y }, width: b.width, height: b.height, data: { ghost: g, highlight: hl(g.id) }, draggable: false, zIndex: 1 });
    }
  }

  // Each foreign key runs from its column to the referenced column (or the header if it's collapsed).
  const shown = (tableId: string, col: string) => {
    const t = model.tables.get(tableId);
    return !!t && visibleColumns(t, expanded).some((c) => c.name === col);
  };
  const groupOf = new Map<string, string>();
  for (const repo of model.repos) for (const g of repo.groups) for (const t of g.tables) groupOf.set(t.id, g.id);
  const edges: Edge[] = model.relations.map((r) => {
    const active = !!sel && (r.from === sel || r.to === sel);
    const far = groupOf.get(r.from) !== groupOf.get(r.to);
    return {
      id: r.id,
      source: r.from,
      target: r.to,
      sourceHandle: shown(r.from, r.fromColumn) ? `s-${r.fromColumn}` : "s-header",
      targetHandle: shown(r.to, r.toColumn) ? `t-${r.toColumn}` : "t-header",
      type: "smoothstep",
      markerStart: "crow-many",
      markerEnd: "crow-one",
      className: `db-edge ${far ? "far" : ""} ${active ? "active" : sel ? "dim" : ""} ${model.hubs.has(r.to) ? "hub" : ""} ${model.ghosts.some((g) => g.id === r.to) ? "ghost" : ""}`,
      zIndex: active ? 3 : 1,
    };
  });
  return { nodes, edges };
}

function DbMapInner({ project, graph, focus: focusReq, onOpenFile, plan = null }: Props) {
  const focus = focusReq?.id ?? null;
  const container = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const model = useMemo(() => {
    const m = buildDbModel(graph, project.repos);
    if (!plan) return m;
    // AI sections replace the schema-file groups, per repo.
    for (const r of m.repos) {
      r.groups = plan.sections
        .map((sec, i) => ({ id: `aisec:${r.id}:${i}`, repoId: r.id, label: sec.name, tables: r.tables.filter((t) => plan.sectionOf.get(t.id) === i) }))
        .filter((g) => g.tables.length > 0);
    }
    return m;
  }, [graph, project.repos, plan]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Layout | null>(null);
  const [sel, setSel] = useState<string | null>(focus);
  const fitted = useRef(false);
  const lastPlan = useRef(plan);

  useEffect(() => {
    let cancelled = false;
    layoutDbModel(model, expanded)
      .then((l) => {
        if (cancelled) return;
        setLayout(l);
        // Switching sections on or off rearranges everything: show the whole map again.
        if (fitted.current && lastPlan.current !== plan) requestAnimationFrame(() => rf.fitView({ padding: 0.08, maxZoom: 1, duration: 300 }));
        lastPlan.current = plan;
      })
      .catch((e) => console.error("schema layout failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, expanded]);

  // First layout: fit everything, or center the table we were sent to.
  useEffect(() => {
    if (!layout || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => (focus && model.tables.has(focus) ? rf.fitView({ nodes: [{ id: focus }], maxZoom: 1, duration: 0 }) : rf.fitView({ padding: 0.08, maxZoom: 1 })));
  }, [layout, rf, focus, model]);

  useEffect(() => {
    if (!focus || !fitted.current) return;
    setSel(focus);
    rf.fitView({ nodes: [{ id: focus }], maxZoom: 1, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq, rf]);

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

  const select = useCallback(
    (id: string) => {
      setSel(id);
      const b = layout?.boxes.get(id);
      if (b) rf.fitView({ nodes: [{ id }], maxZoom: Math.max(rf.getZoom(), 0.7), duration: 350 });
    },
    [layout, rf],
  );

  const flow = useMemo(() => (layout ? buildFlow(model, layout, expanded, project, toggle, sel) : { nodes: [], edges: [] }), [model, layout, expanded, project, toggle, sel]);

  if (model.tables.size === 0) {
    return (
      <div className="page dots" style={{ display: "grid", placeItems: "center" }}>
        <div className="card glass" style={{ width: 460, padding: 22, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No database schema found</div>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.5, fontSize: 13 }}>
            Strata reads Prisma and ZenStack schemas (<span className="mono">.prisma</span>, <span className="mono">.zmodel</span>), Drizzle tables (<span className="mono">pgTable</span>,{" "}
            <span className="mono">sqliteTable</span>, …) and SQL migrations. None of the repos in this project contains one.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={container} className="map" data-level="file">
      {/* Crow's foot markers for the relation lines. */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
        <defs>
          <marker id="crow-many" viewBox="0 0 16 16" refX="1" refY="8" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M15 8 L1 1 M15 8 L1 8 M15 8 L1 15" className="db-marker" fill="none" />
          </marker>
          <marker id="crow-one" viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M9 2 L9 14 M1 8 L15 8" className="db-marker" fill="none" />
          </marker>
        </defs>
      </svg>
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
        onNodeClick={(_, n) => (n.type === "table" || n.type === "ghostTable") && setSel(n.id)}
        onPaneClick={() => setSel(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
        <MiniMap className="map-minimap" pannable zoomable nodeColor={(n) => (n.type === "ghostTable" ? "#F59E0B" : n.type === "table" ? "#14B8A699" : "transparent")} nodeStrokeWidth={0} />
        <ZoomWatcher container={container} onLevel={() => {}} />
      </ReactFlow>
      {!layout && <div className="map-loading">Laying out the schema…</div>}
      <div className="map-legend">
        <span>{model.tables.size} tables · {model.relations.length} relations</span>
        <span><i className="db-lg pk">PK</i> primary key</span>
        <span><i className="db-lg fk">FK</i> foreign key</span>
        <span><i className="lg-line" style={{ borderColor: "var(--db)" }} /> many → one</span>
        {model.hubs.size > 0 && <span className="faint">Lines to {[...model.hubs.keys()].map((id) => model.tables.get(id)?.name).join(", ")} show on selection</span>}
      </div>
      {sel && <DbInspector model={model} project={project} id={sel} onSelect={select} onOpenFile={onOpenFile} onClose={() => setSel(null)} />}
    </div>
  );
}

export function DbMap(props: Props) {
  return (
    <ReactFlowProvider>
      <DbMapInner {...props} />
    </ReactFlowProvider>
  );
}

