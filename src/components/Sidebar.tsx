import { useState } from "react";
import { Project, Repo, ScanProgress, timeAgo } from "../api";
import { Route } from "../routes";
import { ProjectTile } from "./ProjectTile";
import { VersionButton } from "../update/UpdateCard";
import { StrataLogo } from "./StrataLogo";

type Props = {
  projects: Project[];
  route: Route;
  user: string;
  navigate: (r: Route) => void;
  onAddRepo: (projectId: string) => void;
  progress: Record<string, ScanProgress>;
};

function repoDot(repo: Repo): { color: string; anim?: string } {
  switch (repo.scanStatus) {
    case "ok":
      return { color: "var(--ok)" };
    case "scanning":
      return { color: "var(--code)", anim: "strataPulse 1.2s infinite" };
    case "failed":
      return { color: "var(--err)" };
    default:
      return { color: "var(--text-3)" };
  }
}

export function Sidebar({ projects, route, user, navigate, onAddRepo, progress }: Props) {
  const [reposOpen, setReposOpen] = useState(true);
  const activeId = route.page === "project" || route.page === "settings" ? route.id : null;
  const active = projects.find((p) => p.id === activeId) ?? null;

  return (
    <aside className="sidebar" data-tauri-drag-region>
      <div className="workspace">
        <div className="tile">{user[0]?.toUpperCase() ?? "S"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">Local workspace</div>
          <div className="sub">On this Mac</div>
        </div>
      </div>

      <div className={`sb-row ${route.page === "projects" ? "active" : ""}`} style={{ marginTop: -4 }} onClick={() => navigate({ page: "projects" })}>
        <StrataLogo size={18} />
        All projects
      </div>

      <div className="sb-section">
        <div className="sb-label">
          <span>Projects</span>
          <button className="icon-btn" title="New project" onClick={() => navigate({ page: "create" })}>
            +
          </button>
        </div>
        {projects.map((p) => (
          <div key={p.id} className={`sb-row ${p.id === activeId ? "active" : ""}`} onClick={() => navigate({ page: "project", id: p.id, lens: "home" })}>
            <ProjectTile name={p.name} color={p.color} logo={p.logo} />
            <span className="grow">{p.name}</span>
            {(p.hasPlan || p.brief) && p.repos.length === 0 && <span className="sb-plan">Plan</span>}
            <span className="count">{p.repos.length}</span>
          </div>
        ))}
        <div className="sb-row muted" onClick={() => navigate({ page: "create" })}>
          <span style={{ width: 18, textAlign: "center" }}>+</span>New project
        </div>
      </div>

      {active && (
        <div className="sb-section sb-group">
          <div className="sb-row" style={{ height: 26, gap: 6 }} onClick={() => setReposOpen((o) => !o)}>
            <span className="faint" style={{ fontSize: 12, width: 10 }}>{reposOpen ? "▾" : "▸"}</span>
            <span className="grow faint" style={{ fontSize: 12, fontWeight: 600 }}>
              {active.name} · Repositories
            </span>
            <span className="count">{active.repos.length}</span>
          </div>
          {reposOpen && (
            <>
              {active.repos.map((r) => {
                const dot = repoDot(r);
                const p = progress[r.id];
                const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <div key={r.id} title={r.scanError ?? r.path}>
                    <div className="sb-row repo-row" onClick={() => navigate({ page: "project", id: active.id, lens: "home" })}>
                      <span className="repo-dot" style={{ background: dot.color, animation: dot.anim }} />
                      <span className="grow name">{r.name}</span>
                      <span className="count">
                        {r.scanStatus === "scanning" ? `${pct}%` : r.scanStatus === "failed" ? "failed" : r.scanStatus === "never" ? "not scanned" : timeAgo(r.lastScanAt)}
                      </span>
                    </div>
                    {r.scanStatus === "scanning" && (
                      <div className="progress" style={{ margin: "0 8px 4px 40px" }}>
                        <div style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
              {active.repos.length === 0 && <div className="sb-hint">No repos yet</div>}
              <div className="sb-row muted repo-row" style={{ fontSize: 12.5 }} onClick={() => onAddRepo(active.id)}>
                + Add repo to project
              </div>
            </>
          )}

          <div
            className={`sb-row muted ${route.page === "settings" ? "active" : ""}`}
            style={{ marginTop: 6 }}
            onClick={() => navigate({ page: "settings", id: active.id })}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--text-3)" }} />
            Project settings
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} data-tauri-drag-region />

      <div className="user-row">
        <div className="avatar">{user.slice(0, 2)}</div>
        <div style={{ flex: 1 }}>{user}</div>
        <VersionButton />
      </div>
    </aside>
  );
}
