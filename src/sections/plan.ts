import { invoke } from "@tauri-apps/api/core";
import type { Graph, Project } from "../api";
import type { ArchModel } from "../map/archModel";
import type { DbModel } from "../map/dbModel";
import type { CodeModel } from "../map/model";
import { hashOf } from "../summary/subjects";
import { ARCH_ROLE, ROLES } from "../arch/roles";

export type SectionLens = "code" | "arch" | "db";
/** `tier` is the section's column, left to right: on the architecture map the role (see ROLES), elsewhere 0 user-facing … 3 data & infrastructure. */
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
      items: a.nodes.map((n) => ({ id: n.id, line: `${n.name} [${n.kind}; role: ${ROLES[ARCH_ROLE[n.kind]]}] ${n.detail}${n.unit?.dir ? ` (${repoName(n.repoId)}/${n.unit.dir})` : ""}${about(n.id)}` })),
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
  arch: `This is the architecture map: group the components by architectural role, not by business domain. Each item says its role; the roles, left to right, are: ${ROLES.join(", ")}. Never put components with different roles in one section. Usually make one section per role; split a role into 2–3 sections only when it has many components with clearly different jobs (e.g. "Customer apps" and "Admin tools" within Clients). Name each section after its role or a more specific name for what's in it, and say in the description what these parts do in this project and what they talk to.`,
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
  // The marker invalidates plans stored under an older prompt ("roles": the architecture map groups by role).
  return { prompt, tokens, hash: hashOf(lens, lens === "arch" ? "roles" : "tiers", ...input.items.map((i) => i.line)) };
}

/**
 * Validates the model's JSON against the items it was given. With `roleOf` (the architecture
 * map), a section never mixes roles: mixed ones are split, and the role is the section's column.
 */
export function parsePlan(json: string, tokens: { token: string; id: string }[], roleOf?: (id: string) => number): Plan {
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
    const name = String(s?.name ?? "Section").slice(0, 40);
    const description = String(s?.description ?? "").slice(0, 200);
    if (roleOf) {
      const byRole = new Map<number, string[]>();
      for (const m of members) byRole.set(roleOf(m), [...(byRole.get(roleOf(m)) ?? []), m]);
      for (const [role, ms] of byRole) found.push({ name: byRole.size > 1 ? `${name} · ${ROLES[role]}` : name, description, tier: role, members: ms });
    } else {
      const t = Number(s?.tier);
      found.push({ name, description, tier: Number.isInteger(t) && t >= 0 && t <= 3 ? t : 1, members });
    }
  }
  const left = tokens.map((t) => t.id).filter((id) => !seen.has(id));
  if (left.length) {
    if (roleOf) for (const role of [...new Set(left.map(roleOf))]) found.push({ name: ROLES[role], description: "Parts the AI didn't place in a section.", tier: role, members: left.filter((id) => roleOf(id) === role) });
    else found.push({ name: "Other", description: "Items the AI didn't place in a section.", tier: 3, members: left });
  }
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
