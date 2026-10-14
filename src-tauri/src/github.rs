//! Public GitHub repos: a shallow clone in Strata's data folder, refreshed before each scan.
//! From there on they're ordinary local repos for the scanner, the maps and Ask Strata.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::ask::login_path;

/// `owner/name` from the ways people paste a repo: a browser URL (also deep links like
/// `/tree/main/src`), a clone URL, an SSH address, or just `owner/name`.
pub fn parse(input: &str) -> Result<(String, String), String> {
    let s = input.trim().trim_end_matches('/');
    let rest = s
        .strip_prefix("git@github.com:")
        .or_else(|| s.split_once("github.com/").map(|(_, r)| r))
        .unwrap_or(s);
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next().unwrap_or(""), parts.next().unwrap_or("").trim_end_matches(".git"));
    let valid = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !valid(owner) || !valid(name) || (!s.contains("github.com") && rest.split('/').count() != 2) {
        return Err(format!("“{}” doesn't look like a GitHub repo. Paste a link like https://github.com/owner/repo.", input.trim()));
    }
    Ok((owner.to_string(), name.to_string()))
}

/// Where a repo's clone lives.
pub fn dir(root: &Path, owner: &str, name: &str) -> PathBuf {
    root.join(owner).join(name)
}

/// `owner/name` of a folder inside `root`, i.e. a repo Strata cloned.
pub fn cloned(root: &Path, path: &Path) -> Option<(String, String)> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = rel.iter().map(|p| p.to_string_lossy().into_owned());
    let (owner, name) = (parts.next()?, parts.next()?);
    parts.next().is_none().then_some((owner, name))
}

fn git(args: &[&str], cwd: Option<&Path>) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.args(args).env("PATH", login_path()).env("GIT_TERMINAL_PROMPT", "0");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd.output().map_err(|e| format!("Couldn't run git: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let err = err.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("git failed").trim().to_string();
    Err(err)
}

/// Clones the repo (latest commit only) or, if it's already there, moves it to the latest commit.
/// A failed update keeps the copy that's there, so a rescan offline still works.
pub fn sync(path: &Path, owner: &str, name: &str) -> Result<(), String> {
    if path.join(".git").is_dir() {
        if git(&["fetch", "--depth", "1", "origin"], Some(path)).is_ok() {
            git(&["reset", "--hard", "FETCH_HEAD"], Some(path))?;
        }
        return Ok(());
    }
    std::fs::create_dir_all(path).map_err(|e| format!("Couldn't create {}: {e}", path.display()))?;
    let url = format!("https://github.com/{owner}/{name}.git");
    git(&["clone", "--depth", "1", "--single-branch", &url, "."], Some(path)).map_err(|e| {
        let _ = std::fs::remove_dir_all(path);
        if e.contains("not found") || e.contains("could not read Username") || e.contains("Authentication") {
            format!("Couldn't clone {owner}/{name}: the repo doesn't exist or isn't public.")
        } else {
            format!("Couldn't clone {owner}/{name}: {e}")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_usual_forms() {
        let want = Ok(("vercel".to_string(), "next.js".to_string()));
        for s in [
            "https://github.com/vercel/next.js",
            "https://github.com/vercel/next.js/",
            "https://github.com/vercel/next.js.git",
            "github.com/vercel/next.js/tree/canary/packages",
            "git@github.com:vercel/next.js.git",
            "  vercel/next.js ",
        ] {
            assert_eq!(parse(s), want, "{s}");
        }
        for s in ["", "next.js", "https://gitlab.com/a/b/c", "a/b/c", "https://github.com/a", "../../etc"] {
            assert!(parse(s).is_err(), "{s}");
        }
    }

    /// Network: `cargo test github -- --ignored`
    #[test]
    #[ignore]
    fn clones_updates_and_reports_missing_repos() {
        let root = std::env::temp_dir().join(format!("strata-gh-{}", std::process::id()));
        let path = dir(&root, "octocat", "Hello-World");
        sync(&path, "octocat", "Hello-World").unwrap();
        assert!(path.join("README").is_file());
        sync(&path, "octocat", "Hello-World").unwrap(); // second time: fetch + reset
        let missing = dir(&root, "octocat", "no-such-repo-strata");
        let err = sync(&missing, "octocat", "no-such-repo-strata").unwrap_err();
        assert!(err.contains("doesn't exist or isn't public"), "{err}");
        assert!(!missing.exists(), "a failed clone leaves nothing behind");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn recognizes_its_own_clones() {
        let root = Path::new("/data/github");
        assert_eq!(cloned(root, &dir(root, "o", "r")), Some(("o".into(), "r".into())));
        assert_eq!(cloned(root, Path::new("/Users/me/code/r")), None);
        assert_eq!(cloned(root, Path::new("/data/github/o/r/sub")), None);
    }
}
