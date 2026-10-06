import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DbModel, DbTable } from "./dbModel";
import type { Layout } from "./layout";

export const TABLE_W = 280;
export const TABLE_HEADER = 44;
export const COL_H = 24;
export const TABLE_FOOTER = 30;
export const COLLAPSED_COLS = 12;
const REPO_HEADER = 64;

const elk = new ELK();

export function visibleColumns(t: DbTable, expanded: Set<string>) {
  if (expanded.has(t.id) || t.columns.length <= COLLAPSED_COLS + 1) return t.columns;
  // Keys first, so relations stay attached to visible rows.
  const keys = t.columns.filter((c) => c.pk || c.fk);
  const rest = t.columns.filter((c) => !c.pk && !c.fk);
  return [...keys, ...rest].slice(0, Math.max(COLLAPSED_COLS, keys.length));
}

export function tableHeight(t: DbTable, expanded: Set<string>) {
  const rows = visibleColumns(t, expanded).length;
  const more = rows < t.columns.length || expanded.has(t.id) ? COL_H : 0;
  return TABLE_HEADER + rows * COL_H + more + TABLE_FOOTER;
}

const flowOptions = (top: number) => ({
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "32",
  "elk.spacing.componentComponent": "40",
  "elk.aspectRatio": "1.4",
  "elk.padding": `[top=${top},left=24,bottom=24,right=24]`,
});

/**
 * ER layout. Tables flow along their foreign keys inside their schema-file
 * group; groups are packed into a grid. Hub tables (referenced by most others)
 * don't pull the layout, otherwise everything stacks up next to them.
 */
export async function layoutDbModel(model: DbModel, expanded: Set<string>): Promise<Layout> {
  const edgesWithin = (container: string, members: Set<string>) =>
    [...new Map(model.relations.filter((rel) => members.has(rel.from) && members.has(rel.to) && !model.hubs.has(rel.to)).map((rel) => [`${rel.from}>${rel.to}`, rel])).values()].map((rel) => ({
      id: `${container}|${rel.from}>${rel.to}`,
      sources: [rel.from],
      targets: [rel.to],
    }));
  const tableNode = (t: DbTable) => ({ id: t.id, width: TABLE_W, height: tableHeight(t, expanded) });

  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.algorithm": "rectpacking", "elk.spacing.nodeNode": "60" },
    children: model.repos.map((r) => {
      const ghosts = model.ghosts.filter((g) => g.repoId === r.id).map((g) => ({ id: g.id, width: TABLE_W, height: 84 }));
      if (r.groups.length === 0) {
        const members = new Set([...r.tables.map((t) => t.id), ...ghosts.map((g) => g.id)]);
        return { id: `db:${r.id}`, layoutOptions: flowOptions(REPO_HEADER), children: [...r.tables.map(tableNode), ...ghosts], edges: edgesWithin(`db:${r.id}`, members) };
      }
      return {
        id: `db:${r.id}`,
        layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.7", "elk.spacing.nodeNode": "36", "elk.padding": `[top=${REPO_HEADER},left=28,bottom=28,right=28]` },
        children: [
          ...r.groups.map((g) => ({ id: g.id, layoutOptions: flowOptions(48), children: g.tables.map(tableNode), edges: edgesWithin(g.id, new Set(g.tables.map((t) => t.id))) })),
          ...ghosts,
        ],
      };
    }),
  };
  const result = await elk.layout(graph);
  const boxes: Layout["boxes"] = new Map();
  const visit = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
      visit(c);
    }
  };
  visit(result);
  return { boxes };
}
