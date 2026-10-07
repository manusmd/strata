import type { Graph, Project } from "../api";
import type { ArchModel } from "../map/archModel";
import type { DbModel } from "../map/dbModel";
import type { CodeModel, FileInfo } from "../map/model";

/** Something on a map that can be summarized: what Strata knows, which files to read, and a hash of both. */
export type Subject = { nodeId: string; hash: string; prompt: string; files: { path: string; label: string }[] };

/** FNV-1a (32 bit) over a string — enough to notice that an item's inputs changed. */
export function hashOf(...parts: (string | number | undefined | null)[]): string {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x1f;
  }
  return h.toString(16).padStart(8, "0");
}

const repoOf = (project: Project, id: string | null) => project.repos.find((r) => r.id === id);
const abs = (project: Project, repoId: string, rel: string) => `${repoOf(project, repoId)?.path ?? ""}/${rel}`;
const label = (project: Project, repoId: string, rel: string) => `${repoOf(project, repoId)?.name ?? "repo"}/${rel}`;
const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));
const ENTRY = /^(index|main|server|app|cli|worker|mod)\.(m?[tj]sx?)$/;

// ---------- Code lens ----------

export function fileSubject(project: Project, code: CodeModel, graph: Graph, fileId: string): Subject | null {
  const f = code.files.get(fileId);
  if (!f) return null;
  const hash = graph.nodes.find((n) => n.id === fileId)?.meta?.hash ?? hashOf(f.lines, f.symbols.length);
  const path = (id: string) => code.files.get(id)?.path ?? id;
  const prompt = [
    `File ${label(project, f.repoId, f.path)} (${f.lines} lines).`,
    f.symbols.length ? `Top-level declarations: ${list(f.symbols.map((s) => `${s.name} (${s.meta?.symbolKind}${s.meta?.exported ? ", exported" : ""})`))}.` : "",
    f.imports.length ? `Imports: ${list(f.imports.map(path))}.` : "",
    f.packages.length ? `Packages: ${list(f.packages)}.` : "",
    f.importedBy.length ? `Imported by ${f.importedBy.length} files, e.g. ${list(f.importedBy.map(path), 6)}.` : "Nothing in the project imports it.",
    f.tables.length ? `Database: ${f.tables.map((t) => `${t.read && t.write ? "reads and writes" : t.write ? "writes" : "reads"} ${t.name}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { nodeId: fileId, hash, prompt, files: [{ path: abs(project, f.repoId, f.path), label: label(project, f.repoId, f.path) }] };
}

function folderFiles(code: CodeModel, repoId: string, dir: string): FileInfo[] {
  return [...code.files.values()].filter((f) => f.repoId === repoId && (!dir || f.path.startsWith(`${dir}/`)));
}

export function folderSubject(project: Project, code: CodeModel, graph: Graph, id: string): Subject | null {
  const cluster = code.clusters.get(id);
  const groupMatch = id.includes(":group:") ? { repoId: id.slice(0, id.indexOf(":group:")), dir: id.slice(id.indexOf(":group:") + 7) } : null;
  const repoId = cluster?.repoId ?? groupMatch?.repoId;
  const dir = cluster?.dir ?? groupMatch?.dir;
  if (!repoId || dir === undefined) return null;
  const files = cluster ? cluster.files : folderFiles(code, repoId, dir);
  if (!files.length) return null;
  const hashes = new Map(graph.nodes.filter((n) => n.kind === "file").map((n) => [n.id, n.meta?.hash]));
  const inside = new Set(files.map((f) => f.id));
  const outside = new Map<string, number>();
  const users = new Map<string, number>();
  for (const f of files) {
    for (const t of f.imports) if (!inside.has(t)) outside.set(code.files.get(t)!.clusterId, (outside.get(code.files.get(t)!.clusterId) ?? 0) + 1);
    for (const s of f.importedBy) if (!inside.has(s)) users.set(code.files.get(s)!.clusterId, (users.get(code.files.get(s)!.clusterId) ?? 0) + 1);
  }
  const dirName = (cid: string) => code.clusters.get(cid)?.dir || "/";
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => dirName(c));
  const exported = files.flatMap((f) => f.symbols.filter((s) => s.meta?.exported).map((s) => s.name));
  const tables = [...new Set(files.flatMap((f) => f.tables.map((t) => t.name)))];
  const prompt = [
    `Folder ${label(project, repoId, dir || ".")} with ${files.length} source files${cluster ? "" : " (including sub-folders)"}.`,
    `Files: ${list(files.map((f) => f.path.slice(dir ? dir.length + 1 : 0)), 25)}.`,
    exported.length ? `Exported names: ${list(exported, 30)}.` : "",
    outside.size ? `Uses code from: ${list(top(outside))}.` : "",
    users.size ? `Used by: ${list(top(users))}.` : "",
    tables.length ? `Touches database tables: ${list(tables)}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  // A README or the folder's entry file says the most about it.
  const entry = files.filter((f) => ENTRY.test(f.name)).sort((a, b) => a.path.length - b.path.length)[0];
  const popular = [...files].sort((a, b) => b.importedBy.length - a.importedBy.length).filter((f) => f !== entry).slice(0, 1);
  const read = [
    { path: abs(project, repoId, `${dir ? `${dir}/` : ""}README.md`), label: label(project, repoId, `${dir ? `${dir}/` : ""}README.md`) },
    ...[entry, ...popular].filter(Boolean).map((f) => ({ path: abs(project, repoId, f!.path), label: label(project, repoId, f!.path) })),
  ];
  return { nodeId: id, hash: hashOf(...files.map((f) => hashes.get(f.id) ?? f.lines).sort()), prompt, files: read };
}

// ---------- Database lens ----------

export function tableSubject(project: Project, db: DbModel, id: string): Subject | null {
  const t = db.tables.get(id);
  if (!t) return null;
  const name = (tid: string) => db.tables.get(tid)?.name ?? tid.split(":").pop();
  const file = (fid: string) => db.fileNames.get(fid)?.path ?? fid;
  const out = db.relations.filter((r) => r.from === id).map((r) => `${r.fromColumn} → ${name(r.to)}.${r.toColumn}`);
  const inc = db.relations.filter((r) => r.to === id).map((r) => `${name(r.from)}.${r.fromColumn}`);
  const prompt = [
    `Database table ${t.name} (${t.origin}${t.model && t.model !== t.name ? `, model ${t.model}` : ""}), defined in ${label(project, t.repoId, t.source)}.`,
    `Columns: ${list(t.columns.map((c) => `${c.name} ${c.type}${c.pk ? " PK" : ""}${c.nullable ? " nullable" : ""}`), 40)}.`,
    out.length ? `Foreign keys: ${list(out)}.` : "",
    inc.length ? `Referenced by: ${list(inc)}.` : "",
    t.writers.length ? `Written by: ${list(t.writers.map(file), 8)}.` : "No code writes it directly.",
    t.readers.length ? `Read by: ${list(t.readers.map(file), 8)}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { nodeId: id, hash: hashOf(JSON.stringify(t.columns), [...t.readers].sort().join(), [...t.writers].sort().join()), prompt, files: [] };
}

// ---------- Architecture lens ----------

export function archSubject(project: Project, arch: ArchModel, graph: Graph, id: string): Subject | null {
  const n = arch.byId.get(id);
  if (!n) return null;
  const name = (x: string) => arch.byId.get(x)?.name ?? x;
  const out = arch.edges.filter((e) => e.source === id).map((e) => `${name(e.target)} (${e.reasons.slice(0, 2).join("; ")})`);
  const inc = arch.edges.filter((e) => e.target === id).map((e) => `${name(e.source)} (${e.reasons.slice(0, 2).join("; ")})`);
  const lines = [`${n.kind} "${n.name}": ${n.detail}.`, out.length ? `Talks to: ${list(out)}.` : "", inc.length ? `Used by: ${list(inc)}.` : ""];
  const files: Subject["files"] = [];
  const hashes = new Map(graph.nodes.filter((x) => x.kind === "file").map((x) => [x.id, x.meta?.hash]));
  let inputs: string[] = [];

  if (n.unit && n.repoId) {
    const own = [...arch.fileUnit].filter(([, u]) => u === id).map(([f]) => graph.nodes.find((x) => x.id === f)!).filter(Boolean);
    lines.push(`Package ${n.unit.packageName} in ${label(project, n.repoId, n.unit.dir || ".")}, ${n.unit.files} files.`, n.unit.deps.length ? `Dependencies: ${list(n.unit.deps, 25)}.` : "");
    const base = n.unit.dir ? `${n.unit.dir}/` : "";
    files.push({ path: abs(project, n.repoId, `${base}package.json`), label: label(project, n.repoId, `${base}package.json`) }, { path: abs(project, n.repoId, `${base}README.md`), label: label(project, n.repoId, `${base}README.md`) });
    const entries = own.filter((f) => ENTRY.test(f.name)).sort((a, b) => (a.path ?? "").split("/").length - (b.path ?? "").split("/").length).slice(0, 2);
    for (const e of entries) files.push({ path: abs(project, n.repoId, e.path!), label: label(project, n.repoId, e.path!) });
    inputs = own.map((f) => hashes.get(f.id) ?? f.id).sort();
  } else if (n.datastore) {
    const tables = graph.nodes.filter((x) => n.datastore!.tables.includes(x.id));
    lines.push(`Tables: ${list(tables.map((t) => t.name), 60)}.`);
    inputs = tables.map((t) => JSON.stringify(t.meta?.columns ?? [])).sort();
  } else {
    if (n.external?.via.length) lines.push(`Reached via: ${list(n.external.via)}.`);
    if (n.infra) lines.push(`docker-compose service${n.infra.image ? ` (image ${n.infra.image})` : ""}${n.infra.ports.length ? `, ports ${n.infra.ports.join(", ")}` : ""}.`);
    if (n.missing) lines.push(`A package that is imported but not part of this project${n.missing.repo ? `; it comes from the repo ${n.missing.repo.repoName}` : ""}.`);
    // A couple of the files that use it show how it's used.
    const users = [...new Set(arch.edges.filter((e) => e.target === id).flatMap((e) => e.files))].slice(0, 2);
    for (const f of users) {
      const node = graph.nodes.find((x) => x.id === f);
      if (node?.path && node.repoId) files.push({ path: abs(project, node.repoId, node.path), label: label(project, node.repoId, node.path) });
    }
    inputs = users.map((f) => hashes.get(f) ?? f);
  }
  return { nodeId: id, hash: hashOf(n.detail, ...out, ...inc, ...inputs), prompt: lines.filter(Boolean).join("\n"), files };
}

// ---------- Whole project ----------

/** The project as a whole, for the overview screen: built from the architecture and existing summaries. */
export function projectSubject(project: Project, arch: ArchModel, graph: Graph, summaries: Map<string, string>): Subject {
  const name = (x: string) => arch.byId.get(x)?.name ?? x;
  const parts = arch.nodes.map((n) => `- ${n.name} [${n.kind}] ${n.detail}${summaries.get(n.id) ? ` — ${summaries.get(n.id)}` : ""}`);
  const links = arch.edges.slice(0, 60).map((e) => `- ${name(e.source)} → ${name(e.target)}: ${e.reasons.slice(0, 2).join("; ")}`);
  const files = graph.nodes.filter((n) => n.kind === "file").length;
  const tables = graph.nodes.filter((n) => n.kind === "table").length;
  const readmes = project.repos.map((r) => ({ path: `${r.path}/README.md`, label: `${r.name}/README.md` }));
  return {
    nodeId: "project",
    hash: hashOf(files, tables, ...arch.nodes.map((n) => `${n.id}|${n.detail}`), ...arch.edges.map((e) => e.id)),
    prompt: [
      `The whole software project "${project.name}" (${project.repos.length} repos, ${files} source files, ${tables} database tables). Summarize what the system is and how its main parts fit together, in 3 sentences.`,
      "Components:",
      ...parts,
      links.length ? "Connections:" : "",
      ...links,
    ]
      .filter(Boolean)
      .join("\n"),
    files: readmes,
  };
}
