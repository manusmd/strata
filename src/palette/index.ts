import type { Graph, Project } from "../api";
import { buildArchModel, KIND_COLOR, type WorkspacePackage } from "../map/archModel";
import { buildCodeModel } from "../map/model";
import type { Lens } from "../routes";

export type ItemKind = "file" | "symbol" | "table" | "component" | "folder" | "action";

export type PaletteItem = {
  key: string;
  kind: ItemKind;
  title: string;
  subtitle: string;
  /** Short tag on the right, e.g. "Service", "function", "Code". */
  tag: string;
  color: string;
  /** Where selecting it goes. */
  target?: { lens: Lens; id: string };
  action?: string;
  /** Small boost so more important things win ties (exported symbols, big tables…). */
  boost?: number;
  /** AI summary, searched but not shown. */
  about?: string;
};

export const KIND_LABEL: Record<ItemKind, string> = { file: "Files", symbol: "Symbols", table: "Tables", component: "Components", folder: "Folders", action: "Actions" };
export const KIND_ICON: Record<ItemKind, string> = { file: "TS", symbol: "ƒ", table: "▦", component: "◆", folder: "▤", action: "›" };

/** Everything in the project you can jump to, built once per graph. */
export function buildIndex(project: Project, graph: Graph, workspace: WorkspacePackage[], summaries: Map<string, string> = new Map()): PaletteItem[] {
  const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name ?? "";
  const multi = project.repos.length > 1;
  const items: PaletteItem[] = [];
  const files = new Map(graph.nodes.filter((n) => n.kind === "file").map((f) => [f.id, f]));

  for (const f of files.values()) {
    items.push({ key: f.id, kind: "file", title: f.name, subtitle: `${multi ? `${repoName(f.repoId)}/` : ""}${f.path}`, tag: `${f.meta?.lines ?? 0} lines`, color: "var(--code)", target: { lens: "code", id: f.id } });
  }
  for (const s of graph.nodes) {
    if (s.kind !== "symbol" || !s.parentId) continue;
    const file = files.get(s.parentId);
    items.push({
      key: s.id,
      kind: "symbol",
      title: s.name + (s.meta?.symbolKind === "function" ? "()" : ""),
      subtitle: `${file?.path ?? ""}:${s.meta?.line ?? 1}`,
      tag: s.meta?.symbolKind ?? "symbol",
      color: "var(--arch)",
      target: { lens: "code", id: s.parentId },
      boost: s.meta?.exported ? 4 : 0,
    });
  }
  for (const t of graph.nodes) {
    if (t.kind !== "table") continue;
    items.push({
      key: t.id,
      kind: "table",
      title: t.name,
      subtitle: `${multi ? `${repoName(t.repoId)} · ` : ""}${(t.meta?.columns ?? []).length} columns · ${t.path ?? ""}`,
      tag: t.meta?.origin === "sql" ? "SQL" : t.meta?.origin === "drizzle" ? "Drizzle" : "Prisma",
      color: "var(--db)",
      target: { lens: "db", id: t.id },
      boost: 3,
    });
  }
  for (const n of buildArchModel(graph, project.repos, workspace).nodes) {
    items.push({ key: n.id, kind: "component", title: n.name, subtitle: n.detail + (n.unit?.dir ? ` · ${n.unit.dir}` : ""), tag: n.kind, color: KIND_COLOR[n.kind], target: { lens: "arch", id: n.id }, boost: 8 });
  }
  const code = buildCodeModel(graph, project.repos);
  for (const c of code.clusters.values()) {
    if (!c.dir) continue;
    items.push({ key: c.id, kind: "folder", title: c.dir.split("/").pop()!, subtitle: `${multi ? `${repoName(c.repoId)}/` : ""}${c.dir}/ · ${c.files.length} files`, tag: "folder", color: "var(--text-3)", target: { lens: "code", id: c.id } });
  }
  for (const item of items) item.about = summaries.get(item.key);
  return items;
}
