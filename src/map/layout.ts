import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { CodeModel, Cluster, MapItem } from "./model";

export const CLUSTER_W = 268;
export const HEADER_H = 46;
export const ROW_H = 28;
export const PAD = 8;
export const COLLAPSED_ROWS = 10;
export const MORE_H = 28;
export const REPO_HEADER = 64;
export const GROUP_HEADER = 40;
export const GHOST_W = 230;
export const GHOST_H = 70;

/** Up to this many children, a folder is laid out as a dependency flow; beyond it, packed into a grid. */
const FLOW_LIMIT = 14;

const elk = new ELK();

export function visibleFiles(c: Cluster, expanded: Set<string>) {
  return expanded.has(c.id) ? c.files : c.files.slice(0, COLLAPSED_ROWS);
}

export function clusterHeight(c: Cluster, expanded: Set<string>): number {
  const rows = visibleFiles(c, expanded).length;
  const more = c.files.length > COLLAPSED_ROWS ? MORE_H : 0;
  return HEADER_H + rows * ROW_H + more + PAD;
}

export type Box = { x: number; y: number; width: number; height: number };
export type Layout = { boxes: Map<string, Box> };

const itemId = (it: MapItem) => (it.kind === "group" ? it.id : it.cluster.id);

/**
 * Lays out the folder hierarchy with ELK. Each container (repo or folder group)
 * is laid out on its own: small ones as a left-to-right dependency flow, big
 * ones packed into a compact grid, so huge repos don't turn into a tower.
 * Files are stacked inside their cluster, so ELK never sees individual files.
 */
export async function layoutCodeModel(model: CodeModel, expanded: Set<string>): Promise<Layout> {
  // Child of `container` that contains `id` (walking up the hierarchy).
  const childWithin = (container: string, id: string): string | null => {
    let cur: string | undefined = id;
    while (cur) {
      const parent = model.parentOf.get(cur);
      if (parent === container) return cur;
      cur = parent;
    }
    return null;
  };

  const localEdges = (container: string): ElkExtendedEdge[] => {
    const seen = new Set<string>();
    const out: ElkExtendedEdge[] = [];
    for (const e of model.clusterEdges) {
      const a = childWithin(container, e.source);
      const b = childWithin(container, e.target);
      if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      out.push({ id: `${container}|${a}>${b}`, sources: [a], targets: [b] });
    }
    return out;
  };

  const containerOptions = (childCount: number, top: number) => ({
    ...(childCount <= FLOW_LIMIT
      ? {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.layered.spacing.nodeNodeBetweenLayers": "64",
          "elk.spacing.nodeNode": "24",
          "elk.spacing.componentComponent": "32",
        }
      : {
          "elk.algorithm": "rectpacking",
          "elk.aspectRatio": "1.7",
          "elk.spacing.nodeNode": "24",
          "elk.rectpacking.trybox": "true",
        }),
    "elk.padding": `[top=${top},left=20,bottom=20,right=20]`,
  });

  const toElk = (it: MapItem): ElkNode => {
    if (it.kind === "cluster") return { id: it.cluster.id, width: CLUSTER_W, height: clusterHeight(it.cluster, expanded) };
    const useFlow = it.children.length <= FLOW_LIMIT;
    return {
      id: it.id,
      layoutOptions: containerOptions(it.children.length, GROUP_HEADER),
      children: it.children.map(toElk),
      edges: useFlow ? localEdges(it.id) : [],
    };
  };

  // At the top, repos and missing packages: flow so ghosts sit to the right of their importers.
  const repoOf = (clusterId: string) => model.clusters.get(clusterId)?.repoId;
  const topEdges: ElkExtendedEdge[] = [];
  const seen = new Set<string>();
  for (const e of [...model.clusterEdges, ...model.ghostEdges]) {
    const a = repoOf(e.source);
    const b = model.clusters.has(e.target) ? repoOf(e.target) : e.target;
    if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    topEdges.push({ id: `top|${a}>${b}`, sources: [a], targets: [b] });
  }

  // Only edges whose ends are on the map (ELK rejects the whole graph otherwise).
  const present = new Set([...model.repos.map((r) => r.id), ...model.ghosts.map((g) => g.id)]);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.componentComponent": "60",
    },
    children: [
      ...model.repos.map((r) => {
        const useFlow = r.items.length <= FLOW_LIMIT;
        return {
          id: r.id,
          layoutOptions: containerOptions(r.items.length, REPO_HEADER),
          children: r.items.map(toElk),
          edges: useFlow ? localEdges(r.id) : [],
        };
      }),
      ...model.ghosts.map((g) => ({ id: g.id, width: GHOST_W, height: GHOST_H })),
    ],
    edges: topEdges.filter((e) => present.has(e.sources[0]) && present.has(e.targets[0])),
  };

  const result = await elk.layout(graph);
  const boxes = new Map<string, Box>();
  const visit = (n: ElkNode) => {
    for (const child of n.children ?? []) {
      boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 });
      visit(child);
    }
  };
  visit(result);
  return { boxes };
}

export { itemId };
