import type { Graph, GraphNode, Project } from "../api";
import type { ArchEdge, ArchModel, ArchNode } from "../map/archModel";
import type { DbModel, DbTable } from "../map/dbModel";
import { ARCH_ROLE, ROLES } from "../arch/roles";
import { containerView } from "../map/archModel";

/** Everything a docs page is built from: the scan, as the maps see it. */
export type DocsCtx = {
  project: Project;
  graph: Graph;
  arch: ArchModel;
  /** The Architecture page's container view: what the System pages, flows and component facts follow. */
  cv: ArchModel;
  db: DbModel;
  /** Graph nodes by id, and files by "repo/path" label. */
  nodes: Map<string, GraphNode>;
  fileByLabel: Map<string, GraphNode>;
  repoName: (id: string | null) => string;
};

export type PageKind = "start" | "section" | "component" | "data" | "flow" | "glossary";

/** A page of the outline. The outline comes from the scan, so it exists before Claude writes anything. */
export type PageDef = {
  id: string;
  kind: PageKind;
  group: Group;
  title: string;
  /** Code-ish titles (component names) are set in the mono font. */
  mono: boolean;
  /** component: the arch node. section: its members. data: its tables. flow: the arch nodes along the path. */
  node?: string;
  members?: string[];
  tables?: string[];
  steps?: string[];
};

export const GROUPS = ["Start here", "System", "Components", "Libraries", "Data model", "Flows", "Glossary"] as const;
export type Group = (typeof GROUPS)[number];

export const slug = (s: string) => s.toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

export function makeCtx(project: Project, graph: Graph, arch: ArchModel, db: DbModel): DocsCtx {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name ?? "";
  const fileByLabel = new Map(graph.nodes.filter((n) => n.kind === "file" && n.path).map((n) => [`${repoName(n.repoId)}/${n.path}`, n]));
  return { project, graph, arch, cv: containerView(arch), db, nodes, fileByLabel, repoName };
}

const shown = (n: ArchNode) => n.kind !== "Missing";

const outside = (arch: ArchModel, id: string) => (ARCH_ROLE[arch.byId.get(id)?.kind ?? "External"] === 5 ? 1 : 0);

/** The strongest next hop of a request: calls before data before uses, never back or into libraries. */
function nextHop(arch: ArchModel, from: string, seen: Set<string>): ArchEdge | undefined {
  const rank: Record<string, number> = { calls: 0, data: 1, uses: 2 };
  return arch.edges
    .filter((e) => e.source === from && e.kind in rank && !seen.has(e.target))
    .filter((e) => {
      const t = arch.byId.get(e.target);
      return t && t.kind !== "Library" && t.kind !== "Missing";
    })
    // Inside the system first (the request goes on from there), external services last.
    .sort((a, b) => outside(arch, a.target) - outside(arch, b.target) || rank[a.kind] - rank[b.kind] || b.weight - a.weight)[0];
}

/** From each app, follow the main request path through the system. */
export function flowPath(arch: ArchModel, start: string): string[] {
  const path = [start];
  const seen = new Set(path);
  for (let hop = nextHop(arch, start, seen); hop && path.length < 6; hop = nextHop(arch, path[path.length - 1], seen)) {
    path.push(hop.target);
    seen.add(hop.target);
  }
  return path;
}

export function buildOutline(ctx: DocsCtx): PageDef[] {
  const { arch, cv, db } = ctx;
  const pages: PageDef[] = [{ id: "start", kind: "start", group: "Start here", title: "Overview", mono: false }];

  // System pages follow the architectural roles, in the map's reading order.
  ROLES.forEach((title, role) => {
    const members = cv.nodes.filter((n) => shown(n) && ARCH_ROLE[n.kind] === role).map((n) => n.id);
    if (members.length) pages.push({ id: `role:${role}`, kind: "section", group: "System", title, mono: false, members });
  });

  // Containers are the components; shared libraries get their own group, like "Look inside" on the map.
  for (const n of arch.nodes.filter((n) => n.unit).sort((a, b) => ARCH_ROLE[a.kind] - ARCH_ROLE[b.kind] || a.name.localeCompare(b.name)))
    pages.push({ id: `component:${n.id}`, kind: "component", group: cv.byId.has(n.id) ? "Components" : "Libraries", title: n.name, mono: true, node: n.id });

  const groups = db.repos.flatMap((r) => r.groups).filter((g) => g.tables.length);
  if (db.tables.size && (db.tables.size <= 12 || groups.length < 2)) pages.push({ id: "data", kind: "data", group: "Data model", title: "All tables", mono: false, tables: [...db.tables.keys()] });
  else for (const g of groups) pages.push({ id: `data:${g.id}`, kind: "data", group: "Data model", title: g.label, mono: false, tables: g.tables.map((t) => t.id) });

  for (const app of cv.nodes.filter((n) => ARCH_ROLE[n.kind] === 0 && n.unit)) {
    const steps = flowPath(cv, app.id);
    if (steps.length >= 3) pages.push({ id: `flow:${app.id}`, kind: "flow", group: "Flows", title: `${app.name} request path`, mono: false, steps });
  }

  if (db.tables.size || arch.nodes.length > 2) pages.push({ id: "glossary", kind: "glossary", group: "Glossary", title: "Domain terms", mono: false });
  return pages;
}

// ---------- Facts: straight from the scan, never written by Claude ----------

export type ChipKind = "component" | "file" | "table" | "symbol" | "env" | "text";
/** A clickable reference on a page. `target` is what it opens: an arch node, a file or a table. */
export type Chip = { kind: ChipKind; label: string; target?: string; sub?: string };
export type FactRow = { label: string; items: Chip[] };

export const compChip = (n: ArchNode, sub?: string): Chip => ({ kind: "component", label: n.name, target: n.id, sub });
export const tableChip = (t: DbTable): Chip => ({ kind: "table", label: t.name, target: t.id });

/** Files that belong to a component (its package's source). */
export function unitFiles(ctx: DocsCtx, nodeId: string): GraphNode[] {
  return [...ctx.arch.fileUnit].filter(([, u]) => u === nodeId).map(([f]) => ctx.nodes.get(f)!).filter(Boolean);
}

const ENTRY = /^(index|main|server|app|cli|worker|mod)\.(m?[tj]sx?)$/;

function fileChip(_ctx: DocsCtx, f: GraphNode): Chip {
  return { kind: "file", label: f.path ?? f.name, target: f.id };
}

/** Tables that a set of files reads and writes. */
function tableUse(ctx: DocsCtx, files: Set<string>) {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const t of ctx.db.tables.values()) {
    if (t.writers.some((f) => files.has(f))) writes.add(t.id);
    else if (t.readers.some((f) => files.has(f))) reads.add(t.id);
  }
  return { reads: [...reads], writes: [...writes] };
}

export function envVars(ctx: DocsCtx, files: Set<string>): string[] {
  return [...new Set(ctx.graph.edges.filter((e) => e.kind === "env" && files.has(e.src)).map((e) => e.dst.slice(4)))].sort();
}

export function componentFacts(ctx: DocsCtx, id: string): FactRow[] {
  const n = ctx.arch.byId.get(id);
  if (!n) return [];
  // Containers: what they do, including through their libraries. Libraries: their own imports.
  const m = ctx.cv.byId.has(id) ? ctx.cv : ctx.arch;
  const name = (x: string) => m.byId.get(x);
  const out = m.edges.filter((e) => e.source === id && name(e.target));
  const inc = m.edges.filter((e) => e.target === id && name(e.source));
  const files = new Set(unitFiles(ctx, id).map((f) => f.id));
  const { reads, writes } = tableUse(ctx, files);
  const entries = unitFiles(ctx, id).filter((f) => ENTRY.test(f.name)).sort((a, b) => (a.path ?? "").split("/").length - (b.path ?? "").split("/").length).slice(0, 3);
  const scripts: Record<string, string> = ctx.nodes.get(id)?.meta?.scripts ?? {};
  const env = envVars(ctx, files);
  const t = (tid: string) => ctx.db.tables.get(tid)!;
  const rows: FactRow[] = [
    { label: "Talks to", items: out.map((e) => compChip(name(e.target)!, e.kind === "imports" ? undefined : e.reasons[0])) },
    { label: "Used by", items: inc.map((e) => compChip(name(e.source)!)) },
    { label: "Writes", items: writes.map((x) => tableChip(t(x))) },
    { label: "Reads", items: reads.map((x) => tableChip(t(x))) },
    { label: "Entry points", items: entries.map((f) => fileChip(ctx, f)) },
    { label: "Env vars", items: env.slice(0, 12).map((v) => ({ kind: "env" as const, label: v })) },
    { label: "Ports", items: (n.unit?.ports ?? []).map((p) => ({ kind: "text" as const, label: `:${p}` })) },
    { label: "Scripts", items: Object.keys(scripts).filter((s) => /^(dev|start|build|test|migrate|seed)/.test(s)).slice(0, 6).map((s) => ({ kind: "text" as const, label: s, sub: scripts[s].length > 28 ? undefined : scripts[s] })) },
  ];
  if (env.length > 12) rows[5].items.push({ kind: "text", label: `+${env.length - 12} more` });
  return rows.filter((r) => r.items.length);
}

export function sectionFacts(ctx: DocsCtx, members: string[]): FactRow[] {
  const inside = new Set(members);
  const comps = members.map((m) => ctx.cv.byId.get(m)!).filter(Boolean);
  const leaving = new Map<string, ArchNode>();
  const arriving = new Map<string, ArchNode>();
  for (const e of ctx.cv.edges) {
    if (inside.has(e.source) && !inside.has(e.target) && ctx.cv.byId.get(e.target)) leaving.set(e.target, ctx.cv.byId.get(e.target)!);
    if (inside.has(e.target) && !inside.has(e.source) && ctx.cv.byId.get(e.source)) arriving.set(e.source, ctx.cv.byId.get(e.source)!);
  }
  return [
    { label: "Parts", items: comps.map((c) => compChip(c, c.kind)) },
    { label: "Used by", items: [...arriving.values()].map((c) => compChip(c)) },
    { label: "Depends on", items: [...leaving.values()].map((c) => compChip(c)) },
  ].filter((r) => r.items.length);
}

/** The component a file belongs to, for "written by api". */
const ownerOf = (ctx: DocsCtx, fileId: string) => ctx.arch.byId.get(ctx.arch.fileUnit.get(fileId) ?? "");

export function dataFacts(ctx: DocsCtx, tables: string[]): FactRow[] {
  const ts = tables.map((id) => ctx.db.tables.get(id)!).filter(Boolean);
  const writers = new Map<string, ArchNode>();
  const readers = new Map<string, ArchNode>();
  for (const t of ts) {
    for (const f of t.writers) ownerOf(ctx, f) && writers.set(ownerOf(ctx, f)!.id, ownerOf(ctx, f)!);
    for (const f of t.readers) ownerOf(ctx, f) && readers.set(ownerOf(ctx, f)!.id, ownerOf(ctx, f)!);
  }
  for (const id of writers.keys()) readers.delete(id);
  return [
    { label: "Tables", items: ts.map((t) => ({ ...tableChip(t), sub: `${t.columns.length}` })) },
    { label: "Written by", items: [...writers.values()].map((c) => compChip(c)) },
    { label: "Read by", items: [...readers.values()].map((c) => compChip(c)) },
    { label: "Defined in", items: [...new Set(ts.map((t) => `${ctx.repoName(t.repoId)}/${t.source}`))].map((l) => (ctx.fileByLabel.get(l) ? fileChip(ctx, ctx.fileByLabel.get(l)!) : { kind: "text" as const, label: l })) },
  ].filter((r) => r.items.length);
}

/** "How to run it locally": what the scan knows about starting the system. */
export type CheckItem = { id: string; text: string; code?: string };
export function runChecklist(ctx: DocsCtx): CheckItem[] {
  const items: CheckItem[] = [];
  const infra = ctx.arch.nodes.filter((n) => n.infra);
  if (infra.length) items.push({ id: "compose", text: `Start the services from docker-compose (${infra.map((n) => n.name).join(", ")})`, code: "docker compose up -d" });
  const allFiles = new Set(ctx.graph.nodes.filter((n) => n.kind === "file").map((n) => n.id));
  const env = envVars(ctx, allFiles);
  if (env.length) items.push({ id: "env", text: `Set ${env.length} environment ${env.length === 1 ? "variable" : "variables"}, e.g. ${env.slice(0, 4).join(", ")}` });
  for (const r of ctx.project.repos) items.push({ id: `install:${r.id}`, text: `Install the dependencies of ${r.name}` });
  for (const n of ctx.arch.nodes.filter((n) => n.unit && n.layer <= 1)) {
    const scripts: Record<string, string> = ctx.nodes.get(n.id)?.meta?.scripts ?? {};
    const script = ["dev", "start", "serve"].find((s) => scripts[s]);
    if (script) items.push({ id: `run:${n.id}`, text: `Start ${n.name}${n.unit!.ports.length ? ` on port ${n.unit!.ports[0]}` : ""}`, code: `npm run ${script}` });
  }
  return items;
}

/** The two components a flow step connects, with what Strata knows about the connection. */
export function edgeBetween(ctx: DocsCtx, a: string, b: string): ArchEdge | undefined {
  return ctx.cv.edges.find((e) => e.source === a && e.target === b);
}
