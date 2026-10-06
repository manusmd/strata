import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type Repo = {
  id: string;
  name: string;
  path: string;
  remote: string | null;
  lastScanAt: number | null;
  scanStatus: "never" | "scanning" | "ok" | "failed";
  scanError: string | null;
  stats: ScanStats | null;
  /** Other projects this repo also belongs to. */
  alsoIn: string[];
};

export type ScanStats = { files: number; tables?: number; units?: number; symbols: number; imports: number; unresolved: number; packages: number; parse_errors: number };

export type GraphNode = {
  id: string;
  repoId: string | null;
  kind: "folder" | "file" | "symbol" | "package" | "table" | "unit" | "infra";
  name: string;
  path: string | null;
  parentId: string | null;
  meta: Record<string, any>;
};
export type GraphEdge = { src: string; dst: string; kind: string };
export type PackageUse = { repoId: string; name: string; uses: number; declared: boolean };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; packages: PackageUse[] };

export type ScanProgress = { repoId: string; done: number; total: number };
export type ScanFinished = { repoId: string; error: string | null };

export type Project = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  repos: Repo[];
};

export const PROJECT_COLORS = ["#8B5CF6", "#6366F1", "#14B8A6", "#F59E0B", "#E879A0", "#9B9A97"];

export const api = {
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string, color: string, paths: string[]) => invoke<string>("create_project", { name, color, paths }),
  updateProject: (id: string, name: string, color: string) => invoke<void>("update_project", { id, name, color }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  addRepo: (projectId: string, path: string) => invoke<string>("add_repo", { projectId, path }),
  scanProject: (projectId: string) => invoke<void>("scan_project", { projectId }),
  scanRepo: (repoId: string) => invoke<void>("scan_repo", { repoId }),
  getGraph: (projectId: string) => invoke<Graph>("get_graph", { projectId }),
  workspacePackages: () => invoke<import("./map/archModel").WorkspacePackage[]>("workspace_packages"),
  removeRepo: (projectId: string, repoId: string) => invoke<void>("remove_repo", { projectId, repoId }),
  currentUser: () => invoke<string>("current_user"),
};

/** Opens the native folder picker. Returns the chosen folders (possibly none). */
export async function pickFolders(): Promise<string[]> {
  const picked = await open({ directory: true, multiple: true, title: "Add repositories" });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function timeAgo(secs: number | null): string {
  if (!secs) return "never";
  const d = Math.max(0, Date.now() / 1000 - secs);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** "~/dev/api" instead of "/Users/me/dev/api". */
export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
