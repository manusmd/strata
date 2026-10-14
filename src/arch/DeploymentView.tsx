import { useMemo } from "react";
import type { Graph, GraphNode, Project } from "../api";
import { DEV_TOOL, imageLabel, KIND_COLOR, type ArchModel } from "../map/archModel";

type Service = { node: GraphNode; tag: { label: string; tone: "dev" | "test" | "app" | "data" | "infra" } };

const TEST_FILE = /(^|\/)(tests?|e2e|__tests__|examples?|fixtures?)\//;

/** How the system runs: compose files and their services, what's started from scripts, and the ports. */
export function DeploymentView({ project, graph, model, onSelect }: { project: Project; graph: Graph; model: ArchModel; onSelect: (id: string) => void }) {
  const repoName = (id: string | null) => project.repos.find((r) => r.id === id)?.name ?? "";
  const repoSlug = (id: string | null) => repoName(id).toLowerCase().replace(/[^a-z0-9]/g, "");

  const files = useMemo(() => {
    const byFile = new Map<string, Service[]>();
    for (const n of graph.nodes.filter((x) => x.kind === "infra")) {
      const image: string = n.meta?.image ?? "";
      const file = `${project.repos.length > 1 ? `${repoName(n.repoId)}/` : ""}${n.path ?? "docker-compose.yml"}`;
      const own = n.meta?.build !== null && n.meta?.build !== undefined ? true : repoSlug(n.repoId).length >= 4 && image.toLowerCase().replace(/[^a-z0-9/]/g, "").includes(repoSlug(n.repoId));
      const tag: Service["tag"] = TEST_FILE.test(n.path ?? "")
        ? { label: "test setup", tone: "test" }
        : DEV_TOOL.test(image) || DEV_TOOL.test(n.name)
          ? { label: "dev tool", tone: "dev" }
          : own
            ? { label: "the app itself", tone: "app" }
            : imageLabel(image)
              ? { label: imageLabel(image)!, tone: /PostgreSQL|MySQL|MongoDB|Redis|Cockroach|ClickHouse|S3|Search|search/.test(imageLabel(image)!) ? "data" : "infra" }
              : { label: "service", tone: "infra" };
      byFile.set(file, [...(byFile.get(file) ?? []), { node: n, tag }]);
    }
    // Test setups last; the main compose file first.
    return [...byFile].sort(([a, sa], [b, sb]) => Number(sa.every((s) => s.tag.tone === "test")) - Number(sb.every((s) => s.tag.tone === "test")) || a.split("/").length - b.split("/").length || a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, project.repos]);

  // Parts started from package.json scripts (`npm run dev`), with their ports.
  const scripted = useMemo(
    () =>
      model.nodes
        .filter((n) => n.unit)
        .map((n) => {
          const scripts: Record<string, string> = graph.nodes.find((x) => x.id === n.id)?.meta?.scripts ?? {};
          const script = ["dev", "start", "serve"].find((s) => scripts[s]);
          return script ? { n, script, command: scripts[script] } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [model, graph],
  );

  // Every port and who listens on it; two owners on one port won't run side by side.
  const ports = useMemo(() => {
    const m = new Map<number, string[]>();
    const add = (p: number, who: string) => m.set(p, [...new Set([...(m.get(p) ?? []), who])]);
    for (const [, services] of files) for (const s of services) if (s.tag.tone !== "test") for (const p of s.node.meta?.ports ?? []) add(p, s.node.name);
    for (const { n } of scripted) for (const p of n.unit?.ports ?? []) add(p, n.name);
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [files, scripted]);

  const nothing = !files.length && !scripted.length;
  return (
    <div className="deploy">
      <div className="deploy-inner">
        <div>
          <div className="deploy-kicker">Deployment</div>
          <h2 className="deploy-title">How {project.name} runs</h2>
          <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, maxWidth: 640 }}>
            The local setup as the code describes it: docker-compose services, what's started from package.json scripts, and the ports. Dev tools and test setups live here, not on the system views.
          </div>
        </div>
        {nothing && <div className="faint" style={{ fontSize: 13.5 }}>No docker-compose files and no dev or start scripts found.</div>}

        {ports.length > 0 && (
          <section>
            <div className="deploy-h">Ports</div>
            <div className="deploy-ports">
              {ports.map(([p, who]) => (
                <span key={p} className={`deploy-port ${who.length > 1 ? "clash" : ""}`} title={who.length > 1 ? `${who.join(" and ")} both use port ${p}` : undefined}>
                  <span className="mono">:{p}</span>
                  <span>{who.join(", ")}</span>
                </span>
              ))}
            </div>
            {ports.some(([, w]) => w.length > 1) && <div className="deploy-note">Amber ports are used by more than one part; they can't run at the same time without changing one.</div>}
          </section>
        )}

        {scripted.length > 0 && (
          <section>
            <div className="deploy-h">Started from scripts</div>
            <div className="deploy-grid">
              {scripted.map(({ n, script, command }) => (
                <div key={n.id} className="deploy-card" onClick={() => onSelect(n.id)}>
                  <div className="deploy-card-head">
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[n.kind] }} />
                    <span className="mono" style={{ fontWeight: 600 }}>{n.name}</span>
                    <span className="deploy-tag">{n.kind}</span>
                  </div>
                  <code className="deploy-cmd">npm run {script}</code>
                  <div className="faint mono deploy-sub" title={command}>{command}</div>
                  {(n.unit?.ports.length ?? 0) > 0 && <div className="deploy-sub">listens on {n.unit!.ports.map((p) => `:${p}`).join(", ")}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {files.map(([file, services]) => (
          <section key={file}>
            <div className="deploy-h mono">{file}</div>
            <div className="deploy-grid">
              {services.map(({ node, tag }) => (
                <div key={node.id} className={`deploy-card tone-${tag.tone}`}>
                  <div className="deploy-card-head">
                    <span className="mono" style={{ fontWeight: 600 }}>{node.name}</span>
                    <span className={`deploy-tag tone-${tag.tone}`}>{tag.label}</span>
                  </div>
                  <div className="faint mono deploy-sub">{node.meta?.image ?? (node.meta?.build !== null && node.meta?.build !== undefined ? `built from ${node.meta.build || "."}` : "no image")}</div>
                  {(node.meta?.ports ?? []).length > 0 && <div className="deploy-sub">ports {(node.meta.ports as number[]).map((p) => `:${p}`).join(", ")}</div>}
                  {(node.meta?.dependsOn ?? []).length > 0 && <div className="deploy-sub">needs {(node.meta.dependsOn as string[]).join(", ")}</div>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
