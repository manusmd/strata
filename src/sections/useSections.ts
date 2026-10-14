import { useEffect, useMemo } from "react";
import type { Graph, Project } from "../api";
import { buildArchModel, type WorkspacePackage } from "../map/archModel";
import { buildDbModel } from "../map/dbModel";
import { buildCodeModel } from "../map/model";
import { summaryStore, useSummaries } from "../summary/store";
import { buildPlanRequest, parsePlan, planInput, type Plan, type SectionLens } from "./plan";

/**
 * The AI sections plan for a lens, if sections are switched on: the stored one
 * when the map's items haven't changed, otherwise a fresh one from Claude.
 */
export function useSectionPlan(project: Project, lens: SectionLens | null, graph: Graph | null, workspace: WorkspacePackage[], enabled: boolean) {
  const entries = useSummaries(project.id);
  const request = useMemo(() => {
    if (!enabled || !lens || !graph) return null;
    const models = lens === "arch" ? { arch: buildArchModel(graph, project.repos, workspace) } : lens === "db" ? { db: buildDbModel(graph, project.repos) } : { code: buildCodeModel(graph, project.repos) };
    const input = planInput(lens, project, graph, models, summaryStore.texts(project.id));
    if (input.items.length < 2) return null;
    // Architecture components know their column; a section sits where its most user-facing member does.
    const arch = models.arch;
    const tierOf = arch ? (members: string[]) => Math.min(...members.map((id) => arch.byId.get(id)?.layer ?? 3)) : undefined;
    return { ...buildPlanRequest(lens, project, input), tierOf };
    // Summaries only refine the plan; don't re-plan whenever one arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lens, graph, project.repos, project.name, workspace]);

  const entry = lens ? entries[`plan:${lens}`] : undefined;
  const stale = !!request && (!entry?.summary || entry.summary.hash !== request.hash);

  useEffect(() => {
    if (request && lens && stale && !entry?.pending && !entry?.error) summaryStore.requestPlan(project, lens, request.hash, request.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, stale]);

  const plan = useMemo<Plan | null>(() => {
    if (!request || !entry?.summary || entry.summary.hash !== request.hash) return null;
    try {
      return parsePlan(entry.summary.text, request.tokens, request.tierOf);
    } catch {
      return null;
    }
  }, [request, entry?.summary]);

  return {
    plan,
    pending: !!entry?.pending,
    error: entry?.error ?? null,
    retry: () => request && lens && summaryStore.requestPlan(project, lens, request.hash, request.prompt),
  };
}
