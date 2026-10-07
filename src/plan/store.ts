import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { askStore } from "../ask/store";
import { applyEdit, diff, diffExtras, EMPTY_PLAN, isEmpty, normalizePlan, type Changes, type Plan, type PlanEdit } from "./model";

export type VersionInfo = { version: number; title: string; changes: Changes; source: string | null; createdAt: number };

type ProjectPlan = {
  loaded: boolean;
  plan: Plan;
  version: number | null;
  versions: VersionInfo[];
  chatId: string | null;
  /** Components changed by the last update, highlighted on the canvas for a moment. */
  highlight: { changes: Changes; until: number } | null;
  error: string | null;
};

const blank: ProjectPlan = { loaded: false, plan: EMPTY_PLAN, version: null, versions: [], chatId: null, highlight: null, error: null };
let state: Record<string, ProjectPlan> = {};
const subs = new Set<() => void>();
const set = (projectId: string, patch: Partial<ProjectPlan>) => {
  state = { ...state, [projectId]: { ...(state[projectId] ?? blank), ...patch } };
  subs.forEach((s) => s());
};
const get = (projectId: string) => state[projectId] ?? blank;

const parseChanges = (raw: string): Changes => {
  try {
    const c = JSON.parse(raw);
    return { added: c.added ?? [], changed: c.changed ?? [], removed: c.removed ?? [] };
  } catch {
    return { added: [], changed: [], removed: [] };
  }
};

/** Names, not ids: they're shown in the chat and the version history. */
function namedChanges(before: Plan, after: Plan): Changes {
  const d = diff(before, after);
  const x = diffExtras(before, after);
  const name = (p: Plan) => (id: string) => p.components.find((c) => c.id === id)?.name ?? id;
  const tbl = (t: { name: string }) => `▦ ${t.name}`;
  const adr = (d: { id: string }) => `ADR ${d.id}`;
  const q = (o: { text: string }) => `? ${o.text.length > 40 ? o.text.slice(0, 38) + "…" : o.text}`;
  return {
    added: [...d.added.map(name(after)), ...x.tables.added.map(tbl), ...x.decisions.added.map(adr), ...x.questions.added.map(q)],
    changed: [...d.changed.map(name(after)), ...x.tables.changed.map(tbl), ...x.decisions.changed.map(adr), ...x.questions.changed.map(q)],
    removed: [...d.removed.map(name(before)), ...x.tables.removed.map(tbl), ...x.questions.removed.map(q)],
  };
}

// Saves are serialized per project, so two quick edits can't both build on the same version.
const queue = new Map<string, Promise<unknown>>();
function serial<T>(projectId: string, job: () => Promise<T>): Promise<T> {
  const run = (queue.get(projectId) ?? Promise.resolve()).then(job, job);
  queue.set(projectId, run.catch(() => {}));
  return run;
}

export const planStore = {
  async load(projectId: string) {
    if (get(projectId).loaded) return;
    try {
      const [chat, latest, versions] = await Promise.all([
        invoke<[string, string | null]>("plan_chat", { projectId }),
        invoke<[number, unknown] | null>("plan_get", { projectId, version: null }),
        invoke<any[]>("plan_versions", { projectId }),
      ]);
      await askStore.loadChat(chat[0], chat[1]);
      set(projectId, {
        loaded: true,
        chatId: chat[0],
        plan: latest ? normalizePlan(latest[1]) : EMPTY_PLAN,
        version: latest ? latest[0] : null,
        versions: versions.map((v) => ({ version: v.version, title: v.title, changes: parseChanges(v.changes), source: v.source, createdAt: v.createdAt })),
      });
    } catch (e) {
      set(projectId, { loaded: true, error: String(e) });
    }
  },

  /** Saves `next` as a new version (or amends the latest for the same `source`). Returns the version, or null if nothing changed. */
  save(projectId: string, next: Plan, title: string, source: string, opts: { amend?: boolean; highlight?: boolean } = {}): Promise<number | null> {
    return serial(projectId, async () => {
      const cur = get(projectId);
      const changes = namedChanges(cur.plan, next);
      if (isEmpty(changes) && cur.version !== null && !source.startsWith("restore:")) return null;
      const version = await invoke<number>("plan_save", { projectId, plan: next, title, changes: JSON.stringify(changes), source, amend: !!opts.amend });
      const info: VersionInfo = { version, title, changes, source, createdAt: Date.now() / 1000 };
      const versions = [info, ...cur.versions.filter((v) => v.version !== version)];
      set(projectId, { plan: next, version, versions, highlight: opts.highlight === false ? cur.highlight : { changes: diff(cur.plan, next), until: Date.now() + 4500 } });
      return version;
    });
  },

  /** Applies an edit Claude wrote; `source` makes it idempotent across reloads. */
  async applyClaude(projectId: string, edit: PlanEdit, source: string) {
    if (get(projectId).versions.some((v) => v.source === source)) return;
    const { plan } = applyEdit(get(projectId).plan, edit);
    await this.save(projectId, plan, edit.title, source);
  },

  async planAt(projectId: string, version: number): Promise<Plan> {
    if (version === get(projectId).version) return get(projectId).plan;
    const row = await invoke<[number, unknown] | null>("plan_get", { projectId, version });
    return row ? normalizePlan(row[1]) : EMPTY_PLAN;
  },

  /** Restoring adds a new version with the old plan, so nothing is ever lost. */
  async restore(projectId: string, version: number, title = `Restored v${version}`) {
    const plan = await this.planAt(projectId, version);
    await this.save(projectId, plan, title, `restore:${version}`);
  },

  current(projectId: string): Plan {
    return get(projectId).plan;
  },

  versionFor(projectId: string, source: string) {
    return get(projectId).versions.find((v) => v.source === source) ?? null;
  },
};

export function usePlan(projectId: string): ProjectPlan {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => get(projectId),
  );
}
