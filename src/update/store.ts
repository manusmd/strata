import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdateInfo = { version: string; currentVersion: string; notes: string | null; date: string | null };

type State = {
  version: string;
  status: "idle" | "checking" | "available" | "upToDate" | "installing" | "error";
  info: UpdateInfo | null;
  /** 0–1 while downloading, null when the size is unknown. */
  progress: number | null;
  error: string | null;
  /** The user said "Later" for this version: no card until the next launch or a newer version. */
  dismissed: string | null;
  /** The last check was started by the user, so "you're up to date" and errors are worth showing. */
  manual: boolean;
};

let state: State = { version: "", status: "idle", info: null, progress: null, error: null, dismissed: null, manual: false };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((s) => s());
};

const EVERY = 6 * 60 * 60 * 1000;
let started = false;

export const updateStore = {
  /** Once at app start: read the version, check shortly after launch, then every few hours. */
  start() {
    if (started) return;
    started = true;
    invoke<string>("app_version").then((version) => set({ version })).catch(() => {});
    listen<{ downloaded: number; total: number | null }>("update-progress", (e) => set({ progress: e.payload.total ? e.payload.downloaded / e.payload.total : null }));
    setTimeout(() => updateStore.check(false), 4000);
    setInterval(() => updateStore.check(false), EVERY);
  },

  async check(manual = true) {
    if (state.status === "checking" || state.status === "installing") return;
    set({ status: "checking", error: null, manual });
    try {
      const info = await invoke<UpdateInfo | null>("check_update");
      set({ status: info ? "available" : "upToDate", info });
    } catch (e) {
      // Background checks fail quietly (offline, feed not published yet); manual ones say why.
      set({ status: "error", error: String(e) });
    }
  },

  async install() {
    set({ status: "installing", progress: 0, error: null, manual: true });
    try {
      await invoke("install_update"); // restarts the app when done
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  /** Shows the card again after "Later". */
  show() {
    set({ dismissed: null });
  },

  later() {
    set({ dismissed: state.info?.version ?? null, manual: false });
  },

  /** Hides "up to date" / error notices. */
  clear() {
    set({ manual: false, status: state.info ? "available" : "idle" });
  },
};

export function useUpdate() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}
