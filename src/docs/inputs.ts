import { archSubject, hashOf, projectSubject, tableSubject } from "../summary/subjects";
import { edgeBetween, unitFiles, type DocsCtx, type PageDef } from "./outline";

/** What a page is written from: the description, the files Claude reads, and what makes it stale. */
export type PageInput = {
  hash: string;
  prompt: string;
  /** Files whose source goes into the prompt. */
  files: { path: string; label: string }[];
  /** Every file the page depends on ("repo/path" → content hash), to say which ones changed. */
  inputs: Record<string, string>;
  /** The prose blocks Strata asks for: key and heading. */
  slots: { key: string; heading?: string }[];
};

const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));
const fileHash = (ctx: DocsCtx, id: string) => String(ctx.nodes.get(id)?.meta?.hash ?? ctx.nodes.get(id)?.meta?.lines ?? "");
const labelOf = (ctx: DocsCtx, id: string) => {
  const f = ctx.nodes.get(id);
  return f?.path ? `${ctx.repoName(f.repoId)}/${f.path}` : id;
};
const inputsOf = (ctx: DocsCtx, fileIds: string[]) => Object.fromEntries(fileIds.slice(0, 400).map((f) => [labelOf(ctx, f), fileHash(ctx, f)]));
const abs = (ctx: DocsCtx, label: string) => {
  const f = ctx.fileByLabel.get(label);
  const repo = ctx.project.repos.find((r) => r.id === f?.repoId);
  return f && repo ? `${repo.path}/${f.path}` : null;
};

/** Asks for one text per slot, in order. */
function textsRequest(slots: { key: string; heading?: string }[], what: string) {
  return [
    `Write ${slots.length} short sections for this ${what}, in this order:`,
    ...slots.map((s, i) => `${i + 1}. ${s.heading}`),
    `Reply with JSON: {"texts": ["…", …]} — exactly ${slots.length} strings, one per section, each 2–5 sentences.`,
  ].join("\n");
}

const SLOTS = {
  start: [
    { key: "what", heading: "What this system is" },
    { key: "how", heading: "How the parts fit together" },
  ],
  section: [
    { key: "overview", heading: "Overview" },
    { key: "together", heading: "How they work together" },
  ],
  component: [
    { key: "what", heading: "What it does" },
    { key: "how", heading: "How it works" },
    { key: "working", heading: "Working on it" },
  ],
  data: [
    { key: "about", heading: "What this data is about" },
    { key: "use", heading: "How it's used" },
  ],
};

export function pageInput(ctx: DocsCtx, page: PageDef, summaries: Map<string, string>): PageInput {
  const { arch, graph, project } = ctx;
  const name = (id: string) => arch.byId.get(id)?.name ?? id;

  if (page.kind === "start") {
    const s = projectSubject(project, arch, graph, summaries);
    const slots = SLOTS.start;
    return { hash: s.hash, prompt: `Page: "Start here", the first page a new developer reads.\n${s.prompt}\n\n${textsRequest(slots, "overview page")}`, files: s.files, inputs: {}, slots };
  }

  if (page.kind === "component") {
    const s = archSubject(project, arch, graph, page.node!)!;
    const own = unitFiles(ctx, page.node!);
    const slots = SLOTS.component;
    const filesList = `Files (${own.length}): ${list(own.map((f) => labelOf(ctx, f.id)), 40)}.`;
    return { hash: s.hash, prompt: `Page about the component "${page.title}".\n${s.prompt}\n${filesList}\n\n${textsRequest(slots, "component page")}`, files: s.files, inputs: inputsOf(ctx, own.map((f) => f.id)), slots };
  }

  if (page.kind === "section") {
    const members = page.members!;
    const lines = members.map((m) => {
      const n = arch.byId.get(m)!;
      return `- ${n.name} [${n.kind}] ${n.detail}${summaries.get(m) ? ` — ${summaries.get(m)}` : ""}`;
    });
    const inside = new Set(members);
    const links = arch.edges.filter((e) => inside.has(e.source) || inside.has(e.target)).slice(0, 40).map((e) => `- ${name(e.source)} → ${name(e.target)}: ${e.reasons.slice(0, 2).join("; ")}`);
    const slots = SLOTS.section;
    return {
      // Summaries only enrich the prompt; a new summary shouldn't make the page stale.
      hash: hashOf(...members.map((m) => `${m}|${arch.byId.get(m)?.detail}`), ...links),
      prompt: [`Page "${page.title}" of the project "${project.name}": a group of components that sit in the same column of the architecture map.`, "Components:", ...lines, links.length ? "Connections:" : "", ...links, "", textsRequest(slots, "page")].filter((x) => x !== "").join("\n"),
      files: [],
      inputs: {},
      slots,
    };
  }

  if (page.kind === "data") {
    const subjects = page.tables!.map((t) => tableSubject(project, ctx.db, t)).filter((x): x is NonNullable<typeof x> => !!x);
    const slots = SLOTS.data;
    const files = [...new Set(page.tables!.flatMap((t) => ctx.db.tables.get(t)?.writers ?? []))];
    return {
      hash: hashOf(...subjects.map((s) => s.hash)),
      prompt: [`Page "${page.title}" about the database tables of the project "${project.name}".`, ...subjects.slice(0, 30).map((s) => s.prompt), "", textsRequest(slots, "data model page")].join("\n\n"),
      files: [],
      inputs: inputsOf(ctx, files),
      slots,
    };
  }

  if (page.kind === "flow") {
    const cvName = (id: string) => ctx.cv.byId.get(id)?.name ?? id;
    const steps = page.steps!;
    const hops = steps.slice(1).map((to, i) => ({ from: steps[i], to, edge: edgeBetween(ctx, steps[i], to) }));
    const fileIds = [...new Set(hops.flatMap((h) => h.edge?.files.slice(0, 2) ?? []))];
    const files = fileIds.map((f) => labelOf(ctx, f)).flatMap((l) => (abs(ctx, l) ? [{ path: abs(ctx, l)!, label: l }] : [])).slice(0, 5);
    const slots = [{ key: "intro" }, ...steps.map((s, i) => ({ key: `step:${i}`, heading: cvName(s) }))];
    return {
      hash: hashOf(...steps, ...hops.map((h) => h.edge?.reasons.join() ?? ""), ...fileIds.map((f) => fileHash(ctx, f))),
      prompt: [
        `Page "${page.title}": the main path a request takes through the project "${project.name}", starting at ${cvName(steps[0])}.`,
        "Steps:",
        ...steps.map((s, i) => `${i + 1}. ${cvName(s)} [${ctx.cv.byId.get(s)?.kind}] ${ctx.cv.byId.get(s)?.detail ?? ""}${summaries.get(s) ? ` — ${summaries.get(s)}` : ""}`),
        "Connections:",
        ...hops.map((h) => `- ${cvName(h.from)} → ${cvName(h.to)}: ${h.edge?.reasons.slice(0, 3).join("; ") ?? "connected"}`),
        "",
        `Reply with JSON: {"intro": "…", "steps": ["…", …]} — a 1–2 sentence intro, then exactly ${steps.length} strings, one per step, each 1–3 sentences on what happens at that step.`,
      ].join("\n"),
      files,
      inputs: inputsOf(ctx, fileIds),
      slots,
    };
  }

  // Glossary: the words of the domain, from table, component and type names.
  const tables = [...ctx.db.tables.values()].map((t) => `${t.name} (${t.columns.slice(0, 8).map((c) => c.name).join(", ")})`);
  const types = graph.nodes.filter((n) => n.kind === "symbol" && n.meta?.exported && /type|interface|class|enum/.test(n.meta?.symbolKind ?? "")).map((n) => n.name);
  const comps = arch.nodes.filter((n) => n.kind !== "Missing").map((n) => `${n.name} [${n.kind}]`);
  return {
    hash: hashOf(...tables, ...types.slice(0, 200), ...comps),
    prompt: [
      `Page "Domain terms": a glossary of the business words a new developer meets in the project "${project.name}".`,
      `Tables: ${list(tables, 60)}.`,
      types.length ? `Exported types: ${list([...new Set(types)], 120)}.` : "",
      `Components: ${list(comps, 40)}.`,
      "",
      'Pick the 8–16 most important domain terms (business concepts, not technologies like React or Postgres). Reply with JSON: {"terms": [{"term": "…", "text": "…"}]} — each text 1–2 sentences, linking the table, type or component where the term lives.',
    ]
      .filter(Boolean)
      .join("\n"),
    files: [],
    inputs: {},
    slots: [],
  };
}

/** Claude's JSON → texts per slot key (and headings for the glossary, whose terms Claude picks). */
export function parseReply(page: PageDef, input: PageInput, json: string): { key: string; heading?: string; text: string }[] {
  const raw = JSON.parse(json);
  if (page.kind === "glossary") {
    const terms = Array.isArray(raw?.terms) ? raw.terms : [];
    return terms
      .filter((t: any) => t?.term && t?.text)
      .slice(0, 20)
      .map((t: any) => ({ key: `term:${String(t.term).toLowerCase()}`, heading: String(t.term), text: String(t.text) }));
  }
  if (page.kind === "flow") {
    const steps: unknown[] = Array.isArray(raw?.steps) ? raw.steps : [];
    return input.slots.map((s, i) => ({ ...s, text: String(i === 0 ? raw?.intro ?? "" : steps[i - 1] ?? "") })).filter((b) => b.text);
  }
  const texts: unknown[] = Array.isArray(raw?.texts) ? raw.texts : [];
  return input.slots.map((s, i) => ({ ...s, text: String(texts[i] ?? "") })).filter((b) => b.text);
}
