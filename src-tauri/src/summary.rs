//! AI summaries for map items: one short, tool-less Claude call per item.
//! The UI describes the item (what Strata knows about it); this module adds
//! the source of the relevant files and asks Claude for 2–3 sentences.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Condvar, Mutex};

use serde::Deserialize;
use serde_json::Value;

use crate::ask::{find_claude, login_path};

const SYSTEM: &str = "You write short summaries of parts of a software project for a code map called Strata. \
Write 2–3 sentences, at most 60 words, plain prose: no markdown, no lists, no headings, no quotes around names. \
Start with what the item is or does, then the most important collaborators or data it touches. \
Be concrete and only state what the provided context and code show; never guess at intent or speculate. \
Write in English.";

/// Per file, at most this much source goes into the prompt; at most this much in total.
const FILE_LIMIT: usize = 12_000;
const TOTAL_LIMIT: usize = 40_000;
/// Concurrent Claude processes for summaries (pre-generation fires many at once).
const MAX_RUNNING: usize = 3;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryFile {
    /// Absolute path.
    pub path: String,
    /// How the file is shown to Claude, e.g. "api/src/main.ts".
    pub label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRequest {
    pub project_id: String,
    pub node_id: String,
    pub hash: String,
    /// What Strata knows about the item.
    pub prompt: String,
    pub files: Vec<SummaryFile>,
    pub model: String,
}

static SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

struct Slot;
impl Slot {
    fn take() -> Slot {
        let (lock, cv) = &SLOTS;
        let mut running = lock.lock().unwrap();
        while *running >= MAX_RUNNING {
            running = cv.wait(running).unwrap();
        }
        *running += 1;
        Slot
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        let (lock, cv) = &SLOTS;
        *lock.lock().unwrap() -= 1;
        cv.notify_one();
    }
}

pub fn build_prompt(req: &SummaryRequest) -> String {
    let mut prompt = format!("Summarize this item for the map.\n\n{}\n", req.prompt.trim());
    let mut budget = TOTAL_LIMIT;
    for f in &req.files {
        if budget < 500 {
            break;
        }
        let Ok(src) = std::fs::read_to_string(&f.path) else { continue };
        let take = src.len().min(FILE_LIMIT).min(budget);
        // Cut on a char boundary.
        let mut end = take;
        while !src.is_char_boundary(end) {
            end -= 1;
        }
        let cut = if end < src.len() { "\n… (truncated)" } else { "" };
        prompt.push_str(&format!("\n--- {} ---\n{}{}\n", f.label, &src[..end], cut));
        budget -= end;
    }
    prompt
}

/// Runs Claude and returns the summary text. Blocks; call off the main thread.
pub fn summarize(req: &SummaryRequest) -> Result<String, String> {
    complete(SYSTEM, &build_prompt(req), &req.model)
}

const ORGANIZE: &str = "You organize the parts of a software project into sections for a visual map called Strata. \
Group items by domain or responsibility (what they are for), not by technology or folder name alone. \
Give each section a short name (1–4 words) and a one-sentence description. Every item belongs to exactly one section. \
Reply with only JSON, no prose and no code fences: {\"sections\":[{\"name\":\"…\",\"description\":\"…\",\"members\":[\"id\",…]}]}";

/// Asks Claude for a sections plan (JSON text) for one lens of the map.
pub fn organize(prompt: &str, model: &str) -> Result<String, String> {
    let text = complete(ORGANIZE, prompt, model)?;
    // Models sometimes wrap JSON in a fence anyway.
    let trimmed = text.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    serde_json::from_str::<Value>(trimmed).map_err(|e| format!("Claude's plan wasn't valid JSON ({e})."))?;
    Ok(trimmed.to_string())
}

/// One tool-less Claude call with its own system prompt; returns the answer text.
fn complete(system: &str, prompt: &str, model: &str) -> Result<String, String> {
    let claude = find_claude().ok_or("Claude Code isn't installed (no `claude` on PATH).")?;
    let req_model = if model.is_empty() { "haiku" } else { model };
    let _slot = Slot::take();
    let mut child = Command::new(claude)
        .env("PATH", login_path())
        // Extended thinking (on by default in Claude Code) roughly triples the time of these
        // short, fully specified tasks without making the answers better.
        .env("MAX_THINKING_TOKENS", "0")
        .current_dir(std::env::temp_dir())
        .args(["-p", "--output-format", "json", "--system-prompt", system])
        // No tools at all: everything Claude needs is in the prompt.
        .args(["--tools", "", "--strict-mcp-config", "--permission-mode", "dontAsk", "--no-session-persistence"])
        .args(["--model", req_model])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    child.stdin.take().ok_or("no stdin")?.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|_| {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.lines().filter(|l| !l.contains("no stdin data")).collect::<Vec<_>>().join(" ");
        if err.trim().is_empty() { "Claude Code returned no answer.".to_string() } else { err.chars().take(400).collect() }
    })?;
    let text = v.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) || text.is_empty() {
        return Err(if text.is_empty() { "Claude returned an empty summary.".into() } else { text });
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_inlines_files_within_limits() {
        let dir = std::env::temp_dir().join(format!("strata-sum-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.ts"), "export const a = 1;\n").unwrap();
        std::fs::write(dir.join("big.ts"), "x".repeat(FILE_LIMIT + 100)).unwrap();
        let req = SummaryRequest {
            project_id: "p".into(),
            node_id: "n".into(),
            hash: "h".into(),
            prompt: "File api/a.ts, exports a.".into(),
            files: vec![
                SummaryFile { path: dir.join("a.ts").to_string_lossy().into(), label: "api/a.ts".into() },
                SummaryFile { path: dir.join("big.ts").to_string_lossy().into(), label: "api/big.ts".into() },
                SummaryFile { path: dir.join("missing.ts").to_string_lossy().into(), label: "api/missing.ts".into() },
            ],
            model: "haiku".into(),
        };
        let p = build_prompt(&req);
        assert!(p.contains("--- api/a.ts ---\nexport const a = 1;"));
        assert!(p.contains("--- api/big.ts ---") && p.contains("… (truncated)"));
        assert!(!p.contains("missing.ts"), "unreadable files are skipped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Real CLI call (a fraction of a cent): `cargo test summary:: -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_summary() {
        let req = SummaryRequest {
            project_id: "p".into(),
            node_id: "n".into(),
            hash: "h".into(),
            prompt: "File billing/src/tax.ts in repo billing. Exports TAX_RATE (const) and gross() (function). Imported by 3 files.".into(),
            files: vec![],
            model: "haiku".into(),
        };
        let t = summarize(&req).unwrap();
        println!("{t}");
        assert!(t.len() > 20 && !t.contains("**"));
    }
}

#[cfg(test)]
mod organize_tests {
    /// Real CLI call: `cargo test organize_tests -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_plan_is_valid_json() {
        let prompt = "Project \"clubhouse\". Group these database tables into 3–10 sections by business domain, e.g. \"Members\", \"Billing\".\nUse the ids exactly as given (like i12).\n\nItems:\n\
i1: user: id, name, email, emailVerified\ni2: session: id, userId, token, expiresAt | refs user\ni3: account: id, userId, providerId | refs user\n\
i4: organization: id, name, slug, logo\ni5: member: id, organizationId, userId, role | refs organization, user\ni6: invitation: id, email, organizationId | refs organization\n\
i7: clubMember: id, organizationId, firstName, lastName, birthDate | refs organization\ni8: tariff: id, organizationId, name, amountCents | refs organization\n\
i9: invoice: id, clubMemberId, amountCents, dueDate | refs clubMember\ni10: sepaBatch: id, organizationId, executedAt | refs organization\n\
i11: event: id, organizationId, title, startsAt | refs organization\ni12: eventResponse: id, eventId, clubMemberId, status | refs event, clubMember\n\
i13: attendanceSession: id, teamId, date | refs team\ni14: team: id, organizationId, name | refs organization\ni15: announcement: id, organizationId, title, body | refs organization";
        let t = std::time::Instant::now();
        let plan = super::organize(prompt, "haiku").unwrap();
        println!("{:?}\n{plan}", t.elapsed());
        let v: serde_json::Value = serde_json::from_str(&plan).unwrap();
        let members: Vec<String> = v["sections"].as_array().unwrap().iter().flat_map(|s| s["members"].as_array().unwrap().iter().map(|m| m.as_str().unwrap().to_string())).collect();
        assert!(members.len() >= 14, "almost every item placed: {members:?}");
    }
}
