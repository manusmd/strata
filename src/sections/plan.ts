import { invoke } from "@tauri-apps/api/core";
import type { Graph, Project } from "../api";
import type { ArchModel } from "../map/archModel";
import type { DbModel } from "../map/dbModel";
import type { CodeModel } from "../map/model";
import { hashOf } from "../summary/subjects";

export type SectionLens = "code" | "arch" | "db";
export type Section = { name: string; description: string; members: string[] };
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
  arch: "Group these architecture components into 3–7 sections by domain or responsibility, e.g. \"Customer apps\", \"Checkout & payments\", \"Identity\", \"Data & infrastructure\".",
  db: "Group these database tables into 3–10 sections by business domain, e.g. \"Members\", \"Billing\", \"Scheduling\", \"Auth\".",
  code: "Group these source folders into 4–12 sections by feature area or responsibility across repos, e.g. \"Checkout\", \"Member management\", \"Shared UI\", \"Build & tooling\". Folders of the same feature in different repos (frontend, backend, shared) belong together.",
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
  return { prompt, tokens, hash: hashOf(lens, ...input.items.map((i) => i.line)) };
}

/** Validates the model's JSON against the items it was given. */
export function parsePlan(json: string, tokens: { token: string; id: string }[]): Plan {
  const byToken = new Map(tokens.map((t) => [t.token, t.id]));
  const raw = JSON.parse(json);
  const sections: Section[] = [];
  const sectionOf = new Map<string, number>();
  for (const s of Array.isArray(raw?.sections) ? raw.sections : []) {
    const members: string[] = [];
    for (const m of Array.isArray(s?.members) ? s.members : []) {
      const id = byToken.get(String(m).trim());
      if (id && !sectionOf.has(id)) {
        sectionOf.set(id, sections.length);
        members.push(id);
      }
    }
    if (members.length) sections.push({ name: String(s?.name ?? "Section").slice(0, 40), description: String(s?.description ?? "").slice(0, 200), members });
  }
  const left = tokens.map((t) => t.id).filter((id) => !sectionOf.has(id));
  if (left.length) {
    for (const id of left) sectionOf.set(id, sections.length);
    sections.push({ name: "Other", description: "Items the AI didn't place in a section.", members: left });
  }
  if (!sections.length) throw new Error("The plan had no sections.");
  return { sections, sectionOf };
}

export async function requestPlan(projectId: string, lens: SectionLens, hash: string, prompt: string, model: string): Promise<string> {
  return invoke<string>("organize", { projectId, lens, hash, prompt, model });
}
