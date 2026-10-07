//! Reads a repository into a graph of folders, files, symbols and imports.
//!
//! Parsing is done with Tree-sitter (TypeScript / TSX / JavaScript). Relative
//! imports and `tsconfig.json` path aliases are resolved to files inside the
//! repo; bare imports become package nodes (`pkg:<name>`) that are shared
//! across repos, which is what later lets us link repos to each other.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};

use rayon::prelude::*;
use serde::Serialize;
use serde_json::{json, Value};
use tree_sitter::{Language, Node, Parser};

use crate::arch::{self, FileHints};
use crate::schema::{self, DbRef, DrizzleTable};

const MAX_FILE_BYTES: u64 = 1_000_000;
const SKIP_DIRS: &[&str] = &["node_modules", "dist", "build", "out", "coverage", "vendor", "target", ".next", ".nuxt", ".svelte-kit", ".turbo", "__generated__"];
const EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const RESOLVE_EXTS: &[&str] = &[".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub kind: String, // folder | file | symbol | package
    pub name: String,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub meta: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct GraphEdge {
    pub src: String,
    pub dst: String,
    pub kind: String, // imports
}

#[derive(Debug, Default, Serialize)]
pub struct ScanStats {
    pub files: usize,
    pub tables: usize,
    pub units: usize,
    pub symbols: usize,
    pub imports: usize,
    pub unresolved: usize,
    pub packages: usize,
    pub parse_errors: usize,
}

pub struct ScanResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub stats: ScanStats,
    /// `name` from the repo's root package.json, used to link repos together.
    pub package_name: Option<String>,
    /// The most logo-like image in the repo (repo-relative) and its score.
    pub logo: Option<(String, i32)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: &'static str, // function | class | type | const
    pub exported: bool,
    pub line: usize,
    pub lines: usize,
}

#[derive(Debug, Default)]
pub struct ParsedFile {
    /// FNV-1a of the file's bytes, so AI summaries know when they're outdated.
    pub hash: u64,
    pub imports: Vec<String>,
    pub drizzle: Vec<DrizzleTable>,
    pub db_refs: Vec<DbRef>,
    pub hints: FileHints,
    pub symbols: Vec<Symbol>,
    pub lines: usize,
    pub has_errors: bool,
}

// ---------- Parsing ----------

fn language_for(path: &Path) -> Option<Language> {
    match path.extension()?.to_str()? {
        "ts" | "mts" | "cts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "js" | "jsx" | "mjs" | "cjs" => Some(tree_sitter_javascript::LANGUAGE.into()),
        _ => None,
    }
}

fn text<'a>(node: Node, src: &'a [u8]) -> &'a str {
    node.utf8_text(src).unwrap_or("")
}

/// The contents of a string literal node, without quotes.
fn string_value(node: Node, src: &[u8]) -> Option<String> {
    if node.kind() != "string" && node.kind() != "template_string" {
        return None;
    }
    let raw = text(node, src);
    if raw.len() < 2 || raw.contains("${") {
        return None;
    }
    Some(raw[1..raw.len() - 1].to_string())
}

fn symbol_from_decl(node: Node, src: &[u8], exported: bool, out: &mut Vec<Symbol>) {
    let span = |n: Node| (n.start_position().row + 1, n.end_position().row - n.start_position().row + 1);
    let named = |kind: &'static str, out: &mut Vec<Symbol>| {
        if let Some(name) = node.child_by_field_name("name") {
            let (line, lines) = span(node);
            out.push(Symbol { name: text(name, src).to_string(), kind, exported, line, lines });
        }
    };
    match node.kind() {
        "function_declaration" | "generator_function_declaration" | "function_signature" => named("function", out),
        "class_declaration" | "abstract_class_declaration" => named("class", out),
        "interface_declaration" | "type_alias_declaration" | "enum_declaration" => named("type", out),
        "lexical_declaration" | "variable_declaration" => {
            let mut cursor = node.walk();
            for decl in node.named_children(&mut cursor).filter(|c| c.kind() == "variable_declarator") {
                let Some(name) = decl.child_by_field_name("name").filter(|n| n.kind() == "identifier") else { continue };
                let value_kind = decl.child_by_field_name("value").map(|v| v.kind()).unwrap_or("");
                let kind = match value_kind {
                    "arrow_function" | "function_expression" | "function" | "generator_function" => "function",
                    "class" => "class",
                    _ if exported => "const",
                    _ => continue, // non-exported plain values are noise on the map
                };
                let (line, lines) = span(decl);
                out.push(Symbol { name: text(name, src).to_string(), kind, exported, line, lines });
            }
        }
        _ => {}
    }
}

/// Collects imports from anywhere in the tree (static, re-exports, require, dynamic import).
fn collect_imports(node: Node, src: &[u8], out: &mut Vec<String>) {
    match node.kind() {
        "import_statement" | "export_statement" => {
            if let Some(s) = node.child_by_field_name("source").and_then(|s| string_value(s, src)) {
                out.push(s);
            }
        }
        "call_expression" => {
            let callee = node.child_by_field_name("function");
            let is_loader = callee.map(|c| c.kind() == "import" || (c.kind() == "identifier" && text(c, src) == "require")).unwrap_or(false);
            if is_loader {
                if let Some(arg) = node.child_by_field_name("arguments").and_then(|a| a.named_child(0)).and_then(|a| string_value(a, src)) {
                    out.push(arg);
                }
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_imports(child, src, out);
    }
}

/// FNV-1a 64: fast, stable across runs and Rust versions (unlike `DefaultHasher`).
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn parse_source(parser: &mut Parser, lang: &Language, source: &str) -> ParsedFile {
    let src = source.as_bytes();
    if parser.set_language(lang).is_err() {
        return ParsedFile::default();
    }
    let Some(tree) = parser.parse(src, None) else { return ParsedFile::default() };
    let root = tree.root_node();

    let mut parsed = ParsedFile { hash: fnv1a(src), lines: source.lines().count(), has_errors: root.has_error(), ..Default::default() };
    collect_imports(root, src, &mut parsed.imports);
    parsed.drizzle = schema::find_drizzle_tables(root, src);
    schema::collect_db_refs(root, src, &mut parsed.db_refs);
    parsed.hints = arch::file_hints(root, source);

    let mut cursor = root.walk();
    for stmt in root.named_children(&mut cursor) {
        if stmt.kind() == "export_statement" {
            if let Some(decl) = stmt.child_by_field_name("declaration") {
                symbol_from_decl(decl, src, true, &mut parsed.symbols);
            } else if text(stmt, src).starts_with("export default") {
                // `export default function () {}` or `export default class {}`
                if let Some(value) = stmt.child_by_field_name("value").or_else(|| stmt.named_child(0)) {
                    let kind = match value.kind() {
                        "function_declaration" | "function_expression" | "arrow_function" | "function" => Some("function"),
                        "class_declaration" | "class" => Some("class"),
                        _ => None,
                    };
                    if let Some(kind) = kind {
                        let name = value.child_by_field_name("name").map(|n| text(n, src).to_string()).unwrap_or_else(|| "default".into());
                        let line = value.start_position().row + 1;
                        let lines = value.end_position().row - value.start_position().row + 1;
                        parsed.symbols.push(Symbol { name, kind, exported: true, line, lines });
                    }
                }
            }
        } else {
            symbol_from_decl(stmt, src, false, &mut parsed.symbols);
        }
    }
    parsed
}

// ---------- Import resolution ----------

/// Path aliases from one tsconfig/jsconfig (`compilerOptions.baseUrl` + `paths`).
#[derive(Debug, Clone)]
struct AliasConfig {
    dir: PathBuf,        // folder the config lives in (repo-relative)
    base: PathBuf,       // baseUrl, repo-relative
    paths: Vec<(String, Vec<String>)>,
}

/// tsconfig.json is JSONC: strip comments and trailing commas before parsing.
fn parse_jsonc(raw: &str) -> Option<Value> {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let (mut i, mut in_str) = (0, false);
    while i < bytes.len() {
        let c = bytes[i] as char;
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < bytes.len() {
                out.push(bytes[i + 1] as char);
                i += 1;
            } else if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            out.push(c);
        } else if raw[i..].starts_with("//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        } else if raw[i..].starts_with("/*") {
            i += raw[i..].find("*/").map(|e| e + 2).unwrap_or(bytes.len() - i);
            continue;
        } else {
            out.push(c);
        }
        i += 1;
    }
    // Remove trailing commas: `,}` and `,]` (allowing whitespace in between).
    let mut cleaned = String::with_capacity(out.len());
    let chars: Vec<char> = out.chars().collect();
    for (idx, &c) in chars.iter().enumerate() {
        if c == ',' {
            let next = chars[idx + 1..].iter().find(|c| !c.is_whitespace());
            if matches!(next, Some('}') | Some(']')) {
                continue;
            }
        }
        cleaned.push(c);
    }
    serde_json::from_str(&cleaned).ok()
}

fn load_alias_config(rel_dir: &Path, file: &Path) -> Option<AliasConfig> {
    let value = parse_jsonc(&std::fs::read_to_string(file).ok()?)?;
    let opts = value.get("compilerOptions")?;
    let base = rel_dir.join(opts.get("baseUrl").and_then(Value::as_str).unwrap_or("."));
    let paths = opts
        .get("paths")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()))
                .collect()
        })
        .unwrap_or_default();
    Some(AliasConfig { dir: rel_dir.to_path_buf(), base: normalize(&base), paths })
}

/// Lexically normalizes `a/./b/../c` to `a/c` (no filesystem access).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// A package.json inside the repo (the root one, or a monorepo workspace package).
#[derive(Debug, Clone)]
struct LocalPackage {
    name: String,
    dir: PathBuf,
    /// `exports` entries as (subpath pattern, target), e.g. ("./*", "./src/*/index.ts").
    exports: Vec<(String, String)>,
    entry: Option<String>, // types / module / main
}

/// First file path in an `exports` value, preferring TypeScript sources.
fn export_target(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Object(m) => ["types", "import", "default", "require", "node"]
            .iter()
            .filter_map(|k| m.get(*k))
            .chain(m.values())
            .find_map(export_target),
        Value::Array(a) => a.iter().find_map(export_target),
        _ => None,
    }
}

fn load_local_package(rel_dir: &Path, manifest: &Value) -> Option<LocalPackage> {
    let name = manifest.get("name")?.as_str()?.to_string();
    let exports = match manifest.get("exports") {
        Some(Value::Object(m)) if m.keys().any(|k| k.starts_with('.')) => m.iter().filter_map(|(k, v)| Some((k.clone(), export_target(v)?))).collect(),
        Some(v) => export_target(v).map(|t| vec![(".".to_string(), t)]).unwrap_or_default(),
        None => vec![],
    };
    let entry = ["types", "typings", "module", "main"].iter().find_map(|k| manifest.get(*k).and_then(Value::as_str)).map(String::from);
    Some(LocalPackage { name, dir: rel_dir.to_path_buf(), exports, entry })
}

struct Resolver<'a> {
    files: &'a BTreeSet<PathBuf>,
    aliases: Vec<AliasConfig>,
    packages: HashMap<String, LocalPackage>,
}

impl Resolver<'_> {
    fn try_file(&self, candidate: &Path) -> Option<PathBuf> {
        let candidate = normalize(candidate);
        if self.files.contains(&candidate) {
            return Some(candidate);
        }
        let s = candidate.to_string_lossy();
        // ESM-style TS imports: `./foo.js` written for `./foo.ts`.
        for (from, tos) in [(".js", &[".ts", ".tsx"][..]), (".jsx", &[".tsx"][..]), (".mjs", &[".mts"][..])] {
            if let Some(stem) = s.strip_suffix(from) {
                for to in tos {
                    let p = PathBuf::from(format!("{stem}{to}"));
                    if self.files.contains(&p) {
                        return Some(p);
                    }
                }
            }
        }
        for ext in RESOLVE_EXTS {
            let with_ext = PathBuf::from(format!("{s}{ext}"));
            if self.files.contains(&with_ext) {
                return Some(with_ext);
            }
        }
        for ext in RESOLVE_EXTS {
            let index = candidate.join(format!("index{ext}"));
            if self.files.contains(&index) {
                return Some(index);
            }
        }
        None
    }

    /// The closest tsconfig/jsconfig above `from` wins, like in TypeScript.
    fn alias_for(&self, from: &Path) -> Option<&AliasConfig> {
        self.aliases.iter().filter(|a| from.starts_with(&a.dir)).max_by_key(|a| a.dir.components().count())
    }

    fn resolve(&self, from_file: &Path, spec: &str) -> Resolved {
        if spec.starts_with('.') {
            let dir = from_file.parent().unwrap_or(Path::new(""));
            return self.try_file(&dir.join(spec)).map(Resolved::File).unwrap_or(Resolved::Unresolved);
        }
        if let Some(cfg) = self.alias_for(from_file) {
            for (pattern, targets) in &cfg.paths {
                let matched = match pattern.strip_suffix('*') {
                    Some(prefix) => spec.strip_prefix(prefix),
                    None => (spec == pattern).then_some(""),
                };
                if let Some(rest) = matched {
                    for t in targets {
                        if let Some(f) = self.try_file(&cfg.base.join(t.replace('*', rest))) {
                            return Resolved::File(f);
                        }
                    }
                }
            }
            // baseUrl imports like `components/Button`.
            if let Some(f) = self.try_file(&cfg.base.join(spec)) {
                return Resolved::File(f);
            }
        }
        match package_name(spec) {
            Some(name) => match self.packages.get(&name) {
                // Imports of another package in the same monorepo point at real files.
                Some(pkg) => self.resolve_local_package(pkg, &spec[name.len()..]).map(Resolved::File).unwrap_or(Resolved::Package(name)),
                None => Resolved::Package(name),
            },
            None => Resolved::Ignored,
        }
    }

    fn resolve_local_package(&self, pkg: &LocalPackage, sub: &str) -> Option<PathBuf> {
        let key = format!(".{sub}"); // "" -> ".", "/utils" -> "./utils"
        for (pattern, target) in &pkg.exports {
            let resolved = match pattern.split_once('*') {
                Some((pre, post)) => key.strip_prefix(pre).and_then(|r| r.strip_suffix(post)).map(|m| target.replace('*', m)),
                None => (pattern == &key).then(|| target.clone()),
            };
            if let Some(f) = resolved.and_then(|t| self.try_file(&pkg.dir.join(t))) {
                return Some(f);
            }
        }
        if sub.is_empty() {
            if let Some(f) = pkg.entry.as_ref().and_then(|e| self.try_file(&pkg.dir.join(e))) {
                return Some(f);
            }
            return self.try_file(&pkg.dir.join("src")).or_else(|| self.try_file(&pkg.dir));
        }
        let sub = sub.trim_start_matches('/');
        self.try_file(&pkg.dir.join("src").join(sub)).or_else(|| self.try_file(&pkg.dir.join(sub)))
    }
}

enum Resolved {
    File(PathBuf),
    Package(String),
    Ignored,
    Unresolved,
}

const NODE_BUILTINS: &[&str] = &[
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "crypto", "dgram", "dns", "events", "fs", "http", "http2", "https",
    "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url",
    "util", "v8", "vm", "worker_threads", "zlib",
];

/// `@scope/pkg/sub` -> `@scope/pkg`, `lodash/fp` -> `lodash`. Builtins and URLs are ignored.
pub fn package_name(spec: &str) -> Option<String> {
    if spec.starts_with("node:") || spec.contains("://") || spec.starts_with('/') || spec.starts_with('#') || spec.is_empty() {
        return None;
    }
    let mut parts = spec.split('/');
    let first = parts.next()?;
    if first == "@" {
        return None; // an alias like `@/lib` that no tsconfig resolved
    }
    let name = if first.starts_with('@') { format!("{first}/{}", parts.next()?) } else { first.to_string() };
    if NODE_BUILTINS.contains(&name.as_str()) || name.starts_with("virtual:") || name.starts_with('~') {
        return None;
    }
    Some(name)
}

// ---------- Walking ----------

fn rel_string(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn scan_repo(repo_id: &str, root: &Path, mut progress: impl FnMut(usize, usize)) -> Result<ScanResult, String> {
    if !root.is_dir() {
        return Err(format!("{} does not exist any more", root.display()));
    }

    let mut files = BTreeSet::new();
    let mut configs = Vec::new();
    let mut manifests = Vec::new();
    let mut schema_files = Vec::new();
    let mut compose_files = Vec::new();
    let mut has_pnpm_workspace = false;
    let mut logo: Option<(String, i32)> = None;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .require_git(false)
        .filter_entry(|e| !(e.file_type().map(|t| t.is_dir()).unwrap_or(false) && SKIP_DIRS.contains(&e.file_name().to_str().unwrap_or(""))))
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else { continue };
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "tsconfig.json" || name == "jsconfig.json" {
            configs.push(rel.to_path_buf());
            continue;
        }
        if name == "package.json" {
            manifests.push(rel.to_path_buf());
            continue;
        }
        let is_compose = (name.starts_with("docker-compose") || name.starts_with("compose")) && (name.ends_with(".yml") || name.ends_with(".yaml"));
        if is_compose && !name.contains(".test.") && !name.contains("override") {
            compose_files.push(rel.to_path_buf());
            continue;
        }
        if name == "pnpm-workspace.yaml" {
            has_pnpm_workspace = true;
        }
        if let Some(score) = entry.metadata().ok().filter(|m| m.is_file()).and_then(|m| crate::logo::score(rel, m.len())) {
            if logo.as_ref().map(|(_, best)| score > *best).unwrap_or(true) {
                logo = Some((rel_string(rel), score));
            }
            continue;
        }
        if name.ends_with(".prisma") || name.ends_with(".zmodel") || name.ends_with(".sql") || name.starts_with("drizzle.config.") {
            schema_files.push(rel.to_path_buf());
            if !name.starts_with("drizzle.config.") {
                continue;
            }
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !EXTENSIONS.contains(&ext) || name.ends_with(".min.js") || name.ends_with(".d.ts") {
            continue;
        }
        if entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
            continue;
        }
        files.insert(rel.to_path_buf());
    }

    let aliases = configs
        .iter()
        .filter_map(|c| load_alias_config(c.parent().unwrap_or(Path::new("")), &root.join(c)))
        .collect();
    let manifests: Vec<(PathBuf, Value)> = manifests
        .iter()
        .filter_map(|m| Some((m.parent().unwrap_or(Path::new("")).to_path_buf(), serde_json::from_str(&std::fs::read_to_string(root.join(m)).ok()?).ok()?)))
        .collect();
    let packages = manifests.iter().filter_map(|(dir, m)| load_local_package(dir, m)).map(|p| (p.name.clone(), p)).collect();
    let resolver = Resolver { files: &files, aliases, packages };

    let total = files.len();
    progress(0, total);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<usize>();
    let file_list: Vec<&PathBuf> = files.iter().collect();

    let parsed: Vec<(PathBuf, ParsedFile)> = std::thread::scope(|s| {
        let handle = s.spawn(|| {
            file_list
                .par_iter()
                .map_init(Parser::new, |parser, rel| {
                    let abs = root.join(rel);
                    let parsed = match (language_for(&abs), std::fs::read_to_string(&abs)) {
                        (Some(lang), Ok(source)) => parse_source(parser, &lang, &source),
                        _ => ParsedFile::default(),
                    };
                    let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if n % 50 == 0 || n == total {
                        let _ = tx.send(n);
                    }
                    ((*rel).clone(), parsed)
                })
                .collect()
        });
        // Forward progress from the worker threads until parsing is done.
        while !handle.is_finished() {
            if let Ok(n) = rx.recv_timeout(std::time::Duration::from_millis(50)) {
                progress(n, total);
            }
        }
        handle.join().unwrap()
    });
    progress(total, total);

    // ---- Database schema ----
    let read = |rel: &PathBuf| std::fs::read_to_string(root.join(rel)).ok();
    let model_files_prisma: Vec<(String, String)> = schema_files
        .iter()
        .filter(|f| f.extension().map(|e| e == "prisma").unwrap_or(false))
        .filter_map(|f| read(f).map(|src| (rel_string(f), src)))
        .collect();
    let model_files = |ext: &str| -> Vec<(String, String)> {
        schema_files.iter().filter(|f| f.extension().map(|e| e == ext).unwrap_or(false)).filter_map(|f| read(f).map(|src| (rel_string(f), src))).collect()
    };
    // ZenStack's .zmodel is the authoring source; its generated schema.prisma is usually gitignored.
    let zmodel = model_files("zmodel");
    let mut tables = schema::parse_prisma(if zmodel.is_empty() { &model_files_prisma } else { &zmodel });
    let snake = schema_files
        .iter()
        .filter(|f| f.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("drizzle.config.")).unwrap_or(false))
        .filter_map(read)
        .any(|c| c.contains("casing") && c.contains("snake_case"));
    let drizzle: Vec<(String, DrizzleTable)> = parsed.iter().flat_map(|(rel, f)| f.drizzle.iter().map(move |t| (rel_string(rel), t.clone()))).collect();
    tables.extend(schema::resolve_drizzle(drizzle, snake));
    // Migrations are only the source of truth when no ORM schema describes the tables.
    if tables.is_empty() {
        let mut sql: Vec<(String, String)> = schema_files
            .iter()
            .filter(|f| f.extension().map(|e| e == "sql").unwrap_or(false))
            .filter_map(|f| read(f).map(|src| (rel_string(f), src)))
            .collect();
        sql.sort_by(|a, b| a.0.cmp(&b.0));
        tables = schema::replay_sql(&sql);
    }
    tables.dedup_by(|a, b| a.name == b.name);

    // ---- Architecture: units, infrastructure, engines ----
    let mut units: Vec<arch::Unit> = manifests.iter().map(|(dir, m)| arch::unit_from_manifest(&rel_string(dir), m)).collect();
    if units.is_empty() {
        let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "root".into());
        units.push(arch::Unit { dir: String::new(), name, deps: vec![], dev_deps: vec![], scripts: Default::default(), has_bin: false, ports: vec![] });
    }
    // Deepest unit whose folder contains the file.
    let unit_of = |path: &str| -> usize {
        units
            .iter()
            .enumerate()
            .filter(|(_, u)| u.dir.is_empty() || path == u.dir || path.starts_with(&format!("{}/", u.dir)))
            .max_by_key(|(_, u)| u.dir.len())
            .map(|(i, _)| i)
            .unwrap_or(0)
    };
    let mut unit_files = vec![(0usize, 0usize); units.len()];
    let mut listen: Vec<(usize, u16)> = Vec::new();
    for (rel, f) in &parsed {
        let i = unit_of(&rel_string(rel));
        unit_files[i].0 += 1;
        unit_files[i].1 += f.lines;
        listen.extend(f.hints.listen_ports.iter().map(|p| (i, *p)));
    }
    for (i, p) in listen {
        if !units[i].ports.contains(&p) {
            units[i].ports.push(p);
        }
    }
    let root_is_workspace = has_pnpm_workspace || manifests.iter().any(|(d, m)| d.as_os_str().is_empty() && m.get("workspaces").is_some());
    let infra: Vec<arch::InfraService> = compose_files
        .iter()
        .filter_map(|f| read(f).map(|src| arch::parse_compose(&rel_string(f), &rel_string(f.parent().unwrap_or(Path::new(""))), &src)))
        .flatten()
        .collect();
    let mut engines: Vec<String> = model_files_prisma
        .iter()
        .chain(zmodel.iter())
        .map(|(_, src)| src.clone())
        .chain(schema_files.iter().filter(|f| f.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("drizzle.config.")).unwrap_or(false)).filter_map(read))
        .filter_map(|src| arch::engine_in(&src))
        .collect();
    engines.sort();
    engines.dedup();

    let id_of = |rel: &Path| format!("{repo_id}:{}", rel_string(rel));
    let root_id = format!("{repo_id}:");
    let mut stats = ScanStats { files: total, ..Default::default() };
    let mut nodes = Vec::new();
    let mut edges = BTreeSet::new();
    let mut packages: BTreeMap<String, usize> = BTreeMap::new();

    // Folder nodes for every directory that (transitively) contains code.
    let mut folders: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for rel in &files {
        let mut dir = rel.parent();
        while let Some(d) = dir.filter(|d| !d.as_os_str().is_empty()) {
            *folders.entry(d.to_path_buf()).or_default() += 1;
            dir = d.parent();
        }
    }
    let parent_id = |rel: &Path| match rel.parent() {
        Some(p) if !p.as_os_str().is_empty() => id_of(p),
        _ => root_id.clone(),
    };
    nodes.push(GraphNode {
        id: root_id.clone(),
        kind: "folder".into(),
        name: root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: Some(String::new()),
        parent_id: None,
        meta: json!({ "files": total, "engines": engines }),
    });
    for (dir, count) in &folders {
        nodes.push(GraphNode {
            id: id_of(dir),
            kind: "folder".into(),
            name: dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: Some(rel_string(dir)),
            parent_id: Some(parent_id(dir)),
            meta: json!({ "files": count }),
        });
    }

    for (rel, file) in &parsed {
        let file_id = id_of(rel);
        stats.symbols += file.symbols.len();
        stats.parse_errors += file.has_errors as usize;

        let mut seen: HashMap<String, usize> = HashMap::new();
        for sym in &file.symbols {
            let n = seen.entry(sym.name.clone()).or_default();
            *n += 1;
            let sym_id = if *n == 1 { format!("{file_id}#{}", sym.name) } else { format!("{file_id}#{}:{}", sym.name, sym.line) };
            nodes.push(GraphNode {
                id: sym_id,
                kind: "symbol".into(),
                name: sym.name.clone(),
                path: Some(rel_string(rel)),
                parent_id: Some(file_id.clone()),
                meta: json!({ "symbolKind": sym.kind, "exported": sym.exported, "line": sym.line, "lines": sym.lines }),
            });
        }

        for spec in &file.imports {
            match resolver.resolve(rel, spec) {
                Resolved::File(target) if &target != rel => {
                    stats.imports += 1;
                    edges.insert(GraphEdge { src: file_id.clone(), dst: id_of(&target), kind: "imports".into() });
                }
                Resolved::Package(name) => {
                    *packages.entry(name.clone()).or_default() += 1;
                    edges.insert(GraphEdge { src: file_id.clone(), dst: format!("pkg:{name}"), kind: "imports".into() });
                }
                Resolved::Unresolved => stats.unresolved += 1,
                _ => {}
            }
        }

        nodes.push(GraphNode {
            id: file_id,
            kind: "file".into(),
            name: rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: Some(rel_string(rel)),
            parent_id: Some(parent_id(rel)),
            meta: json!({ "lines": file.lines, "symbols": file.symbols.len(), "parseError": file.has_errors, "hash": format!("{:016x}", file.hash) }),
        });
    }

    for (i, u) in units.iter().enumerate() {
        nodes.push(GraphNode {
            id: format!("{repo_id}:unit:{}", u.dir),
            kind: "unit".into(),
            name: u.name.clone(),
            path: Some(u.dir.clone()),
            parent_id: None,
            meta: json!({
                "deps": u.deps, "devDeps": u.dev_deps, "scripts": u.scripts, "hasBin": u.has_bin, "ports": u.ports,
                "files": unit_files[i].0, "lines": unit_files[i].1,
                "workspaceRoot": u.dir.is_empty() && units.len() > 1 && (root_is_workspace || unit_files[i].0 == 0),
            }),
        });
    }
    for svc in &infra {
        nodes.push(GraphNode {
            id: format!("{repo_id}:infra:{}", svc.name),
            kind: "infra".into(),
            name: svc.name.clone(),
            path: Some(svc.file.clone()),
            parent_id: None,
            meta: json!({ "image": svc.image, "build": svc.build, "ports": svc.ports, "dependsOn": svc.depends_on, "links": svc.links }),
        });
    }
    for (rel, f) in &parsed {
        let src = id_of(rel);
        for v in &f.hints.env {
            edges.insert(GraphEdge { src: src.clone(), dst: format!("env:{v}"), kind: "env".into() });
        }
        for p in &f.hints.localhost_ports {
            edges.insert(GraphEdge { src: src.clone(), dst: format!("port:{p}"), kind: "calls".into() });
        }
        for h in &f.hints.hosts {
            edges.insert(GraphEdge { src: src.clone(), dst: format!("host:{h}"), kind: "calls".into() });
        }
    }

    let table_id = |name: &str| format!("{repo_id}:table:{name}");
    stats.tables = tables.len();
    stats.units = units.len();
    for t in &tables {
        nodes.push(GraphNode {
            id: table_id(&t.name),
            kind: "table".into(),
            name: t.name.clone(),
            path: Some(t.source.clone()),
            parent_id: None,
            meta: json!({ "origin": t.origin, "line": t.line, "model": t.model, "columns": t.columns }),
        });
        for c in &t.columns {
            if let Some(fk) = &c.fk {
                edges.insert(GraphEdge { src: table_id(&t.name), dst: table_id(&fk.table), kind: "references".into() });
            }
        }
    }
    if !tables.is_empty() {
        for (rel, file) in &parsed {
            for r in &file.db_refs {
                if let Some(t) = schema::resolve_ref(r, &tables) {
                    let write = matches!(r, DbRef::Accessor { write: true, .. } | DbRef::Ident { write: true, .. } | DbRef::Sql { write: true, .. });
                    edges.insert(GraphEdge { src: id_of(rel), dst: table_id(&t.name), kind: if write { "writes" } else { "reads" }.into() });
                }
            }
        }
    }

    // Declared dependencies (from every package.json in the repo) tell real
    // packages apart from ones that live in a repo that isn't connected.
    let mut declared: BTreeSet<String> = resolver.packages.keys().cloned().collect();
    for (_, m) in &manifests {
        for key in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
            if let Some(deps) = m.get(key).and_then(Value::as_object) {
                declared.extend(deps.keys().cloned());
            }
        }
    }
    let root_manifest = manifests.iter().find(|(dir, _)| dir.as_os_str().is_empty()).map(|(_, m)| m);
    stats.packages = packages.len();
    for (name, uses) in packages {
        nodes.push(GraphNode {
            id: format!("pkg:{name}"),
            kind: "package".into(),
            name: name.clone(),
            path: None,
            parent_id: None,
            meta: json!({ "uses": uses, "declared": declared.contains(&name) }),
        });
    }

    Ok(ScanResult {
        nodes,
        edges: edges.into_iter().collect(),
        stats,
        package_name: root_manifest.and_then(|m| m.get("name")).and_then(Value::as_str).map(String::from),
        logo,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(ext: &str, src: &str) -> ParsedFile {
        let mut parser = Parser::new();
        let lang = language_for(Path::new(&format!("x.{ext}"))).unwrap();
        parse_source(&mut parser, &lang, src)
    }

    #[test]
    fn extracts_imports_and_symbols() {
        let f = parse(
            "ts",
            r#"
import { a } from "./a";
import type { T } from '../types';
export { b } from "./b";
const lazy = () => import("./lazy");
const fs = require("fs");
export async function createCheckout() {}
export const pricing = (x: number) => x * 2;
export const LIMIT = 10;
const internal = 5;
function helper() {}
export class CheckoutError extends Error {}
export interface Cart { id: string }
export default function () {}
"#,
        );
        assert_eq!(f.imports, vec!["./a", "../types", "./b", "./lazy", "fs"]);
        let names: Vec<_> = f.symbols.iter().map(|s| (s.name.as_str(), s.kind, s.exported)).collect();
        assert_eq!(
            names,
            vec![
                ("lazy", "function", false),
                ("createCheckout", "function", true),
                ("pricing", "function", true),
                ("LIMIT", "const", true),
                ("helper", "function", false),
                ("CheckoutError", "class", true),
                ("Cart", "type", true),
                ("default", "function", true),
            ]
        );
    }

    #[test]
    fn parses_jsx_and_tsx() {
        let f = parse("tsx", "import React from 'react';\nexport function App() { return <div className=\"a\">hi</div>; }\n");
        assert_eq!(f.imports, vec!["react"]);
        assert_eq!(f.symbols[0].name, "App");
        assert!(!f.has_errors);
        let j = parse("jsx", "export const Button = () => <button/>;\n");
        assert_eq!(j.symbols[0].name, "Button");
    }

    #[test]
    fn package_names() {
        assert_eq!(package_name("@acme/shared-types/dist/x").as_deref(), Some("@acme/shared-types"));
        assert_eq!(package_name("lodash/fp").as_deref(), Some("lodash"));
        assert_eq!(package_name("fs"), None);
        assert_eq!(package_name("node:path"), None);
        assert_eq!(package_name("@/lib/utils"), None);
    }

    #[test]
    fn jsonc() {
        let v = parse_jsonc("{ // c\n \"a\": \"//not a comment\", /* x */ \"b\": [1,2,], }").unwrap();
        assert_eq!(v["a"], "//not a comment");
        assert_eq!(v["b"][1], 2);
    }

    #[test]
    fn scans_a_small_repo_with_aliases() {
        let root = std::env::temp_dir().join(format!("strata-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let write = |p: &str, s: &str| {
            let path = root.join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, s).unwrap();
        };
        write("package.json", r#"{ "name": "api", "dependencies": { "stripe": "1" } }"#);
        write("tsconfig.json", r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }"#);
        write("src/routes/checkout.ts", "import { createCheckout } from '@/services/checkout.service';\nimport Stripe from 'stripe';\nimport { x } from '@acme/shared-types';\n");
        write("src/services/checkout.service.ts", "import { db } from '../db';\nexport function createCheckout() {}\n");
        write("src/db/index.ts", "export const db = {};\n");
        write("node_modules/stripe/index.js", "module.exports = {}\n");

        let r = scan_repo("r1", &root, |_, _| {}).unwrap();
        assert_eq!(r.stats.files, 3, "node_modules is skipped");
        assert_eq!(r.package_name.as_deref(), Some("api"));
        let edge = |s: &str, d: &str| r.edges.iter().any(|e| e.src == s && e.dst == d);
        assert!(edge("r1:src/routes/checkout.ts", "r1:src/services/checkout.service.ts"), "alias resolved");
        assert!(edge("r1:src/services/checkout.service.ts", "r1:src/db/index.ts"), "index resolved");
        assert!(edge("r1:src/routes/checkout.ts", "pkg:stripe"));
        let shared = r.nodes.iter().find(|n| n.id == "pkg:@acme/shared-types").unwrap();
        assert_eq!(shared.meta["declared"], false);
        let file = r.nodes.iter().find(|n| n.id == "r1:src/db/index.ts").unwrap();
        assert_eq!(file.parent_id.as_deref(), Some("r1:src/db"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_monorepo_workspace_packages() {
        let root = std::env::temp_dir().join(format!("strata-mono-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let write = |p: &str, s: &str| {
            let path = root.join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, s).unwrap();
        };
        write("package.json", r#"{ "name": "mono", "private": true }"#);
        write("packages/shared/package.json", r#"{ "name": "@m/shared", "exports": { ".": "./src/index.ts", "./*": "./src/*/index.ts" }, "dependencies": { "zod": "3" } }"#);
        write("packages/shared/src/index.ts", "export const a = 1;\n");
        write("packages/shared/src/money/index.ts", "export const b = 1;\n");
        write("packages/db/package.json", r#"{ "name": "@m/db", "main": "./src/client.ts" }"#);
        write("packages/db/src/client.ts", "export const db = 1;\n");
        write("apps/web/package.json", r#"{ "name": "web", "dependencies": { "@m/shared": "workspace:*", "next": "15" } }"#);
        write("apps/web/page.ts", "import { a } from '@m/shared';\nimport { b } from '@m/shared/money';\nimport { db } from '@m/db';\nimport z from 'zod';\nimport next from 'next';\n");

        let r = scan_repo("r", &root, |_, _| {}).unwrap();
        let edge = |d: &str| r.edges.iter().any(|e| e.src == "r:apps/web/page.ts" && e.dst == d);
        assert!(edge("r:packages/shared/src/index.ts"));
        assert!(edge("r:packages/shared/src/money/index.ts"), "exports pattern");
        assert!(edge("r:packages/db/src/client.ts"), "main field");
        let declared = |n: &str| r.nodes.iter().find(|x| x.id == format!("pkg:{n}")).map(|x| x.meta["declared"].as_bool().unwrap());
        assert_eq!(declared("zod"), Some(true), "declared in a nested package.json");
        assert_eq!(declared("next"), Some(true));
        assert_eq!(declared("@m/shared"), None, "resolved to files, not a package");
        assert_eq!(r.package_name.as_deref(), Some("mono"));
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod real_repo {
    /// `STRATA_SCAN=/path/to/repo cargo test --release real_repo -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn scan_real_repo() {
        let Ok(path) = std::env::var("STRATA_SCAN") else { return };
        let t = std::time::Instant::now();
        let r = super::scan_repo("r", std::path::Path::new(&path), |_, _| {}).unwrap();
        println!("{path}: {:?} nodes={} edges={} in {:?}", r.stats, r.nodes.len(), r.edges.len(), t.elapsed());
        println!("logo: {:?}", r.logo);
        let undeclared: Vec<_> = r.nodes.iter().filter(|n| n.kind == "package" && n.meta["declared"] == false).map(|n| n.name.as_str()).collect();
        println!("undeclared: {undeclared:?}");
        let tables: Vec<_> = r.nodes.iter().filter(|n| n.kind == "table").map(|n| format!("{}({}c,{})", n.name, n.meta["columns"].as_array().map(|a| a.len()).unwrap_or(0), n.meta["origin"].as_str().unwrap_or(""))).collect();
        let count = |k: &str| r.edges.iter().filter(|e| e.kind == k).count();
        println!("tables: {} {:?}", tables.len(), &tables[..tables.len().min(12)]);
        println!("fk={} reads={} writes={} calls={} env={}", count("references"), count("reads"), count("writes"), count("calls"), count("env"));
        for n in r.nodes.iter().filter(|n| n.kind == "unit" || n.kind == "infra") {
            println!("  {} {} {}", n.kind, n.name, serde_json::json!({ "ports": n.meta["ports"], "files": n.meta["files"], "image": n.meta["image"], "build": n.meta["build"], "root": n.meta["workspaceRoot"] }));
        }
        let root = r.nodes.iter().find(|n| n.id == "r:").unwrap();
        println!("engines: {}", root.meta["engines"]);
        // STRATA_FIXTURE=../public/fixture.json writes the graph in `get_graph` shape for `?fixture`.
        if let Ok(out) = std::env::var("STRATA_FIXTURE") {
            let nodes: Vec<_> = r.nodes.iter().filter(|n| n.kind != "package").map(|n| serde_json::json!({ "id": n.id, "repoId": "r", "kind": n.kind, "name": n.name, "path": n.path, "parentId": n.parent_id, "meta": n.meta })).collect();
            let packages: Vec<_> = r.nodes.iter().filter(|n| n.kind == "package").map(|n| serde_json::json!({ "repoId": "r", "name": n.name, "uses": n.meta["uses"], "declared": n.meta["declared"] })).collect();
            let graph = serde_json::json!({ "nodes": nodes, "edges": r.edges, "packages": packages, "repoIds": ["r"] });
            std::fs::write(out, graph.to_string()).unwrap();
        }
    }
}
