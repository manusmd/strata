import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, Project } from "../api";
import type { WorkspacePackage } from "../map/archModel";
import { scoreItem } from "./fuzzy";
import { KIND_ICON, KIND_LABEL, buildIndex, type ItemKind, type PaletteItem } from "./index";

type Props = {
  projects: Project[];
  current: Project | null;
  graph: Graph | null;
  workspace: WorkspacePackage[];
  onPick: (item: PaletteItem, query: string) => void;
  onClose: () => void;
};

const PER_GROUP = 5;
const ORDER: ItemKind[] = ["component", "file", "symbol", "table", "folder", "action"];

// Recently opened items stay on top of the empty state (per app session).
const recent: string[] = [];
export function rememberPick(key: string) {
  const i = recent.indexOf(key);
  if (i !== -1) recent.splice(i, 1);
  recent.unshift(key);
  recent.length = Math.min(recent.length, 6);
}

function Highlight({ text, idx }: { text: string; idx: number[] }) {
  if (!idx.length) return <>{text}</>;
  const set = new Set(idx);
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <Fragment key={i}>{ch}</Fragment>))}
    </>
  );
}

export function Palette({ projects, current, graph, workspace, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const index = useMemo(() => (current && graph ? buildIndex(current, graph, workspace) : []), [current, graph, workspace]);

  const actions = useMemo<PaletteItem[]>(() => {
    const a: PaletteItem[] = [];
    if (current) {
      a.push(
        { key: "go:code", kind: "action", title: "Go to Code view", subtitle: "Folders, files and imports", tag: "View", color: "var(--code)", action: "lens:code" },
        { key: "go:arch", kind: "action", title: "Go to Architecture view", subtitle: "Apps, services, data and external APIs", tag: "View", color: "var(--arch)", action: "lens:arch" },
        { key: "go:db", kind: "action", title: "Go to Database view", subtitle: "Tables and relations", tag: "View", color: "var(--db)", action: "lens:db" },
        { key: "rescan", kind: "action", title: "Rescan project", subtitle: `Scan all repos of ${current.name} again`, tag: "Action", color: "var(--text-3)", action: "rescan" },
        { key: "settings", kind: "action", title: "Project settings", subtitle: current.name, tag: "Action", color: "var(--text-3)", action: "settings" },
      );
    }
    for (const p of projects) if (p.id !== current?.id) a.push({ key: `project:${p.id}`, kind: "action", title: `Open ${p.name}`, subtitle: `${p.repos.length} repos`, tag: "Project", color: p.color, action: `project:${p.id}` });
    a.push(
      { key: "new", kind: "action", title: "New project", subtitle: "Group repos into one system", tag: "Action", color: "var(--text-3)", action: "new" },
      { key: "all", kind: "action", title: "All projects", subtitle: "Projects overview", tag: "Action", color: "var(--text-3)", action: "home" },
      { key: "theme", kind: "action", title: "Toggle light / dark mode", subtitle: "", tag: "Action", color: "var(--text-3)", action: "theme" },
    );
    return a;
  }, [projects, current]);

  const ask: PaletteItem | null = current && query.trim() ? { key: "ask", kind: "action", title: `Ask Strata: “${query.trim()}”`, subtitle: "Claude reads the code and answers", tag: "⌘↵", color: "var(--arch)", action: "ask" } : null;

  // Results: grouped by kind, best group first; the empty state shows recent picks and actions.
  const rows = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const byKey = new Map([...index, ...actions].map((i) => [i.key, i]));
      const rec = recent.map((k) => byKey.get(k)).filter(Boolean) as PaletteItem[];
      return [
        ...(rec.length ? [{ group: "Recent", items: rec.map((item) => ({ item, idx: [] as number[] })) }] : []),
        { group: "Actions", items: actions.slice(0, 8).map((item) => ({ item, idx: [] as number[] })) },
      ];
    }
    const scored: { item: PaletteItem; idx: number[]; score: number }[] = [];
    for (const item of [...index, ...actions]) {
      const m = scoreItem(q, item.title, item.subtitle);
      if (m) scored.push({ item, idx: m.titleIdx, score: m.score + (item.boost ?? 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    const groups = new Map<ItemKind, { item: PaletteItem; idx: number[]; score: number }[]>();
    for (const s of scored) {
      const g = groups.get(s.item.kind) ?? [];
      if (g.length < PER_GROUP) g.push(s);
      groups.set(s.item.kind, g);
    }
    const ordered = [...groups].sort((a, b) => b[1][0].score - a[1][0].score || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
    const out = ordered.map(([kind, items]) => ({ group: KIND_LABEL[kind], items }));
    if (ask) out.push({ group: "Ask", items: [{ item: ask, idx: [], score: 0 }] });
    return out;
  }, [query, index, actions, ask]);

  const flat = rows.flatMap((r) => r.items.map((i) => i.item));
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind !== "action") rememberPick(item.key);
    onPick(item, query.trim());
  };

  let n = 0;
  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-search">⌕</span>
          <input
            ref={input}
            value={query}
            placeholder={current ? "Search files, symbols, tables, components — or ask a question" : "Search projects and actions"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(e.metaKey && ask ? ask : flat[active]);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <span className="palette-kbd">esc</span>
        </div>
        <div className="palette-list" ref={list}>
          {rows.map((r) => (
            <div key={r.group}>
              <div className="palette-group">{r.group}</div>
              {r.items.map(({ item, idx }) => {
                const i = n++;
                return (
                  <div key={item.key} data-row={i} className={`palette-row ${i === active ? "on" : ""}`} onMouseMove={() => setActive(i)} onClick={() => pick(item)}>
                    <span className="palette-icon" style={{ color: item.color, background: `color-mix(in srgb, ${item.color} 14%, transparent)` }}>
                      {KIND_ICON[item.kind]}
                    </span>
                    <span className="palette-title">
                      <Highlight text={item.title} idx={idx} />
                    </span>
                    <span className="palette-sub"><bdi>{item.subtitle}</bdi></span>
                    <span className="palette-tag">{item.tag}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="palette-footer">
          <span><b>↑↓</b> navigate</span>
          <span><b>↵</b> open</span>
          {current && <span><b>⌘↵</b> ask Strata</span>}
          <span style={{ marginLeft: "auto" }}>{index.length ? `${index.length.toLocaleString()} things indexed` : ""}</span>
        </div>
      </div>
    </div>
  );
}
