import { Project, timeAgo } from "../api";
import { Route } from "../routes";
import { ProjectTile } from "../components/ProjectTile";

function lastScan(p: Project): number | null {
  const times = p.repos.map((r) => r.lastScanAt).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

function Health({ project }: { project: Project }) {
  if (project.repos.length === 0) return <span className="badge">No repos</span>;
  if (project.repos.some((r) => r.scanStatus === "failed")) return <span className="badge" style={{ color: "var(--err-text)" }}>Scan failed</span>;
  if (project.repos.some((r) => r.scanStatus === "scanning")) return <span className="badge">Scanning…</span>;
  if (project.repos.every((r) => r.scanStatus === "never")) return <span className="badge">Not scanned</span>;
  return (
    <span className="badge">
      <span className="repo-dot" style={{ background: "var(--ok)" }} />
      Healthy
    </span>
  );
}

/** Until the scanner has built a graph, the thumbnail shows one block per repo. */
function Thumb({ project }: { project: Project }) {
  if (project.repos.length === 0) {
    return <div className="faint" style={{ fontSize: 12.5 }}>No repos yet</div>;
  }
  if (project.logo) {
    return <ProjectTile name={project.name} color={project.color} logo={project.logo} size={64} />;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 220 }}>
      {project.repos.slice(0, 6).map((r) => (
        <div
          key={r.id}
          style={{
            width: 46,
            height: 22,
            borderRadius: 5,
            border: `1px ${r.scanStatus === "ok" ? "solid" : "dashed"} ${project.color}88`,
            background: project.color + "1F",
          }}
        />
      ))}
    </div>
  );
}

export function ProjectsPage({ projects, navigate }: { projects: Project[]; navigate: (r: Route) => void }) {
  const repoCount = new Set(projects.flatMap((p) => p.repos.map((r) => r.id))).size;

  return (
    <div className="page">
      <div className="page-inner">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 className="title">Projects</h1>
            <div className="subtitle">
              {projects.length} {projects.length === 1 ? "project" : "projects"} · {repoCount} {repoCount === 1 ? "repository" : "repositories"}
            </div>
          </div>
          <button className="btn primary" onClick={() => navigate({ page: "create" })}>
            + New project
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {projects.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}
              onClick={() => navigate({ page: "project", id: p.id, lens: "home" })}
            >
              <div className="dots" style={{ height: 130, display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)" }}>
                <Thumb project={p} />
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ProjectTile name={p.name} color={p.color} logo={p.logo} size={24} />
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{p.name}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.repos.map((r) => (
                    <span key={r.id} className="chip">
                      <span className="repo-dot" style={{ width: 6, height: 6, background: p.color }} />
                      {r.name}
                    </span>
                  ))}
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--text-3)" }}>
                  <span>{lastScan(p) ? `Scanned ${timeAgo(lastScan(p))}` : "Never scanned"}</span>
                  <Health project={p} />
                </div>
              </div>
            </div>
          ))}

          <div
            className="card"
            style={{ minHeight: 260, display: "grid", placeItems: "center", cursor: "pointer", borderStyle: "dashed", boxShadow: "none", background: "transparent" }}
            onClick={() => navigate({ page: "create" })}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 34, height: 34, margin: "0 auto 10px", borderRadius: 9, background: "var(--chip)", display: "grid", placeItems: "center", fontSize: 18 }}>+</div>
              <div style={{ fontWeight: 600 }}>New project</div>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>
                Group repos into one system
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
