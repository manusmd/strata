use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::scanner::ScanResult;

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- A repo exists once per workspace and can belong to several projects.
CREATE TABLE IF NOT EXISTS repos (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE,
  remote        TEXT,
  last_scan_at  INTEGER,
  scan_status   TEXT NOT NULL DEFAULT 'never',  -- never | scanning | ok | failed
  scan_error    TEXT,
  stats         TEXT,                           -- JSON ScanStats of the last scan
  package_name  TEXT                            -- `name` from package.json, links repos together
);

CREATE TABLE IF NOT EXISTS project_repos (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, repo_id)
);

-- The shared graph behind all three views (filled by the scanner).
CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  repo_id    TEXT REFERENCES repos(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,   -- folder | file | symbol | package (later: service | table)
  name       TEXT NOT NULL,
  path       TEXT,
  parent_id  TEXT,
  meta       TEXT             -- JSON
);
CREATE INDEX IF NOT EXISTS nodes_repo ON nodes(repo_id);

CREATE TABLE IF NOT EXISTS edges (
  repo_id  TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,  -- repo the edge was found in
  src      TEXT NOT NULL,
  dst      TEXT NOT NULL,
  kind     TEXT NOT NULL,     -- imports (later: calls | reads | writes)
  PRIMARY KEY (src, dst, kind)
);

-- Packages a repo imports, and whether its package.json declares them.
CREATE TABLE IF NOT EXISTS repo_packages (
  repo_id   TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  uses      INTEGER NOT NULL,
  declared  INTEGER NOT NULL,
  PRIMARY KEY (repo_id, name)
);
"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub remote: Option<String>,
    pub last_scan_at: Option<i64>,
    pub scan_status: String,
    pub scan_error: Option<String>,
    pub stats: Option<serde_json::Value>,
    /// Names of the other projects this repo also belongs to.
    pub also_in: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: i64,
    pub repos: Vec<Repo>,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let found = stmt.query_map([], |row| row.get::<_, String>(1))?.filter_map(Result::ok).any(|c| c == column);
    Ok(found)
}

/// Brings databases created by older builds up to the current schema.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for col in ["scan_error TEXT", "stats TEXT", "package_name TEXT"] {
        let name = col.split(' ').next().unwrap();
        if !has_column(conn, "repos", name)? {
            conn.execute_batch(&format!("ALTER TABLE repos ADD COLUMN {col}"))?;
        }
    }
    if !has_column(conn, "edges", "repo_id")? {
        // Only ever held scanner output, which a rescan rebuilds.
        conn.execute_batch("DROP TABLE edges;")?;
        conn.execute_batch(SCHEMA)?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS edges_repo ON edges(repo_id);
         CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst);",
    )
}

pub fn open(dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(dir).ok();
    let conn = Connection::open(dir.join("strata.db"))?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    // A scan that was running when the app quit never finished.
    conn.execute(
        "UPDATE repos SET scan_status = CASE WHEN last_scan_at IS NULL THEN 'never' ELSE 'ok' END WHERE scan_status = 'scanning'",
        [],
    )?;
    Ok(conn)
}

fn repos_for(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Repo>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.name, r.path, r.remote, r.last_scan_at, r.scan_status, r.scan_error, r.stats
         FROM repos r JOIN project_repos pr ON pr.repo_id = r.id
         WHERE pr.project_id = ?1 ORDER BY pr.added_at",
    )?;
    let mut repos = stmt
        .query_map([project_id], |row| {
            Ok(Repo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                remote: row.get(3)?,
                last_scan_at: row.get(4)?,
                scan_status: row.get(5)?,
                scan_error: row.get(6)?,
                stats: row.get::<_, Option<String>>(7)?.and_then(|s| serde_json::from_str(&s).ok()),
                also_in: vec![],
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut other = conn.prepare(
        "SELECT p.name FROM projects p JOIN project_repos pr ON pr.project_id = p.id
         WHERE pr.repo_id = ?1 AND p.id != ?2 ORDER BY p.name",
    )?;
    for repo in &mut repos {
        repo.also_in = other
            .query_map(params![repo.id, project_id], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
    }
    Ok(repos)
}

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<Project>> {
    let mut stmt = conn.prepare("SELECT id, name, color, created_at FROM projects ORDER BY created_at")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(id, name, color, created_at)| {
            let repos = repos_for(conn, &id)?;
            Ok(Project { id, name, color, created_at, repos })
        })
        .collect()
}

pub fn create_project(conn: &Connection, name: &str, color: &str) -> rusqlite::Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO projects (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name.trim(), color, now()],
    )?;
    Ok(id)
}

pub fn update_project(conn: &Connection, id: &str, name: &str, color: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE projects SET name = ?2, color = ?3 WHERE id = ?1", params![id, name.trim(), color])?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    prune_orphan_repos(conn)
}

/// Reads the `origin` URL from `.git/config` without shelling out to git.
fn git_remote(path: &Path) -> Option<String> {
    let config = std::fs::read_to_string(path.join(".git/config")).ok()?;
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == r#"[remote "origin"]"#;
        } else if in_origin {
            if let Some(url) = line.strip_prefix("url").map(|s| s.trim_start_matches([' ', '=']).trim()) {
                return Some(url.to_string());
            }
        }
    }
    None
}

/// Adds a local folder to a project. A folder that is already known in the
/// workspace is reused, so one repo can live in several projects.
pub fn add_local_repo(conn: &Connection, project_id: &str, path: &str) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err(format!("{} is not a folder", path.display()));
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let path_str = canonical.to_string_lossy().to_string();

    let existing: Option<String> = conn
        .query_row("SELECT id FROM repos WHERE path = ?1", [&path_str], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    let repo_id = match existing {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            let name = canonical.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path_str.clone());
            conn.execute(
                "INSERT INTO repos (id, name, path, remote) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, path_str, git_remote(&canonical)],
            )
            .map_err(|e| e.to_string())?;
            id
        }
    };

    conn.execute(
        "INSERT OR IGNORE INTO project_repos (project_id, repo_id, added_at) VALUES (?1, ?2, ?3)",
        params![project_id, repo_id, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(repo_id)
}

pub fn remove_repo(conn: &Connection, project_id: &str, repo_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM project_repos WHERE project_id = ?1 AND repo_id = ?2", [project_id, repo_id])?;
    prune_orphan_repos(conn)
}

/// Repos that no project uses any more are forgotten (their graph goes with them).
fn prune_orphan_repos(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM repos WHERE id NOT IN (SELECT repo_id FROM project_repos)", [])?;
    Ok(())
}

// ---------- Scanning ----------

pub fn repo_path(conn: &Connection, repo_id: &str) -> rusqlite::Result<String> {
    conn.query_row("SELECT path FROM repos WHERE id = ?1", [repo_id], |row| row.get(0))
}

pub fn project_repo_ids(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT repo_id FROM project_repos WHERE project_id = ?1 ORDER BY added_at")?;
    let ids = stmt.query_map([project_id], |row| row.get(0))?.collect();
    ids
}

pub fn set_scan_status(conn: &Connection, repo_id: &str, status: &str, error: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("UPDATE repos SET scan_status = ?2, scan_error = ?3 WHERE id = ?1", params![repo_id, status, error])?;
    Ok(())
}

/// Replaces everything a repo contributed to the graph with a fresh scan, atomically.
pub fn save_scan(conn: &mut Connection, repo_id: &str, scan: &ScanResult) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM edges WHERE repo_id = ?1", [repo_id])?;
    tx.execute("DELETE FROM nodes WHERE repo_id = ?1", [repo_id])?;
    tx.execute("DELETE FROM repo_packages WHERE repo_id = ?1", [repo_id])?;
    {
        let mut node = tx.prepare("INSERT OR REPLACE INTO nodes (id, repo_id, kind, name, path, parent_id, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?;
        let mut package = tx.prepare("INSERT OR IGNORE INTO nodes (id, repo_id, kind, name) VALUES (?1, NULL, 'package', ?2)")?;
        let mut usage = tx.prepare("INSERT INTO repo_packages (repo_id, name, uses, declared) VALUES (?1, ?2, ?3, ?4)")?;
        for n in &scan.nodes {
            if n.kind == "package" {
                // Package nodes are shared by every repo that imports them.
                package.execute(params![n.id, n.name])?;
                usage.execute(params![repo_id, n.name, n.meta["uses"].as_i64().unwrap_or(0), n.meta["declared"].as_bool().unwrap_or(false)])?;
            } else {
                node.execute(params![n.id, repo_id, n.kind, n.name, n.path, n.parent_id, n.meta.to_string()])?;
            }
        }
        let mut edge = tx.prepare("INSERT OR IGNORE INTO edges (repo_id, src, dst, kind) VALUES (?1, ?2, ?3, ?4)")?;
        for e in &scan.edges {
            edge.execute(params![repo_id, e.src, e.dst, e.kind])?;
        }
    }
    tx.execute(
        "UPDATE repos SET scan_status = 'ok', scan_error = NULL, last_scan_at = ?2, stats = ?3, package_name = ?4 WHERE id = ?1",
        params![repo_id, now(), serde_json::to_string(&scan.stats).unwrap_or_default(), scan.package_name],
    )?;
    // Packages nobody imports any more.
    tx.execute("DELETE FROM nodes WHERE kind = 'package' AND id NOT IN (SELECT dst FROM edges)", [])?;
    tx.commit()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRow {
    pub id: String,
    pub repo_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub meta: serde_json::Value,
}

#[derive(Serialize)]
pub struct EdgeRow {
    pub src: String,
    pub dst: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageUse {
    pub repo_id: String,
    pub name: String,
    pub uses: i64,
    pub declared: bool,
}

#[derive(Serialize)]
pub struct Graph {
    pub nodes: Vec<NodeRow>,
    pub edges: Vec<EdgeRow>,
    pub packages: Vec<PackageUse>,
}

/// Everything the map needs for one project: the graph of all its repos.
pub fn get_graph(conn: &Connection, project_id: &str) -> rusqlite::Result<Graph> {
    let in_project = "SELECT repo_id FROM project_repos WHERE project_id = ?1";
    let mut stmt = conn.prepare(&format!("SELECT id, repo_id, kind, name, path, parent_id, meta FROM nodes WHERE repo_id IN ({in_project})"))?;
    let nodes = stmt
        .query_map([project_id], |row| {
            Ok(NodeRow {
                id: row.get(0)?,
                repo_id: row.get(1)?,
                kind: row.get(2)?,
                name: row.get(3)?,
                path: row.get(4)?,
                parent_id: row.get(5)?,
                meta: row.get::<_, Option<String>>(6)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::Value::Null),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare(&format!("SELECT src, dst, kind FROM edges WHERE repo_id IN ({in_project})"))?;
    let edges = stmt
        .query_map([project_id], |row| Ok(EdgeRow { src: row.get(0)?, dst: row.get(1)?, kind: row.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare(&format!("SELECT repo_id, name, uses, declared FROM repo_packages WHERE repo_id IN ({in_project}) ORDER BY uses DESC"))?;
    let packages = stmt
        .query_map([project_id], |row| Ok(PackageUse { repo_id: row.get(0)?, name: row.get(1)?, uses: row.get(2)?, declared: row.get(3)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Graph { nodes, edges, packages })
}

/// A package some repo in the workspace provides, so a "missing" import can be traced to it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePackage {
    pub package_name: String,
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub projects: Vec<String>,
}

pub fn workspace_packages(conn: &Connection) -> rusqlite::Result<Vec<WorkspacePackage>> {
    let mut stmt = conn.prepare(
        "SELECT n.name, r.id, r.name, r.path,
                (SELECT group_concat(p.name, char(31)) FROM project_repos pr JOIN projects p ON p.id = pr.project_id WHERE pr.repo_id = r.id)
         FROM nodes n JOIN repos r ON r.id = n.repo_id WHERE n.kind = 'unit'",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WorkspacePackage {
                package_name: row.get(0)?,
                repo_id: row.get(1)?,
                repo_name: row.get(2)?,
                path: row.get(3)?,
                projects: row.get::<_, Option<String>>(4)?.map(|s| s.split('\u{1f}').map(String::from).collect()).unwrap_or_default(),
            })
        })?
        .collect();
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn repo_can_belong_to_several_projects() {
        let conn = mem();
        let dir = std::env::temp_dir().join("strata-test-repo");
        std::fs::create_dir_all(&dir).unwrap();
        let a = create_project(&conn, "Acme Cloud", "#6366F1").unwrap();
        let b = create_project(&conn, "Internal Tools", "#14B8A6").unwrap();
        add_local_repo(&conn, &a, dir.to_str().unwrap()).unwrap();
        add_local_repo(&conn, &b, dir.to_str().unwrap()).unwrap();
        add_local_repo(&conn, &b, dir.to_str().unwrap()).unwrap(); // idempotent

        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects[0].repos.len(), 1);
        assert_eq!(projects[1].repos.len(), 1);
        assert_eq!(projects[0].repos[0].id, projects[1].repos[0].id);
        assert_eq!(projects[0].repos[0].also_in, vec!["Internal Tools"]);

        remove_repo(&conn, &a, &projects[0].repos[0].id).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "still used by Internal Tools");

        delete_project(&conn, &b).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "orphaned repo is pruned");
    }

    #[test]
    fn rescan_replaces_graph_and_shares_packages() {
        use crate::scanner::{GraphEdge, GraphNode, ScanResult, ScanStats};
        use serde_json::json;
        let mut conn = mem();
        let dir = std::env::temp_dir().join("strata-test-graph");
        std::fs::create_dir_all(&dir).unwrap();
        let p = create_project(&conn, "P", "#fff").unwrap();
        add_local_repo(&conn, &p, dir.to_str().unwrap()).unwrap();
        let repo = project_repo_ids(&conn, &p).unwrap().remove(0);

        let scan = |files: &[&str]| ScanResult {
            nodes: files
                .iter()
                .map(|f| GraphNode { id: format!("{repo}:{f}"), kind: "file".into(), name: f.to_string(), path: Some(f.to_string()), parent_id: None, meta: json!({}) })
                .chain([GraphNode { id: "pkg:stripe".into(), kind: "package".into(), name: "stripe".into(), path: None, parent_id: None, meta: json!({"uses": 2, "declared": true}) }])
                .collect(),
            edges: vec![GraphEdge { src: format!("{repo}:{}", files[0]), dst: "pkg:stripe".into(), kind: "imports".into() }],
            stats: ScanStats::default(),
            package_name: Some("api".into()),
        };
        save_scan(&mut conn, &repo, &scan(&["a.ts", "b.ts"])).unwrap();
        save_scan(&mut conn, &repo, &scan(&["c.ts"])).unwrap();

        let g = get_graph(&conn, &p).unwrap();
        let files: Vec<_> = g.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(files, vec!["c.ts"], "old scan is gone; packages are not repo nodes");
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.packages[0].name, "stripe");
        assert!(g.packages[0].declared);
        let status: String = conn.query_row("SELECT scan_status FROM repos WHERE id = ?1", [&repo], |r| r.get(0)).unwrap();
        assert_eq!(status, "ok");
    }

    #[test]
    fn scan_with_schema_round_trips_through_the_database() {
        let mut conn = mem();
        let root = std::env::temp_dir().join(format!("strata-db-roundtrip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("prisma")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("prisma/schema.prisma"), "model User {\n  id String @id\n  posts Post[]\n}\nmodel Post {\n  id String @id\n  authorId String\n  author User @relation(fields: [authorId], references: [id])\n}\n").unwrap();
        std::fs::write(root.join("src/posts.ts"), "export const list = () => prisma.post.findMany();\nexport const add = () => prisma.post.create({});\n").unwrap();

        let p = create_project(&conn, "P", "#fff").unwrap();
        let repo = add_local_repo(&conn, &p, root.to_str().unwrap()).unwrap();
        let scan = crate::scanner::scan_repo(&repo, &root, |_, _| {}).unwrap();
        save_scan(&mut conn, &repo, &scan).unwrap();

        let g = get_graph(&conn, &p).unwrap();
        let tables: Vec<_> = g.nodes.iter().filter(|n| n.kind == "table").map(|n| n.name.as_str()).collect();
        assert_eq!(tables, vec!["User", "Post"]);
        let has = |src: &str, dst: &str, kind: &str| g.edges.iter().any(|e| e.src.ends_with(src) && e.dst.ends_with(dst) && e.kind == kind);
        assert!(has(":table:Post", ":table:User", "references"));
        assert!(has(":src/posts.ts", ":table:Post", "reads"));
        assert!(has(":src/posts.ts", ":table:Post", "writes"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_packages_point_at_their_repo() {
        let mut conn = mem();
        let root = std::env::temp_dir().join(format!("strata-ws-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("packages/types/src")).unwrap();
        std::fs::write(root.join("package.json"), r#"{ "name": "shared", "private": true, "workspaces": ["packages/*"] }"#).unwrap();
        std::fs::write(root.join("packages/types/package.json"), r#"{ "name": "@acme/shared-types" }"#).unwrap();
        std::fs::write(root.join("packages/types/src/index.ts"), "export type Id = string;\n").unwrap();

        let p = create_project(&conn, "Internal Tools", "#fff").unwrap();
        let repo = add_local_repo(&conn, &p, root.to_str().unwrap()).unwrap();
        let scan = crate::scanner::scan_repo(&repo, &root, |_, _| {}).unwrap();
        save_scan(&mut conn, &repo, &scan).unwrap();

        let ws = workspace_packages(&conn).unwrap();
        let types = ws.iter().find(|w| w.package_name == "@acme/shared-types").expect("nested package is listed");
        assert_eq!(types.repo_id, repo);
        assert_eq!(types.projects, vec!["Internal Tools"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}

