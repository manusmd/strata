/** The structured blocks Claude writes while planning, besides ```strata-plan edits. */
import { normalizePlan, type Plan } from "./model";

export type Question = { q: string; options: string[] };
export type PlanOption = { id: string; title: string; tagline: string; complexity: number; recommended: boolean; pros: string[]; cons: string[]; plan: Plan };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

function loose(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));
  }
}

/** ```strata-questions: clarifying questions with tappable answers. */
export function parseQuestions(body: string): { ok: true; questions: Question[] } | { ok: false; error: string } {
  let raw: any;
  try {
    raw = loose(body.trim());
  } catch (e) {
    return { ok: false, error: `The questions aren't valid JSON (${String(e).replace(/^SyntaxError: /, "")}).` };
  }
  const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
    .map((q: any) => ({ q: str(q?.q ?? q?.question), options: strs(q?.options, 5) }))
    .filter((q: Question) => q.q)
    .slice(0, 6);
  return questions.length ? { ok: true, questions } : { ok: false, error: "No questions in the block." };
}

/** ```strata-options: alternative architectures, each a complete plan. */
export function parseOptions(body: string): { ok: true; options: PlanOption[] } | { ok: false; error: string } {
  let raw: any;
  try {
    raw = loose(body.trim());
  } catch (e) {
    return { ok: false, error: `The options aren't valid JSON (${String(e).replace(/^SyntaxError: /, "")}).` };
  }
  const options: PlanOption[] = [];
  for (const o of Array.isArray(raw?.options) ? raw.options : []) {
    const title = str(o?.title);
    const plan = normalizePlan(o?.plan);
    if (!title || !plan.components.length) continue;
    const id = str(o?.id) || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (options.some((x) => x.id === id)) continue;
    options.push({
      id,
      title,
      tagline: str(o?.tagline ?? o?.tag),
      complexity: Math.max(1, Math.min(5, Math.round(Number(o?.complexity) || 3))),
      recommended: o?.recommended === true,
      pros: strs(o?.pros, 4),
      cons: strs(o?.cons, 4),
      plan,
    });
  }
  if (!options.length) return { ok: false, error: "No usable options in the block." };
  // Exactly one recommendation: the first marked one, else the first.
  const rec = Math.max(0, options.findIndex((o) => o.recommended));
  options.forEach((o, i) => (o.recommended = i === rec));
  return { ok: true, options: options.slice(0, 4) };
}

export const COMPLEXITY = ["Very low", "Low", "Medium", "High", "Very high"];
