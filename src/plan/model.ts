/** The architecture plan of a project: components and how they connect, the planned data model, decisions and open questions. */

export const PLAN_TYPES = ["App", "Service", "Worker", "Library", "Database", "Queue", "External"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export type PlanComponent = {
  id: string;
  name: string;
  type: PlanType;
  /** What it is responsible for, in a sentence or two. */
  resp?: string;
  tech?: string[];
  /** Where it will live: a repo, folder or "Managed service". */
  lives?: string;
  notes?: string[];
};

export type ConnectionKind = "calls" | "data" | "queue" | "uses";
export type PlanConnection = { from: string; to: string; label?: string; kind?: ConnectionKind };

export type PlanColumn = { name: string; type?: string; pk?: boolean; fk?: string; nullable?: boolean; unique?: boolean };
/** A planned table. `owner` is the component that owns it; `fk` on a column names the referenced table id. */
export type PlanTable = { id: string; name: string; owner?: string; columns: PlanColumn[]; note?: string };

/** An architecture decision record: what was chosen, why, and what else was considered. `links` are component or table ids. */
export type Decision = { id: string; title: string; chosen: string; reason?: string; alts?: string[]; links?: string[]; date?: string };
export type OpenQuestion = { id: string; text: string; detail?: string; links?: string[] };

export type Plan = { components: PlanComponent[]; connections: PlanConnection[]; tables?: PlanTable[]; decisions?: Decision[]; questions?: OpenQuestion[] };

export const EMPTY_PLAN: Plan = { components: [], connections: [] };

/** One edit from Claude (or the canvas). Small and composable, so the plan evolves instead of being redrawn. */
export type PlanOp =
  | { op: "add"; component: PlanComponent }
  | { op: "update"; id: string; set: Partial<Omit<PlanComponent, "id">> }
  | { op: "remove"; id: string }
  | { op: "connect"; from: string; to: string; label?: string; kind?: ConnectionKind }
  | { op: "disconnect"; from: string; to: string }
  /** Adds a table, or replaces the one with the same id. */
  | { op: "table"; table: PlanTable }
  | { op: "remove_table"; id: string }
  /** Records a decision (a new ADR number unless `id` names an existing one). */
  | { op: "decide"; decision: Omit<Decision, "id"> & { id?: string } }
  | { op: "ask"; question: Omit<OpenQuestion, "id"> & { id?: string } }
  | { op: "resolve"; id: string };

export type PlanEdit = { title: string; ops: PlanOp[] } | { title: string; plan: Plan };

export type Changes = { added: string[]; changed: string[]; removed: string[] };

/* ---------- Colors and labels (from the design) ---------- */

const ARCH = "#8B5CF6", CODE = "#6366F1", DB = "#14B8A6", GRAY = "#9B9A97";
export const TYPE_STYLE: Record<PlanType, { ini: string; color: string }> = {
  App: { ini: "AP", color: ARCH },
  Service: { ini: "SV", color: ARCH },
  Worker: { ini: "WK", color: ARCH },
  Library: { ini: "LB", color: CODE },
  Database: { ini: "DB", color: DB },
  Queue: { ini: "Q", color: DB },
  External: { ini: "EX", color: GRAY },
};
export const KIND_COLOR: Record<ConnectionKind, string> = { calls: ARCH, data: DB, queue: DB, uses: GRAY };

export const initials = (c: PlanComponent) => {
  const parts = c.name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : c.name.slice(0, 2)).toUpperCase() || TYPE_STYLE[c.type].ini;
};

/* ---------- Parsing and normalizing ---------- */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : undefined);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "component";
const tableSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "table";
const typeOf = (v: unknown): PlanType => PLAN_TYPES.find((t) => t.toLowerCase() === str(v).toLowerCase()) ?? "Service";
const kindOf = (v: unknown): ConnectionKind | undefined => (["calls", "data", "queue", "uses"] as const).find((k) => k === str(v).toLowerCase());
const today = () => new Date().toISOString().slice(0, 10);

function component(raw: any): PlanComponent | null {
  const name = str(raw?.name) || str(raw?.id);
  if (!name) return null;
  return {
    id: str(raw?.id) || slug(name),
    name,
    type: typeOf(raw?.type),
    resp: str(raw?.resp ?? raw?.responsibility) || undefined,
    tech: strs(raw?.tech),
    lives: str(raw?.lives ?? raw?.livesIn) || undefined,
    notes: strs(raw?.notes),
  };
}

function column(raw: any): PlanColumn | null {
  const name = str(raw?.name);
  if (!name) return null;
  const key = str(raw?.key).toUpperCase();
  return {
    name,
    type: str(raw?.type) || undefined,
    pk: raw?.pk === true || key === "PK" || undefined,
    fk: str(raw?.fk ?? raw?.references) || undefined,
    nullable: raw?.nullable === true || undefined,
    unique: raw?.unique === true || undefined,
  };
}

function table(raw: any): PlanTable | null {
  const name = str(raw?.name) || str(raw?.id);
  if (!name) return null;
  const columns = (Array.isArray(raw?.columns) ? raw.columns : []).map(column).filter((c: PlanColumn | null): c is PlanColumn => !!c);
  return { id: str(raw?.id) || tableSlug(name), name, owner: str(raw?.owner) || undefined, columns, note: str(raw?.note) || undefined };
}

function decision(raw: any, id: string): Decision | null {
  const title = str(raw?.title);
  if (!title) return null;
  return { id, title, chosen: str(raw?.chosen) || title, reason: str(raw?.reason) || undefined, alts: strs(raw?.alts ?? raw?.alternatives), links: strs(raw?.links), date: str(raw?.date) || today() };
}

function question(raw: any, id: string): OpenQuestion | null {
  const text = str(raw?.text ?? raw?.q);
  return text ? { id, text, detail: str(raw?.detail) || undefined, links: strs(raw?.links) } : null;
}

const pad = (n: number) => String(n).padStart(4, "0");
const nextDecisionId = (ds: Decision[]) => pad(ds.reduce((m, d) => Math.max(m, parseInt(d.id, 10) || 0), 0) + 1);
const nextQuestionId = (qs: OpenQuestion[]) => `q${qs.reduce((m, q) => Math.max(m, parseInt(q.id.replace(/\D/g, ""), 10) || 0), 0) + 1}`;

/** A stored or model-written plan, cleaned up: unique ids, references only to things that exist. */
export function normalizePlan(raw: any): Plan {
  const components: PlanComponent[] = [];
  const ids = new Set<string>();
  for (const c of Array.isArray(raw?.components) ? raw.components : []) {
    const comp = component(c);
    if (comp && !ids.has(comp.id)) {
      ids.add(comp.id);
      components.push(comp);
    }
  }
  const seen = new Set<string>();
  const connections: PlanConnection[] = [];
  for (const e of Array.isArray(raw?.connections) ? raw.connections : []) {
    const from = str(e?.from), to = str(e?.to);
    const key = `${from}>${to}`;
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(key)) continue;
    seen.add(key);
    connections.push({ from, to, label: str(e?.label) || undefined, kind: kindOf(e?.kind) });
  }
  const tables: PlanTable[] = [];
  for (const t of Array.isArray(raw?.tables) ? raw.tables : []) {
    const tb = table(t);
    if (tb && !tables.some((x) => x.id === tb.id)) tables.push(tb);
  }
  const tableIds = new Set(tables.map((t) => t.id));
  for (const t of tables) {
    if (t.owner && !ids.has(t.owner)) t.owner = undefined;
    for (const c of t.columns) if (c.fk && !tableIds.has(c.fk)) c.fk = undefined;
  }
  const known = (l?: string[]) => l?.filter((x) => ids.has(x) || tableIds.has(x));
  const decisions: Decision[] = [];
  for (const d of Array.isArray(raw?.decisions) ? raw.decisions : []) {
    const dec = decision(d, str(d?.id) || nextDecisionId(decisions));
    if (dec && !decisions.some((x) => x.id === dec.id)) decisions.push({ ...dec, links: known(dec.links) });
  }
  const questions: OpenQuestion[] = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const oq = question(q, str(q?.id) || nextQuestionId(questions));
    if (oq && !questions.some((x) => x.id === oq.id)) questions.push({ ...oq, links: known(oq.links) });
  }
  const plan: Plan = { components, connections };
  if (tables.length) plan.tables = tables;
  if (decisions.length) plan.decisions = decisions;
  if (questions.length) plan.questions = questions;
  return plan;
}

/** Lenient JSON: models sometimes add comments or trailing commas. */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));
  }
}

/** Reads a ```strata-plan block. */
export function parseEdit(body: string): { ok: true; edit: PlanEdit } | { ok: false; error: string } {
  let raw: any;
  try {
    raw = looseJson(body.trim());
  } catch (e) {
    return { ok: false, error: `The plan update isn't valid JSON (${String(e).replace(/^SyntaxError: /, "")}).` };
  }
  const title = str(raw?.title).slice(0, 80) || "Update the plan";
  if (raw?.plan) return { ok: true, edit: { title, plan: normalizePlan(raw.plan) } };
  if (!Array.isArray(raw?.ops)) return { ok: false, error: 'The plan update needs an "ops" list (or a full "plan").' };
  const ops: PlanOp[] = [];
  for (const o of raw.ops) {
    switch (str(o?.op)) {
      case "add": {
        const c = component(o.component ?? o);
        if (c) ops.push({ op: "add", component: c });
        break;
      }
      case "update": {
        const id = str(o.id);
        const set: Partial<PlanComponent> = {};
        const src = o.set ?? o;
        if (src.name !== undefined) set.name = str(src.name);
        if (src.type !== undefined) set.type = typeOf(src.type);
        if (src.resp !== undefined || src.responsibility !== undefined) set.resp = str(src.resp ?? src.responsibility);
        if (src.tech !== undefined) set.tech = strs(src.tech) ?? [];
        if (src.lives !== undefined) set.lives = str(src.lives);
        if (src.notes !== undefined) set.notes = strs(src.notes) ?? [];
        if (id) ops.push({ op: "update", id, set });
        break;
      }
      case "remove":
        if (str(o.id)) ops.push({ op: "remove", id: str(o.id) });
        break;
      case "connect":
        if (str(o.from) && str(o.to)) ops.push({ op: "connect", from: str(o.from), to: str(o.to), label: str(o.label) || undefined, kind: kindOf(o.kind) });
        break;
      case "disconnect":
        if (str(o.from) && str(o.to)) ops.push({ op: "disconnect", from: str(o.from), to: str(o.to) });
        break;
      case "table": {
        const t = table(o.table ?? o);
        if (t) ops.push({ op: "table", table: t });
        break;
      }
      case "remove_table":
        if (str(o.id)) ops.push({ op: "remove_table", id: str(o.id) });
        break;
      case "decide": {
        const src = o.decision ?? o;
        const d = decision(src, str(src.id) || "new");
        if (d) ops.push({ op: "decide", decision: { ...d, id: str(src.id) || undefined } });
        break;
      }
      case "ask": {
        const src = o.question ?? o;
        const q = question(src, str(src.id) || "new");
        if (q) ops.push({ op: "ask", question: { ...q, id: str(src.id) || undefined } });
        break;
      }
      case "resolve":
        if (str(o.id)) ops.push({ op: "resolve", id: str(o.id) });
        break;
    }
  }
  if (!ops.length) return { ok: false, error: "The plan update has no changes Strata understands." };
  return { ok: true, edit: { title, ops } };
}

/* ---------- Applying edits ---------- */

/** Applies an edit; unknown ids are skipped and reported, never fatal. */
export function applyEdit(plan: Plan, edit: PlanEdit): { plan: Plan; skipped: string[] } {
  if ("plan" in edit) return { plan: normalizePlan(edit.plan), skipped: [] };
  let components = plan.components.map((c) => ({ ...c }));
  let connections = [...plan.connections];
  let tables = (plan.tables ?? []).map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c })) }));
  let decisions = [...(plan.decisions ?? [])];
  let questions = [...(plan.questions ?? [])];
  const skipped: string[] = [];
  const has = (id: string) => components.some((c) => c.id === id);
  for (const o of edit.ops) {
    if (o.op === "add") {
      let id = o.component.id;
      for (let i = 2; has(id); i++) id = `${o.component.id}-${i}`;
      components.push({ ...o.component, id });
    } else if (o.op === "update") {
      const c = components.find((x) => x.id === o.id);
      if (!c) skipped.push(`update ${o.id}`);
      else Object.assign(c, Object.fromEntries(Object.entries(o.set).filter(([, v]) => v !== undefined)));
    } else if (o.op === "remove") {
      if (!has(o.id)) skipped.push(`remove ${o.id}`);
      components = components.filter((c) => c.id !== o.id);
      connections = connections.filter((e) => e.from !== o.id && e.to !== o.id);
    } else if (o.op === "connect") {
      if (!has(o.from) || !has(o.to) || o.from === o.to) skipped.push(`connect ${o.from} → ${o.to}`);
      else {
        connections = connections.filter((e) => !(e.from === o.from && e.to === o.to));
        connections.push({ from: o.from, to: o.to, label: o.label, kind: o.kind });
      }
    } else if (o.op === "disconnect") {
      connections = connections.filter((e) => !(e.from === o.from && e.to === o.to));
    } else if (o.op === "table") {
      const i = tables.findIndex((t) => t.id === o.table.id);
      if (i >= 0) tables[i] = o.table;
      else tables.push(o.table);
    } else if (o.op === "remove_table") {
      if (!tables.some((t) => t.id === o.id)) skipped.push(`remove table ${o.id}`);
      tables = tables.filter((t) => t.id !== o.id);
    } else if (o.op === "decide") {
      const id = o.decision.id && decisions.some((d) => d.id === o.decision.id) ? o.decision.id : nextDecisionId(decisions);
      const d: Decision = { ...o.decision, id, date: o.decision.date ?? today() };
      decisions = decisions.some((x) => x.id === id) ? decisions.map((x) => (x.id === id ? d : x)) : [...decisions, d];
    } else if (o.op === "ask") {
      const id = o.question.id && questions.some((q) => q.id === o.question.id) ? o.question.id : nextQuestionId(questions);
      const q: OpenQuestion = { ...o.question, id };
      questions = questions.some((x) => x.id === id) ? questions.map((x) => (x.id === id ? q : x)) : [...questions, q];
    } else if (o.op === "resolve") {
      if (!questions.some((q) => q.id === o.id)) skipped.push(`resolve ${o.id}`);
      questions = questions.filter((q) => q.id !== o.id);
    }
  }
  return { plan: normalizePlan({ components, connections, tables, decisions, questions }), skipped };
}

/** Swaps in another architecture (a picked option) but keeps the data model, decisions and questions. */
export function withShape(current: Plan, shape: Plan): Plan {
  return normalizePlan({ ...current, components: shape.components, connections: shape.connections, tables: current.tables?.length ? current.tables : shape.tables });
}

/* ---------- Comparing versions ---------- */

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed from `a` to `b`, by component (a component whose connections changed counts as changed). */
export function diff(a: Plan, b: Plan): Changes {
  const before = new Map(a.components.map((c) => [c.id, c]));
  const after = new Map(b.components.map((c) => [c.id, c]));
  const edges = (p: Plan, id: string) => p.connections.filter((e) => e.from === id).map((e) => `${e.to}:${e.label ?? ""}:${e.kind ?? ""}`).sort().join("|");
  const added = b.components.filter((c) => !before.has(c.id)).map((c) => c.id);
  const removed = a.components.filter((c) => !after.has(c.id)).map((c) => c.id);
  const changed = b.components
    .filter((c) => before.has(c.id) && (!same({ ...before.get(c.id), id: 0 }, { ...c, id: 0 }) || edges(a, c.id) !== edges(b, c.id)))
    .map((c) => c.id);
  return { added, changed, removed };
}

/** Like `diff`, for tables, decisions and open questions (by id). */
export function diffExtras(a: Plan, b: Plan) {
  const cmp = <T extends { id: string }>(x: T[] = [], y: T[] = []) => {
    const bx = new Map(x.map((i) => [i.id, i]));
    const by = new Map(y.map((i) => [i.id, i]));
    return {
      added: y.filter((i) => !bx.has(i.id)),
      changed: y.filter((i) => bx.has(i.id) && !same(bx.get(i.id), i)),
      removed: x.filter((i) => !by.has(i.id)),
    };
  };
  return { tables: cmp(a.tables, b.tables), decisions: cmp(a.decisions, b.decisions), questions: cmp(a.questions, b.questions) };
}

export const changesLabel = (c: Changes) =>
  [c.added.length ? `+${c.added.length}` : "", c.changed.length ? `~${c.changed.length}` : "", c.removed.length ? `−${c.removed.length}` : ""].filter(Boolean).join(" ") || "no changes";

export const isEmpty = (c: Changes) => !c.added.length && !c.changed.length && !c.removed.length;
