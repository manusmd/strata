import { useSyncExternalStore } from "react";
import { api, type Project, type Summary } from "../api";
import type { Subject } from "./subjects";

type Entry = { summary?: Summary; pending?: boolean; error?: string };
type State = Record<string, Record<string, Entry>>; // projectId -> nodeId -> entry

let state: State = {};
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const set = (projectId: string, nodeId: string, entry: Entry) => {
  state = { ...state, [projectId]: { ...(state[projectId] ?? {}), [nodeId]: entry } };
  emit();
};
const loaded = new Set<string>();

// Pre-generation shouldn't flood the CLI: a small queue in front of the backend's own limit.
const MAX_PARALLEL = 3;
let running = 0;
const queue: (() => Promise<void>)[] = [];
const pump = () => {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
};

export const summaryStore = {
  async load(projectId: string, force = false) {
    if (loaded.has(projectId) && !force) return;
    loaded.add(projectId);
    const rows = await api.projectSummaries(projectId).catch(() => [] as Summary[]);
    const map: Record<string, Entry> = { ...(state[projectId] ?? {}) };
    for (const r of rows) map[r.nodeId] = { ...map[r.nodeId], summary: r };
    state = { ...state, [projectId]: map };
    emit();
  },

  get(projectId: string, nodeId: string): Entry | undefined {
    return state[projectId]?.[nodeId];
  },

  /** True when there's no summary yet, or the item changed since it was written. */
  needs(projectId: string, subject: Subject): boolean {
    const e = state[projectId]?.[subject.nodeId];
    return !e?.pending && (!e?.summary || e.summary.hash !== subject.hash);
  },

  request(project: Project, subject: Subject, opts: { priority?: boolean } = {}): Promise<void> {
    const prev = state[project.id]?.[subject.nodeId];
    if (prev?.pending) return Promise.resolve();
    set(project.id, subject.nodeId, { ...prev, pending: true, error: undefined });
    return new Promise((resolve) => {
      const job = async () => {
        try {
          const text = await api.summarize({ projectId: project.id, nodeId: subject.nodeId, hash: subject.hash, prompt: subject.prompt, files: subject.files, model: project.aiModel });
          set(project.id, subject.nodeId, { summary: { nodeId: subject.nodeId, hash: subject.hash, text, model: project.aiModel, createdAt: Date.now() / 1000 } });
        } catch (e) {
          set(project.id, subject.nodeId, { ...prev, pending: false, error: String(e) });
        }
        resolve();
      };
      // What you just clicked jumps the queue.
      opts.priority ? queue.unshift(job) : queue.push(job);
      pump();
    });
  },

  /** AI sections plan for a lens, stored like a summary under `plan:<lens>`. */
  requestPlan(project: Project, lens: string, hash: string, prompt: string): Promise<void> {
    const nodeId = `plan:${lens}`;
    const prev = state[project.id]?.[nodeId];
    if (prev?.pending) return Promise.resolve();
    set(project.id, nodeId, { ...prev, pending: true, error: undefined });
    return api
      .organize(project.id, lens, hash, prompt, project.aiModel)
      .then((text) => set(project.id, nodeId, { summary: { nodeId, hash, text, model: project.aiModel, createdAt: Date.now() / 1000 } }))
      .catch((e) => set(project.id, nodeId, { ...prev, pending: false, error: String(e) }));
  },

  async clear(projectId: string) {
    await api.clearSummaries(projectId);
    state = { ...state, [projectId]: {} };
    emit();
  },

  /** Plain text of all summaries of a project (for Ask Strata and search). */
  texts(projectId: string): Map<string, string> {
    return new Map(Object.entries(state[projectId] ?? {}).flatMap(([id, e]) => (e.summary ? [[id, e.summary.text] as [string, string]] : [])));
  },
};

export function useSummaries(projectId: string): Record<string, Entry> {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state[projectId] ?? EMPTY,
  );
}
const EMPTY: Record<string, Entry> = {};
