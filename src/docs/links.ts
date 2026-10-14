import { shortName } from "../map/archModel";
import type { Chip, DocsCtx } from "./outline";

/** A piece of prose: plain text, inline code, bold, or a resolved reference. */
export type Seg = { t: "text" | "code" | "bold"; text: string } | { t: "chip"; chip: Chip };

const TOKEN = /\[\[(component|file|table|symbol):([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*/g;

/** Finds what a link token names. Unknown names stay plain text: docs never link to things that don't exist. */
export function resolve(ctx: DocsCtx, kind: string, raw: string): Chip | null {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (kind === "component") {
    const n = ctx.arch.nodes.find((x) => x.name.toLowerCase() === lower || shortName(x.unit?.packageName ?? "").toLowerCase() === lower || x.unit?.packageName.toLowerCase() === lower);
    return n ? { kind: "component", label: n.name, target: n.id } : null;
  }
  if (kind === "table") {
    const t = [...ctx.db.tables.values()].find((x) => x.name.toLowerCase() === lower || x.model?.toLowerCase() === lower);
    return t ? { kind: "table", label: t.name, target: t.id } : null;
  }
  if (kind === "file") {
    const exact = ctx.fileByLabel.get(value);
    const f = exact ?? [...ctx.fileByLabel.entries()].find(([label]) => label.endsWith(`/${value}`) || label === value)?.[1];
    return f ? { kind: "file", label: f.path ?? value, target: f.id } : null;
  }
  if (kind === "symbol") {
    const name = value.replace(/\(\)$/, "");
    const candidates = ctx.graph.nodes.filter((n) => n.kind === "symbol" && n.name === name);
    const s = candidates.find((n) => n.meta?.exported) ?? candidates[0];
    // Symbols open their file: that's where the code map can land.
    return s?.parentId ? { kind: "symbol", label: `${name}${/function|method/.test(s.meta?.symbolKind ?? "") ? "()" : ""}`, target: s.parentId } : null;
  }
  return null;
}

export function segments(ctx: DocsCtx, text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ t: "text", text: text.slice(last, m.index) });
    if (m[1]) {
      const chip = resolve(ctx, m[1], m[2]);
      out.push(chip ? { t: "chip", chip } : { t: "code", text: m[2].replace(/^.*\//, "") });
    } else if (m[3] !== undefined) out.push({ t: "code", text: m[3] });
    else out.push({ t: "bold", text: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

/** Plain words of a text without tokens, for diffs. */
export const plain = (text: string) => text.replace(/\[\[(?:component|file|table|symbol):([^\]]+)\]\]/g, (_, v) => v.replace(/^.*\//, "")).replace(/\*\*|`/g, "");

/** A word diff: unchanged, removed and added runs, for "What changed". */
export type DiffRun = { kind: "same" | "del" | "add"; text: string };
export function wordDiff(before: string, after: string): DiffRun[] {
  const a = plain(before).split(/(\s+)/);
  const b = plain(after).split(/(\s+)/);
  // LCS on words; paragraphs are short, so the quadratic table is fine.
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const runs: DiffRun[] = [];
  const push = (kind: DiffRun["kind"], text: string) => (runs.length && runs[runs.length - 1].kind === kind ? (runs[runs.length - 1].text += text) : runs.push({ kind, text }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (push("same", a[i]), i++, j++);
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return runs;
}
