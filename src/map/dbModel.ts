import type { Graph, Repo } from "../api";

export type DbColumn = {
  name: string;
  type: string;
  pk: boolean;
  nullable: boolean;
  unique: boolean;
  fk?: { table: string; column: string };
};

export type DbTable = {
  id: string;
  repoId: string;
  name: string;
  origin: "prisma" | "drizzle" | "sql";
  source: string;
  line: number;
  model: string | null;
  columns: DbColumn[];
  /** Files that read / write this table. */
  readers: string[];
  writers: string[];
};

/** A table that a foreign key points at but no schema in the project defines. */
export type GhostTable = { id: string; name: string; repoId: string; referencedBy: string[] };

export type DbRelation = { id: string; from: string; fromColumn: string; to: string; toColumn: string };

export type DbGroup = { id: string; repoId: string; label: string; tables: DbTable[] };

export type DbModel = {
  repos: { id: string; name: string; tables: DbTable[]; groups: DbGroup[] }[];
  /** Tables nearly everything points at (tenant, user): laid out apart, their lines shown on selection. */
  hubs: Map<string, number>;
  tables: Map<string, DbTable>;
  ghosts: GhostTable[];
  relations: DbRelation[];
  fileNames: Map<string, { path: string; repoId: string }>;
};

export const tableIdFor = (repoId: string, name: string) => `${repoId}:table:${name}`;

export function buildDbModel(graph: Graph, repos: Repo[]): DbModel {
  const tables = new Map<string, DbTable>();
  const fileNames = new Map<string, { path: string; repoId: string }>();
  for (const n of graph.nodes) {
    if (n.kind === "file" && n.path && n.repoId) fileNames.set(n.id, { path: n.path, repoId: n.repoId });
    if (n.kind !== "table" || !n.repoId) continue;
    tables.set(n.id, {
      id: n.id,
      repoId: n.repoId,
      name: n.name,
      origin: n.meta?.origin ?? "sql",
      source: n.path ?? "",
      line: n.meta?.line ?? 1,
      model: n.meta?.model ?? null,
      columns: n.meta?.columns ?? [],
      readers: [],
      writers: [],
    });
  }
  for (const e of graph.edges) {
    const t = tables.get(e.dst);
    if (!t) continue;
    if (e.kind === "reads") t.readers.push(e.src);
    if (e.kind === "writes") t.writers.push(e.src);
  }

  const relations: DbRelation[] = [];
  const ghosts = new Map<string, GhostTable>();
  for (const t of tables.values()) {
    for (const c of t.columns) {
      if (!c.fk) continue;
      const target = tableIdFor(t.repoId, c.fk.table);
      if (target === t.id) continue; // self references are shown as a badge, not a loop
      if (!tables.has(target)) {
        const g = ghosts.get(target) ?? { id: target, name: c.fk.table, repoId: t.repoId, referencedBy: [] };
        g.referencedBy.push(t.id);
        ghosts.set(target, g);
      }
      relations.push({ id: `${t.id}.${c.name}`, from: t.id, fromColumn: c.name, to: target, toColumn: c.fk.column });
    }
  }

  // Schema files usually split tables by domain (finance.zmodel, auth-schema.ts, …): group by them.
  const groupLabel = (source: string) => source.split("/").pop()!.replace(/\.(zmodel|prisma|ts|js|sql)$/, "").replace(/[-_.]?schema$/, "") || "schema";
  const repoList = repos
    .map((r) => {
      const own = [...tables.values()].filter((t) => t.repoId === r.id).sort((a, b) => a.name.localeCompare(b.name));
      const bySource = new Map<string, DbTable[]>();
      for (const t of own) {
        // SQL migrations describe one schema together, whatever file a table first appeared in.
        const key = t.origin === "sql" ? "sql" : t.source;
        bySource.set(key, [...(bySource.get(key) ?? []), t]);
      }
      const groups =
        bySource.size > 1
          ? [...bySource].map(([src, ts]) => ({ id: `dbg:${r.id}:${src}`, repoId: r.id, label: groupLabel(src), tables: ts })).sort((a, b) => b.tables.length - a.tables.length)
          : [];
      return { id: r.id, name: r.name, tables: own, groups };
    })
    .filter((r) => r.tables.length > 0);

  const inDegree = new Map<string, number>();
  for (const rel of relations) inDegree.set(rel.to, (inDegree.get(rel.to) ?? 0) + 1);
  const threshold = Math.max(6, Math.round(tables.size * 0.15));
  const hubs = new Map([...inDegree].filter(([, n]) => n >= threshold));

  return { repos: repoList, hubs, tables, ghosts: [...ghosts.values()], relations, fileNames };
}

export const ORIGIN_LABEL: Record<DbTable["origin"], string> = { prisma: "Prisma", drizzle: "Drizzle", sql: "SQL" };
