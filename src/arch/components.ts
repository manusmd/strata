import type { Graph } from "../api";
import type { ArchModel, ArchNode } from "../map/archModel";

/**
 * C4 level 3: the components inside one container, from the conventions of its framework
 * (Next.js routes, feature modules, NestJS modules, components/), else its top-level folders.
 */
export type CompKind = "Pages" | "API routes" | "Feature module" | "UI components" | "Code";
export type Component = {
  id: string;
  name: string;
  kind: CompKind;
  /** Folder the component lives in, relative to the repo (for the code map and the file list). */
  dir: string;
  files: string[];
  /** What's inside: "4 controllers · 3 services". */
  detail: string;
};
/** Something outside the container a component uses: a library, datastore, external system or other container. */
export type Outside = { id: string; node: ArchNode };
export type CompEdge = { id: string; source: string; target: string; weight: number; label: string; kind: "imports" | "data" | "calls" | "uses" };
export type ComponentModel = { components: Component[]; outside: Outside[]; edges: CompEdge[]; compOf: Map<string, string> };

export const COMP_COLUMN: Record<CompKind, number> = { Pages: 0, "API routes": 0, "UI components": 1, "Feature module": 1, Code: 2 };
export const COMP_COLOR: Record<CompKind, string> = { Pages: "#8B5CF6", "API routes": "#6366F1", "Feature module": "#A78BFA", "UI components": "#C084FC", Code: "#9B9A97" };

const TEST = /(^|\/)(tests?|__tests__|__mocks__|playwright|e2e|cypress|fixtures?)(\/|$)|\.(test|spec|stories)\.[tj]sx?$/;
const FEATURE_ROOTS = new Set(["modules", "features", "domains", "platform"]);
const routeSeg = (s: string) => !/^\(.*\)$/.test(s) && !/^@/.test(s);
const pretty = (s: string) => s.replace(/^\[+\.*|\]+$/g, "").replace(/[-_]/g, " ");

/** The component a file belongs to: [key, name, kind, dir relative to the container]. */
function keyOf(rel: string): [string, string, CompKind, string] {
  const src = rel.startsWith("src/") ? "src/" : "";
  const r = rel.slice(src.length);
  const parts = r.split("/");
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  // Next.js app router: route.ts is an API route, everything else a page; grouped by the first real segment.
  if (dirs[0] === "app") {
    const segs = dirs.slice(1).filter(routeSeg);
    if (/^route\.[tj]s$/.test(file) || segs[0] === "api") {
      const seg = segs[0] === "api" ? segs[1] ?? "api" : segs[0] ?? "/";
      return [`api:${seg}`, `${pretty(seg)} API`, "API routes", `${src}app`];
    }
    const seg = segs[0] ?? "/";
    return [`pages:${seg}`, seg === "/" ? "Home pages" : `${pretty(seg)} pages`, "Pages", `${src}app`];
  }
  if (dirs[0] === "pages") {
    if (dirs[1] === "api") return [`api:${dirs[2] ?? "api"}`, `${pretty(dirs[2] ?? "api")} API`, "API routes", `${src}pages/api`];
    const seg = dirs[1] ?? (file.replace(/\.[tj]sx?$/, "") === "index" ? "/" : file.replace(/\.[tj]sx?$/, ""));
    return [`pages:${seg}`, seg === "/" ? "Home pages" : `${pretty(seg)} pages`, "Pages", `${src}pages`];
  }
  if (FEATURE_ROOTS.has(dirs[0]) && dirs[1]) return [`module:${dirs[0]}/${dirs[1]}`, dirs[0] === "platform" ? `${dirs[1]} (platform)` : dirs[1], "Feature module", `${src}${dirs[0]}/${dirs[1]}`];
  if (dirs[0] === "components") {
    const sub = dirs[1] && dirs[1] !== "ui" ? dirs[1] : null;
    return [`ui:${sub ?? "components"}`, sub ? `${pretty(sub)} UI` : "UI components", "UI components", `${src}components${dirs[1] ? `/${dirs[1]}` : ""}`];
  }
  if (!dirs.length) return ["code:(root)", "Entry & config", "Code", src.replace(/\/$/, "")];
  return [`code:${dirs[0]}`, dirs[0], "Code", `${src}${dirs[0]}`];
}

// Matched against the path inside the container, so a container under apps/api/ isn't all "API handlers".
const ROLES: [RegExp, string][] = [
  [/controller\.[tj]s$/i, "controllers"],
  [/service\.[tj]s$/i, "services"],
  [/(repository|repo)\.[tj]s$/i, "repositories"],
  [/\.module\.[tj]s$/i, "modules"],
  [/(^|\/)route\.[tj]s$|(^|\/)pages\/api\//, "API handlers"],
  [/(^|\/)(page|layout)\.[tj]sx$|(^|\/)pages\//, "pages"],
  [/(^|\/)use[A-Z][\w]*\.[tj]sx?$/, "hooks"],
  [/\.dto\.[tj]s$|\/dtos?\//i, "DTOs"],
  [/\.tsx$/, "React components"],
];

export function buildComponents(container: ArchNode, full: ArchModel, graph: Graph, files: string[]): ComponentModel {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const base = container.unit?.dir ? `${container.unit.dir}/` : "";
  const groups = new Map<string, Component>();
  const compOf = new Map<string, string>();
  for (const f of files) {
    const path = nodeById.get(f)?.path ?? "";
    const rel = path.startsWith(base) ? path.slice(base.length) : path;
    if (TEST.test(rel)) continue;
    const [key, name, kind, dir] = keyOf(rel);
    const c = groups.get(key) ?? { id: `comp:${key}`, name, kind, dir: `${base}${dir}`.replace(/\/$/, ""), files: [], detail: "" };
    c.files.push(f);
    groups.set(key, c);
  }
  // Tiny groups join an "Other …" of their kind; a long tail is folded too, so the view stays readable.
  let comps = [...groups.values()].sort((a, b) => b.files.length - a.files.length);
  const keep = new Set(comps.filter((c, i) => c.files.length >= 3 && i < 16).map((c) => c.id));
  const merged = new Map<string, Component>();
  for (const c of comps) {
    if (keep.has(c.id)) {
      merged.set(c.id, c);
      continue;
    }
    const id = `comp:other:${c.kind}`;
    const o = merged.get(id) ?? { id, name: `Other ${c.kind.toLowerCase()}`, kind: c.kind, dir: base.replace(/\/$/, ""), files: [], detail: "" };
    o.files.push(...c.files);
    merged.set(id, o);
  }
  comps = [...merged.values()];
  for (const c of comps) {
    for (const f of c.files) compOf.set(f, c.id);
    const counts = new Map<string, number>();
    for (const f of c.files) {
      const full = nodeById.get(f)?.path ?? "";
      const p = full.startsWith(base) ? full.slice(base.length) : full;
      const role = ROLES.find(([re]) => re.test(p))?.[1];
      if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${n} ${r}`);
    c.detail = [`${c.files.length} files`, ...top].join(" · ");
  }

  // Lines between components: file imports, counted.
  const edges = new Map<string, CompEdge>();
  const add = (source: string, target: string, kind: CompEdge["kind"], label: (n: number) => string) => {
    if (source === target) return;
    const id = `${source}>${target}`;
    const e = edges.get(id) ?? { id, source, target, weight: 0, label: "", kind };
    e.weight++;
    e.label = label(e.weight);
    edges.set(id, e);
  };
  for (const e of graph.edges) {
    if (e.kind !== "imports") continue;
    const a = compOf.get(e.src);
    const b = compOf.get(e.dst);
    if (a && b) add(a, b, "imports", (n) => `${n} ${n === 1 ? "import" : "imports"}`);
  }

  // What each component uses outside: the container's own lines, split by the files behind them.
  const outside = new Map<string, Outside>();
  for (const e of full.edges) {
    if (e.source !== container.id) continue;
    const target = full.byId.get(e.target);
    if (!target) continue;
    for (const f of e.files) {
      const c = compOf.get(f);
      if (!c) continue;
      outside.set(target.id, { id: target.id, node: target });
      const kind = e.kind === "data" ? "data" : e.kind === "calls" ? "calls" : e.kind === "imports" ? "imports" : "uses";
      add(c, target.id, kind, (n) => (kind === "data" ? "SQL" : kind === "imports" ? `${n} ${n === 1 ? "import" : "imports"}` : kind === "calls" ? "HTTP" : "uses"));
    }
  }
  return { components: comps, outside: [...outside.values()], edges: [...edges.values()], compOf };
}
