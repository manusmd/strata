mod db;
mod scanner;
mod schema;
mod arch;
mod ask;
mod summary;
mod logo;
mod update;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use db::{Db, Graph, Project};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Repos that currently have a scan running, so a second click doesn't start another.
#[derive(Default)]
struct Scanning(Mutex<HashSet<String>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    repo_id: String,
    done: usize,
    total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFinished {
    repo_id: String,
    error: Option<String>,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
fn list_projects(db: State<Db>) -> CmdResult<Vec<Project>> {
    db::list_projects(&db.0.lock().unwrap()).map_err(err)
}

#[tauri::command]
fn create_project(db: State<Db>, name: String, color: String, paths: Vec<String>) -> CmdResult<String> {
    let conn = db.0.lock().unwrap();
    let id = db::create_project(&conn, &name, &color).map_err(err)?;
    for path in paths {
        db::add_local_repo(&conn, &id, &path)?;
    }
    Ok(id)
}

#[tauri::command]
fn update_project(db: State<Db>, id: String, name: String, color: String) -> CmdResult<()> {
    db::update_project(&db.0.lock().unwrap(), &id, &name, &color).map_err(err)
}

#[tauri::command]
fn delete_project(db: State<Db>, id: String) -> CmdResult<()> {
    db::delete_project(&db.0.lock().unwrap(), &id).map_err(err)
}

#[tauri::command]
fn add_repo(db: State<Db>, project_id: String, path: String) -> CmdResult<String> {
    db::add_local_repo(&db.0.lock().unwrap(), &project_id, &path)
}

#[tauri::command]
fn remove_repo(db: State<Db>, project_id: String, repo_id: String) -> CmdResult<()> {
    db::remove_repo(&db.0.lock().unwrap(), &project_id, &repo_id).map_err(err)
}

fn scan_one(app: &AppHandle, repo_id: &str) -> Result<(), String> {
    let db = app.state::<Db>();
    let path = {
        let conn = db.0.lock().unwrap();
        db::set_scan_status(&conn, repo_id, "scanning", None).map_err(err)?;
        PathBuf::from(db::repo_path(&conn, repo_id).map_err(err)?)
    };
    let _ = app.emit("scan-progress", ScanProgress { repo_id: repo_id.into(), done: 0, total: 0 });

    // Parsing happens without holding the database lock; only saving needs it.
    let result = scanner::scan_repo(repo_id, &path, |done, total| {
        let _ = app.emit("scan-progress", ScanProgress { repo_id: repo_id.into(), done, total });
    });
    let mut conn = db.0.lock().unwrap();
    match result {
        Ok(scan) => db::save_scan(&mut conn, repo_id, &scan).map_err(err),
        Err(e) => {
            db::set_scan_status(&conn, repo_id, "failed", Some(&e)).map_err(err)?;
            Err(e)
        }
    }
}

/// Scans the given repos one after another on a background thread.
fn spawn_scan(app: AppHandle, repo_ids: Vec<String>) {
    let repo_ids: Vec<String> = {
        let scanning = app.state::<Scanning>();
        let mut set = scanning.0.lock().unwrap();
        repo_ids.into_iter().filter(|id| set.insert(id.clone())).collect()
    };
    std::thread::spawn(move || {
        for repo_id in repo_ids {
            let outcome = scan_one(&app, &repo_id);
            if let Err(e) = &outcome {
                // Covers failures before/after parsing too (e.g. a database error).
                let conn = app.state::<Db>();
                let conn = conn.0.lock().unwrap();
                let _ = db::set_scan_status(&conn, &repo_id, "failed", Some(e));
            }
            app.state::<Scanning>().0.lock().unwrap().remove(&repo_id);
            let _ = app.emit("scan-finished", ScanFinished { repo_id, error: outcome.err() });
        }
    });
}

#[tauri::command]
fn scan_project(app: AppHandle, db: State<Db>, project_id: String) -> CmdResult<()> {
    let ids = db::project_repo_ids(&db.0.lock().unwrap(), &project_id).map_err(err)?;
    spawn_scan(app, ids);
    Ok(())
}

#[tauri::command]
fn scan_repo(app: AppHandle, repo_id: String) -> CmdResult<()> {
    spawn_scan(app, vec![repo_id]);
    Ok(())
}

#[tauri::command]
fn get_graph(db: State<Db>, project_id: String) -> CmdResult<Graph> {
    db::get_graph(&db.0.lock().unwrap(), &project_id).map_err(err)
}

#[tauri::command]
fn workspace_packages(db: State<Db>) -> CmdResult<Vec<db::WorkspacePackage>> {
    db::workspace_packages(&db.0.lock().unwrap()).map_err(err)
}

#[tauri::command]
fn claude_status() -> ask::ClaudeStatus {
    ask::status()
}

#[tauri::command]
fn ask_start(app: AppHandle, request: ask::AskRequest) -> CmdResult<()> {
    ask::start(app, request)
}

#[tauri::command]
fn ask_cancel(app: AppHandle, ask_id: String) {
    ask::cancel(&app, &ask_id)
}

#[tauri::command]
fn set_project_ai(db: State<Db>, id: String, mode: String, model: String) -> CmdResult<()> {
    db::set_project_ai(&db.0.lock().unwrap(), &id, &mode, &model).map_err(err)
}

#[tauri::command]
fn project_summaries(db: State<Db>, project_id: String) -> CmdResult<Vec<db::Summary>> {
    db::project_summaries(&db.0.lock().unwrap(), &project_id).map_err(err)
}

#[tauri::command]
fn clear_summaries(db: State<Db>, project_id: String) -> CmdResult<usize> {
    db::clear_summaries(&db.0.lock().unwrap(), &project_id).map_err(err)
}

/// Generates and stores one summary. Runs on a blocking thread; at most a few at once.
#[tauri::command]
async fn summarize(app: AppHandle, request: summary::SummaryRequest) -> CmdResult<String> {
    let request = std::sync::Arc::new(request);
    let req = request.clone();
    let text = tauri::async_runtime::spawn_blocking(move || summary::summarize(&req)).await.map_err(err)??;
    let db = app.state::<Db>();
    db::save_summary(&db.0.lock().unwrap(), &request.project_id, &request.node_id, &request.hash, &text, &request.model).map_err(err)?;
    Ok(text)
}

/// Generates (and stores) the AI sections plan for one lens: JSON text.
#[tauri::command]
async fn organize(app: AppHandle, project_id: String, lens: String, hash: String, prompt: String, model: String) -> CmdResult<String> {
    let m = model.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || summary::organize(&prompt, &m)).await.map_err(err)??;
    let db = app.state::<Db>();
    db::save_summary(&db.0.lock().unwrap(), &project_id, &format!("plan:{lens}"), &hash, &plan, &model).map_err(err)?;
    Ok(plan)
}

#[tauri::command]
fn list_chats(db: State<Db>, project_id: String) -> CmdResult<Vec<db::Chat>> {
    db::list_chats(&db.0.lock().unwrap(), &project_id).map_err(err)
}

#[tauri::command]
fn create_chat(db: State<Db>, project_id: String, title: String) -> CmdResult<String> {
    db::create_chat(&db.0.lock().unwrap(), &project_id, &title).map_err(err)
}

#[tauri::command]
fn chat_messages(db: State<Db>, chat_id: String) -> CmdResult<Vec<db::ChatMessage>> {
    db::chat_messages(&db.0.lock().unwrap(), &chat_id).map_err(err)
}

#[tauri::command]
fn append_chat_message(db: State<Db>, chat_id: String, role: String, content: serde_json::Value) -> CmdResult<()> {
    db::append_chat_message(&db.0.lock().unwrap(), &chat_id, &role, &content).map_err(err)
}

#[tauri::command]
fn update_chat(db: State<Db>, chat_id: String, title: Option<String>, session_id: Option<String>) -> CmdResult<()> {
    db::update_chat(&db.0.lock().unwrap(), &chat_id, title.as_deref(), session_id.as_deref()).map_err(err)
}

#[tauri::command]
fn delete_chat(db: State<Db>, chat_id: String) -> CmdResult<()> {
    db::delete_chat(&db.0.lock().unwrap(), &chat_id).map_err(err)
}

#[tauri::command]
fn current_user() -> String {
    std::env::var("USER").unwrap_or_else(|_| "you".into())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, pending: State<'_, update::Pending>) -> Result<Option<update::UpdateInfo>, String> {
    update::check(app, pending).await
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, pending: State<'_, update::Pending>) -> Result<(), String> {
    update::install(app, pending).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let conn = db::open(&dir)?;
            app.manage(Db(Mutex::new(conn)));
            app.manage(Scanning::default());
            app.manage(ask::Asks::default());
            app.manage(update::Pending::default());

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::FollowsWindowActiveState), None)
                    .expect("vibrancy is supported on macOS");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            update_project,
            delete_project,
            add_repo,
            remove_repo,
            scan_project,
            scan_repo,
            get_graph,
            workspace_packages,
            claude_status,
            ask_start,
            ask_cancel,
            set_project_ai,
            project_summaries,
            clear_summaries,
            summarize,
            organize,
            list_chats,
            create_chat,
            chat_messages,
            append_chat_message,
            update_chat,
            delete_chat,
            current_user,
            app_version,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
