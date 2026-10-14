import { invoke } from "@tauri-apps/api/core";
import type { Graph, Project } from "../api";
import type { ArchModel } from "../map/archModel";
import type { DbModel } from "../map/dbModel";
import type { CodeModel } from "../map/model";
import { hashOf } from "../summary/subjects";

export type SectionLens = "code" | "arch" | "db";
/** `tier` is the section's column, left to right: 0 user-facing clients, 1 APIs & services, 2 workers & shared code, 3 data, infra & external. */
export type Section = { name: string; description: string; tier: number; members: string[] };
/** A validated plan: every item in exactly one section. */
export type Plan = { sections: Section[]; sectionOf: Map<string, number> };

type Item = { id: string; line: string };

/** Items of a lens as short lines; ids become short tokens so the model can't mangle them. */
export function planInput(lens: SectionLens, project: Project, _graph: Graph, models: { code?: CodeModel; arch?: ArchModel; db?: DbModel }, summaries: Map<string, string>): { items: Item[]; extra: string[] } {
  const about = (id: string) => (summaries.get(id) ? ` — ${summaries.get(id)}` : "");
  const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name ?? "";
  if (lens === "arch" && models.arch) {
    const a = models.arch;
    const name = (id: string) => a.byId.get(id)?.name ?? id;
    return {
      items: a.nodes.map((n) => ({ id: n.id, line: `${n.name} [${n.kind}] ${n.detail}${n.unit?.dir ? ` (${repoName(n.repoId)}/${n.unit.dir})` : ""}${about(n.id)}` })),
      extra: ["Connections:", ...a.edges.slice(0, 120).map((e) => `${name(e.source)} → ${name(e.target)} (${e.kind})`)],
    };
  }
  if (lens === "db" && models.db) {
    const d = models.db;
    return {
      items: [...d.tables.values()].map((t) => ({
        id: t.id,
        line: `${t.name}: ${t.columns.slice(0, 12).map((c) => c.name).join(", ")}${t.columns.length > 12 ? ", …" : ""}${t.columns.some((c) => c.fk) ? ` | refs ${[...new Set(t.columns.filter((c) => c.fk).map((c) => c.fk!.table))].join(", ")}` : ""}${about(t.id)}`,
      })),
      extra: [],
    };
  }
  if (lens === "code" && models.code) {
    const c = models.code;
    return {
      items: [...c.clusters.values()].map((cl) => {
        const exported = cl.files.flatMap((f) => f.symbols.filter((s) => s.meta?.exported).map((s) => s.name)).slice(0, 8);
        return { id: cl.id, line: `${repoName(cl.repoId)}/${cl.dir || "."} (${cl.files.length} files${exported.length ? `; exports ${exported.join(", ")}` : ""})${about(cl.id)}` };
      }),
      extra: [],
    };
  }
  return { items: [], extra: [] };
}

const SECTION_HINT: Record<SectionLens, string> = {
  arch: "Group these architecture components into 3–7 sections by domain or responsibility, e.g. \"Customer apps\" (tier 0), \"Checkout & payments\" (tier 1), \"Background jobs\" (tier 2), \"Data & infrastructure\" (tier 3). Keep frontends and clients out of backend sections so they can sit on the left.",
  db: "Group these database tables into 3–10 sections by business domain, e.g. \"Members\", \"Billing\", \"Scheduling\", \"Auth\". Tier: 0 for what users see and edit directly (accounts, profiles, content), 1 for core business data, 2 for jobs, events and logs, 3 for system and reference tables.",
  code: "Group these source folders into 4–12 sections by feature area or responsibility across repos, e.g. \"Storefront\" (tier 0), \"Checkout\" (tier 1), \"Shared UI\" (tier 2), \"Build & tooling\" (tier 3). Folders of the same feature in different repos (frontend, backend, shared) belong together; give a feature the tier of its most user-facing part.",
};

export function buildPlanRequest(lens: SectionLens, project: Project, input: { items: Item[]; extra: string[] }) {
  const tokens = input.items.map((it, i) => ({ token: `i${i + 1}`, ...it }));
  const prompt = [
    `Project "${project.name}". ${SECTION_HINT[lens]}`,
    "Use the ids exactly as given (like i12).",
    "",
    "Items:",
    ...tokens.map((t) => `${t.token}: ${t.line}`),
    ...(input.extra.length ? ["", ...input.extra] : []),
  ].join("\n");
  // "tiers" invalidates plans stored before sections had a column.
  return { prompt, tokens, hash: hashOf(lens, "tiers", ...input.items.map((i) => i.line)) };
}

/** Validates the model's JSON against the items it was given. `tierOf` measures a section's column from its members and wins over the model's guess. */
export function parsePlan(json: string, tokens: { token: string; id: string }[], tierOf?: (members: string[]) => number): Plan {
  const byToken = new Map(tokens.map((t) => [t.token, t.id]));
  const raw = JSON.parse(json);
  const seen = new Set<string>();
  const found: Section[] = [];
  for (const s of Array.isArray(raw?.sections) ? raw.sections : []) {
    const members: string[] = [];
    for (const m of Array.isArray(s?.members) ? s.members : []) {
      const id = byToken.get(String(m).trim());
      if (id && !seen.has(id)) {
        seen.add(id);
        members.push(id);
      }
    }
    if (!members.length) continue;
    const t = Number(s?.tier);
    const tier = tierOf ? tierOf(members) : Number.isInteger(t) && t >= 0 && t <= 3 ? t : 1;
    found.push({ name: String(s?.name ?? "Section").slice(0, 40), description: String(s?.description ?? "").slice(0, 200), tier, members });
  }
  const left = tokens.map((t) => t.id).filter((id) => !seen.has(id));
  if (left.length) found.push({ name: "Other", description: "Items the AI didn't place in a section.", tier: tierOf?.(left) ?? 3, members: left });
  // Left to right: by tier, keeping the model's order within a tier.
  const sections = found.map((s, i) => ({ s, i })).sort((a, b) => a.s.tier - b.s.tier || a.i - b.i).map(({ s }) => s);
  const sectionOf = new Map<string, number>();
  sections.forEach((s, i) => s.members.forEach((id) => sectionOf.set(id, i)));
  if (!sections.length) throw new Error("The plan had no sections.");
  return { sections, sectionOf };
}

export async function requestPlan(projectId: string, lens: SectionLens, hash: string, prompt: string, model: string): Promise<string> {
  return invoke<string>("organize", { projectId, lens, hash, prompt, model });
}
