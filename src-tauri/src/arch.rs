//! Signals for the Architecture lens: deployable units (every package.json),
//! infrastructure from docker-compose, database engines, and per-file hints
//! about how code reaches other services (env vars, localhost ports, external
//! hosts, ports it listens on).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tree_sitter::Node;

/// A package.json in the repo. Classification (app / service / library …) happens in the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Unit {
    pub dir: String, // repo-relative, "" for the root
    pub name: String,
    pub deps: Vec<String>,
    pub dev_deps: Vec<String>,
    pub scripts: BTreeMap<String, String>,
    pub has_bin: bool,
    /// Ports from scripts (`-p 3002`, `PORT=4000`) and from code that calls `.listen(...)`.
    pub ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct InfraService {
    pub name: String,
    pub image: Option<String>,
    /// Build context, repo-relative — links the service to a unit.
    pub build: Option<String>,
    pub ports: Vec<u16>,
    pub depends_on: Vec<String>,
    /// Other services named in this one's environment, e.g. `OLLAMA_HOST: http://ollama:11434` -> ("ollama", "OLLAMA_HOST").
    pub links: Vec<(String, String)>,
    pub file: String,
}

static SCRIPT_PORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:-p|--port)[ =](\d{2,5})\b|\bPORT=(\d{2,5})\b").unwrap());

fn names(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_object).map(|o| o.keys().cloned().collect()).unwrap_or_default()
}

pub fn unit_from_manifest(dir: &str, manifest: &Value) -> Unit {
    let scripts: BTreeMap<String, String> = manifest
        .get("scripts")
        .and_then(Value::as_object)
        .map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default();
    let mut ports: BTreeSet<u16> = BTreeSet::new();
    for (key, s) in &scripts {
        if matches!(key.as_str(), "dev" | "start" | "serve" | "preview") {
            for c in SCRIPT_PORT.captures_iter(s) {
                if let Some(p) = c.get(1).or(c.get(2)).and_then(|m| m.as_str().parse().ok()) {
                    ports.insert(p);
                }
            }
        }
    }
    let fallback = if dir.is_empty() { "root".to_string() } else { dir.rsplit('/').next().unwrap_or(dir).to_string() };
    Unit {
        dir: dir.to_string(),
        name: manifest.get("name").and_then(Value::as_str).map(String::from).unwrap_or(fallback),
        deps: names(manifest.get("dependencies")),
        dev_deps: names(manifest.get("devDependencies")),
        scripts,
        has_bin: manifest.get("bin").is_some(),
        ports: ports.into_iter().collect(),
    }
}

/// `"5432:5432"`, `"127.0.0.1:8080:80"`, `{ published: 3000 }` -> the host-side port.
fn compose_port(v: &serde_yaml::Value) -> Option<u16> {
    match v {
        serde_yaml::Value::Number(n) => n.as_u64().and_then(|n| u16::try_from(n).ok()),
        serde_yaml::Value::String(s) => {
            let parts: Vec<&str> = s.split('/').next()?.split(':').collect();
            let host = if parts.len() >= 2 { parts[parts.len() - 2] } else { parts[0] };
            host.split('-').next()?.parse().ok()
        }
        serde_yaml::Value::Mapping(m) => m.get("published").and_then(|p| compose_port(p)),
        _ => None,
    }
}

static ENV_HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?://|@)([A-Za-z0-9_.-]+)(?::\d+|/|$)").unwrap());

pub fn parse_compose(file: &str, dir: &str, src: &str) -> Vec<InfraService> {
    let Ok(mut doc) = serde_yaml::from_str::<serde_yaml::Value>(src) else { return vec![] };
    // `<<: *shared-env` merge keys are common in compose files.
    let _ = doc.apply_merge();
    let Some(services) = doc.get("services").and_then(|s| s.as_mapping()) else { return vec![] };
    let join = |p: &str| {
        let p = p.trim_start_matches("./").trim_end_matches('/');
        match (dir.is_empty(), p.is_empty() || p == ".") {
            (_, true) => dir.to_string(),
            (true, false) => p.to_string(),
            (false, false) => format!("{dir}/{p}"),
        }
    };
    let service_names: Vec<String> = services.keys().filter_map(|k| k.as_str().map(String::from)).collect();
    services
        .iter()
        .filter_map(|(name, svc)| {
            let name = name.as_str()?.to_string();
            let build = match svc.get("build") {
                Some(serde_yaml::Value::String(s)) => Some(join(s)),
                Some(m @ serde_yaml::Value::Mapping(_)) => Some(join(m.get("context").and_then(|c| c.as_str()).unwrap_or("."))),
                _ => None,
            };
            let depends_on = match svc.get("depends_on") {
                Some(serde_yaml::Value::Sequence(s)) => s.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
                Some(serde_yaml::Value::Mapping(m)) => m.keys().filter_map(|k| k.as_str().map(String::from)).collect(),
                _ => vec![],
            };
            let mut env: Vec<(String, String)> = match svc.get("environment") {
                Some(serde_yaml::Value::Mapping(m)) => {
                    let mut m = serde_yaml::Value::Mapping(m.clone());
                    let _ = m.apply_merge();
                    m.as_mapping().map(|m| m.iter().filter_map(|(k, v)| Some((k.as_str()?.to_string(), v.as_str().map(String::from).unwrap_or_default()))).collect()).unwrap_or_default()
                }
                Some(serde_yaml::Value::Sequence(s)) => s.iter().filter_map(|v| v.as_str()?.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))).collect(),
                _ => vec![],
            };
            env.sort();
            let mut links: Vec<(String, String)> = Vec::new();
            for (key, value) in &env {
                for c in ENV_HOST.captures_iter(value) {
                    let host = &c[1];
                    if host != name && service_names.iter().any(|n| n == host) && !links.iter().any(|(h, _)| h == host) {
                        links.push((host.to_string(), key.clone()));
                    }
                }
            }
            Some(InfraService {
                links,
                name,
                image: svc.get("image").and_then(|i| i.as_str()).map(String::from),
                build,
                ports: svc.get("ports").and_then(|p| p.as_sequence()).map(|s| s.iter().filter_map(compose_port).collect()).unwrap_or_default(),
                depends_on,
                file: file.to_string(),
            })
        })
        .collect()
}

static PRISMA_PROVIDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"(\w+)""#).unwrap());
static DRIZZLE_DIALECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"dialect\s*:\s*['"](\w+)['"]"#).unwrap());

/// Database engine declared by a Prisma/ZenStack schema or a drizzle.config file.
pub fn engine_in(src: &str) -> Option<String> {
    let raw = PRISMA_PROVIDER.captures(src).or_else(|| DRIZZLE_DIALECT.captures(src)).map(|c| c[1].to_lowercase())?;
    Some(
        match raw.as_str() {
            "postgresql" | "postgres" | "pg" => "postgres",
            "sqlite" | "turso" | "libsql" | "d1" => "sqlite",
            "mysql" | "singlestore" | "planetscale" => "mysql",
            "mongodb" => "mongodb",
            "sqlserver" => "sqlserver",
            "cockroachdb" => "cockroachdb",
            other => other,
        }
        .to_string(),
    )
}

// ---------- Per-file hints ----------

#[derive(Debug, Default, Clone, PartialEq)]
pub struct FileHints {
    pub env: Vec<String>,
    pub localhost_ports: Vec<u16>,
    pub hosts: Vec<String>,
    pub listen_ports: Vec<u16>,
}

static LOCALHOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})").unwrap());
static URL_HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[`'\x22]https?://([A-Za-z0-9.-]+\.[A-Za-z]{2,})").unwrap());
/// `.listen(3000)`, `port ?? 3000`, `PORT || 3000`, and env schemas like `API_PORT: z.number().default(3000)`.
static LISTEN_PORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.listen\(\s*\{?[^)]{0,80}?\b([1-9]\d{3,4})\b|port\b[^\n]{0,80}?(?:\?\?|\|\||default\()\s*\(?\s*([1-9]\d{3,4})\b").unwrap());

const HTTP_CALLS: &[&str] = &["fetch", "get", "post", "put", "patch", "delete", "request", "ky", "got", "axios", "ofetch", "$fetch"];
const IGNORED_HOSTS: &[&str] = &["example.com", "example.org", "localhost", "schema.org", "www.w3.org", "json-schema.org"];

fn text<'a>(n: Node, src: &'a [u8]) -> &'a str {
    n.utf8_text(src).unwrap_or("")
}

fn walk(n: Node, src: &[u8], out: &mut FileHints) {
    match n.kind() {
        // process.env.X / import.meta.env.X
        "member_expression" => {
            if let (Some(obj), Some(prop)) = (n.child_by_field_name("object"), n.child_by_field_name("property")) {
                let o = text(obj, src);
                if o == "process.env" || o == "import.meta.env" {
                    out.env.push(text(prop, src).to_string());
                }
            }
        }
        "call_expression" => {
            let callee = n.child_by_field_name("function").map(|f| text(f, src)).unwrap_or("");
            let last = callee.rsplit('.').next().unwrap_or(callee);
            if HTTP_CALLS.contains(&last) || callee.starts_with("axios") {
                if let Some(arg) = n.child_by_field_name("arguments").and_then(|a| a.named_child(0)) {
                    if let Some(c) = URL_HOST.captures(text(arg, src)) {
                        let host = c[1].to_lowercase();
                        // Reserved test TLDs (RFC 2606/6761) only appear in tests and examples.
                        let reserved = [".example", ".test", ".invalid", ".localhost", ".local"].iter().any(|t| host.ends_with(t));
                        if !reserved && !IGNORED_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) {
                            out.hosts.push(host);
                        }
                    }
                }
            }
        }
        "string" | "template_string" => {
            for c in LOCALHOST.captures_iter(text(n, src)) {
                if let Ok(p) = c[1].parse() {
                    out.localhost_ports.push(p);
                }
            }
        }
        _ => {}
    }
    let mut cursor = n.walk();
    for child in n.children(&mut cursor) {
        walk(child, src, out);
    }
}

pub fn file_hints(root: Node, source: &str) -> FileHints {
    let mut h = FileHints::default();
    walk(root, source.as_bytes(), &mut h);
    if source.contains(".listen(") || source.contains("serve(") || source.contains("PORT") {
        for c in LISTEN_PORT.captures_iter(source) {
            if let Some(p) = c.get(1).or(c.get(2)).and_then(|m| m.as_str().parse().ok()) {
                h.listen_ports.push(p);
            }
        }
    }
    for v in [&mut h.env, &mut h.hosts] {
        v.sort();
        v.dedup();
    }
    h.localhost_ports.sort();
    h.localhost_ports.dedup();
    h.listen_ports.sort();
    h.listen_ports.dedup();
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    #[test]
    fn units_from_manifests() {
        let m: Value = serde_json::from_str(r#"{ "name": "@a/landing", "scripts": { "dev": "next dev -p 3002", "start": "PORT=4000 node x" }, "dependencies": { "next": "15", "react": "19" }, "devDependencies": { "typescript": "5" } }"#).unwrap();
        let u = unit_from_manifest("apps/landing", &m);
        assert_eq!(u.name, "@a/landing");
        assert_eq!(u.deps, vec!["next", "react"]);
        assert_eq!(u.dev_deps, vec!["typescript"]);
        assert_eq!(u.ports, vec![3002, 4000]);
        let anon = unit_from_manifest("tools/x", &serde_json::json!({}));
        assert_eq!(anon.name, "x");
    }

    #[test]
    fn compose_services() {
        let src = r#"
x-env: &shared
  DATABASE_URL: postgres://app:secret@db:5432/app
  NODE_ENV: production
services:
  db:
    image: postgres:16-alpine
    ports: ['5432:5432']
  api:
    build: ./apps/api
    environment:
      <<: *shared
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy
  web:
    build:
      context: apps/web
    depends_on: [api]
"#;
        let s = parse_compose("deploy/compose.yaml", "", src);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0], InfraService { name: "db".into(), image: Some("postgres:16-alpine".into()), ports: vec![5432], file: "deploy/compose.yaml".into(), ..Default::default() });
        assert_eq!(s[1].links, vec![("db".to_string(), "DATABASE_URL".to_string())]);
        assert_eq!(s[1].build.as_deref(), Some("apps/api"));
        assert_eq!(s[1].ports, vec![3000]);
        assert_eq!(s[1].depends_on, vec!["db"]);
        assert_eq!(s[2].build.as_deref(), Some("apps/web"));
        assert_eq!(s[2].depends_on, vec!["api"]);
        assert_eq!(parse_compose("x/compose.yml", "x", "services:\n  a:\n    build: .\n")[0].build.as_deref(), Some("x"));
    }

    #[test]
    fn engines() {
        assert_eq!(engine_in("datasource db {\n  provider = \"postgresql\"\n  url = env(\"X\")\n}").as_deref(), Some("postgres"));
        assert_eq!(engine_in("export default defineConfig({ dialect: 'sqlite', schema: './s.ts' })").as_deref(), Some("sqlite"));
        assert_eq!(engine_in("model A { id Int @id }"), None);
    }

    #[test]
    fn hints_from_code() {
        let src = r#"
const base = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const key = process.env.STRIPE_SECRET_KEY;
await fetch("https://api.stripe.com/v1/charges");
await axios.get(`https://graph.microsoft.com/v1.0/me`);
await fetch(`${base}/users`);
const docs = "https://example.com/docs";
await fetch("https://evil.example/x");
app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
"#;
        let mut p = Parser::new();
        p.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()).unwrap();
        let tree = p.parse(src, None).unwrap();
        let h = file_hints(tree.root_node(), src);
        assert_eq!(h.env, vec!["PORT", "STRIPE_SECRET_KEY", "VITE_API_URL"]);
        assert_eq!(h.localhost_ports, vec![3000]);
        assert_eq!(h.hosts, vec!["api.stripe.com", "graph.microsoft.com"]);
        assert_eq!(h.listen_ports, vec![3000]);

        let env_schema = "export const env = z.object({ API_PORT: optional(z.coerce.number()).transform((v) => v ?? 3001), X: z.string() });";
        let tree = p.parse(env_schema, None).unwrap();
        assert_eq!(file_hints(tree.root_node(), env_schema).listen_ports, vec![3001]);
    }
}
