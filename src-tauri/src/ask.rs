//! "Ask Strata": questions about a project, answered by the user's own Claude
//! Code CLI (and therefore their own subscription). Claude runs read-only:
//! only the Read/Grep/Glob tools, confined to the project's repos.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct Asks(pub Mutex<HashMap<String, Child>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Apps started from the Finder don't get the shell's PATH, so ask a login shell once.
pub(crate) fn login_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let from_shell = Command::new(shell)
            .args(["-lc", "printf %s \"$PATH\""])
            .stdin(Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .filter(|p| !p.trim().is_empty());
        let current = std::env::var("PATH").unwrap_or_default();
        match from_shell {
            Some(p) => format!("{p}:{current}"),
            None => current,
        }
    })
}

/// "2.1.292 (Claude Code)" -> [2, 1, 292]
fn parse_version(v: &str) -> Vec<u32> {
    v.split_whitespace().next().unwrap_or("").split('.').filter_map(|p| p.parse().ok()).collect()
}

fn version_of(path: &Path) -> Option<String> {
    Command::new(path)
        .arg("--version")
        .env("PATH", login_path())
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|v| v.trim().to_string())
}

/// The newest `claude` among all installations (Homebrew, npm and the native
/// installer can coexist, and a login shell's PATH may list an old one first).
pub(crate) fn find_claude() -> Option<PathBuf> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            let home = std::env::var("HOME").unwrap_or_default();
            let extra = [format!("{home}/.local/bin"), format!("{home}/.claude/local"), "/opt/homebrew/bin".into(), "/usr/local/bin".into(), format!("{home}/.npm-global/bin"), format!("{home}/.bun/bin")];
            let mut seen = std::collections::HashSet::new();
            login_path()
                .split(':')
                .map(String::from)
                .chain(extra)
                .map(|d| Path::new(&d).join("claude"))
                .filter(|p| p.is_file() && seen.insert(p.canonicalize().unwrap_or(p.clone())))
                .filter_map(|p| version_of(&p).map(|v| (parse_version(&v), p)))
                .max_by(|a, b| a.0.cmp(&b.0))
                .map(|(_, p)| p)
        })
        .clone()
}

/// `--restricted` (no code-running tools, file tools confined to the repos) is newer than `--tools`.
fn supports_restricted(claude: &Path) -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        Command::new(claude)
            .arg("--help")
            .env("PATH", login_path())
            .stdin(Stdio::null())
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("--restricted"))
            .unwrap_or(false)
    })
}

pub fn status() -> ClaudeStatus {
    let Some(path) = find_claude() else { return ClaudeStatus { available: false, path: None, version: None } };
    let version = version_of(&path);
    ClaudeStatus { available: true, path: Some(path.to_string_lossy().to_string()), version }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub ask_id: String,
    pub question: String,
    /// Project context (architecture, schema, link syntax), appended to Claude's system prompt.
    pub context: String,
    /// Repo folders Claude may read; the first is the working directory.
    pub dirs: Vec<String>,
    /// Continue an earlier conversation.
    pub session_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskEvent {
    ask_id: String,
    event: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskDone {
    ask_id: String,
    ok: bool,
    error: Option<String>,
}

/// Keeps the events the panel needs and drops the bulky ones (tool results, thinking).
fn relevant(v: &Value) -> bool {
    match v.get("type").and_then(Value::as_str) {
        Some("stream_event") => v.pointer("/event/delta/type").and_then(Value::as_str) == Some("text_delta"),
        Some("assistant") | Some("result") | Some("rate_limit_event") => true,
        Some("system") => matches!(v.get("subtype").and_then(Value::as_str), Some("init") | Some("task_summary")),
        _ => false,
    }
}

/// The CLI invocation: read-only, streaming, confined to the project's repos.
fn command(req: &AskRequest) -> Result<Command, String> {
    let claude = find_claude().ok_or("Claude Code isn't installed (no `claude` on PATH).")?;
    let cwd = req.dirs.first().cloned().ok_or("This project has no repos to read.")?;
    let restricted = supports_restricted(&claude);
    let mut cmd = Command::new(claude);
    cmd.current_dir(&cwd)
        .env("PATH", login_path())
        .arg("-p")
        .arg(&req.question)
        .args(["--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        // Read-only: only the file-reading tools exist, nothing else is approved, no MCP servers.
        .args(["--strict-mcp-config", "--permission-mode", "dontAsk"])
        .args(["--tools", "Read", "Grep", "Glob"])
        .args(["--allowedTools", "Read", "Grep", "Glob"])
        .args(["--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"])
        .arg("--append-system-prompt")
        .arg(&req.context)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if restricted {
        // Also confines the file tools to the working directories.
        cmd.arg("--restricted");
    }
    for dir in req.dirs.iter().skip(1) {
        cmd.arg("--add-dir").arg(dir);
    }
    if let Some(s) = &req.session_id {
        cmd.args(["--resume", s]);
    }
    if let Some(m) = req.model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    Ok(cmd)
}

pub fn start(app: AppHandle, req: AskRequest) -> Result<(), String> {
    let mut cmd = command(&req)?;
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    app.state::<Asks>().0.lock().unwrap().insert(req.ask_id.clone(), child);

    let ask_id = req.ask_id;
    std::thread::spawn(move || {
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        let mut result_error: Option<String> = None;
        let mut got_result = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v.get("type").and_then(Value::as_str) == Some("result") {
                got_result = true;
                if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
                    result_error = v.get("result").and_then(Value::as_str).map(String::from).or(Some("Claude reported an error.".into()));
                }
            }
            if relevant(&v) {
                let _ = app.emit("ask-event", AskEvent { ask_id: ask_id.clone(), event: v });
            }
        }
        let stderr = err_reader.join().unwrap_or_default();
        let child = app.state::<Asks>().0.lock().unwrap().remove(&ask_id);
        let status = child.map(|mut c| c.wait());
        let cancelled = status.is_none();
        let ok = got_result && result_error.is_none();
        let error = if ok || cancelled {
            None
        } else {
            result_error.or_else(|| {
                let tail: String = stderr.lines().filter(|l| !l.contains("no stdin data received")).collect::<Vec<_>>().join("\n");
                Some(if tail.trim().is_empty() { "Claude Code stopped without an answer.".into() } else { tail.trim().chars().take(600).collect() })
            })
        };
        let _ = app.emit("ask-done", AskDone { ask_id, ok, error });
    });
    Ok(())
}

pub fn cancel(app: &AppHandle, ask_id: &str) {
    if let Some(mut child) = app.state::<Asks>().0.lock().unwrap().remove(ask_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the real CLI (costs a few cents of the subscription): `cargo test ask:: -- --ignored --nocapture`
    #[test]
    fn versions() {
        assert!(parse_version("2.1.292 (Claude Code)") > parse_version("2.1.153 (Claude Code)"));
        assert!(parse_version("2.10.0") > parse_version("2.9.99"));
    }

    #[test]
    #[ignore]
    fn real_claude_answers_and_resumes() {
        println!("using {:?}", find_claude());
        let root = std::env::temp_dir().join(format!("strata-ask-{}", std::process::id()));
        let (a, b) = (root.join("api"), root.join("web"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("price.ts"), "export const TAX_RATE = 0.19;\n").unwrap();
        std::fs::write(b.join("cart.ts"), "import { TAX_RATE } from '../api/price';\nexport const total = (n: number) => n * (1 + TAX_RATE);\n").unwrap();
        let run = |question: &str, session: Option<String>| -> (Option<String>, String, Vec<String>) {
            let req = AskRequest {
                ask_id: "t".into(),
                question: question.into(),
                context: "Link files as [name](strata:file/<repo>/<path>). Repos: api, web.".into(),
                dirs: vec![a.to_string_lossy().into(), b.to_string_lossy().into()],
                session_id: session,
                model: Some("haiku".into()),
            };
            let out = command(&req).unwrap().output().unwrap();
            if !out.status.success() || out.stdout.is_empty() {
                println!("status: {:?}\nstderr: {}", out.status, String::from_utf8_lossy(&out.stderr));
            }
            let mut session = None;
            let mut result = String::new();
            let mut tools = vec![];
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                if v["type"] == "system" && v["subtype"] == "init" {
                    session = v["session_id"].as_str().map(String::from);
                    tools = v["tools"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
                }
                if v["type"] == "result" {
                    assert_eq!(v["is_error"], false, "{v}");
                    result = v["result"].as_str().unwrap_or("").to_string();
                }
            }
            (session, result, tools)
        };
        let (session, answer, tools) = run("What is the tax rate used by web/cart.ts? Read the files. Answer in one sentence.", None);
        println!("answer: {answer}\ntools: {tools:?}");
        assert_eq!(tools, vec!["Glob", "Grep", "Read"], "only read-only tools");
        assert!(answer.contains("0.19") || answer.contains("19"), "{answer}");
        let (_, follow, _) = run("Which file defines it? Reply with just the file name.", session);
        println!("follow-up: {follow}");
        assert!(follow.contains("price"), "{follow}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
