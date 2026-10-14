import { componentFacts, dataFacts, runChecklist, sectionFacts, slug, type Chip, type DocsCtx, type FactRow, type PageDef } from "./outline";
import { resolve } from "./links";
import type { StoredPage } from "./store";

const FOLDER: Record<PageDef["kind"], string> = { start: "", screens: "screens/", tasks: "", section: "system/", component: "components/", data: "data/", flow: "flows/", glossary: "" };

/** Where a page lands in the export, relative to the docs folder's parent. */
export function docPath(def: PageDef): string {
  if (def.kind === "start") return "docs/README.md";
  if (def.kind === "glossary") return "docs/glossary.md";
  if (def.kind === "tasks") return "docs/where-do-i.md";
  if (def.kind === "screens") return `docs/screens/${slug(def.id.split(":").slice(1).join("-"))}.md`;
  return `docs/${FOLDER[def.kind]}${slug(def.title)}.md`;
}

/** `from` and `to` are absolute; the result is a relative path from the folder of `from`. */
function relative(from: string, to: string): string {
  const a = from.split("/").slice(0, -1).filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

type Linker = (chip: Chip) => string;

function linker(ctx: DocsCtx, defs: PageDef[], dir: string, def: PageDef): Linker {
  const here = `${dir.replace(/\/$/, "")}/${docPath(def)}`;
  const pageOfNode = new Map(defs.filter((d) => d.node).map((d) => [d.node!, d]));
  const dataPage = (tableId: string) => defs.find((d) => d.tables?.includes(tableId));
  const fileAbs = (id: string) => {
    const f = ctx.nodes.get(id);
    const repo = ctx.project.repos.find((r) => r.id === f?.repoId);
    return f?.path && repo ? `${repo.path}/${f.path}` : null;
  };
  return (chip) => {
    const toPage = (d: PageDef | undefined, anchor = "") => (d ? `[${chip.label}](${relative(here, `${dir.replace(/\/$/, "")}/${docPath(d)}`)}${anchor})` : `\`${chip.label}\``);
    if (chip.kind === "component") return toPage(pageOfNode.get(chip.target!));
    if (chip.kind === "route") return toPage(defs.find((d) => d.screens?.some((s) => s.path === chip.target)), `#${slug(chip.label)}`);
    if (chip.kind === "table") return toPage(dataPage(chip.target!), `#${slug(chip.label)}`);
    if ((chip.kind === "file" || chip.kind === "symbol") && chip.target) {
      const to = fileAbs(chip.target);
      return to ? `[${chip.label}](${relative(here, to)})` : `\`${chip.label}\``;
    }
    return `\`${chip.label}\``;
  };
}

/** Link tokens become Markdown links; names Strata can't find become code. */
function prose(ctx: DocsCtx, text: string, link: Linker): string {
  return text.replace(/\[\[(component|file|table|symbol):([^\]]+)\]\]/g, (_, kind, value) => {
    const chip = resolve(ctx, kind, value);
    return chip ? link(chip) : `\`${String(value).replace(/^.*\//, "")}\``;
  });
}

function facts(rows: FactRow[], link: Linker): string {
  return rows.map((r) => `- **${r.label}:** ${r.items.map((i) => (i.kind === "text" || i.kind === "env" ? `\`${i.label}\`${i.sub ? ` (${i.sub})` : ""}` : link(i))).join(", ")}`).join("\n");
}

export function pageMarkdown(ctx: DocsCtx, defs: PageDef[], def: PageDef, page: StoredPage | undefined, dir: string): string {
  const link = linker(ctx, defs, dir, def);
  const out: string[] = [`# ${def.kind === "start" ? ctx.project.name : def.title}`, ""];
  const blocks = page?.blocks ?? [];
  const block = (key: string) => blocks.find((b) => b.key === key);
  const section = (b: { heading?: string; text: string }) => out.push(...(b.heading ? [`## ${b.heading}`, ""] : []), prose(ctx, b.text, link), "");

  if (def.kind === "component") {
    out.push(facts(componentFacts(ctx, def.node!), link), "");
    blocks.forEach(section);
  } else if (def.kind === "section") {
    out.push(facts(sectionFacts(ctx, def.members!), link), "");
    blocks.forEach(section);
  } else if (def.kind === "data") {
    out.push(facts(dataFacts(ctx, def.tables!), link), "");
    blocks.forEach(section);
    out.push("## Tables", "");
    for (const id of def.tables!) {
      const t = ctx.db.tables.get(id);
      if (!t) continue;
      out.push(`### ${t.name}`, "", "| Column | Type | Key |", "| --- | --- | --- |", ...t.columns.map((c) => `| ${c.name} | ${c.type}${c.nullable ? "?" : ""} | ${c.pk ? "PK" : c.fk ? `FK → ${c.fk.table}` : ""} |`), "");
    }
  } else if (def.kind === "flow") {
    const intro = block("intro");
    if (intro) out.push(prose(ctx, intro.text, link), "");
    def.steps!.forEach((s, i) => {
      const n = ctx.cv.byId.get(s) ?? ctx.arch.byId.get(s);
      const b = block(`step:${i}`);
      out.push(`${i + 1}. ${n ? link({ kind: "component", label: n.name, target: n.id }) : s}${b ? ` — ${prose(ctx, b.text, link)}` : ""}`);
    });
    out.push("");
  } else if (def.kind === "screens") {
    const intro = block("intro");
    if (intro) out.push(prose(ctx, intro.text, link), "");
    for (const s of def.screens!) {
      const f = ctx.nodes.get(s.fileId);
      const b = block(`screen:${s.path}`);
      out.push(`### ${s.path}`, "");
      if (b) out.push(prose(ctx, b.text, link), "");
      out.push(`- **Page:** ${f ? link({ kind: "file", label: f.path ?? s.path, target: f.id }) : s.path}`);
      if (s.uses.length) out.push(`- **Uses:** ${s.uses.map((u) => `\`${u}\``).join(", ")}`);
      if (s.tables.length) out.push(`- **Data:** ${s.tables.map((t) => `\`${t}\``).join(", ")}`);
      out.push("");
    }
  } else if (def.kind === "tasks") {
    for (const b of blocks) out.push(`- **${b.heading}** — ${prose(ctx, b.text, link)}`);
    out.push("");
  } else if (def.kind === "glossary") {
    for (const b of blocks) out.push(`**${b.heading}** — ${prose(ctx, b.text, link)}`, "");
  } else {
    blocks.forEach(section);
    const run = runChecklist(ctx);
    if (run.length) out.push("## How to run it locally", "", ...run.map((c) => `- [ ] ${c.text}${c.code ? `: \`${c.code}\`` : ""}`), "");
    out.push("## Pages", "", ...defs.filter((d) => d !== def).map((d) => `- [${d.title}](${relative(`${dir}/${docPath(def)}`, `${dir}/${docPath(d)}`)}) — ${d.group}`), "");
  }
  if (!page) out.push("_Not written yet. Open this page in Strata to write it._", "");
  out.push(`<!-- Generated by Strata from a scan of the code${page ? ` on ${new Date(page.writtenAt).toISOString().slice(0, 10)}` : ""}. Facts come from the scan; prose is written by Claude and edited by people. -->`, "");
  return out.join("\n");
}

export function exportFiles(ctx: DocsCtx, defs: PageDef[], pages: Record<string, StoredPage>, dir: string) {
  return defs.map((d) => ({ path: docPath(d), title: d.title, content: pageMarkdown(ctx, defs, d, pages[d.id], dir) }));
}
