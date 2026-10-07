/** A diagram Claude draws in a chat answer, as a ```strata-canvas fenced JSON block. */

export const NODE_TYPES = ["App", "Service", "Worker", "CLI", "Extension", "Library", "Database", "Cache", "Queue", "Storage", "Search", "AI", "External", "Infra", "Step", "Actor", "Note"] as const;
export type CanvasNodeType = (typeof NODE_TYPES)[number];
export type CanvasStatus = "existing" | "new" | "changed" | "removed";

export type CanvasNode = { id: string; label: string; type: CanvasNodeType; status: CanvasStatus; ref?: string; group?: string; note?: string };
export type CanvasEdge = { from: string; to: string; label?: string; status: CanvasStatus; kind: "calls" | "data" | "uses" | "step" };
export type CanvasGroup = { id: string; label: string };
export type Canvas = { title: string; kind: "architecture" | "flow"; description?: string; groups: CanvasGroup[]; nodes: CanvasNode[]; edges: CanvasEdge[] };

export type Parsed = { ok: true; canvas: Canvas; warnings: string[] } | { ok: false; error: string };

const STATUSES: CanvasStatus[] = ["existing", "new", "changed", "removed"];
const EDGE_KINDS: CanvasEdge["kind"][] = ["calls", "data", "uses", "step"];
const MAX_NODES = 60;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Lenient JSON: strips comments and trailing commas that models sometimes add. */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(cleaned);
  }
}

/** Parses and repairs what it can; returns a readable error otherwise. */
export function parseCanvas(body: string): Parsed {
  let raw: any;
  try {
    raw = looseJson(body.trim());
  } catch (e) {
    return { ok: false, error: `The JSON is invalid (${String(e).replace(/^SyntaxError: /, "")}).` };
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) return { ok: false, error: 'The canvas needs a "nodes" array.' };
  const warnings: string[] = [];

  const groups: CanvasGroup[] = (Array.isArray(raw.groups) ? raw.groups : []).map((g: any) => ({ id: str(g?.id), label: str(g?.label) || str(g?.id) })).filter((g: CanvasGroup) => g.id);
  const groupIds = new Set(groups.map((g) => g.id));

  const seen = new Set<string>();
  const nodes: CanvasNode[] = [];
  for (const n of raw.nodes as any[]) {
    const id = str(n?.id) || str(n?.label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = NODE_TYPES.find((t) => t.toLowerCase() === str(n?.type).toLowerCase()) ?? "Service";
    const status = STATUSES.find((s) => s === str(n?.status).toLowerCase()) ?? "existing";
    const group = str(n?.group);
    if (group && !groupIds.has(group)) {
      groups.push({ id: group, label: group });
      groupIds.add(group);
    }
    nodes.push({ id, label: str(n?.label) || id, type, status, ref: str(n?.ref) || undefined, group: group || undefined, note: str(n?.note) || undefined });
  }
  if (!nodes.length) return { ok: false, error: "The canvas has no nodes." };
  if (nodes.length > MAX_NODES) {
    warnings.push(`Showing the first ${MAX_NODES} of ${nodes.length} nodes.`);
    nodes.length = MAX_NODES;
  }
  const ids = new Set(nodes.map((n) => n.id));

  let dropped = 0;
  const edges: CanvasEdge[] = [];
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    const from = str(e?.from ?? e?.source);
    const to = str(e?.to ?? e?.target);
    if (!ids.has(from) || !ids.has(to)) {
      dropped++;
      continue;
    }
    edges.push({
      from,
      to,
      label: str(e?.label) || undefined,
      status: STATUSES.find((s) => s === str(e?.status).toLowerCase()) ?? "existing",
      kind: EDGE_KINDS.find((k) => k === str(e?.kind).toLowerCase()) ?? (raw.kind === "flow" ? "step" : "calls"),
    });
  }
  if (dropped) warnings.push(`${dropped} connection${dropped === 1 ? "" : "s"} pointed at unknown nodes and were left out.`);

  return {
    ok: true,
    warnings,
    canvas: { title: str(raw.title) || "Canvas", kind: raw.kind === "flow" ? "flow" : "architecture", description: str(raw.description) || undefined, groups: groups.filter((g) => nodes.some((n) => n.group === g.id)), nodes, edges },
  };
}

/** Appended to the system prompt of chats: when and how to draw. */
export const CANVAS_INSTRUCTIONS = `## Canvases (diagrams)
When a diagram helps — and always when the user asks you to visualize, draw, propose, restructure or compare something (architecture, a request flow, a data model change) — add a canvas to your answer: a fenced code block with the language \`strata-canvas\` that contains only JSON:

\`\`\`strata-canvas
{
  "title": "Proposal: move payments into their own service",
  "kind": "architecture",
  "description": "One sentence about what the canvas shows.",
  "groups": [{ "id": "core", "label": "Core services" }],
  "nodes": [
    { "id": "web", "label": "web-app", "type": "App", "status": "existing", "ref": "web-app", "group": "clients" },
    { "id": "pay", "label": "payment-service", "type": "Service", "status": "new", "group": "core", "note": "Owns Stripe and invoices" }
  ],
  "edges": [{ "from": "web", "to": "pay", "label": "POST /checkout", "status": "new", "kind": "calls" }]
}
\`\`\`

Rules:
- "kind": "architecture" for components and how they connect; "flow" for a sequence (nodes are actors or steps of type "Actor"/"Step", edge labels numbered like "1. POST /checkout").
- node "type": one of ${NODE_TYPES.join(", ")}.
- "status" on nodes and edges, relative to the current system: "existing", "new", "changed" (explain in "note"), "removed". Plain explanations of today's system use "existing" everywhere.
- For a node that is an existing component, set "ref" to its exact name from the Architecture list above.
- Use "groups" to organize the canvas into sections. At most 30 nodes. Short unique ids.
- Strictly valid JSON: double quotes, no comments, no trailing commas.
- Explain the proposal in prose outside the block; don't repeat the whole canvas in text.`;
