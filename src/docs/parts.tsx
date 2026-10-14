import { useRef, useState, type ReactNode } from "react";
import { KIND_COLOR } from "../map/archModel";
import { segments, type DiffRun } from "./links";
import type { Chip, DocsCtx } from "./outline";

const CHIP_COLOR: Record<string, string> = { route: "var(--warn)", component: "var(--arch)", file: "var(--code)", symbol: "var(--code)", table: "var(--db)", env: "var(--text-3)", text: "var(--text-3)" };
const OPEN_LABEL: Record<string, string> = { route: "Show the screen", component: "Open in Architecture", file: "Open in Code", symbol: "Open in Code", table: "Open in Database" };

export type ChipProps = {
  ctx: DocsCtx;
  summaries: Map<string, string>;
  onOpen: (chip: Chip) => void;
  /** Opens a component's docs page, when it has one. */
  docsPageOf?: (chip: Chip) => (() => void) | null;
};

/** What a chip points at, for the hover card. */
function preview(chip: Chip, { ctx, summaries }: ChipProps): { kind: string; where: string; title: string; sum?: string; rows?: [string, string, string][]; talks?: string[] } | null {
  if (chip.kind === "component") {
    const n = ctx.cv.byId.get(chip.target!) ?? ctx.arch.byId.get(chip.target!);
    if (!n) return null;
    const m = ctx.cv.byId.has(n.id) ? ctx.cv : ctx.arch;
    const talks = m.edges.filter((e) => e.source === n.id && !e.minor).map((e) => m.byId.get(e.target)?.name).filter((x): x is string => !!x);
    return { kind: n.kind.toUpperCase(), where: n.unit ? `${ctx.repoName(n.repoId)}${n.unit.dir ? `/${n.unit.dir}` : ""}` : n.detail, title: n.name, sum: summaries.get(n.id) ?? n.detail, talks: talks.slice(0, 6) };
  }
  if (chip.kind === "table") {
    const t = ctx.db.tables.get(chip.target!);
    if (!t) return null;
    const cols = t.columns.slice(0, 6).map((c): [string, string, string] => [c.name, c.type, c.pk ? "PK" : c.fk ? "FK" : ""]);
    if (t.columns.length > 6) cols.push([`+${t.columns.length - 6} more`, "", ""]);
    return { kind: "TABLE", where: `${ctx.repoName(t.repoId)}/${t.source}`, title: t.name, sum: summaries.get(t.id), rows: cols };
  }
  if (chip.kind === "file" || chip.kind === "symbol") {
    const f = ctx.nodes.get(chip.target!);
    if (!f) return null;
    const symbols = ctx.graph.nodes.filter((n) => n.kind === "symbol" && n.parentId === f.id).slice(0, 6);
    return {
      kind: chip.kind === "symbol" ? "SYMBOL" : "FILE",
      where: ctx.repoName(f.repoId),
      title: chip.kind === "symbol" ? `${chip.label} · ${f.path}` : f.path ?? f.name,
      sum: summaries.get(f.id) ?? `${f.meta?.lines ?? "?"} lines${symbols.length ? ` · declares ${symbols.map((s) => s.name).join(", ")}` : ""}`,
    };
  }
  return null;
}

/** An inline reference: click opens it in its lens, hover shows what it is. */
export function RefChip({ chip, ...props }: ChipProps & { chip: Chip }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const clickable = !!chip.target;
  const card = open ? preview(chip, props) : null;
  const docs = open && props.docsPageOf ? props.docsPageOf(chip) : null;
  const enter = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 280);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 150);
  };
  return (
    <span className="doc-chip-wrap" onMouseEnter={clickable ? enter : undefined} onMouseLeave={clickable ? leave : undefined}>
      <button className={`doc-chip k-${chip.kind}`} style={{ ["--c" as any]: CHIP_COLOR[chip.kind] }} disabled={!clickable} onClick={() => clickable && props.onOpen(chip)}>
        {chip.label}
        {chip.sub && <span className="doc-chip-sub">{chip.sub}</span>}
      </button>
      {card && (
        <span className="doc-pop glass" onMouseEnter={enter} onMouseLeave={leave}>
          <span className="doc-pop-head">
            <span className="mono" style={{ color: CHIP_COLOR[chip.kind], fontWeight: 600, fontSize: 10.5, letterSpacing: ".05em" }}>{card.kind}</span>
            <span className="faint" style={{ marginLeft: "auto", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.where}</span>
          </span>
          <span className="mono" style={{ fontWeight: 600, fontSize: 13, wordBreak: "break-all" }}>{card.title}</span>
          {card.sum && <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{card.sum}</span>}
          {card.rows && (
            <span className="doc-pop-cols">
              {card.rows.map(([n, t, k]) => (
                <span key={n} className="mono">
                  <span style={{ flex: 1 }}>{n}</span>
                  <span className="faint">{t}</span>
                  <span style={{ width: 18, textAlign: "right", fontSize: 10.5, fontWeight: 600, color: k === "PK" ? "#F59E0B" : "#818CF8" }}>{k}</span>
                </span>
              ))}
            </span>
          )}
          {card.talks && card.talks.length > 0 && (
            <span style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", fontSize: 12 }} className="faint">
              Talks to
              {card.talks.map((t) => (
                <span key={t} className="mono doc-pop-tag">{t}</span>
              ))}
            </span>
          )}
          <span className="doc-pop-foot">
            <button className="btn small" onClick={() => props.onOpen(chip)}>
              {OPEN_LABEL[chip.kind]} ↗
            </button>
            {docs && (
              <button className="btn small ghost" onClick={docs}>
                Docs page
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

/** Claude's (or a person's) text with link tokens turned into chips. */
export function Prose({ text, ...props }: ChipProps & { text: string }) {
  return (
    <>
      {segments(props.ctx, text).map((s, i) =>
        s.t === "chip" ? <RefChip key={i} chip={s.chip} {...props} /> : s.t === "code" ? <code key={i} className="doc-code">{s.text}</code> : s.t === "bold" ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

export function Diff({ runs, show }: { runs: DiffRun[]; show: "del" | "add" }) {
  return (
    <>
      {runs
        .filter((r) => r.kind === "same" || r.kind === show)
        .map((r, i) => (
          <span key={i} className={r.kind === "same" ? undefined : `doc-diff-${r.kind}`}>
            {r.text}
          </span>
        ))}
    </>
  );
}

/** A small read-only architecture map: columns left to right, the main connections. */
export function MiniMap({ ctx, highlight, onPick, vertical }: { ctx: DocsCtx; highlight?: Set<string>; onPick: (id: string) => void; vertical?: string[] }): ReactNode {
  const W = vertical ? 168 : 124;
  const H = vertical ? 30 : 34;
  let nodes: { id: string; x: number; y: number }[];
  if (vertical) nodes = vertical.map((id, i) => ({ id, x: 0, y: i * (H + 22) }));
  else {
    const cols = [0, 1, 2, 3].map((l) => ctx.cv.nodes.filter((n) => n.layer === l && n.kind !== "Missing" && (l !== 2 || ctx.cv.edges.some((e) => e.target === n.id && e.kind !== "imports"))).slice(0, 5)).filter((c) => c.length);
    nodes = cols.flatMap((c, ci) => c.map((n, i) => ({ id: n.id, x: ci * (W + 46), y: i * (H + 12) })));
  }
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges = vertical
    ? vertical.slice(1).map((to, i) => ({ id: `${vertical[i]}>${to}`, source: vertical[i], target: to }))
    : ctx.cv.edges.filter((e) => e.kind !== "imports" && at.has(e.source) && at.has(e.target));
  const width = Math.max(...nodes.map((n) => n.x + W), W);
  const height = Math.max(...nodes.map((n) => n.y + H), H);
  return (
    <div className="doc-minimap" style={{ height: height + 32 }}>
      <div style={{ position: "absolute", left: vertical ? 12 : "50%", top: 16, width, height, transform: vertical ? undefined : "translateX(-50%)" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {edges.map((e) => {
            const a = at.get(e.source)!;
            const b = at.get(e.target)!;
            const on = !highlight || (highlight.has(e.source) && highlight.has(e.target));
            return vertical ? (
              <line key={e.id} x1={a.x + 20} y1={a.y + H} x2={b.x + 20} y2={b.y} style={{ stroke: on ? "var(--arch)" : "var(--edge)", strokeWidth: on ? 1.6 : 1, transition: "stroke .25s" }} />
            ) : (
              <path key={e.id} d={`M${a.x + W},${a.y + H / 2} C${a.x + W + 23},${a.y + H / 2} ${b.x - 23},${b.y + H / 2} ${b.x},${b.y + H / 2}`} fill="none" style={{ stroke: "var(--edge)", strokeWidth: 1 }} />
            );
          })}
        </svg>
        {nodes.map((p) => {
          const n = ctx.cv.byId.get(p.id)!;
          const dim = highlight && !highlight.has(p.id);
          return (
            <div key={p.id} className="doc-mini-node mono" title={`${n.name} · ${n.kind}`} onClick={() => onPick(p.id)} style={{ left: p.x, top: p.y, width: W, height: H, opacity: dim ? 0.45 : 1, borderColor: highlight?.has(p.id) && vertical ? "var(--arch)" : undefined }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: KIND_COLOR[n.kind], flex: "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function relTime(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
