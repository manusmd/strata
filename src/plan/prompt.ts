import type { Graph, PlanBrief, Project } from "../api";
import { buildContext } from "../ask/context";
import type { WorkspacePackage } from "../map/archModel";
import { PLAN_TYPES, type Plan } from "./model";

/** The plan as compact JSON for the prompt (only the fields that are set). */
function planJson(plan: Plan) {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  return JSON.stringify({
    components: plan.components.map(clean),
    connections: plan.connections.map(clean),
    ...(plan.tables?.length ? { tables: plan.tables.map((t) => clean({ ...t, columns: t.columns.map(clean) })) } : {}),
    ...(plan.decisions?.length ? { decisions: plan.decisions.map(clean) } : {}),
    ...(plan.questions?.length ? { questions: plan.questions.map(clean) } : {}),
  });
}

const INSTRUCTIONS = `## How to plan
You are planning the architecture of a software project together with the user, inside Strata. The plan is a canvas of components and connections that you change step by step. Strata shows your prose in the chat and applies your changes to the canvas.

Planning a new project goes in three phases:
1. **Questions.** While the plan is empty and you haven't asked yet, ask 3–4 short, concrete questions in a \`strata-questions\` block (see below) — about what changes the architecture: payments, scale, background work, team, must-use services, compliance. Skip what the brief already answers. Don't draw anything yet. If the brief already answers enough, go straight to phase 2.
2. **Options.** Once the user has answered (or asks you to draw), propose 2–3 genuinely different architectures in a \`strata-options\` block, and recommend exactly one. Strata draws the recommended option as the first draft; the user can switch to another or ask you to mix them.
3. **Refining.** From then on, change the plan with small edits in a \`strata-plan\` block. If the user asks for alternatives again, you may send another \`strata-options\` block.

- Record the reasoning as you go: every meaningful choice (a split, a store, a vendor, a protocol) becomes a decision with the reason and the alternatives you considered; anything that must be settled later becomes an open question. When a question gets settled, resolve it and record the decision.
- Plan the data model when the user asks for it, or once the components are settled: the main tables with their key columns, each owned by one component.
- Prefer a few well-named components (usually 4–15). Each has one clear responsibility.
- Explain your reasoning briefly in prose: what you changed and why, and any trade-off worth knowing. No need to restate the whole plan.
- Only change what the user asked for (plus what directly follows from it). Never silently drop components.

## Asking questions

\`\`\`strata-questions
{ "questions": [
  { "q": "Will users pay in the app?", "options": ["Yes", "No", "Later"] },
  { "q": "Expected users in year one?", "options": ["< 1k", "1k–50k", "50k+"] }
] }
\`\`\`

Each question gets 2–4 short answers (a few words each). The user taps answers or replies in their own words. Put any short intro in prose above the block.

## Proposing options

\`\`\`strata-options
{ "options": [
  { "id": "monolith", "title": "Modular monolith", "tagline": "One deployable with strict module boundaries.", "complexity": 2, "recommended": false,
    "pros": ["Fastest to ship", "One deploy"], "cons": ["Heavy jobs compete with API traffic"],
    "plan": { "components": [ ... ], "connections": [ ... ] } }
] }
\`\`\`

- Each option is a complete plan (components and connections in the format below), usually 4–10 components, with 2–3 pros and cons, and "complexity" from 1 (very low) to 5 (very high).
- Make the options really differ in shape (e.g. monolith vs. API + worker vs. serverless), not in naming. In prose, say briefly why you recommend the one you do.

## Changing the plan
To change the canvas, add exactly one fenced block with the language \`strata-plan\` containing only JSON:

\`\`\`strata-plan
{
  "title": "Split billing out",
  "ops": [
    { "op": "add", "component": { "id": "billing", "name": "billing-service", "type": "Service", "resp": "Meters usage and issues invoices. The only component that talks to Stripe.", "tech": ["Fastify", "Stripe SDK"], "lives": "services/billing" } },
    { "op": "update", "id": "api", "set": { "resp": "Public REST API. Calls billing-service for invoices." } },
    { "op": "connect", "from": "api", "to": "billing", "label": "REST", "kind": "calls" },
    { "op": "disconnect", "from": "api", "to": "stripe" },
    { "op": "remove", "id": "mailer" }
  ]
}
\`\`\`

- "title": a short label for this version of the plan (what changed, 2–6 words).
- ops: "add" (a new component), "update" (only the fields that change), "remove" (also removes its connections), "connect", "disconnect".
- Component fields: "id" (short, lowercase, kebab-case, stable — never rename ids; change "name" instead), "name", "type" (one of ${PLAN_TYPES.join(", ")}), "resp" (1–2 sentences), "tech" (list), "lives" (repo/folder like "apps/web", or "Managed service").
- Data model ops: { "op": "table", "table": { "id": "invoices", "name": "invoices", "owner": "billing", "columns": [ { "name": "id", "type": "uuid", "pk": true }, { "name": "account_id", "type": "uuid", "fk": "accounts" }, { "name": "total_cents", "type": "int" } ] } } adds a table or replaces the one with that id (send all columns); { "op": "remove_table", "id": "invoices" }. "owner" is a component id, "fk" the id of the referenced table. Use snake_case table ids.
- Decisions: { "op": "decide", "decision": { "title": "Split billing into its own service", "chosen": "billing-service", "reason": "Keeps Stripe out of the public API.", "alts": ["Billing module in api"], "links": ["billing", "api"] } } (pass "id" to revise an existing one). Open questions: { "op": "ask", "question": { "text": "Do invoices need multi-currency at launch?", "detail": "Affects invoice_lines and Stripe prices.", "links": ["billing"] } }; { "op": "resolve", "id": "q1" }. "links" are component or table ids.
- Connections point from the caller to the callee, or from the writer to the store. "kind": "calls" (requests), "data" (reads/writes a database), "queue" (enqueue/consume), "uses" (anything else). "label": the protocol or purpose, e.g. "REST", "SQL", "enqueue", "OIDC".
- For the very first draft (empty plan) you may send { "title": "First draft", "plan": { "components": [...], "connections": [...] } } instead of ops.
- Use the ids of the current plan. Strictly valid JSON: double quotes, no comments, no trailing commas. Only one strata-plan block per answer.`;

/** The "Plan from scratch" form as prose. */
export function briefText(b: PlanBrief) {
  const lines = [b.idea.trim()];
  if (b.stack?.length) lines.push(`Preferred stack: ${b.stack.join(", ")}.`);
  if (b.hosting?.length) lines.push(`Hosting: ${b.hosting.join(", ")}.`);
  if (b.scale) lines.push(`Expected scale: ${b.scale} users in year one.`);
  if (b.team) lines.push(`Team: ${b.team.toLowerCase()}.`);
  if (b.services?.length) lines.push(`Must use: ${b.services.join(", ")}.`);
  return lines.join("\n");
}

/** Everything Claude needs for a planning turn: the brief, the current plan, plus the existing system if the project has repos. */
export function planContext(project: Project, plan: Plan, version: number | null, graph: Graph | null, workspace: WorkspacePackage[]) {
  const parts = [`# Strata planning: project "${project.name}"`];
  if (project.brief?.idea) parts.push(`## Brief\n${briefText(project.brief)}`);
  if (graph && project.repos.length) {
    parts.push("The project already has code. Plan changes to the existing system; components that exist today should keep their names.", buildContext(project, graph, workspace, "arch"));
  } else {
    parts.push("The project has no code yet: this is a plan from scratch.");
  }
  parts.push(
    plan.components.length
      ? `## Current plan (version ${version})\n${planJson(plan)}`
      : "## Current plan\nEmpty. Ask your questions first (phase 1) unless they're already answered, then propose options (phase 2).",
    INSTRUCTIONS,
  );
  return parts.join("\n\n");
}
