import type { Graph, GraphNode, Repo } from "../api";

export type FileInfo = {
  id: string;
  repoId: string;
  path: string;
  name: string;
  clusterId: string;
  lines: number;
  parseError: boolean;
  symbols: GraphNode[];
  imports: string[]; // file ids
  importedBy: string[]; // file ids
  packages: string[]; // package names
  tables: { id: string; name: string; read: boolean; write: boolean }[];
};

/** A folder that directly contains files. Nested folders are flattened into their own clusters. */
export type Cluster = {
  id: string;
  repoId: string;
  dir: string; // repo-relative, "" for the repo root
  files: FileInfo[];
};

/** A folder that groups sub-folders on the map (single-child chains like `apps/web/src` are merged). */
export type FolderGroup = {
  kind: "group";
  id: string;
  repoId: string;
  dir: string;
  label: string; // relative to the enclosing group
  children: MapItem[];
  fileCount: number;
};
export type ClusterItem = { kind: "cluster"; cluster: Cluster; label: string };
export type MapItem = FolderGroup | ClusterItem;

export type RepoBox = {
  id: string;
  name: string;
  clusters: Cluster[];
  items: MapItem[];
  fileCount: number;
};

/** A package that code imports but no package.json declares — usually a repo that isn't connected yet. */
export type GhostPackage = { id: string; name: string; uses: number; repoIds: string[] };

export type CodeModel = {
  repos: RepoBox[];
  files: Map<string, FileInfo>;
  clusters: Map<string, Cluster>;
  clusterEdges: { source: string; target: string; count: number }[];
  ghosts: GhostPackage[];
  ghostEdges: { source: string; target: string; count: number }[];
  /** Parent group/repo of every group and cluster, for walking up the hierarchy. */
  parentOf: Map<string, string>;
};

export const clusterIdFor = (repoId: string, dir: string) => `${repoId}:dir:${dir}`;
export const ghostIdFor = (name: string) => `ghost:${name}`;
export const groupIdFor = (repoId: string, dir: string) => `${repoId}:group:${dir}`;

type Trie = { dir: string; cluster?: Cluster; subs: Map<string, Trie> };

function relLabel(dir: string, base: string): string {
  if (dir === base) return "./";
  const rel = base ? dir.slice(base.length + 1) : dir;
  return rel || "/";
}

/** Turns a repo's folders into nested map items, merging folders that only wrap one sub-folder. */
function buildItems(repoId: string, clusters: Cluster[]): MapItem[] {
  const root: Trie = { dir: "", subs: new Map() };
  for (const c of clusters) {
    let node = root;
    if (c.dir) {
      for (const seg of c.dir.split("/")) {
        const dir = node.dir ? `${node.dir}/${seg}` : seg;
        if (!node.subs.has(seg)) node.subs.set(seg, { dir, subs: new Map() });
        node = node.subs.get(seg)!;
      }
    }
    node.cluster = c;
  }
  const count = (items: MapItem[]): number => items.reduce((n, i) => n + (i.kind === "group" ? i.fileCount : i.cluster.files.length), 0);

  const toItems = (node: Trie, base: string): MapItem[] => {
    // Skip through folders that hold no files and a single sub-folder.
    while (!node.cluster && node.subs.size === 1) node = [...node.subs.values()][0];
    const subs = [...node.subs.values()].sort((a, b) => a.dir.localeCompare(b.dir));
    if (subs.length === 0) return node.cluster ? [{ kind: "cluster", cluster: node.cluster, label: relLabel(node.cluster.dir, base) }] : [];
    const inner: MapItem[] = [];
    if (node.cluster) inner.push({ kind: "cluster", cluster: node.cluster, label: `${node.dir.split("/").pop() || "/"}/` });
    for (const sub of subs) inner.push(...toItems(sub, node.dir));
    if (node.dir === base) return inner; // the repo root itself
    return [{ kind: "group", id: groupIdFor(repoId, node.dir), repoId, dir: node.dir, label: relLabel(node.dir, base), children: inner, fileCount: count(inner) }];
  };
  let items = toItems(root, "");
  // A repo that keeps everything in one folder (e.g. `src/`) doesn't need that extra frame.
  while (items.length === 1 && items[0].kind === "group") items = items[0].children;
  return items;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function buildCodeModel(graph: Graph, repos: Repo[]): CodeModel {
  const files = new Map<string, FileInfo>();
  const symbolsByFile = new Map<string, GraphNode[]>();

  for (const n of graph.nodes) {
    if (n.kind === "symbol" && n.parentId) {
      const list = symbolsByFile.get(n.parentId) ?? [];
      list.push(n);
      symbolsByFile.set(n.parentId, list);
    }
  }
  for (const n of graph.nodes) {
    if (n.kind !== "file" || !n.repoId || !n.path) continue;
    files.set(n.id, {
      id: n.id,
      repoId: n.repoId,
      path: n.path,
      name: n.name,
      clusterId: clusterIdFor(n.repoId, dirOf(n.path)),
      lines: n.meta?.lines ?? 0,
      parseError: !!n.meta?.parseError,
      symbols: (symbolsByFile.get(n.id) ?? []).sort((a, b) => (a.meta?.line ?? 0) - (b.meta?.line ?? 0)),
      imports: [],
      importedBy: [],
      packages: [],
      tables: [],
    });
  }

  for (const e of graph.edges) {
    const src = files.get(e.src);
    if (!src) continue;
    if (e.dst.startsWith("pkg:")) {
      src.packages.push(e.dst.slice(4));
      continue;
    }
    if (e.kind === "reads" || e.kind === "writes") {
      const name = e.dst.slice(e.dst.indexOf(":table:") + 7);
      let t = src.tables.find((x) => x.id === e.dst);
      if (!t) src.tables.push((t = { id: e.dst, name, read: false, write: false }));
      if (e.kind === "reads") t.read = true;
      else t.write = true;
      continue;
    }
    const dst = files.get(e.dst);
    if (!dst) continue;
    src.imports.push(dst.id);
    dst.importedBy.push(src.id);
  }

  const clusters = new Map<string, Cluster>();
  for (const f of [...files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    let c = clusters.get(f.clusterId);
    if (!c) {
      c = { id: f.clusterId, repoId: f.repoId, dir: dirOf(f.path), files: [] };
      clusters.set(c.id, c);
    }
    c.files.push(f);
  }

  const repoBoxes: RepoBox[] = repos
    .filter((r) => r.scanStatus === "ok" || [...clusters.values()].some((c) => c.repoId === r.id))
    .map((r) => {
      const own = [...clusters.values()].filter((c) => c.repoId === r.id).sort((a, b) => a.dir.localeCompare(b.dir));
      return { id: r.id, name: r.name, clusters: own, items: buildItems(r.id, own), fileCount: own.reduce((n, c) => n + c.files.length, 0) };
    })
    .filter((r) => r.clusters.length > 0);

  // Aggregate file imports into folder-to-folder edges.
  const agg = new Map<string, number>();
  for (const f of files.values()) {
    for (const t of f.imports) {
      const target = files.get(t)!;
      if (target.clusterId === f.clusterId) continue;
      const key = `${f.clusterId}\u0000${target.clusterId}`;
      agg.set(key, (agg.get(key) ?? 0) + 1);
    }
  }
  const clusterEdges = [...agg].map(([k, count]) => {
    const [source, target] = k.split("\u0000");
    return { source, target, count };
  });

  // Undeclared packages become ghosts on the map.
  const undeclared = new Map<string, GhostPackage>();
  for (const p of graph.packages) {
    if (p.declared) continue;
    const g = undeclared.get(p.name) ?? { id: ghostIdFor(p.name), name: p.name, uses: 0, repoIds: [] };
    g.uses += p.uses;
    g.repoIds.push(p.repoId);
    undeclared.set(p.name, g);
  }
  const ghosts = [...undeclared.values()].sort((a, b) => b.uses - a.uses);
  const ghostAgg = new Map<string, number>();
  for (const f of files.values()) {
    for (const p of f.packages) {
      if (!undeclared.has(p)) continue;
      const key = `${f.clusterId}\u0000${ghostIdFor(p)}`;
      ghostAgg.set(key, (ghostAgg.get(key) ?? 0) + 1);
    }
  }
  const ghostEdges = [...ghostAgg].map(([k, count]) => {
    const [source, target] = k.split("\u0000");
    return { source, target, count };
  });

  const parentOf = new Map<string, string>();
  const walk = (items: MapItem[], parent: string) => {
    for (const it of items) {
      const id = it.kind === "group" ? it.id : it.cluster.id;
      parentOf.set(id, parent);
      if (it.kind === "group") walk(it.children, it.id);
    }
  };
  for (const r of repoBoxes) walk(r.items, r.id);

  return { repos: repoBoxes, files, clusters, clusterEdges, ghosts, ghostEdges, parentOf };
}

/** Folder label shown on the map; the repo root is shown as "/". */
export function clusterLabel(c: Cluster): string {
  return c.dir === "" ? "/" : c.dir;
}
