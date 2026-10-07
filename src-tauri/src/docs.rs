//! Writes the guidelines generated from a plan into a folder (usually the project's first repo).

use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

use crate::ask::login_path;

#[derive(Deserialize)]
pub struct DocFile {
    /// Relative to the target folder, e.g. "docs/decisions/0001-postgres.md".
    pub path: String,
    pub content: String,
}

/// Only plain relative paths inside the target folder: no absolute paths, no "..".
fn inside(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Refusing to write outside the folder: {rel}"));
    }
    Ok(dir.join(p))
}

/// Which of `paths` already exist in `dir` (they would be overwritten).
pub fn existing(dir: &str, paths: &[String]) -> Vec<String> {
    let dir = Path::new(dir);
    paths.iter().filter(|p| inside(dir, p).map(|f| f.exists()).unwrap_or(false)).cloned().collect()
}

/// Writes the files (creating folders as needed) and optionally runs `git init`. Returns the number written.
pub fn write(dir: &str, files: &[DocFile], git: bool) -> Result<usize, String> {
    let root = Path::new(dir);
    if !root.is_absolute() {
        return Err("Choose a folder first.".into());
    }
    // Validate everything before writing anything.
    let targets = files.iter().map(|f| inside(root, &f.path)).collect::<Result<Vec<_>, _>>()?;
    std::fs::create_dir_all(root).map_err(|e| format!("Couldn't create {dir}: {e}"))?;
    for (file, target) in files.iter().zip(&targets) {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Couldn't create {}: {e}", parent.display()))?;
        }
        std::fs::write(target, &file.content).map_err(|e| format!("Couldn't write {}: {e}", file.path))?;
    }
    if git && !root.join(".git").exists() {
        let out = Command::new("git").arg("init").arg("-q").current_dir(root).env("PATH", login_path()).output().map_err(|e| format!("Couldn't run git: {e}"))?;
        if !out.status.success() {
            return Err(format!("git init failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
    }
    Ok(files.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_inside_the_folder_only() {
        let dir = std::env::temp_dir().join(format!("strata-docs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let d = dir.to_string_lossy().to_string();
        let files = vec![DocFile { path: "ARCHITECTURE.md".into(), content: "# A".into() }, DocFile { path: "docs/decisions/0001-x.md".into(), content: "# D".into() }];
        assert_eq!(write(&d, &files, false).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(dir.join("docs/decisions/0001-x.md")).unwrap(), "# D");
        assert_eq!(existing(&d, &["ARCHITECTURE.md".into(), "ROADMAP.md".into()]), vec!["ARCHITECTURE.md".to_string()]);
        for bad in ["../evil.md", "/etc/x", "docs/../../x.md", ""] {
            assert!(write(&d, &[DocFile { path: bad.into(), content: String::new() }], false).is_err(), "{bad}");
        }
        assert!(write("relative/dir", &files, false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
