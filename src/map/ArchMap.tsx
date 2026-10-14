import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MapLegend } from "./MapLegend";
import { ContextView } from "../arch/ContextView";
import { ComponentView } from "../arch/ComponentView";
import { flowPath } from "../docs/outline";
import { docsStore, useDocs } from "../docs/store";
import { DeploymentView } from "../arch/DeploymentView";
import { actorsPrompt, flowsPrompt, guessActors, parseActors, parseFlows } from "../arch/actors";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { Graph, Project } from "../api";
import { KIND_COLOR, buildArchModel, containerView, edgeLabel, type ArchModel, type ArchNode, type WorkspacePackage } from "./archModel";
import type { Highlight } from "./nodes";
import { ArchInspector } from "./ArchInspector";
import type { Layout } from "./layout";
import { ZoomWatcher } from "./zoom";
import type { Plan } from "../sections/plan";
import { ARCH_ROLE, ROLES } from "../arch/roles";
import { timeAgo } from "../api";
import { summaryStore, useSummaries } from "../summary/store";
import { CodeMap } from "./CodeMap";
import { focusOn, type Focus } from "./focus";
import { fontsReady, lineCount, MONO, SANS, textWidth } from "./measure";

const NODE_W = 248;
const elk = new ELK();

type Size = { nameLines: number; detailLines: number; respLines: number; height: number };

/** What a component is for, in a line: the start of its AI summary, else its package.json description. */
function respOf(n: ArchNode, summaries: Map<string, string>): string | null {
  const s = summaries.get(n.id);
  const routes = n.unit?.routes;
  const offers = routes && routes.pages + routes.api > 0 ? [routes.pages ? `${routes.pages} ${routes.pages === 1 ? "page" : "pages"}` : "", routes.api ? `${routes.api} API ${routes.api === 1 ? "route" : "routes"}` : ""].filter(Boolean).join(" · ") : null;
  const first = s ? s.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? s : n.unit?.description ?? offers;
  if (!first) return null;
  return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
}

/** Datastores are drawn as cylinders, external systems as dashed boxes: the usual notation. */
const SHAPE: Partial<Record<ArchNode["kind"], string>> = { Database: "db", Cache: "db", Queue: "db", Storage: "db", Search: "db", External: "ext", AI: "ext", Mail: "ext" };

/** Measured so long names, details and descriptions wrap inside the card instead of being cut. */
function cardSize(n: ArchNode, resp: string | null): Size {
  const inner = NODE_W - 28 - 3;
  const kind = textWidth(n.kind, `11px ${SANS}`) + 14;
  const nameLines = lineCount(n.name, `600 13.5px ${MONO}`, inner - 26 - 18 - kind, 3);
  const detailLines = lineCount(n.detail, `12px ${SANS}`, inner, 3);
  const respLines = resp ? lineCount(resp, `12px ${SANS}`, inner, 2) : 0;
  const lid = SHAPE[n.kind] === "db" ? 8 : 0;
  return { nameLines, detailLines, respLines, height: 27 + Math.max(26, nameLines * 18) + 6 + detailLines * 16 + (respLines ? 6 + respLines * 16 : 0) + 6 + 20 + lid };
}

type CardData = { node: ArchNode; highlight: Highlight; repoName: string | null; color: string; size: Size; resp: string | null };

const initials = (name: string) => {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ");
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
};

const ArchCard = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { node } = data;
  const color = KIND_COLOR[node.kind];
  const missing = node.kind === "Missing";
  return (
    <div className={`arch-card ${missing ? "missing" : ""} ${SHAPE[node.kind] ? `shape-${SHAPE[node.kind]}` : ""} hl-${data.highlight ?? "none"}`} style={{ ["--kind" as any]: color }}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
      <div className="arch-top">
        <span className="arch-mono">{missing ? "?" : initials(node.name)}</span>
        <span className="arch-name wrap" style={{ WebkitLineClamp: data.size.nameLines }}>{node.name}</span>
        <span className="arch-kind">{node.kind}</span>
      </div>
      <div className="arch-detail wrap" style={{ WebkitLineClamp: data.size.detailLines }}>{node.detail}</div>
      {data.resp && (
        <div className="arch-resp wrap" style={{ WebkitLineClamp: data.size.respLines }} title={data.resp}>
          {data.resp}
        </div>
      )}
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

/** The system boundary: a dashed frame around everything the project runs or stores. */
const Boundary = memo(({ data }: NodeProps<Node<{ name: string }>>) => (
  <div className="arch-boundary">
    <span>{data.name}</span>
    <span className="faint">system</span>
  </div>
));

const nodeTypes = { arch: ArchCard, section: SectionFrame, boundary: Boundary };

const flowInside = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.partitioning.activate": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "24",
  "elk.padding": "[top=56,left=20,bottom=20,right=20]",
};

/** With AI sections: each section is a frame with its own left-to-right flow; frames stand in columns by tier (clients on the left, data and external services on the right) and stack in the plan's order. */
async function layoutSections(model: ArchModel, plan: Plan, sizes: Map<string, Size>): Promise<Layout> {
  const frames = await Promise.all(
    plan.sections.map((sec) => {
      const members = new Set(sec.members);
      const frame: ElkNode = {
        id: "frame",
        layoutOptions: flowInside,
        children: model.nodes.filter((n) => members.has(n.id)).map((n) => ({ id: n.id, width: NODE_W, height: sizes.get(n.id)!.height, layoutOptions: { "elk.partitioning.partition": String(n.layer) } })),
        edges: model.edges.filter((e) => !e.minor && members.has(e.source) && members.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };
      return elk.layout(frame);
    }),
  );
  const GAP_X = 80, GAP_Y = 40;
  // Sections whose parts are all hidden (shared code in the container view) take no room.
  const shown = plan.sections.map((s) => s.members.some((m) => model.byId.has(m)));
  const tiers = [...new Set(plan.sections.filter((_, i) => shown[i]).map((s) => s.tier))].sort((a, b) => a - b);
  const columns = tiers.map((t) => plan.sections.flatMap((s, i) => (s.tier === t && shown[i] ? [i] : [])));
  const heightOf = (col: number[]) => col.reduce((h, i) => h + (frames[i].height ?? 0), 0) + GAP_Y * (col.length - 1);
  const tallest = Math.max(...columns.map(heightOf));
  const boxes: Layout["boxes"] = new Map();
  let x = 0;
  for (const col of columns) {
    // Center each column vertically so the flow reads as one row.
    let y = (tallest - heightOf(col)) / 2;
    const width = Math.max(...col.map((i) => frames[i].width ?? 0));
    for (const i of col) {
      const f = frames[i];
      boxes.set(`sec:${i}`, { x, y, width: f.width ?? 0, height: f.height ?? 0 });
      for (const c of f.children ?? []) boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
      y += (f.height ?? 0) + GAP_Y;
    }
    x += width + GAP_X;
  }
  return { boxes };
}

/** Columns by architectural role: clients → APIs → workers → shared code → data → external services. */
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
    children: model.nodes.map((n) => ({ id: n.id, width: NODE_W, height: sizes.get(n.id)!.height, layoutOptions: { "elk.partitioning.partition": String(ARCH_ROLE[n.kind]) } })),
    edges: model.edges.filter((e) => !e.minor).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
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
  /** Opens the component a file belongs to, zoomed into its code, with the file selected. */
  drillFile?: Focus | null;
  /** "Enrich with AI" is on: Claude also names the users in the context view. */
  aiEnriched?: boolean;
  /** Opens a Docs page (a flow's page, from the flow bar). */
  onOpenDocs?: (pageId: string) => void;
};

function ArchMapInner({ project, graph, workspace, onOpenFile, onOpenTable, onAddRepo, focus: focusReq, plan: aiPlan = null, drillFile = null, aiEnriched = false, onOpenDocs }: Props) {
  const focus = focusReq?.id ?? null;
  const container = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const full = useMemo(() => buildArchModel(graph, project.repos, workspace), [graph, project.repos, workspace]);
  // Containers only (what runs and stores data); a component's code is one step in: "Look inside".
  const model = useMemo(() => containerView(full), [full]);
  const [drill, setDrill] = useState<string | null>(null);
  // Inside a container: its components (C4 level 3) or its files on the code map.
  const [drillTab, setDrillTab] = useState<"components" | "files">("components");
  // Opened for a file: show the files with it selected; otherwise start with the components.
  const fromFile = useRef(false);
  useEffect(() => {
    setDrillTab(fromFile.current ? "files" : "components");
    if (!fromFile.current) setFileFocus(null);
    fromFile.current = false;
  }, [drill]);
  // Where "Look inside" came from when stepping into a library from a component.
  const [drillTrail, setDrillTrail] = useState<string[]>([]);
  // A jump to something that isn't a container (a library from Docs, a file) opens its code.
  useEffect(() => {
    if (!focusReq) return;
    const n = full.byId.get(focusReq.id);
    if (n && !model.byId.has(n.id) && n.unit) setDrill(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);
  useEffect(() => {
    if (!drillFile) return;
    const unit = full.fileUnit.get(drillFile.id);
    if (unit) {
      fromFile.current = true;
      setDrill(unit);
      setFileFocus(focusOn(drillFile.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillFile]);
  const [fileFocus, setFileFocus] = useState<Focus | null>(null);
  // Boxes the AI plan doesn't know (the container view's merged "web APIs") join a section of their role.
  const plan = useMemo<Plan | null>(() => {
    if (!aiPlan) return null;
    const sections = aiPlan.sections.map((s) => ({ ...s, members: [...s.members] }));
    const sectionOf = new Map(aiPlan.sectionOf);
    for (const n of model.nodes) {
      if (sectionOf.has(n.id)) continue;
      const role = ARCH_ROLE[n.kind];
      let i = sections.findIndex((s) => s.tier === role);
      if (i < 0) i = sections.push({ name: ROLES[role], description: "", tier: role, members: [] }) - 1;
      sections[i].members.push(n.id);
      sectionOf.set(n.id, i);
    }
    return { sections, sectionOf };
  }, [aiPlan, model]);

  const summaryEntries = useSummaries(project.id);

  // Flows: the main request path from each app, the same ones Docs describes, played on the map.
  // Context (the system as one box, its users and external systems) or the containers inside it.
  const viewKey = `strata-arch-view-${project.id}`;
  type View = "context" | "containers" | "deployment";
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "context" || v === "deployment" ? v : "containers";
    } catch {
      return "containers";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(viewKey, v);
    } catch {}
  };
  // With "Enrich with AI", Claude also suggests the flows that matter (e.g. "Book a meeting").
  const flowsAsk = useMemo(() => flowsPrompt(project.name, model, summaryStore.texts(project.id)), [project.name, project.id, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const flowsEntry = summaryEntries["context:flows"];
  useEffect(() => {
    if (!aiEnriched || view !== "containers" || flowsEntry?.pending || flowsEntry?.error) return;
    if (flowsEntry?.summary?.hash !== flowsAsk.hash) summaryStore.requestFlows(project, flowsAsk.hash, flowsAsk.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnriched, view, flowsAsk.hash, flowsEntry?.summary?.hash]);
  const flows = useMemo(() => {
    const found: { id: string; title: string; steps: string[]; texts?: string[]; ai?: boolean }[] = model.nodes
      .filter((n) => ARCH_ROLE[n.kind] === 0 && n.unit)
      .map((n) => ({ id: `flow:${n.id}`, title: `${n.name} request path`, steps: flowPath(model, n.id) }))
      .filter((f) => f.steps.length >= 3);
    if (aiEnriched && flowsEntry?.summary?.hash === flowsAsk.hash) {
      try {
        found.unshift(...parseFlows(flowsEntry.summary.text, model).map((f) => ({ ...f, ai: true })));
      } catch {}
    }
    return found;
  }, [model, aiEnriched, flowsEntry?.summary, flowsAsk.hash]);
  // Topic filter: what matches (name, tech, description, AI summary, AI section) and its direct neighbors.
  const [topic, setTopic] = useState("");
  const topicHits = useMemo(() => {
    const q = topic.trim().toLowerCase();
    if (q.length < 2) return null;
    const texts = summaryStore.texts(project.id);
    const hits = new Set(
      model.nodes
        .filter((n) => {
          const section = plan ? plan.sections[plan.sectionOf.get(n.id) ?? -1]?.name ?? "" : "";
          return [n.name, n.detail, n.kind, n.unit?.description, n.unit?.dir, texts.get(n.id), section, ...(n.parts ?? []), ...(n.external?.via ?? [])].some((t) => t?.toLowerCase().includes(q));
        })
        .map((n) => n.id),
    );
    const near = new Set(hits);
    for (const e of model.edges) if (!e.minor && (hits.has(e.source) || hits.has(e.target))) (near.add(e.source), near.add(e.target));
    return { hits, near };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, model, plan, summaryEntries]);
  // Bring what the filter found into view.
  useEffect(() => {
    if (!topicHits?.near.size) return;
    const t = setTimeout(() => rf.fitView({ nodes: [...topicHits.near].map((id) => ({ id })), padding: 0.25, maxZoom: 1, duration: 300 }), 250);
    return () => clearTimeout(t);
  }, [topicHits, rf]);
  const [played, setPlayed] = useState<{ id: string; step: number; playing: boolean } | null>(null);
  const [flowMenu, setFlowMenu] = useState(false);
  const activeFlow = played ? flows.find((f) => f.id === played.id) : undefined;
  const docs = useDocs(project.id);
  useEffect(() => {
    if (played) docsStore.load(project.id);
  }, [played, project.id]);
  useEffect(() => {
    if (!played?.playing || !activeFlow) return;
    const t = setTimeout(() => setPlayed((f) => (f && f.step < activeFlow.steps.length - 1 ? { ...f, step: f.step + 1 } : f && { ...f, playing: false })), 2600);
    return () => clearTimeout(t);
  }, [played, activeFlow]);

  // Users: guessed from the entry points; with "Enrich with AI", named by Claude.
  const usersAsk = useMemo(() => actorsPrompt(project.name, model, summaryStore.texts(project.id)), [project.name, project.id, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const usersEntry = summaryEntries["context:users"];
  useEffect(() => {
    if (!aiEnriched || view !== "context" || usersEntry?.pending || usersEntry?.error) return;
    if (usersEntry?.summary?.hash !== usersAsk.hash) summaryStore.requestUsers(project, usersAsk.hash, usersAsk.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnriched, view, usersAsk.hash, usersEntry?.summary?.hash]);
  const actors = useMemo(() => {
    if (aiEnriched && usersEntry?.summary?.hash === usersAsk.hash) {
      try {
        const named = parseActors(usersEntry.summary.text, usersAsk.ids);
        if (named.length) return named;
      } catch {}
    }
    return guessActors(model);
  }, [aiEnriched, usersEntry?.summary, usersAsk, model]);
  const resp = useMemo(() => {
    const texts = summaryStore.texts(project.id);
    return new Map(model.nodes.map((n) => [n.id, respOf(n, texts)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, summaryEntries, project.id]);
  // Re-measure only when a description actually changes, not on every summary update.
  const respKey = useMemo(() => [...resp.values()].join("|"), [resp]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [sizes, setSizes] = useState<Map<string, Size>>(new Map());
  const [sel, setSel] = useState<string | null>(focus);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fontsReady()
      .then(() => {
        const sz = new Map(model.nodes.map((n) => [n.id, cardSize(n, resp.get(n.id) ?? null)]));
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
  }, [model, plan, respKey]);

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
    const onPath = activeFlow ? new Set(activeFlow.steps.slice(0, played!.step + 1)) : null;
    const current = activeFlow ? activeFlow.steps[played!.step] : null;
    const hl = (id: string): Highlight =>
      onPath
        ? id === current ? "selected" : onPath.has(id) ? "related" : "dim"
        : sel
          ? id === sel ? "selected" : related.has(id) ? "related" : "dim"
          : topicHits
            ? topicHits.hits.has(id) ? "selected" : topicHits.near.has(id) ? "related" : "dim"
            : null;
    // Lines along the played part of the flow, numbered.
    const flowEdge = new Map<string, number>();
    if (activeFlow) for (let k = 0; k < played!.step; k++) flowEdge.set(`${activeFlow.steps[k]}>${activeFlow.steps[k + 1]}`, k + 1);
    const repoName = (id: string | null) => (id ? project.repos.find((r) => r.id === id)?.name ?? null : null);
    const frames: Node[] = (plan?.sections ?? []).flatMap((sec, i) => {
      const b = layout.boxes.get(`sec:${i}`);
      if (b && !sec.members.some((m) => model.byId.has(m))) return [];
      return b ? [{ id: `sec:${i}`, type: "section", position: { x: b.x, y: b.y }, width: b.width, height: b.height, data: { name: sec.name, description: sec.description, count: sec.members.length }, draggable: false, selectable: false, zIndex: 0 }] : [];
    });
    // The system boundary: everything we run or store, with external services outside it.
    const inside = (n: ArchNode) => ARCH_ROLE[n.kind] < 5 && n.kind !== "Missing";
    const ownBoxes = plan
      ? (plan.sections ?? []).flatMap((sec, i) => (sec.tier < 5 && sec.members.some((m) => model.byId.has(m)) && layout.boxes.get(`sec:${i}`) ? [layout.boxes.get(`sec:${i}`)!] : []))
      : model.nodes.filter(inside).flatMap((n) => (layout.boxes.get(n.id) ? [layout.boxes.get(n.id)!] : []));
    const PAD = 28;
    const boundary: Node[] = ownBoxes.length
      ? [
          (() => {
            const x0 = Math.min(...ownBoxes.map((b) => b.x)) - PAD;
            const y0 = Math.min(...ownBoxes.map((b) => b.y)) - PAD - 26;
            const x1 = Math.max(...ownBoxes.map((b) => b.x + b.width)) + PAD;
            const y1 = Math.max(...ownBoxes.map((b) => b.y + b.height)) + PAD;
            return { id: "boundary", type: "boundary", position: { x: x0, y: y0 }, width: x1 - x0, height: y1 - y0, data: { name: project.name }, draggable: false, selectable: false, zIndex: -1 };
          })(),
        ]
      : [];
    const nodes: Node[] = [
      ...boundary,
      ...frames,
      ...model.nodes.flatMap((n) => {
        const b = layout.boxes.get(n.id);
        const size = sizes.get(n.id);
        const section = plan?.sectionOf.get(n.id);
        return b && size
          ? [{ id: n.id, type: "arch", parentId: section !== undefined ? `sec:${section}` : undefined, position: { x: b.x, y: b.y }, width: NODE_W, height: b.height, data: { node: n, highlight: hl(n.id), repoName: project.repos.length > 1 || n.unit ? repoName(n.repoId) : null, color: project.color, size, resp: resp.get(n.id) ?? null }, draggable: false, zIndex: 2 }]
          : [];
      }),
    ];
    // Library-to-library imports only show for the selected library.
    const edges: Edge[] = model.edges.filter((e) => !e.minor || e.source === sel || e.target === sel).map((e) => {
      const step = flowEdge.get(`${e.source}>${e.target}`);
      const active = activeFlow ? step !== undefined : !!sel && (e.source === sel || e.target === sel);
      const dimmed = activeFlow ? step === undefined : sel ? !active : topicHits ? !(topicHits.near.has(e.source) && topicHits.near.has(e.target) && (topicHits.hits.has(e.source) || topicHits.hits.has(e.target))) : false;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        className: `arch-edge k-${e.kind} ${e.inferred ? "inferred" : ""} ${e.target.startsWith("missing:") ? "missing" : ""} ${active ? "active" : dimmed ? "dim" : ""} ${step ? "flow" : ""}`,
        // A short label on every line (how they talk); the full evidence when it's selected; the step number in a flow.
        label: step ? `${step} · ${edgeLabel(e, model)}` : active ? [...e.reasons, ...(e.via?.length ? [`via ${e.via.join(", ")}`] : [])].join(" · ") : edgeLabel(e, model),
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelClassName: `arch-edge-label ${active ? "" : "quiet"}`,
        animated: active && e.kind === "calls",
        zIndex: active ? 3 : 1,
      };
    });
    // A suggested flow can step where the code shows no line (calls through config): draw it dashed.
    if (activeFlow)
      for (let k = 0; k < played!.step; k++) {
        const [a, b] = [activeFlow.steps[k], activeFlow.steps[k + 1]];
        if (model.edges.some((e) => e.source === a && e.target === b)) continue;
        edges.push({ id: `flowx:${k}`, source: a, target: b, className: "arch-edge k-calls inferred active flow", label: `${k + 1} · inferred`, labelBgPadding: [6, 3], labelBgBorderRadius: 6, labelClassName: "arch-edge-label", zIndex: 4 } as Edge);
      }
    return { nodes, edges };
  }, [layout, sizes, model, sel, project, plan, resp, activeFlow, played, topicHits]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of model.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [model]);

  // One step in: the component's own code, on the code map.
  const drilled = drill ? full.byId.get(drill) : undefined;
  const scoped = useMemo(() => {
    if (!drilled) return null;
    const files = new Set([...full.fileUnit].filter(([, u]) => u === drilled.id).map(([f]) => f));
    return {
      graph: {
        nodes: graph.nodes.filter((n) => files.has(n.id) || (n.kind === "symbol" && files.has(n.parentId ?? "")) || n.kind === "table"),
        edges: graph.edges.filter((e) => files.has(e.src)),
        // No "missing package" ghosts inside one component: hoisted npm packages would all show up.
        packages: [],
      },
      project: { ...project, repos: project.repos.filter((r) => r.id === drilled.repoId) },
      files: [...files],
    };
  }, [drilled, full, graph, project]);
  // A title on the diagram itself, so a screenshot says what it shows and how current it is.
  const scannedAt = Math.max(0, ...project.repos.map((r) => r.lastScanAt ?? 0));
  const diagramTitle = (what: string, extra: string) => (
    <div className="arch-title">
      <div className="arch-title-main">{what}</div>
      <div className="arch-title-sub">
        {extra}
        {scannedAt ? ` · scanned ${timeAgo(scannedAt)}` : ""}
      </div>
    </div>
  );
  const viewToggle = (
    <div className="arch-view-toggle glass">
      <button className={view === "context" ? "on" : ""} onClick={() => setView("context")} title="The system as one box, with its users and the external systems it depends on">
        Context
      </button>
      <button className={view === "containers" ? "on" : ""} onClick={() => setView("containers")} title="What runs and stores data inside the system">
        Containers
      </button>
      <button className={view === "deployment" ? "on" : ""} onClick={() => setView("deployment")} title="How it runs: docker-compose services, scripts, ports and dev tools">
        Deployment
      </button>
    </div>
  );
  if (view === "deployment" && !drilled)
    return (
      <div className="map">
        <DeploymentView project={project} graph={graph} model={model} onSelect={setSel} />
        {viewToggle}
        {sel && full.byId.has(sel) && <ArchInspector onDrill={setDrill} model={full} project={project} graph={graph} id={sel} onSelect={setSel} onOpenFile={onOpenFile} onOpenTable={onOpenTable} onAddRepo={onAddRepo} onClose={() => setSel(null)} />}
      </div>
    );
  if (view === "context" && !drilled)
    return (
      <div className="map">
        <ContextView projectName={project.name} model={model} actors={actors} onOpenContainers={() => setView("containers")} onSelect={setSel} />
        {diagramTitle(`System context of ${project.name}`, `${actors.length} kinds of users · ${model.nodes.filter((n) => ARCH_ROLE[n.kind] === 5).length} external systems`)}
        {viewToggle}
        {aiEnriched && usersEntry?.pending && <div className="glass scan-pill" style={{ top: "auto", bottom: 14, left: "50%" }}><span className="ai-spark">✦</span> Naming the users…</div>}
        <MapLegend
          summary={`${actors.length} kinds of users · ${model.nodes.filter((n) => ARCH_ROLE[n.kind] === 5).length} external systems`}
          groups={[
            {
              title: "Shapes",
              items: [
                { icon: <i className="lg-person" />, label: aiEnriched && actors.some((a) => a.ai) ? "users, named by Claude" : "users, guessed from the apps" },
                { icon: <i className="lg-boundary" />, label: `${project.name}: double-click to see inside` },
                { icon: <i className="lg-shape ext" />, label: "external system" },
              ],
            },
          ]}
        />
        {sel && full.byId.has(sel) && <ArchInspector onDrill={setDrill} model={full} project={project} graph={graph} id={sel} onSelect={setSel} onOpenFile={onOpenFile} onOpenTable={onOpenTable} onAddRepo={onAddRepo} onClose={() => setSel(null)} />}
      </div>
    );

  if (drilled && scoped) {
    // The shared libraries this component imports, most used first: each one step further in.
    const libs = full.edges
      .filter((e) => e.source === drilled.id && e.kind === "imports" && full.byId.get(e.target)?.kind === "Library")
      .sort((a, b) => b.files.length - a.files.length)
      .map((e) => ({ id: e.target, name: full.byId.get(e.target)!.name, files: e.files.length }));
    const back = drillTrail.length ? drillTrail[drillTrail.length - 1] : null;
    return (
      <div className="map" style={{ display: "flex", flexDirection: "column" }}>
        <div className="arch-drill-bar glass">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="link-btn" onClick={() => (setDrill(null), setDrillTrail([]))}>
              ← {project.name}
            </button>
            {back && (
              <>
                <span className="faint">›</span>
                <button className="link-btn mono" onClick={() => (setDrill(back), setDrillTrail((t) => t.slice(0, -1)))}>
                  {full.byId.get(back)?.name}
                </button>
              </>
            )}
            <span className="faint">›</span>
            <span className="mono" style={{ fontWeight: 600 }}>{drilled.name}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {drilled.kind} · {drilled.unit?.files ?? 0} files{drilled.parts?.length ? ` · incl. ${drilled.parts.length} packages` : ""}
            </span>
            <div className="seg" style={{ marginLeft: 8, height: 26 }}>
              <button className={drillTab === "components" ? "on" : ""} onClick={() => setDrillTab("components")} title="The building blocks inside: pages, API routes, modules, UI">
                Components
              </button>
              <button className={drillTab === "files" ? "on" : ""} onClick={() => setDrillTab("files")} title="Folders and files on the code map">
                Files
              </button>
            </div>
          </div>
          {libs.length > 0 && (
            <div className="arch-drill-libs">
              <span className="faint">Uses</span>
              {libs.slice(0, 10).map((l) => (
                <button
                  key={l.id}
                  className="doc-chip mono"
                  style={{ ["--c" as any]: "var(--text-3)" }}
                  title={`${l.files} ${l.files === 1 ? "file imports" : "files import"} it · look inside`}
                  onClick={() => {
                    setDrillTrail((t) => [...t, drilled.id]);
                    setDrill(l.id);
                  }}
                >
                  {l.name}
                  <span className="doc-chip-sub">{l.files}</span>
                </button>
              ))}
              {libs.length > 10 && <span className="faint">+{libs.length - 10}</span>}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
          {drillTab === "components" ? (
            <ComponentView
              key={drilled.id}
              container={drilled}
              full={full}
              graph={graph}
              files={scoped.files}
              onOpenFile={onOpenFile}
              onOpenPart={(id) => {
                setDrillTrail((t) => [...t, drilled.id]);
                setDrill(id);
              }}
            />
          ) : (
            <CodeMap key={drilled.id} project={scoped.project} graph={scoped.graph} onLevel={() => {}} zoomRequest={null} focus={fileFocus} onOpenTable={(id) => onOpenTable(id)} onOpenFile={onOpenFile} />
          )}
        </div>
      </div>
    );
  }

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
        onNodeDoubleClick={(_, n) => full.byId.get(n.id)?.unit && setDrill(n.id)}
        zoomOnDoubleClick={false}
        onPaneClick={() => setSel(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dot)" />
        <MiniMap className="map-minimap" pannable zoomable nodeColor={(n) => (n.type === "arch" ? KIND_COLOR[(n.data as CardData).node.kind] + "AA" : "rgba(139, 92, 246, 0.08)")} nodeStrokeWidth={0} />
        <ZoomWatcher container={container} onLevel={() => {}} />
      </ReactFlow>
      {!layout && <div className="map-loading">Laying out the architecture…</div>}
      {diagramTitle(`Containers of ${project.name}`, `${model.nodes.filter((n) => ARCH_ROLE[n.kind] < 5).length} inside · ${model.nodes.filter((n) => ARCH_ROLE[n.kind] === 5).length} external`)}
      {viewToggle}
      <div className="arch-flows">
        <div className="arch-filter glass">
          <span className="faint">⌕</span>
          <input
            value={topic}
            placeholder="Filter, e.g. billing"
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setTopic("")}
          />
          {topicHits && <span className="faint" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{topicHits.hits.size} {topicHits.hits.size === 1 ? "match" : "matches"}</span>}
          {topic && (
            <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setTopic("")} title="Clear">
              ×
            </button>
          )}
        </div>
        {(flows.length > 0 || flowsEntry?.pending) && (
          <button className={`btn small ${activeFlow ? "plan-primary" : ""}`} onClick={() => setFlowMenu((o) => !o)}>
            ▶ Flows{aiEnriched && flowsEntry?.pending ? " · ✦ finding…" : ""}
          </button>
        )}
          {flowMenu && (
            <div className="arch-flow-menu glass">
              {flows.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setPlayed({ id: f.id, step: 0, playing: true });
                    setFlowMenu(false);
                    setSel(null);
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {f.ai && <span className="ai-spark">✦ </span>}
                    {f.title}
                  </span>
                  <span className="faint mono" style={{ fontSize: 11.5 }}>{f.steps.map((s) => model.byId.get(s)?.name).join(" → ")}</span>
                </button>
              ))}
            </div>
          )}
      </div>
      {activeFlow && played && (() => {
        const node = model.byId.get(activeFlow.steps[played.step]);
        const page = docs.pages[activeFlow.id];
        const text = activeFlow.texts?.[played.step] || page?.blocks.find((b) => b.key === `step:${played.step}`)?.text;
        const plainText = text?.replace(/\[\[(?:component|file|table|symbol):([^\]]+)\]\]/g, (_, v) => String(v).replace(/^.*\//, ""));
        return (
          <div className="arch-flow-bar glass">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="arch-flow-num mono">{played.step + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {activeFlow.title} <span className="faint" style={{ fontWeight: 400 }}>· step {played.step + 1} of {activeFlow.steps.length}</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  <span className="mono" style={{ color: "var(--text)" }}>{node?.name}</span> {plainText ? `— ${plainText}` : `· ${node?.detail ?? ""}`}
                </div>
              </div>
              <button className="icon-btn" title="Previous step" disabled={played.step === 0} onClick={() => setPlayed({ ...played, step: played.step - 1, playing: false })}>‹</button>
              <button className="icon-btn" title="Next step" disabled={played.step >= activeFlow.steps.length - 1} onClick={() => setPlayed({ ...played, step: played.step + 1, playing: false })}>›</button>
              <button className="btn small" onClick={() => setPlayed({ ...played, step: played.playing || played.step >= activeFlow.steps.length - 1 ? 0 : played.step, playing: !played.playing })}>
                {played.playing ? "■ Stop" : "▶ Play"}
              </button>
              {onOpenDocs && !activeFlow.ai && (
                <button className="btn small ghost" onClick={() => onOpenDocs(activeFlow.id)} title="Open this flow's Docs page">
                  Docs
                </button>
              )}
              <button className="icon-btn" title="Close the flow" onClick={() => setPlayed(null)}>×</button>
            </div>
            {!text && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Write this flow in Docs to see what happens at each step.</div>}
            {activeFlow.ai && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}><span className="ai-spark">✦</span> Suggested by Claude from the parts and their descriptions; dashed steps weren't found as calls in the code.</div>}
          </div>
        );
      })()}
      <MapLegend
        summary={`${model.nodes.length} parts · ${model.edges.filter((e) => !e.minor).length} connections`}
        groups={[
          {
            title: "Parts",
            items: Object.entries(counts).map(([k, n]) => ({
              icon: <i className="lg-dot" style={{ background: KIND_COLOR[k as ArchNode["kind"]] }} />,
              label: `${n} ${k === "Library" ? (n === 1 ? "library" : "libraries") : k.toLowerCase() + (n === 1 || ["Missing", "External", "Infra"].includes(k) ? "" : "s")}`,
            })),
          },
          {
            title: "Lines",
            items: [
              { icon: <i className="lg-line" style={{ borderColor: "var(--arch)" }} />, label: "calls (HTTP, tRPC)" },
              { icon: <i className="lg-line" style={{ borderColor: "var(--db)" }} />, label: "reads or writes data" },
              { icon: <i className="lg-line" />, label: "uses (SDK, cache, mail)" },
              { icon: <i className="lg-line ghost" />, label: "missing or inferred" },
            ],
          },
          {
            title: "Shapes",
            items: [
              { icon: <i className="lg-shape db" />, label: "datastore" },
              { icon: <i className="lg-shape ext" />, label: "external system" },
              { icon: <i className="lg-boundary" />, label: `${project.name} system boundary` },
            ],
          },
        ]}
      />
      {sel && full.byId.has(sel) && (
        <ArchInspector onDrill={setDrill} model={full} project={project} graph={graph} id={sel} onSelect={setSel} onOpenFile={onOpenFile} onOpenTable={onOpenTable} onAddRepo={onAddRepo} onClose={() => setSel(null)} />
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
