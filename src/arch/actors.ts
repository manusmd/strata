import type { ArchModel, ArchNode } from "../map/archModel";
import { hashOf } from "../summary/subjects";

/** A kind of person (or program) that uses the system, and the parts they use it through. */
export type Actor = { id: string; name: string; description: string; uses: string[]; ai?: boolean };

/** Parts people reach directly: apps, extensions, CLIs, and APIs nothing in the project calls. */
export function entryPoints(m: ArchModel): ArchNode[] {
  const calledInside = new Set(m.edges.filter((e) => e.kind === "calls" && m.byId.get(e.source)?.unit).map((e) => e.target));
  return m.nodes.filter((n) => n.unit && (["App", "Extension", "CLI"].includes(n.kind) || (n.kind === "Service" && !calledInside.has(n.id))));
}

const RULES: [RegExp, string, string][] = [
  [/admin|backoffice|back-office|internal|console|ops/, "Admins", "Run and configure the system"],
  [/docs?$|documentation|storybook/, "Readers", "Read the documentation"],
  [/landing|marketing|^site$|website|^www$|homepage/, "Visitors", "Learn about the product"],
  [/mobile|ios|android|native|expo/, "Mobile users", "Use the mobile app"],
];

/** Who uses the system, guessed from its entry points (no AI). */
export function guessActors(m: ArchModel): Actor[] {
  const actors = new Map<string, Actor>();
  const add = (name: string, description: string, part: string) => {
    const a = actors.get(name) ?? { id: `actor:${name.toLowerCase().replace(/\W+/g, "-")}`, name, description, uses: [] };
    a.uses.push(part);
    actors.set(name, a);
  };
  for (const n of entryPoints(m)) {
    const name = `${n.name} ${n.unit?.dir ?? ""}`.toLowerCase();
    const rule = RULES.find(([re]) => re.test(n.name.toLowerCase()) || re.test((n.unit?.dir ?? "").split("/").pop() ?? ""));
    if (n.kind === "CLI") add("Developers", "Run the command-line tools", n.id);
    else if (n.kind === "Extension") add("Browser users", "Use the browser extension", n.id);
    else if (n.kind === "Service") add("API clients", "Integrate through the public API", n.id);
    else if (rule) add(rule[1], rule[2], n.id);
    else if (/test|e2e|example/.test(name)) continue;
    else add("Users", "Use the main app", n.id);
  }
  return [...actors.values()];
}

/** What Claude gets to name the users: the entry points and what they do. */
export function actorsPrompt(projectName: string, m: ArchModel, summaries: Map<string, string>) {
  const parts = entryPoints(m);
  const lines = parts.map((n) => `- ${n.name} [${n.kind}] ${n.detail}${n.unit?.description ? ` — ${n.unit.description}` : ""}${summaries.get(n.id) ? ` — ${summaries.get(n.id)}` : ""}`);
  const externals = m.nodes.filter((n) => n.kind === "External").map((n) => n.name);
  return {
    hash: hashOf("actors", ...parts.map((n) => `${n.id}|${n.detail}|${n.unit?.description ?? ""}`)),
    ids: parts.map((n) => ({ id: n.id, name: n.name })),
    prompt: [
      `Project "${projectName}". These are the parts people (or other programs) use directly:`,
      ...lines,
      externals.length ? `It also talks to: ${externals.join(", ")}.` : "",
      "",
      'Name the 2–5 kinds of users of this system, as the product would call them (e.g. "Hosts" and "Attendees" for a scheduling app, not "Users"). Reply with only JSON: {"users": [{"name": "…", "description": "what they do with it, one short sentence", "uses": ["part name", …]}]}. Use the part names exactly as given; every part should be used by someone.',
    ]
      .filter((x) => x !== "")
      .join("\n"),
  };
}

export function parseActors(json: string, ids: { id: string; name: string }[]): Actor[] {
  const byName = new Map(ids.map((p) => [p.name.toLowerCase(), p.id]));
  const raw = JSON.parse(json);
  const out: Actor[] = [];
  for (const u of Array.isArray(raw?.users) ? raw.users.slice(0, 6) : []) {
    const uses = (Array.isArray(u?.uses) ? u.uses : []).map((x: unknown) => byName.get(String(x).toLowerCase())).filter((x: string | undefined): x is string => !!x);
    if (!u?.name || !uses.length) continue;
    out.push({ id: `actor:${String(u.name).toLowerCase().replace(/\W+/g, "-")}`, name: String(u.name).slice(0, 30), description: String(u.description ?? "").slice(0, 120), uses, ai: true });
  }
  return out;
}

/** A flow suggested by Claude: parts in order, one sentence per step. */
export type AiFlow = { id: string; title: string; steps: string[]; texts: string[] };

/** What Claude gets to suggest flows: the parts, what they do, and the connections found in the code. */
export function flowsPrompt(projectName: string, m: ArchModel, summaries: Map<string, string>) {
  const parts = m.nodes.filter((n) => n.kind !== "Missing");
  const name = (id: string) => m.byId.get(id)?.name ?? id;
  const lines = parts.map((n) => {
    const routes = n.unit?.routes && n.unit.routes.pages + n.unit.routes.api ? ` (${n.unit.routes.pages} pages, ${n.unit.routes.api} API routes)` : "";
    return `- ${n.name} [${n.kind}] ${n.detail}${routes}${n.unit?.description ? ` — ${n.unit.description}` : ""}${summaries.get(n.id) ? ` — ${summaries.get(n.id)}` : ""}`;
  });
  const links = m.edges.filter((e) => !e.minor).map((e) => `- ${name(e.source)} → ${name(e.target)} (${e.kind}: ${e.reasons.slice(0, 2).join("; ")})`);
  return {
    hash: hashOf("flows", ...parts.map((n) => `${n.id}|${n.detail}|${n.unit?.description ?? ""}`), ...m.edges.map((e) => e.id)),
    prompt: [
      `Project "${projectName}". Its parts:`,
      ...lines,
      "Connections found in the code:",
      ...(links.length ? links : ["- none"]),
      "",
      'Suggest the 1–4 most important flows a new developer should know, named by what the user does. Reply with only JSON: {"flows": [{"name": "Book a meeting", "steps": [{"part": "exact part name", "text": "what happens there, one short sentence"}]}]} with 3–6 steps each, in order, starting where the user is.',
    ].join("\n"),
  };
}

export function parseFlows(json: string, m: ArchModel): AiFlow[] {
  const byName = new Map(m.nodes.map((n) => [n.name.toLowerCase(), n.id]));
  const raw = JSON.parse(json);
  const out: AiFlow[] = [];
  for (const f of Array.isArray(raw?.flows) ? raw.flows.slice(0, 4) : []) {
    const steps: { id: string; text: string }[] = [];
    for (const s of Array.isArray(f?.steps) ? f.steps : []) {
      const id = byName.get(String(s?.part ?? "").toLowerCase());
      // Unknown parts are dropped; a part right after itself too.
      if (id && steps[steps.length - 1]?.id !== id) steps.push({ id, text: String(s?.text ?? "").slice(0, 200) });
    }
    if (steps.length >= 2 && f?.name) out.push({ id: `aiflow:${String(f.name).toLowerCase().replace(/\W+/g, "-")}`, title: String(f.name).slice(0, 40), steps: steps.map((s) => s.id), texts: steps.map((s) => s.text) });
  }
  return out;
}
