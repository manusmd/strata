import type { ArchNode } from "../map/archModel";
import { ARCH_ROLE } from "../arch/roles";
import type { DocsCtx } from "./outline";

/** A screen of an app: its URL, the file that renders it, and what it's built from. */
export type Screen = {
  path: string;
  fileId: string;
  /** Feature modules and UI folders the page pulls in ("bookings", "data-table"). */
  uses: string[];
  /** Tables the screen reaches through its imports (two steps deep). */
  tables: string[];
};

/** The URL of a page file, by framework convention; null when it isn't a page. */
export function routeOf(rel: string): string | null {
  const r = rel.replace(/^src\//, "");
  const clean = (segs: string[]) =>
    "/" +
    segs
      .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@") && !s.startsWith("_"))
      .map((s) => s.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, ":$1*").replace(/^\[(\w+)\]$/, ":$1").replace(/^\$(\w+)$/, ":$1"))
      .join("/");
  // Next.js app router: app/(group)/settings/[id]/page.tsx
  let m = r.match(/^app\/(.*?)\/?page\.[tj]sx?$/);
  if (m) return clean(m[1].split("/"));
  // Next.js pages router: pages/settings/index.tsx (not api/, not _app/_document)
  m = r.match(/^pages\/(?!api\/)(.+)\.[tj]sx?$/);
  if (m) {
    const segs = m[1].split("/");
    if (segs[segs.length - 1].startsWith("_")) return null;
    if (segs[segs.length - 1] === "index") segs.pop();
    return clean(segs);
  }
  // Remix flat routes: app/routes/settings.profile.$id.tsx
  m = r.match(/^(?:app\/)?routes\/([^/]+?)(?:\/route)?\.[tj]sx?$/);
  if (m) return clean(m[1].split(".").map((s) => (s === "_index" ? "" : s)));
  return null;
}

// Feature folders only: UI primitives (components/button…) say nothing about what a screen is for.
const FEATURE = /(?:^|\/)(?:modules|features|domains)\/([^/.]+)\//;

/** Every screen of every app, from its page files. */
export function screensOf(ctx: DocsCtx): { app: ArchNode; screens: Screen[] }[] {
  const imports = new Map<string, string[]>();
  for (const e of ctx.graph.edges) if (e.kind === "imports" && !e.dst.startsWith("pkg:")) imports.set(e.src, [...(imports.get(e.src) ?? []), e.dst]);
  const tablesOf = new Map<string, Set<string>>();
  for (const e of ctx.graph.edges)
    if (e.kind === "reads" || e.kind === "writes") {
      const t = ctx.db.tables.get(e.dst)?.name;
      if (t) tablesOf.set(e.src, (tablesOf.get(e.src) ?? new Set()).add(t));
    }

  const out: { app: ArchNode; screens: Screen[] }[] = [];
  for (const app of ctx.cv.nodes.filter((n) => n.unit && ARCH_ROLE[n.kind] === 0)) {
    const base = app.unit!.dir ? `${app.unit!.dir}/` : "";
    const screens: Screen[] = [];
    for (const [fileId, unit] of ctx.arch.fileUnit) {
      if (unit !== app.id) continue;
      const f = ctx.nodes.get(fileId);
      const rel = f?.path?.startsWith(base) ? f.path.slice(base.length) : f?.path ?? "";
      const path = routeOf(rel);
      if (!path) continue;
      // What the page pulls in, two imports deep: feature folders and the tables they touch.
      const seen = new Set([fileId]);
      let frontier = [fileId];
      for (let depth = 0; depth < 2; depth++) {
        const next: string[] = [];
        for (const x of frontier) for (const y of imports.get(x) ?? []) if (!seen.has(y)) (seen.add(y), next.push(y));
        frontier = next;
      }
      const uses = new Set<string>();
      const tables = new Set<string>();
      for (const x of seen) {
        const p = ctx.nodes.get(x)?.path ?? "";
        const feat = p.match(FEATURE)?.[1];
        if (feat && x !== fileId) uses.add(feat);
        for (const t of tablesOf.get(x) ?? []) tables.add(t);
      }
      screens.push({ path, fileId, uses: [...uses].slice(0, 6), tables: [...tables].slice(0, 6) });
    }
    // One catch-all route (a docs site's "/:slug*") says nothing about where to do what.
    if (screens.length >= 2) out.push({ app, screens: screens.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return out;
}

/** Screens of one app by area (first URL segment), the big areas on their own page, the rest together. */
export function screenAreas(screens: Screen[]): { area: string; screens: Screen[] }[] {
  const by = new Map<string, Screen[]>();
  for (const s of screens) {
    const area = s.path.split("/")[1] || "home";
    by.set(area, [...(by.get(area) ?? []), s]);
  }
  const big = [...by].filter(([, s]) => s.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  const bigSet = new Set(big.map(([a]) => a));
  const rest = [...by].filter(([a]) => !bigSet.has(a)).flatMap(([, s]) => s);
  const areas = big.map(([area, s]) => ({ area, screens: s.slice(0, 30) }));
  if (rest.length) areas.push({ area: big.length ? "more" : "all", screens: rest.slice(0, 30) });
  return areas;
}
