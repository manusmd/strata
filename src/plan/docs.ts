/** Markdown guidelines generated from a plan: for the humans and the coding agents who build it. */
import type { PlanBrief } from "../api";
import type { Decision, Plan, PlanComponent, PlanTable } from "./model";

export type DocFile = { path: string; content: string; title: string; group: "root" | "docs" | "decisions" | "components" | "internal" };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "decision";
/** "a", "a and b", "a, b and c". */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const code = (s: string) => `\`${s}\``;

/** Where a component's code goes, if it's a folder (not a managed service). */
const folderOf = (c: PlanComponent) => {
  const l = c.lives?.trim();
  if (!l || /managed|saas|hosted|external/i.test(l) || c.type === "External") return null;
  return l.replace(/^\.?\//, "").replace(/\/$/, "");
};

/* ---------- Mermaid ---------- */

const mid = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");
const mlabel = (s: string) => s.replace(/"/g, "'");

export function mermaid(plan: Plan) {
  const shape = (c: PlanComponent) => {
    const l = `"${mlabel(c.name)}"`;
    if (c.type === "Database") return `${mid(c.id)}[(${l})]`;
    if (c.type === "Queue") return `${mid(c.id)}[[${l}]]`;
    if (c.type === "External") return `${mid(c.id)}([${l}])`;
    if (c.type === "App") return `${mid(c.id)}[/${l}/]`;
    return `${mid(c.id)}[${l}]`;
  };
  const lines = ["flowchart LR", ...plan.components.map((c) => `  ${shape(c)}`)];
  for (const e of plan.connections) {
    const arrow = e.kind === "queue" || e.kind === "uses" ? "-.->" : "-->";
    lines.push(`  ${mid(e.from)} ${arrow}${e.label ? `|"${mlabel(e.label)}"|` : ""} ${mid(e.to)}`);
  }
  return lines.join("\n");
}

/* ---------- Rules derived from the plan ---------- */

/** Boundaries the plan implies: table ownership, who talks to external services, queues, folders. */
export function rules(plan: Plan): string[] {
  const name = new Map(plan.components.map((c) => [c.id, c.name]));
  const out: string[] = [];
  const owners = new Map<string, PlanTable[]>();
  for (const t of plan.tables ?? []) if (t.owner) owners.set(t.owner, [...(owners.get(t.owner) ?? []), t]);
  for (const [owner, ts] of owners) {
    out.push(`${code(name.get(owner) ?? owner)} owns the ${ts.length === 1 ? "table" : "tables"} ${list(ts.map((t) => code(t.name)))}. Other components don't read or write them directly; they go through ${code(name.get(owner) ?? owner)}.`);
  }
  for (const ext of plan.components.filter((c) => c.type === "External")) {
    const callers = [...new Set(plan.connections.filter((e) => e.to === ext.id).map((e) => e.from))].map((id) => code(name.get(id) ?? id));
    if (callers.length) out.push(`Only ${list(callers)} ${callers.length === 1 ? "talks" : "talk"} to ${ext.name}. Don't call it from anywhere else.`);
  }
  for (const q of plan.components.filter((c) => c.type === "Queue")) {
    const producers = plan.connections.filter((e) => e.to === q.id && /enqueue|publish|produce|send/i.test(e.label ?? "") ).map((e) => name.get(e.from) ?? e.from);
    const consumers = plan.connections.filter((e) => e.to === q.id && !/enqueue|publish|produce|send/i.test(e.label ?? "")).map((e) => name.get(e.from) ?? e.from);
    out.push(
      `Slow or background work goes through ${code(q.name)}${producers.length ? ` (enqueued by ${list(producers.map(code))}` : ""}${consumers.length ? `${producers.length ? ", " : " ("}consumed by ${list(consumers.map(code))}` : ""}${producers.length || consumers.length ? ")" : ""}. Jobs must be idempotent and safe to retry.`,
    );
  }
  for (const c of plan.components) {
    const f = folderOf(c);
    if (f) out.push(`${code(c.name)} lives in ${code(f + "/")}; keep its code there.`);
  }
  out.push("If the code and the plan disagree, ask before changing either. Record new architecture decisions in `docs/decisions/`.");
  return out;
}

/* ---------- Files ---------- */

const header = (title: string, meta: string) => `# ${title}\n\n*${meta}*\n`;

function architecture(name: string, brief: PlanBrief | null | undefined, plan: Plan, meta: string, adrPath: (d: Decision) => string) {
  const byId = new Map(plan.components.map((c) => [c.id, c]));
  const parts = [header(`${name} — Architecture`, meta)];
  if (brief?.idea) parts.push(brief.idea.trim() + "\n");
  parts.push("## Diagram\n\n```mermaid\n" + mermaid(plan) + "\n```\n");
  parts.push("## Components\n");
  for (const c of plan.components) {
    const lines = [`### ${c.name}\n`, `${c.type}${c.tech?.length ? ` · ${c.tech.join(", ")}` : ""}${c.lives ? ` · ${code(c.lives)}` : ""}\n`];
    if (c.resp) lines.push(c.resp + "\n");
    const out = plan.connections.filter((e) => e.from === c.id);
    if (out.length) lines.push(out.map((e) => `- → ${byId.get(e.to)?.name ?? e.to}${e.label ? ` (${e.label})` : ""}`).join("\n") + "\n");
    const tables = (plan.tables ?? []).filter((t) => t.owner === c.id);
    if (tables.length) lines.push(`Owns: ${list(tables.map((t) => code(t.name)))} — see [data model](docs/data-model.md).\n`);
    parts.push(lines.join("\n"));
  }
  const r = rules(plan);
  if (r.length) parts.push("## Boundaries\n\n" + r.map((x) => `- ${x}`).join("\n") + "\n");
  if (plan.decisions?.length) parts.push("## Decisions\n\n" + plan.decisions.map((d) => `- [ADR ${d.id}: ${d.title}](${adrPath(d)})`).join("\n") + "\n");
  if (plan.questions?.length) parts.push("## Open questions\n\n" + plan.questions.map((q) => `- ${q.text}${q.detail ? ` ${q.detail}` : ""}`).join("\n") + "\n");
  return parts.join("\n");
}

function agents(name: string, plan: Plan, meta: string) {
  const folders = plan.components.map((c) => [folderOf(c), c.name] as const).filter((x): x is [string, string] => !!x[0]);
  const parts = [header("AGENTS.md", `Instructions for coding agents working on ${name} · ${meta}`)];
  parts.push("Read `ARCHITECTURE.md` and the decisions in `docs/decisions/` before changing how components talk to each other or where data lives.\n");
  parts.push("## Rules\n\n" + rules(plan).map((x) => `- ${x}`).join("\n") + "\n");
  if (folders.length) {
    const w = Math.max(...folders.map(([f]) => f.length));
    parts.push("## Layout\n\n```\n" + folders.map(([f, n]) => `${(f + "/").padEnd(w + 3)}# ${n}`).join("\n") + "\n```\n");
  }
  if (plan.decisions?.length) parts.push("## Decisions in force\n\n" + plan.decisions.map((d) => `- ADR ${d.id}: ${d.title}${d.title.toLowerCase().includes(d.chosen.toLowerCase()) ? "" : ` — ${d.chosen}`}`).join("\n") + "\n");
  if (plan.questions?.length) parts.push("## Open questions\n\nDon't settle these silently in code; ask first.\n\n" + plan.questions.map((q) => `- ${q.text}`).join("\n") + "\n");
  parts.push("## Definition of done\n\n- Tests pass, and the change matches the plan — or updates `ARCHITECTURE.md` and adds a decision record in the same change.\n- New tables are added to `docs/data-model.md` with their owner.\n");
  return parts.join("\n");
}

function claude(name: string, meta: string) {
  return [
    header("CLAUDE.md", `Instructions for Claude Code in ${name} · ${meta}`),
    "The project rules live in AGENTS.md, so every coding agent follows the same ones:\n",
    "@AGENTS.md\n",
    "## For Claude\n",
    "- Before a change that crosses components, check `ARCHITECTURE.md` and say which components and tables it touches.",
    "- When you make an architecture decision, add a record to `docs/decisions/` (next number, same format) and update `ARCHITECTURE.md`.",
    "- Keep this plan and the code in sync; Strata compares them.\n",
  ].join("\n");
}

function dataModel(plan: Plan, meta: string) {
  const name = new Map(plan.components.map((c) => [c.id, c.name]));
  const tables = plan.tables ?? [];
  const parts = [header("Data model", `Planned · ${tables.length} tables · ${meta}`)];
  parts.push("Each table is owned by exactly one component; only the owner reads and writes it.\n");
  const groups = new Map<string, PlanTable[]>();
  for (const t of tables) groups.set(t.owner ?? "", [...(groups.get(t.owner ?? "") ?? []), t]);
  for (const [owner, ts] of groups) {
    parts.push(`## ${owner ? name.get(owner) ?? owner : "Unowned"}\n`);
    for (const t of ts) {
      const cols = t.columns.map((c) => `- ${code(c.name)} ${c.type ?? ""}${c.nullable ? " (nullable)" : ""}${c.pk ? " · primary key" : ""}${c.unique ? " · unique" : ""}${c.fk ? ` · → ${code(tables.find((x) => x.id === c.fk)?.name ?? c.fk)}` : ""}`.replace(/ +/g, " ").trimEnd());
      parts.push(`### ${t.name}\n${t.note ? `\n${t.note}\n` : ""}\n${cols.join("\n") || "_No columns yet._"}\n`);
    }
  }
  return parts.join("\n");
}

function adr(d: Decision, plan: Plan) {
  const label = (id: string) => plan.components.find((c) => c.id === id)?.name ?? plan.tables?.find((t) => t.id === id)?.name ?? id;
  const parts = [`# ADR ${d.id}: ${d.title}\n`, `- Status: Accepted\n- Date: ${d.date ?? ""}\n`, `## Decision\n\n${d.chosen}.${d.reason ? ` ${d.reason}` : ""}\n`];
  if (d.alts?.length) parts.push("## Alternatives considered\n\n" + d.alts.map((a) => `- ${a}`).join("\n") + "\n");
  if (d.links?.length) parts.push("## Affects\n\n" + d.links.map((l) => `- ${label(l)}`).join("\n") + "\n");
  return parts.join("\n");
}

function componentReadme(c: PlanComponent, plan: Plan, meta: string) {
  const byId = new Map(plan.components.map((x) => [x.id, x]));
  const parts = [header(c.name, `${c.type} · ${meta}`)];
  if (c.resp) parts.push(c.resp + "\n");
  if (c.tech?.length) parts.push(`**Tech:** ${c.tech.join(", ")}\n`);
  const out = plan.connections.filter((e) => e.from === c.id);
  const inc = plan.connections.filter((e) => e.to === c.id);
  if (out.length) parts.push("## Talks to\n\n" + out.map((e) => `- ${byId.get(e.to)?.name ?? e.to}${e.label ? ` (${e.label})` : ""}`).join("\n") + "\n");
  if (inc.length) parts.push("## Used by\n\n" + inc.map((e) => `- ${byId.get(e.from)?.name ?? e.from}${e.label ? ` (${e.label})` : ""}`).join("\n") + "\n");
  const tables = (plan.tables ?? []).filter((t) => t.owner === c.id);
  if (tables.length) parts.push("## Owns\n\n" + tables.map((t) => `- ${code(t.name)}`).join("\n") + "\n");
  if (c.notes?.length) parts.push("## Notes\n\n" + c.notes.map((n) => `- ${n}`).join("\n") + "\n");
  parts.push("See the project's `ARCHITECTURE.md` for how this fits the whole system.\n");
  return parts.join("\n");
}

/** Every file the plan can produce (ROADMAP.md comes from Claude separately). */
export function generateDocs(projectName: string, brief: PlanBrief | null | undefined, plan: Plan, version: number | null): DocFile[] {
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const meta = `Generated by Strata from plan v${version ?? 0} · ${date}`;
  const adrPath = (d: Decision) => `docs/decisions/${d.id}-${slugify(d.title.replace(/^Shape:\s*/i, "shape "))}.md`;
  const files: DocFile[] = [
    { path: "ARCHITECTURE.md", title: "Architecture", group: "root", content: architecture(projectName, brief, plan, meta, adrPath) },
    { path: "AGENTS.md", title: "Rules for coding agents", group: "root", content: agents(projectName, plan, meta) },
    { path: "CLAUDE.md", title: "Claude Code", group: "root", content: claude(projectName, meta) },
  ];
  if (plan.tables?.length) files.push({ path: "docs/data-model.md", title: "Data model", group: "docs", content: dataModel(plan, meta) });
  for (const d of plan.decisions ?? []) files.push({ path: adrPath(d), title: `ADR ${d.id}`, group: "decisions", content: adr(d, plan) });
  for (const c of plan.components) {
    const f = folderOf(c);
    if (f && c.type !== "Database" && c.type !== "Queue") files.push({ path: `${f}/README.md`, title: c.name, group: "components", content: componentReadme(c, plan, meta) });
  }
  files.push({ path: ".strata/plan.json", title: "The plan (for Strata)", group: "internal", content: JSON.stringify({ project: projectName, version, brief: brief ?? undefined, plan }, null, 2) + "\n" });
  return files;
}

/** What Claude needs to draft the roadmap. */
export function roadmapPrompt(projectName: string, brief: PlanBrief | null | undefined, plan: Plan) {
  return [
    `Project: ${projectName}`,
    brief?.idea ? `Idea: ${brief.idea}` : "",
    "Components:",
    ...plan.components.map((c) => `- ${c.name} (${c.type}${c.tech?.length ? `, ${c.tech.join(", ")}` : ""}): ${c.resp ?? ""}`),
    "Connections:",
    ...plan.connections.map((e) => `- ${plan.components.find((c) => c.id === e.from)?.name} → ${plan.components.find((c) => c.id === e.to)?.name}${e.label ? ` (${e.label})` : ""}`),
    plan.tables?.length ? `Tables: ${plan.tables.map((t) => t.name).join(", ")}` : "",
    plan.decisions?.length ? "Decisions:\n" + plan.decisions.map((d) => `- ${d.title}: ${d.chosen}`).join("\n") : "",
    plan.questions?.length ? "Open questions:\n" + plan.questions.map((q) => `- ${q.text}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}
