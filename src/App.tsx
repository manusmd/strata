import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Project, Repo, ScanFinished, ScanProgress, api, pickFolders } from "./api";
import { Route } from "./routes";
import { Sidebar } from "./components/Sidebar";
import { ProjectsPage } from "./pages/ProjectsPage";
import { CreateProject } from "./pages/CreateProject";
import { ProjectToolbar, ProjectView, type Progress } from "./pages/ProjectView";
import type { ZoomLevel } from "./map/CodeMap";
import { Settings } from "./pages/Settings";

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const system = () => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("strata-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    return system();
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keeps the native sidebar vibrancy in the same appearance as the UI.
    getCurrentWindow().setTheme(theme).catch(() => {});
  }, [theme]);

  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("strata-theme", next);
      } catch {}
      return next;
    });
  return [theme, toggle];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [route, setRoute] = useState<Route>({ page: "projects" });
  const [user, setUser] = useState("you");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [level, setLevel] = useState<ZoomLevel>("File");
  const [zoomRequest, setZoomRequest] = useState<{ level: ZoomLevel; n: number } | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  // ⌘J toggles Ask Strata, like in the design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reload = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    api.currentUser().then(setUser).catch(() => {});
  }, [reload]);

  // Scans run in the backend; it reports progress and completion as events.
  useEffect(() => {
    const unsubs = [
      listen<ScanProgress>("scan-progress", (e) => {
        setProgress((p) => ({ ...p, [e.payload.repoId]: e.payload }));
        // The first event of a scan (0/0) means the repo just flipped to "scanning".
        if (e.payload.total === 0) reload();
      }),
      listen<ScanFinished>("scan-finished", (e) => {
        setProgress((p) => {
          const { [e.payload.repoId]: _, ...rest } = p;
          return rest;
        });
        reload();
      }),
    ];
    return () => unsubs.forEach((u) => u.then((f) => f()).catch(() => {}));
  }, [reload]);

  // Runs an action against the backend, shows its error and refreshes the list.
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(String(e));
      }
      await reload();
    },
    [reload],
  );

  const addFolders = useCallback(
    async (projectId: string) => {
      const paths = await pickFolders();
      if (paths.length)
        await act(async () => {
          for (const p of paths) await api.scanRepo(await api.addRepo(projectId, p));
        });
    },
    [act],
  );

  if (projects === null) return <div className="main" style={{ height: "100%" }} />;

  const current = route.page === "project" || route.page === "settings" ? projects.find((p) => p.id === route.id) : undefined;
  // A deleted project (or a stale route) falls back to the overview.
  if ((route.page === "project" || route.page === "settings") && !current) {
    setRoute({ page: "projects" });
    return null;
  }

  // Without any project, onboarding takes the whole window.
  if (projects.length === 0) {
    return (
      <div className="main" style={{ height: "100%" }}>
        <CreateProject
          first
          onCancel={null}
          onCreate={async (name, color, paths) => {
            const id = await api.createProject(name, color, paths);
            if (paths.length) await api.scanProject(id);
            await reload();
            setRoute({ page: "project", id, lens: "code" });
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar projects={projects} route={route} user={user} navigate={setRoute} onAddRepo={addFolders} progress={progress} />
      <main className="main">
        <header className="topbar" data-tauri-drag-region>
          <div className="crumbs" data-tauri-drag-region>
            {route.page === "projects" && <b>All projects</b>}
            {route.page === "create" && (
              <>
                <span>Projects</span>/<b>New project</b>
              </>
            )}
            {route.page === "project" && current && <b>{current.name}</b>}
            {route.page === "settings" && current && (
              <>
                <span>{current.name}</span>/<b>Settings</b>
              </>
            )}
          </div>
          {route.page === "project" && current ? (
            <ProjectToolbar
              project={current}
              lens={route.lens}
              setLens={(lens) => setRoute({ ...route, lens })}
              level={level}
              onLevel={(l) => setZoomRequest((r) => ({ level: l, n: (r?.n ?? 0) + 1 }))}
              onRescan={() => act(() => api.scanProject(current.id))}
              askOpen={askOpen}
              onToggleAsk={() => setAskOpen((o) => !o)}
            />
          ) : (
            <div className="spacer" data-tauri-drag-region />
          )}
          <button className="icon-btn" style={{ width: 28, height: 28, fontSize: 14 }} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}>
            ◐
          </button>
        </header>

        {error && (
          <div className="error-banner" style={{ margin: "12px 20px 0" }}>
            {error}
          </div>
        )}

        {route.page === "projects" && <ProjectsPage projects={projects} navigate={setRoute} />}

        {route.page === "create" && (
          <CreateProject
            first={false}
            onCancel={() => setRoute({ page: "projects" })}
            onCreate={async (name, color, paths) => {
              const id = await api.createProject(name, color, paths);
              if (paths.length) await api.scanProject(id);
              await reload();
              setRoute({ page: "project", id, lens: "code" });
            }}
          />
        )}

        {route.page === "project" && current && (
          <ProjectView
            key={current.id}
            project={current}
            allProjects={projects}
            lens={route.lens}
            setLens={(lens) => setRoute({ ...route, lens })}
            progress={progress}
            onAddFolder={() => addFolders(current.id)}
            onReuse={(repo: Repo) =>
              act(async () => {
                const id = await api.addRepo(current.id, repo.path);
                if (repo.scanStatus !== "ok") await api.scanRepo(id);
              })
            }
            onAddRepoPath={(path) =>
              act(async () => {
                await api.scanRepo(await api.addRepo(current.id, path));
              })
            }
            onScan={() => act(() => api.scanProject(current.id))}
            onLevel={setLevel}
            zoomRequest={zoomRequest}
            askOpen={askOpen}
            onCloseAsk={() => setAskOpen(false)}
          />
        )}

        {route.page === "settings" && current && (
          <Settings
            project={current}
            onSave={(name, color) => act(() => api.updateProject(current.id, name, color))}
            onAddRepo={() => addFolders(current.id)}
            onRemoveRepo={(repoId) => act(() => api.removeRepo(current.id, repoId))}
            onRescan={(repoId) => act(() => api.scanRepo(repoId))}
            onDelete={() => act(() => api.deleteProject(current.id)).then(() => setRoute({ page: "projects" }))}
          />
        )}
      </main>
    </div>
  );
}
