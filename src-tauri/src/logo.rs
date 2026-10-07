//! Finds a repo's logo (logo files, app icons, favicons) to show as the project's image.

use std::path::Path;

const MAX_BYTES: u64 = 512 * 1024;

/// How likely a file is to be the repo's logo; `None` if it isn't an image candidate.
pub fn score(rel: &Path, size: u64) -> Option<i32> {
    if !(100..=MAX_BYTES).contains(&size) {
        return None;
    }
    let path = rel.to_string_lossy().to_lowercase().replace('\\', "/");
    let name = path.rsplit('/').next().unwrap_or(&path);
    let (stem, ext) = name.rsplit_once('.')?;
    let ext_bonus = match ext {
        "svg" => 8,
        "png" => 5,
        "webp" => 4,
        "jpg" | "jpeg" => 2,
        "ico" => 0,
        _ => return None,
    };
    let mut s = if stem.contains("logo") && !stem.starts_with("square") && stem != "storelogo" {
        50
    } else if stem == "app-icon" || (stem == "icon" && path.contains("src-tauri/icons/")) {
        45
    } else if stem.starts_with("apple-touch-icon") {
        34
    } else if stem == "icon" || stem.starts_with("android-chrome") {
        36
    } else if stem.starts_with("favicon") {
        // favicon-48.png beats favicon-16.png; an svg favicon is usually the vector logo.
        let px: i32 = stem.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
        if ext == "svg" { 30 } else { 18 + (px / 32).min(8) }
    } else {
        return None;
    };
    s += ext_bonus;
    if ["/test", "/tests/", "fixture", "/e2e/", "/docs/", "/example", "/stories/", "__snapshots__"].iter().any(|p| path.contains(p)) || path.starts_with("test") {
        s -= 30;
    }
    s -= path.matches('/').count() as i32; // shallower is better
    Some(s)
}

/// The file as a data URL the webview can show directly.
pub fn data_url(abs: &Path) -> Option<String> {
    use base64::Engine;
    let bytes = std::fs::read(abs).ok().filter(|b| (b.len() as u64) <= MAX_BYTES)?;
    let mime = match abs.extension()?.to_str()?.to_lowercase().as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        _ => return None,
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn best(files: &[&str]) -> String {
        files.iter().filter_map(|f| score(Path::new(f), 2000).map(|s| (s, *f))).max().unwrap().1.to_string()
    }

    #[test]
    fn picks_the_most_logo_like_file() {
        assert_eq!(best(&["apps/web/public/favicon-48.png", "apps/web/public/apple-touch-icon.png", "apps/web/public/favicon.svg", "apps/landing/src/app/icon.svg"]), "apps/landing/src/app/icon.svg");
        assert_eq!(best(&["apps/web/public/favicon.ico", "apps/web/public/apple-touch-icon.png", "apps/web/public/favicon.svg"]), "apps/web/public/apple-touch-icon.png");
        assert_eq!(best(&["src/app/favicon.ico"]), "src/app/favicon.ico");
        assert_eq!(best(&["assets/app-icon.svg", "src-tauri/icons/icon.png", "src-tauri/icons/Square30x30Logo.png", "src-tauri/icons/StoreLogo.png"]), "assets/app-icon.svg");
        assert_eq!(best(&["public/favicon.svg", "docs/brand/logo.svg", "public/logo.svg"]), "public/logo.svg");
        assert_eq!(score(Path::new("src/components/Button.tsx"), 2000), None);
        assert_eq!(score(Path::new("public/logo.png"), 5 * 1024 * 1024), None, "too big");
    }
}
