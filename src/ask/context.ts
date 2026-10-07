import type { Graph, Project } from "../api";
import { buildArchModel, type WorkspacePackage } from "../map/archModel";
import { buildDbModel } from "../map/dbModel";
import type { Lens } from "../routes";

const LIMIT = 24_000; // characters; keeps the appended system prompt small

/**
 * What Strata already knows about the project, handed to Claude so it starts
 * from the map instead of exploring blind — plus the link syntax the panel
 * turns into clickable references.
 */
export function buildContext(project: Project, graph: Graph | null, workspace: WorkspacePackage[], lens: Lens, summaries: Map<string, string> = new Map()): string {
  const lines: string[] = [];
  lines.push(
    `You are "Ask Strata", answering questions about the software project "${project.name}" inside Strata, a code map app.`,
    "You can read the project's repositories with the Read, Grep and Glob tools. You cannot run commands or change anything — never offer to.",
    "Answer concisely, in the language the user writes in. Explain how things work and where they live; prefer short paragraphs and numbered steps for flows.",
    "",
    "Link every file, table and component you mention so the user can click it:",
    "- files: [checkout.service.ts](strata:file/<repo>/<repo-relative path>)  e.g. (strata:file/api/src/services/checkout.service.ts)",
    "- database tables: [orders](strata:table/<repo>/<table name>)",
    "- architecture components: [api](strata:node/<component name>)",
    "Use the repo names exactly as listed below. Only link things that exist.",
    "",
    `The user is currently looking at the ${lens === "arch" ? "Architecture" : lens === "db" ? "Database" : "Code"} view.`,
    "",
    "## Repositories",
  );
  for (const r of project.repos) lines.push(`- ${r.name}: ${r.path}${r.remote ? ` (${r.remote})` : ""}${r.stats ? ` — ${r.stats.files} files, ${r.stats.tables ?? 0} tables` : ""}`);

  if (graph) {
    const arch = buildArchModel(graph, project.repos, workspace);
    const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name ?? "";
    lines.push("", "## Architecture (derived from the code by Strata)");
    for (const n of arch.nodes) {
      const where = n.unit ? ` in ${repoName(n.repoId)}/${n.unit.dir || ""}` : "";
      const about = summaries.get(n.id);
      lines.push(`- ${n.name} [${n.kind}] ${n.detail}${where}${about ? ` — ${about}` : ""}`);
    }
    if (arch.edges.length) {
      lines.push("", "Connections:");
      for (const e of arch.edges.slice(0, 120)) lines.push(`- ${arch.byId.get(e.source)?.name} → ${arch.byId.get(e.target)?.name}: ${e.kind}, ${e.reasons.slice(0, 3).join("; ")}${e.inferred ? " (inferred)" : ""}`);
    }

    const db = buildDbModel(graph, project.repos);
    if (db.tables.size) {
      lines.push("", "## Database tables");
      for (const r of db.repos) {
        lines.push(`${r.name}:`);
        for (const t of r.tables) {
          const fks = t.columns.filter((c) => c.fk).map((c) => `${c.name}→${c.fk!.table}`);
          const about = summaries.get(t.id);
          lines.push(`- ${t.name} (${t.columns.length} cols${fks.length ? `; ${fks.join(", ")}` : ""}) — ${t.source}${about ? ` — ${about}` : ""}`);
        }
      }
    }
  }

  let text = lines.join("\n");
  if (text.length > LIMIT) text = text.slice(0, LIMIT) + "\n… (truncated)";
  return text;
}

export function suggestions(project: Project, graph: Graph | null, workspace: WorkspacePackage[]): string[] {
  const out = [`Give me a tour of ${project.name}: what are the main parts and how do they fit together?`];
  if (!graph) return out;
  const arch = buildArchModel(graph, project.repos, workspace);
  const service = arch.nodes.find((n) => n.kind === "Service");
  const app = arch.nodes.find((n) => n.kind === "App");
  const db = buildDbModel(graph, project.repos);
  const busiest = [...db.tables.values()].sort((a, b) => b.writers.length + b.readers.length - (a.writers.length + a.readers.length))[0];
  if (app && service) out.push(`How does ${app.name} talk to ${service.name}?`);
  if (busiest) out.push(`Where is the ${busiest.name} table written, and what triggers it?`);
  const missing = arch.nodes.find((n) => n.kind === "Missing");
  if (missing) out.push(`What is ${missing.name} used for here?`);
  else out.push("Where would I start to add a new feature end to end?");
  return out.slice(0, 4);
}
