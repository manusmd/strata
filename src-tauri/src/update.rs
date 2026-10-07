//! In-app updates: check the release feed, download and install a signed update, restart.
//! Updates are verified against the public key in tauri.conf.json (plugins.updater.pubkey).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

/// The update found by the last check, kept until it's installed.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// Release notes (Markdown), from the release body.
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut builder = app.updater_builder();
    // Point a build at another feed, e.g. a local server when testing the update flow.
    if let Ok(url) = std::env::var("STRATA_UPDATE_URL") {
        let url = url.parse().map_err(|e| format!("STRATA_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

/// `None` when this is the newest version.
pub async fn check(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<UpdateInfo>, String> {
    let update = updater(&app)?.check().await.map_err(|e| format!("Couldn't check for updates: {e}"))?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.date().to_string()),
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Downloads (emitting `update-progress`), verifies and installs the pending update, then restarts.
pub async fn install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("There's no update to install. Check for updates first.")?;
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("The update couldn't be installed: {e}"))?;
    app.restart();
}
