/** Plan vs. code: which planned components exist, which are missing, what the code has that the plan doesn't, and where it deviates. */
import type { Graph, Project } from "../api";
import type { ArchKind, ArchModel, ArchNode } from "../map/archModel";
import { normalizePlan, slug, type Plan, type PlanComponent, type PlanConnection, type PlanType } from "./model";

export type DriftStatus = "BUILT" | "MISSING" | "UNPLANNED" | "DIFFERENT";
export type Finding = { component: string; text: string; detail: string; file?: string; edge?: { from: string; to: string; kind: "calls" | "data" } };
export type Drift = {
  /** Plan component id → the architecture node it was found as. */
  matches: Map<string, ArchNode>;
  status: Map<string, DriftStatus>;
  missing: PlanComponent[];
  unplanned: ArchNode[];
  findings: Finding[];
  tables: { planned: number; found: string[]; missing: string[] };
  /** Code connections that involve unplanned parts (plan ids or `code:` ids), for drawing and "Update plan from code". */
  codeEdges: { from: string; to: string; kind: "calls" | "data" }[];
};

const norm = (s: string) => s.toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9]/g, "");
const tableNorm = (s: string) => norm(s).replace(/s$/, "");
const dirNorm = (s: string) => s.replace(/^\.?\//, "").replace(/\/$/, "").toLowerCase();

const COMPATIBLE: Record<PlanType, ArchKind[]> = {
  App: ["App", "Extension", "CLI"],
  Service: ["Service", "App", "Worker"],
  Worker: ["Worker", "Service", "CLI"],
  Library: ["Library"],
  Database: ["Database", "Infra", "Storage", "Search"],
  Queue: ["Queue", "Cache", "Infra"],
  External: ["External", "AI", "Mail", "Storage", "Search", "Proxy"],
};
// Engines and products that go by several names.
const ALIASES: [RegExp, string][] = [
  [/^(postgres|postgresql|pg|psql)/, "postgres"],
  [/^(mongo|mongodb)/, "mongo"],
  [/^(redis|bullmq|valkey)/, "redis"],
  [/^(mysql|mariadb)/, "mysql"],
  [/^(s3|awss3)/, "s3"],
];
const alias = (s: string) => ALIASES.find(([re]) => re.test(s))?.[1] ?? s;

/** How sure we are that a code node is this planned component (0 = not at all). */
function score(c: PlanComponent, n: ArchNode, repoName: string | undefined): number {
  if (!COMPATIBLE[c.type].includes(n.kind)) return 0;
  const lives = c.lives ? dirNorm(c.lives) : "";
  if (n.unit && lives) {
    const dir = dirNorm(n.unit.dir);
    if (dir && dir === lives) return 100;
    if (!dir && repoName && lives.split("/").pop() === repoName.toLowerCase()) return 90;
  }
  const mine = [c.name, c.id, ...(c.tech ?? []).filter(() => c.type === "Database" || c.type === "Queue" || c.type === "External")].map(norm).filter(Boolean);
  const theirs = [n.name, n.unit?.packageName, n.unit?.dir.split("/").pop(), !n.unit?.dir ? repoName : undefined, n.datastore?.engine, n.infra?.image?.split(":")[0]]
    .filter((x): x is string => !!x)
    .map(norm)
    .filter(Boolean);
  let best = 0;
  for (const a of mine)
    for (const b of theirs) {
      if (a === b || alias(a) === alias(b)) best = Math.max(best, 80);
      else if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) best = Math.max(best, 50);
    }
  return best;
}

const planType = (k: ArchKind): PlanType =>
  k === "App" || k === "Extension" || k === "CLI" ? "App" : k === "Worker" ? "Worker" : k === "Library" ? "Library" : k === "Database" || k === "Storage" || k === "Search" ? "Database" : k === "Queue" || k === "Cache" ? "Queue" : k === "Service" ? "Service" : "External";

export function computeDrift(plan: Plan, arch: ArchModel, graph: Graph, project: Project): Drift {
  const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name;
  const candidates = arch.nodes.filter((n) => n.kind !== "Missing" && (n.kind !== "Infra" || n.datastore || /redis|rabbit|kafka|nats/i.test(n.name + (n.infra?.image ?? ""))));

  // Best pairs first; every node and every component matches at most once.
  const pairs: { c: PlanComponent; n: ArchNode; s: number }[] = [];
  for (const c of plan.components) for (const n of candidates) {
    const s = score(c, n, repoName(n.repoId));
    if (s >= 50) pairs.push({ c, n, s });
  }
  pairs.sort((a, b) => b.s - a.s);
  const matches = new Map<string, ArchNode>();
  const taken = new Set<string>();
  for (const { c, n } of pairs) {
    if (matches.has(c.id) || taken.has(n.id)) continue;
    matches.set(c.id, n);
    taken.add(n.id);
  }
  const planOf = new Map([...matches].map(([cid, n]) => [n.id, cid]));
  const name = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id;
  const findings: Finding[] = [];

  // 1. Connections in the code between planned components that the plan doesn't have.
  const planned = (a: string, b: string) => plan.connections.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  const seenEdge = new Set<string>();
  for (const e of arch.edges) {
    // Requests and data access; SDK usage ("uses") counts when it reaches an external service or a store.
    const targetKind = arch.byId.get(e.target)?.kind;
    const reaches = !!targetKind && ["External", "AI", "Mail", "Storage", "Search", "Database", "Queue", "Cache", "Infra"].includes(targetKind);
    if (e.kind !== "calls" && e.kind !== "data" && !(e.kind === "uses" && reaches)) continue;
    const a = planOf.get(e.source), b = planOf.get(e.target);
    if (!a || !b || a === b || planned(a, b) || seenEdge.has(`${a}>${b}`)) continue;
    seenEdge.add(`${a}>${b}`);
    const target = plan.components.find((c) => c.id === b)!;
    const others = plan.connections.filter((x) => x.to === b && x.from !== a).map((x) => name(x.from));
    findings.push({
      component: a,
      text: `${name(a)} ${e.kind === "data" ? "uses" : "talks to"} ${target.name} directly`,
      // e.g. "api talks to Stripe directly" — "The plan says only billing-service does."
      detail: others.length ? `The plan says only ${others.join(" and ")} ${others.length === 1 ? "does" : "do"}.` : "The plan has no such connection.",
      file: e.files[0] ? graph.nodes.find((n) => n.id === e.files[0])?.path ?? undefined : undefined,
      edge: { from: a, to: b, kind: e.kind === "data" || targetKind === "Database" ? "data" : "calls" },
    });
  }

  // 2. Tables used by a component other than their planned owner.
  const plannedTables = new Map((plan.tables ?? []).map((t) => [tableNorm(t.name), t]));
  const tableNodes = graph.nodes.filter((n) => n.kind === "table");
  const seenTable = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== "reads" && e.kind !== "writes") continue;
    const tn = tableNodes.find((t) => t.id === e.dst);
    const t = tn && plannedTables.get(tableNorm(tn.name));
    const unit = arch.fileUnit.get(e.src);
    const comp = unit ? planOf.get(unit) : undefined;
    if (!t?.owner || !comp || comp === t.owner || seenTable.has(`${comp}:${t.id}`)) continue;
    seenTable.add(`${comp}:${t.id}`);
    findings.push({
      component: comp,
      text: `${name(comp)} ${e.kind} ${t.name} directly`,
      detail: `The plan says ${name(t.owner)} owns it.`,
      file: graph.nodes.find((n) => n.id === e.src)?.path ?? undefined,
    });
  }

  const status = new Map<string, DriftStatus>();
  for (const c of plan.components) status.set(c.id, !matches.has(c.id) ? "MISSING" : findings.some((f) => f.component === c.id) ? "DIFFERENT" : "BUILT");
  const unplanned = candidates.filter((n) => !taken.has(n.id) && n.kind !== "Library");
  const unplannedIds = new Set(unplanned.map((n) => n.id));
  const endpoint = (id: string) => planOf.get(id) ?? (unplannedIds.has(id) ? codeId(arch.byId.get(id)!) : null);
  const codeEdges: Drift["codeEdges"] = [];
  for (const e of arch.edges) {
    if (!unplannedIds.has(e.source) && !unplannedIds.has(e.target)) continue;
    const tk = arch.byId.get(e.target)?.kind;
    const reaches = !!tk && ["External", "AI", "Mail", "Storage", "Search", "Database", "Queue", "Cache", "Infra"].includes(tk);
    if (e.kind !== "calls" && e.kind !== "data" && !(e.kind === "uses" && reaches)) continue;
    const a = endpoint(e.source), b = endpoint(e.target);
    if (a && b && a !== b && !codeEdges.some((x) => x.from === a && x.to === b)) codeEdges.push({ from: a, to: b, kind: e.kind === "data" || tk === "Database" ? "data" : "calls" });
  }
  const codeTables = new Set(tableNodes.map((t) => tableNorm(t.name)));
  const pts = plan.tables ?? [];
  return {
    matches,
    status,
    missing: plan.components.filter((c) => !matches.has(c.id)),
    // What the code has that the plan doesn't (shared libraries are left out: they're rarely planned).
    unplanned,
    codeEdges,
    findings,
    tables: { planned: pts.length, found: pts.filter((t) => codeTables.has(tableNorm(t.name))).map((t) => t.name), missing: pts.filter((t) => !codeTables.has(tableNorm(t.name))).map((t) => t.name) },
  };
}

export const codeId = (n: ArchNode) => `code:${n.id}`;

/** The plan plus what only the code has, for drawing the comparison. */
export function comparePlan(plan: Plan, drift: Drift): { plan: Plan; badges: Map<string, DriftStatus> } {
  const extra: PlanComponent[] = drift.unplanned.map((n) => ({ id: codeId(n), name: n.name, type: planType(n.kind), tech: n.detail ? [n.detail] : undefined, lives: n.unit?.dir || undefined }));
  const edges: PlanConnection[] = [
    ...drift.findings.filter((f) => f.edge).map((f) => ({ from: f.edge!.from, to: f.edge!.to, label: "in code", kind: f.edge!.kind })),
    ...drift.codeEdges.map((e) => ({ from: e.from, to: e.to, label: "in code", kind: e.kind })),
  ];
  const badges = new Map<string, DriftStatus>([...drift.status, ...extra.map((c) => [c.id, "UNPLANNED"] as const)]);
  return { plan: { ...plan, components: [...plan.components, ...extra], connections: [...plan.connections, ...edges] }, badges };
}

/** "Update plan from code": adds what the code has (components and the extra connections), keeps everything planned. */
export function planFromCode(plan: Plan, drift: Drift): Plan {
  const { plan: merged } = comparePlan(plan, drift);
  // Code-only components get readable ids from their names (unique within the plan).
  const ids = new Map<string, string>();
  const used = new Set(plan.components.map((c) => c.id));
  for (const c of merged.components) {
    if (!c.id.startsWith("code:")) continue;
    let id = slug(c.name);
    for (let i = 2; used.has(id); i++) id = `${slug(c.name)}-${i}`;
    used.add(id);
    ids.set(c.id, id);
  }
  const fix = (id: string) => ids.get(id) ?? id;
  return normalizePlan({
    ...plan,
    components: merged.components.map((c) => ({ ...c, id: fix(c.id) })),
    connections: merged.connections.map((e) => ({ ...e, from: fix(e.from), to: fix(e.to), label: e.label === "in code" ? undefined : e.label })),
  });
}

/** The comparison as text, for Claude. */
export function driftReport(plan: Plan, drift: Drift) {
  const name = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id;
  const lines = [`Built: ${[...drift.matches].map(([id, n]) => `${name(id)} (found as ${n.name}${n.unit?.dir ? ` in ${n.unit.dir}` : ""})`).join(", ") || "nothing yet"}.`];
  if (drift.missing.length) lines.push(`Missing in the code: ${drift.missing.map((c) => c.name).join(", ")}.`);
  if (drift.unplanned.length) lines.push(`In the code but not in the plan: ${drift.unplanned.map((n) => `${n.name} (${n.kind})`).join(", ")}.`);
  for (const f of drift.findings) lines.push(`Deviation: ${f.text}. ${f.detail}${f.file ? ` Found in ${f.file}.` : ""}`);
  if (drift.tables.planned) lines.push(`Planned tables found in the schema: ${drift.tables.found.length} of ${drift.tables.planned}${drift.tables.missing.length ? ` (missing: ${drift.tables.missing.join(", ")})` : ""}.`);
  return lines.join("\n");
}
