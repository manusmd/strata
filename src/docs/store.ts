import { useSyncExternalStore } from "react";
import { api, type Project } from "../api";
import { pageInput, parseReply } from "./inputs";
import type { DocsCtx, PageDef } from "./outline";

/** A prose block. Claude's blocks are rewritten on refresh; blocks a person wrote never are. */
export type Block = {
  key: string;
  heading?: string;
  text: string;
  /** Written (or last edited) by a person. */
  human?: boolean;
  editedAt?: number;
  /** Claude's text before the last refresh, for "What changed". */
  prev?: string;
  /** Claude's proposed update for a human block. */
  suggestion?: string;
};

export type StoredPage = {
  id: string;
  /** Hash of what the page was written from; differs from the current one when the code changed. */
  hash: string;
  writtenAt: number;
  model: string;
  /** Files Claude read ("repo/path"). */
  read: string[];
  /** Files the page depends on, with their content hashes then. */
  inputs: Record<string, string>;
  blocks: Block[];
};

type ProjectState = {
  pages: Record<string, StoredPage>;
  pending: Record<string, boolean>;
  errors: Record<string, string>;
  /** "Write all": how far it got, and whether it's paused. */
  run: { total: number; done: number; paused: boolean; current: string | null } | null;
  /** Counts saves, so "Keep in sync" can re-export after each one. */
  rev: number;
};

const EMPTY: ProjectState = { pages: {}, pending: {}, errors: {}, run: null, rev: 0 };
let state: Record<string, ProjectState> = {};
const subs = new Set<() => void>();
const get = (id: string) => state[id] ?? EMPTY;
const update = (id: string, fn: (s: ProjectState) => ProjectState) => {
  state = { ...state, [id]: fn(get(id)) };
  subs.forEach((s) => s());
};
const loaded = new Set<string>();

// Claude writes two pages at a time; "Write all" fills a queue that can pause.
const PARALLEL = 2;
let running = 0;
type Job = { projectId: string; pageId: string; run: () => Promise<void> };
let queue: Job[] = [];
const pump = () => {
  while (running < PARALLEL) {
    const i = queue.findIndex((j) => !get(j.projectId).run?.paused);
    if (i < 0) return;
    const [job] = queue.splice(i, 1);
    running++;
    job.run().finally(() => {
      running--;
      pump();
    });
  }
};

/** Merges a fresh reply into the stored page: human blocks keep their text and get a suggestion instead. */
function merge(old: StoredPage | undefined, fresh: { key: string; heading?: string; text: string }[]): Block[] {
  const before = new Map((old?.blocks ?? []).map((b) => [b.key, b]));
  const blocks: Block[] = fresh.map((f) => {
    const b = before.get(f.key);
    if (b?.human) return { ...b, suggestion: f.text.trim() !== b.text.trim() ? f.text : undefined };
    return { key: f.key, heading: f.heading, text: f.text, prev: b && b.text.trim() !== f.text.trim() ? b.text : undefined };
  });
  // Something a person wrote stays, even when Claude no longer has a block for it.
  const keys = new Set(blocks.map((b) => b.key));
  for (const b of old?.blocks ?? []) if (b.human && !keys.has(b.key)) blocks.push(b);
  return blocks;
}

async function save(projectId: string, page: StoredPage) {
  update(projectId, (s) => ({ ...s, pages: { ...s.pages, [page.id]: page }, rev: s.rev + 1 }));
  await api.saveDocPage(projectId, page.id, JSON.stringify(page)).catch((e) => console.error("saving docs page failed", e));
}

export const docsStore = {
  async load(projectId: string) {
    if (loaded.has(projectId)) return;
    loaded.add(projectId);
    const rows = await api.docPages(projectId).catch(() => []);
    const pages: Record<string, StoredPage> = {};
    for (const r of rows) {
      try {
        pages[r.pageId] = JSON.parse(r.content);
      } catch {}
    }
    update(projectId, (s) => ({ ...s, pages: { ...pages, ...s.pages } }));
  },

  /** Queues Claude for one page. `priority` puts it first (the page you're looking at). */
  write(project: Project, ctx: DocsCtx, def: PageDef, summaries: Map<string, string>, priority = false): Promise<void> {
    if (get(project.id).pending[def.id]) return Promise.resolve();
    update(project.id, (s) => ({ ...s, pending: { ...s.pending, [def.id]: true }, errors: { ...s.errors, [def.id]: "" } }));
    return new Promise((resolve) => {
      const run = async () => {
        const input = pageInput(ctx, def, summaries);
        update(project.id, (s) => (s.run ? { ...s, run: { ...s.run, current: def.id } } : s));
        try {
          const json = await api.writeDocPage({ projectId: project.id, nodeId: `docs:${def.id}`, hash: input.hash, prompt: input.prompt, files: input.files, model: project.aiModel });
          const fresh = parseReply(def, input, json, ctx);
          if (!fresh.length) throw new Error("Claude's page was empty.");
          const old = get(project.id).pages[def.id];
          await save(project.id, { id: def.id, hash: input.hash, writtenAt: Date.now(), model: project.aiModel, read: input.files.map((f) => f.label), inputs: input.inputs, blocks: merge(old, fresh) });
        } catch (e) {
          update(project.id, (s) => ({ ...s, errors: { ...s.errors, [def.id]: String(e) } }));
        }
        update(project.id, (s) => {
          const pending = { ...s.pending };
          delete pending[def.id];
          const run = s.run ? { ...s.run, done: s.run.done + 1 } : null;
          return { ...s, pending, run: run && run.done >= run.total ? null : run };
        });
        resolve();
      };
      const job = { projectId: project.id, pageId: def.id, run };
      priority ? queue.unshift(job) : queue.push(job);
      pump();
    });
  },

  /** "Write all docs" / "Refresh all": every given page, two at a time, with progress. */
  writeAll(project: Project, ctx: DocsCtx, defs: PageDef[], summaries: Map<string, string>) {
    const todo = defs.filter((d) => !get(project.id).pending[d.id]);
    if (!todo.length) return;
    update(project.id, (s) => ({ ...s, run: { total: (s.run?.total ?? 0) + todo.length, done: s.run?.done ?? 0, paused: false, current: null } }));
    for (const d of todo) docsStore.write(project, ctx, d, summaries);
  },

  togglePause(projectId: string) {
    update(projectId, (s) => (s.run ? { ...s, run: { ...s.run, paused: !s.run.paused } } : s));
    pump();
  },

  /** Saves a person's text: from now on the block is theirs. */
  async edit(projectId: string, pageId: string, key: string, text: string) {
    const page = get(projectId).pages[pageId];
    if (!page) return;
    await save(projectId, { ...page, blocks: page.blocks.map((b) => (b.key === key ? { ...b, text, human: true, editedAt: Date.now(), prev: undefined, suggestion: undefined } : b)) });
  },

  async resolveSuggestion(projectId: string, pageId: string, key: string, accept: boolean) {
    const page = get(projectId).pages[pageId];
    if (!page) return;
    await save(projectId, { ...page, blocks: page.blocks.map((b) => (b.key !== key ? b : accept && b.suggestion ? { ...b, text: b.suggestion, suggestion: undefined, editedAt: Date.now() } : { ...b, suggestion: undefined })) });
  },

  /** Hides "What changed" once it has been read. */
  async clearPrev(projectId: string, pageId: string) {
    const page = get(projectId).pages[pageId];
    if (!page || !page.blocks.some((b) => b.prev)) return;
    await save(projectId, { ...page, blocks: page.blocks.map(({ prev: _p, ...b }) => b) });
  },
};

export function useDocs(projectId: string): ProjectState {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => get(projectId),
  );
}

/** Files that changed since the page was written ("repo/path"), newest knowledge from the scan. */
export function changedFiles(page: StoredPage, current: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [label, hash] of Object.entries(page.inputs)) if (current[label] !== hash) out.push(label);
  for (const label of Object.keys(current)) if (!(label in page.inputs)) out.push(label);
  return out;
}
