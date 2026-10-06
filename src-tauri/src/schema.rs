//! Database schemas, read from the three places they usually live:
//! Prisma schema files, Drizzle table definitions in TypeScript, and SQL
//! migrations (replayed in order). Also finds where code reads or writes
//! tables: Prisma client calls, Drizzle query builders and raw SQL strings.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use tree_sitter::Node;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ForeignKey {
    pub table: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub pk: bool,
    pub nullable: bool,
    pub unique: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fk: Option<ForeignKey>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Table {
    pub name: String,
    pub origin: &'static str, // prisma | drizzle | sql
    pub source: String,       // repo-relative file
    pub line: usize,
    /// Name code uses to reach the table: Prisma model or Drizzle variable.
    pub model: Option<String>,
    pub columns: Vec<Column>,
}

fn col(name: &str, ty: &str) -> Column {
    Column { name: name.to_string(), ty: ty.to_string(), pk: false, nullable: true, unique: false, fk: None }
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches(|c| c == '"' || c == '`' || c == '[' || c == ']' || c == '\'').to_string()
}

/// `public.users` -> `users`
fn table_ident(s: &str) -> String {
    let s = unquote(s);
    s.rsplit('.').next().map(unquote).unwrap_or(s)
}

// ---------- Prisma ----------

static PRISMA_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(abstract\s+)?(model|enum|view|type)\s+(\w+)(?:\s+extends\s+([\w\s,]+?))?\s*\{").unwrap());
static PRISMA_ATTR_STR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"@@?map\(\s*(?:name:\s*)?"([^"]+)"\s*\)"#).unwrap());
static PRISMA_LIST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(fields|references)\s*:\s*\[([^\]]*)\]").unwrap());
static PRISMA_ID_LIST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@@id\(\s*(?:fields:\s*)?\[([^\]]*)\]").unwrap());

fn strip_line_comment(line: &str) -> &str {
    let mut in_str = false;
    let bytes = line.as_bytes();
    for i in 0..bytes.len() {
        match bytes[i] {
            b'"' => in_str = !in_str,
            b'/' if !in_str && bytes.get(i + 1) == Some(&b'/') => return &line[..i],
            _ => {}
        }
    }
    line
}

fn split_list(s: &str) -> Vec<String> {
    s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// Parses Prisma schema files, or ZenStack `.zmodel` files (Prisma syntax plus
/// `abstract model` / `extends`), which may spread models across several files.
pub fn parse_prisma(files: &[(String, String)]) -> Vec<Table> {
    struct Field {
        name: String,
        base: String,
        list: bool,
        optional: bool,
        attrs: String,
    }
    struct Model {
        name: String,
        file: String,
        line: usize,
        abstract_: bool,
        extends: Vec<String>,
        fields: Vec<Field>,
        block_attrs: Vec<String>,
    }
    let mut models: Vec<Model> = Vec::new();
    let mut enums: Vec<String> = Vec::new();
    let mut current: Option<Model> = None;
    let mut skipping = false; // inside an enum/view/type block

    for (file, source) in files {
    for (i, raw) in source.lines().enumerate() {
        let line = strip_line_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        if current.is_none() && !skipping {
            if let Some(c) = PRISMA_BLOCK.captures(line) {
                match &c[2] {
                    "model" => {
                        current = Some(Model {
                            name: c[3].to_string(),
                            file: file.clone(),
                            line: i + 1,
                            abstract_: c.get(1).is_some(),
                            extends: c.get(4).map(|m| split_list(m.as_str())).unwrap_or_default(),
                            fields: vec![],
                            block_attrs: vec![],
                        })
                    }
                    "enum" => {
                        enums.push(c[3].to_string());
                        skipping = true;
                    }
                    _ => skipping = true,
                }
                // One-line blocks like `enum Role { A B }`.
                if line.trim_end().ends_with('}') {
                    skipping = false;
                    if let Some(m) = current.take() {
                        models.push(m);
                    }
                }
            }
            continue;
        }
        if line.starts_with('}') {
            if let Some(m) = current.take() {
                models.push(m);
            }
            skipping = false;
            continue;
        }
        let Some(m) = current.as_mut() else { continue };
        if line.starts_with("@@") {
            m.block_attrs.push(line.to_string());
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(name), Some(ty)) = (parts.next(), parts.next()) else { continue };
        let attrs = parts.collect::<Vec<_>>().join(" ");
        let optional = ty.ends_with('?');
        let list = ty.ends_with("[]");
        let base = ty.trim_end_matches('?').trim_end_matches("[]").to_string();
        m.fields.push(Field { name: name.to_string(), base, list, optional, attrs });
    }
    }

    // `extends`: inherited fields come first, like ZenStack generates them.
    let abstracts: HashMap<String, (Vec<Field>, Vec<String>)> = models
        .iter()
        .filter(|m| m.abstract_)
        .map(|m| (m.name.clone(), (m.fields.iter().map(|f| Field { name: f.name.clone(), base: f.base.clone(), list: f.list, optional: f.optional, attrs: f.attrs.clone() }).collect(), m.block_attrs.clone())))
        .collect();
    models.retain(|m| !m.abstract_);
    for m in &mut models {
        let mut inherited = Vec::new();
        for parent in &m.extends {
            if let Some((fields, attrs)) = abstracts.get(parent) {
                inherited.extend(fields.iter().filter(|f| !m.fields.iter().any(|o| o.name == f.name)).map(|f| Field { name: f.name.clone(), base: f.base.clone(), list: f.list, optional: f.optional, attrs: f.attrs.clone() }));
                m.block_attrs.extend(attrs.iter().filter(|a| a.starts_with("@@id")).cloned());
            }
        }
        inherited.append(&mut m.fields);
        m.fields = inherited;
    }

    let model_names: HashMap<&str, String> = models
        .iter()
        .map(|m| {
            let table = m.block_attrs.iter().find_map(|a| a.starts_with("@@map").then(|| PRISMA_ATTR_STR.captures(a).map(|c| c[1].to_string())).flatten());
            (m.name.as_str(), table.unwrap_or_else(|| m.name.clone()))
        })
        .collect();
    // Field name -> column name per model (for @map'd columns and FK targets).
    let column_name = |f: &Field| PRISMA_ATTR_STR.captures(&f.attrs).map(|c| c[1].to_string()).unwrap_or_else(|| f.name.clone());
    let col_lookup: HashMap<(&str, &str), String> = models.iter().flat_map(|m| m.fields.iter().map(move |f| ((m.name.as_str(), f.name.as_str()), column_name(f)))).collect();

    models
        .iter()
        .map(|m| {
            let composite_pk: Vec<String> = m.block_attrs.iter().find_map(|a| PRISMA_ID_LIST.captures(a)).map(|c| split_list(&c[1])).unwrap_or_default();
            let mut columns: Vec<Column> = Vec::new();
            let mut fks: Vec<(String, ForeignKey)> = Vec::new();
            for f in &m.fields {
                if let Some(target) = model_names.get(f.base.as_str()) {
                    // A relation field: real columns are the ones listed in `fields: [...]`.
                    let mut lists = PRISMA_LIST.captures_iter(&f.attrs).map(|c| (c[1].to_string(), split_list(&c[2]))).collect::<HashMap<_, _>>();
                    if let (Some(from), Some(to)) = (lists.remove("fields"), lists.remove("references")) {
                        for (a, b) in from.iter().zip(to.iter()) {
                            let to_col = col_lookup.get(&(f.base.as_str(), b.as_str())).cloned().unwrap_or_else(|| b.clone());
                            fks.push((a.clone(), ForeignKey { table: target.clone(), column: to_col }));
                        }
                    }
                    continue;
                }
                if f.list && !enums.contains(&f.base) && !is_prisma_scalar(&f.base) {
                    continue;
                }
                let mut c = col(&column_name(f), &format!("{}{}", f.base, if f.list { "[]" } else { "" }));
                c.pk = f.attrs.contains("@id") || composite_pk.contains(&f.name);
                c.nullable = f.optional;
                c.unique = f.attrs.contains("@unique");
                columns.push(c);
            }
            for (field, fk) in fks {
                let name = col_lookup.get(&(m.name.as_str(), field.as_str())).cloned().unwrap_or(field);
                if let Some(c) = columns.iter_mut().find(|c| c.name == name) {
                    c.fk = Some(fk);
                }
            }
            Table { name: model_names[m.name.as_str()].clone(), origin: "prisma", source: m.file.clone(), line: m.line, model: Some(m.name.clone()), columns }
        })
        .collect()
}

fn is_prisma_scalar(t: &str) -> bool {
    matches!(t, "String" | "Int" | "BigInt" | "Float" | "Decimal" | "Boolean" | "DateTime" | "Json" | "Bytes")
}

// ---------- SQL migrations ----------

/// Removes comments and splits into statements, keeping `$$ ... $$` bodies intact.
fn sql_statements(src: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut line, mut start_line) = (1, 1);
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let (mut in_str, mut in_dollar) = (false, false);
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '\n' {
            line += 1;
        }
        if !in_str && !in_dollar && c == '-' && next == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if !in_str && !in_dollar && c == '/' && next == Some('*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                if chars[i] == '\n' {
                    line += 1;
                }
                i += 1;
            }
            i += 2;
            continue;
        }
        if !in_dollar && c == '\'' {
            in_str = !in_str;
        }
        if !in_str && c == '$' && next == Some('$') {
            in_dollar = !in_dollar;
            cur.push_str("$$");
            i += 2;
            continue;
        }
        if c == ';' && !in_str && !in_dollar {
            if !cur.trim().is_empty() {
                out.push((start_line, cur.trim().to_string()));
            }
            cur.clear();
            start_line = line;
        } else {
            if cur.trim().is_empty() {
                start_line = line;
            }
            cur.push(c);
        }
        i += 1;
    }
    if !cur.trim().is_empty() {
        out.push((start_line, cur.trim().to_string()));
    }
    out
}

/// Splits on commas that aren't inside parentheses.
fn split_top(s: &str) -> Vec<String> {
    let (mut depth, mut cur, mut out) = (0i32, String::new(), Vec::new());
    let mut in_str = false;
    for c in s.chars() {
        match c {
            '\'' => in_str = !in_str,
            '(' if !in_str => depth += 1,
            ')' if !in_str => depth -= 1,
            ',' if depth == 0 && !in_str => {
                out.push(cur.trim().to_string());
                cur.clear();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

static RE_CREATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\((.*)\)[^)]*$"#).unwrap());
static RE_REFS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\breferences\s+([\w."`\[\]]+)\s*(?:\(\s*([\w"`\[\]]+)\s*\))?"#).unwrap());
static RE_FK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w."`\[\]]+)\s*(?:\(([^)]*)\))?"#).unwrap());
static RE_PK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)primary\s+key\s*\(([^)]*)\)").unwrap());
static RE_ALTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."`\[\]]+)\s+(.*)$"#).unwrap());
static RE_DROP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)^drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+cascade|\s+restrict)?$"#).unwrap());

const CONSTRAINT_WORDS: &[&str] = &["primary", "not", "null", "unique", "references", "default", "check", "constraint", "generated", "collate", "on", "autoincrement", "auto_increment", "identity"];

fn parse_column_def(def: &str) -> Option<Column> {
    let mut words = def.split_whitespace();
    let name = unquote(words.next()?);
    let rest: Vec<&str> = words.collect();
    let type_end = rest.iter().position(|w| CONSTRAINT_WORDS.contains(&w.to_ascii_lowercase().as_str())).unwrap_or(rest.len());
    let ty = rest[..type_end].join(" ");
    let lower = def.to_ascii_lowercase();
    let mut c = col(&name, if ty.is_empty() { "?" } else { &ty });
    c.pk = lower.contains("primary key");
    c.nullable = !lower.contains("not null") && !c.pk;
    c.unique = lower.split_whitespace().any(|w| w == "unique");
    if let Some(r) = RE_REFS.captures(def) {
        c.fk = Some(ForeignKey { table: table_ident(&r[1]), column: r.get(2).map(|m| unquote(m.as_str())).unwrap_or_else(|| "id".into()) });
    }
    Some(c)
}

fn apply_table_constraint(table: &mut Table, def: &str) -> bool {
    let lower = def.trim_start().to_ascii_lowercase();
    let is_constraint = ["primary key", "foreign key", "unique", "constraint", "check", "exclude", "index", "key ", "fulltext"].iter().any(|k| lower.starts_with(k));
    if !is_constraint {
        return false;
    }
    if let Some(fk) = RE_FK.captures(def) {
        let from = split_list(&fk[1]).into_iter().map(|c| unquote(&c)).collect::<Vec<_>>();
        let to = fk.get(3).map(|m| split_list(m.as_str()).into_iter().map(|c| unquote(&c)).collect::<Vec<_>>()).unwrap_or_else(|| vec!["id".into()]);
        for (i, f) in from.iter().enumerate() {
            if let Some(c) = table.columns.iter_mut().find(|c| &c.name == f) {
                c.fk = Some(ForeignKey { table: table_ident(&fk[2]), column: to.get(i).cloned().unwrap_or_else(|| "id".into()) });
            }
        }
    } else if let Some(pk) = RE_PK.captures(def) {
        for name in split_list(&pk[1]).into_iter().map(|c| unquote(&c)) {
            if let Some(c) = table.columns.iter_mut().find(|c| c.name == name) {
                c.pk = true;
                c.nullable = false;
            }
        }
    }
    true
}

/// Replays SQL files (already in migration order) into the resulting set of tables.
pub fn replay_sql(files: &[(String, String)]) -> Vec<Table> {
    let mut tables: Vec<Table> = Vec::new();
    for (file, src) in files {
        for (line, stmt) in sql_statements(src) {
            if let Some(c) = RE_CREATE.captures(&stmt) {
                let name = table_ident(&c[1]);
                let mut t = Table { name: name.clone(), origin: "sql", source: file.clone(), line, model: None, columns: vec![] };
                for def in split_top(&c[2]) {
                    if !apply_table_constraint(&mut t, &def) {
                        if let Some(col) = parse_column_def(&def) {
                            t.columns.push(col);
                        }
                    }
                }
                tables.retain(|x| x.name != name);
                tables.push(t);
            } else if let Some(c) = RE_ALTER.captures(&stmt) {
                let name = table_ident(&c[1]);
                let Some(t) = tables.iter_mut().find(|t| t.name == name) else { continue };
                for action in split_top(&c[2]) {
                    let lower = action.to_ascii_lowercase();
                    let words: Vec<&str> = action.split_whitespace().collect();
                    let lw: Vec<String> = words.iter().map(|w| w.to_ascii_lowercase()).collect();
                    if lower.starts_with("add constraint") || lower.starts_with("add primary key") || lower.starts_with("add foreign key") || lower.starts_with("add unique") {
                        let def = action.splitn(2, char::is_whitespace).nth(1).unwrap_or("");
                        let def = if lower.starts_with("add constraint") { def.splitn(3, char::is_whitespace).nth(2).unwrap_or("") } else { def };
                        apply_table_constraint(t, def);
                    } else if lw.first().map(|w| w == "add").unwrap_or(false) {
                        let skip = 1 + (lw.get(1).map(|w| w == "column").unwrap_or(false) as usize);
                        let skip = skip + if lw.get(skip).map(|w| w == "if").unwrap_or(false) { 3 } else { 0 };
                        if let Some(c) = parse_column_def(&words[skip.min(words.len())..].join(" ")) {
                            t.columns.retain(|x| x.name != c.name);
                            t.columns.push(c);
                        }
                    } else if lw.first().map(|w| w == "drop").unwrap_or(false) && !lower.starts_with("drop constraint") {
                        let mut idx = 1 + (lw.get(1).map(|w| w == "column").unwrap_or(false) as usize);
                        if lw.get(idx).map(|w| w == "if").unwrap_or(false) {
                            idx += 2;
                        }
                        if let Some(n) = words.get(idx) {
                            let n = unquote(n);
                            t.columns.retain(|x| x.name != n);
                        }
                    } else if lower.starts_with("rename column") || (lower.starts_with("rename ") && lw.get(2).map(|w| w == "to").unwrap_or(false)) {
                        let i = if lower.starts_with("rename column") { 2 } else { 1 };
                        if let (Some(a), Some(b)) = (words.get(i), words.get(i + 2)) {
                            let (a, b) = (unquote(a), unquote(b));
                            if let Some(c) = t.columns.iter_mut().find(|c| c.name == a) {
                                c.name = b;
                            }
                        }
                    } else if lower.starts_with("rename to") {
                        if let Some(n) = words.get(2) {
                            t.name = table_ident(n);
                        }
                    } else if lower.starts_with("alter column") || lower.starts_with("alter ") {
                        if let Some(n) = words.get(if lw.get(1).map(|w| w == "column").unwrap_or(false) { 2 } else { 1 }) {
                            let n = unquote(n);
                            if let Some(c) = t.columns.iter_mut().find(|c| c.name == n) {
                                if lower.contains("set not null") {
                                    c.nullable = false;
                                } else if lower.contains("drop not null") {
                                    c.nullable = true;
                                }
                                if let Some(pos) = lw.iter().position(|w| w == "type") {
                                    if let Some(ty) = words.get(pos + 1) {
                                        c.ty = ty.to_string();
                                    }
                                }
                            }
                        }
                    }
                }
            } else if let Some(c) = RE_DROP.captures(&stmt) {
                for n in c[1].split(',').map(table_ident) {
                    tables.retain(|t| t.name != n);
                }
            }
        }
    }
    tables
}

// ---------- Drizzle (from a parsed TypeScript tree) ----------

/// A Drizzle table as written in code; references point at variables, resolved later.
#[derive(Debug, Clone)]
pub struct DrizzleTable {
    pub var: Option<String>,
    pub name: String,
    pub line: usize,
    /// (ts key, column, `references(() => var.key)`)
    pub columns: Vec<(String, Column, Option<(String, String)>)>,
}

fn text<'a>(n: Node, src: &'a [u8]) -> &'a str {
    n.utf8_text(src).unwrap_or("")
}

fn str_value(n: Node, src: &[u8]) -> Option<String> {
    matches!(n.kind(), "string" | "template_string").then(|| text(n, src)).filter(|t| t.len() >= 2 && !t.contains("${")).map(|t| t[1..t.len() - 1].to_string())
}

fn first_arg(call: Node) -> Option<Node> {
    call.child_by_field_name("arguments").and_then(|a| a.named_child(0))
}

/// Walks a builder chain like `text('x').notNull().references(() => users.id)`.
fn parse_drizzle_column(key: &str, mut expr: Node, src: &[u8]) -> Option<(Column, Option<(String, String)>)> {
    let mut methods: Vec<(String, Node)> = Vec::new();
    loop {
        if expr.kind() != "call_expression" {
            return None;
        }
        let callee = expr.child_by_field_name("function")?;
        match callee.kind() {
            "identifier" => return Some(finish_column(key, text(callee, src), expr, &methods, src)),
            "member_expression" => {
                let prop = callee.child_by_field_name("property").map(|p| text(p, src).to_string()).unwrap_or_default();
                let object = callee.child_by_field_name("object")?;
                if object.kind() == "call_expression" {
                    methods.push((prop, expr));
                    expr = object;
                } else {
                    // `t.text()` in the `(t) => ({ ... })` style is the base call, like `text()`.
                    return Some(finish_column(key, &prop, expr, &methods, src));
                }
            }
            _ => return None,
        }
    }
}

fn finish_column(key: &str, ty: &str, base: Node, methods: &[(String, Node)], src: &[u8]) -> (Column, Option<(String, String)>) {
    let name = first_arg(base).and_then(|a| str_value(a, src));
    let mut c = col(name.as_deref().unwrap_or(key), ty);
    let mut fk = None;
    for (m, call) in methods {
        match m.as_str() {
            "primaryKey" => {
                c.pk = true;
                c.nullable = false;
            }
            "notNull" => c.nullable = false,
            "unique" => c.unique = true,
            "references" => {
                // `() => users.id`
                let body = first_arg(*call).and_then(|f| f.child_by_field_name("body"));
                if let Some(b) = body.filter(|b| b.kind() == "member_expression") {
                    let obj = b.child_by_field_name("object").map(|o| text(o, src).to_string());
                    let prop = b.child_by_field_name("property").map(|p| text(p, src).to_string());
                    if let (Some(o), Some(p)) = (obj, prop) {
                        fk = Some((o, p));
                    }
                }
            }
            _ => {}
        }
    }
    (c, fk)
}

fn object_pairs<'a>(obj: Node<'a>, src: &[u8], locals: &HashMap<String, Node<'a>>, out: &mut Vec<(String, Node<'a>)>) {
    let mut cursor = obj.walk();
    for child in obj.named_children(&mut cursor) {
        match child.kind() {
            "pair" => {
                let (Some(k), Some(v)) = (child.child_by_field_name("key"), child.child_by_field_name("value")) else { continue };
                let key = str_value(k, src).unwrap_or_else(|| text(k, src).to_string());
                out.push((key, v));
            }
            "spread_element" => {
                // `...timestamps` where `const timestamps = { ... }` lives in the same file.
                if let Some(target) = child.named_child(0).and_then(|n| locals.get(text(n, src))) {
                    object_pairs(*target, src, locals, out);
                }
            }
            _ => {}
        }
    }
}

pub fn find_drizzle_tables(root: Node, src: &[u8]) -> Vec<DrizzleTable> {
    if !text(root, src).contains("Table(") {
        return vec![];
    }
    // Top-level `const x = { ... }` objects, for spreads.
    let mut locals: HashMap<String, Node> = HashMap::new();
    let mut stack = vec![root];
    let mut calls = Vec::new();
    while let Some(n) = stack.pop() {
        if n.kind() == "variable_declarator" {
            if let (Some(name), Some(value)) = (n.child_by_field_name("name"), n.child_by_field_name("value")) {
                if value.kind() == "object" {
                    locals.insert(text(name, src).to_string(), value);
                }
            }
        }
        if n.kind() == "call_expression" {
            if let Some(f) = n.child_by_field_name("function").filter(|f| f.kind() == "identifier") {
                if matches!(text(f, src), "pgTable" | "sqliteTable" | "mysqlTable" | "singlestoreTable") {
                    calls.push(n);
                }
            }
        }
        let mut cursor = n.walk();
        stack.extend(n.children(&mut cursor));
    }

    calls.sort_by_key(|c| c.start_byte());
    let mut out = Vec::new();
    for call in calls {
        let Some(args) = call.child_by_field_name("arguments") else { continue };
        let (Some(name), Some(mut cols)) = (args.named_child(0).and_then(|a| str_value(a, src)), args.named_child(1)) else { continue };
        // Newer Drizzle style: `(t) => ({ ... })`.
        if cols.kind() == "arrow_function" {
            match cols.child_by_field_name("body") {
                Some(b) if b.kind() == "parenthesized_expression" => match b.named_child(0) {
                    Some(o) => cols = o,
                    None => continue,
                },
                Some(b) => cols = b,
                None => continue,
            }
        }
        if cols.kind() != "object" {
            continue;
        }
        let mut pairs = Vec::new();
        object_pairs(cols, src, &locals, &mut pairs);
        let mut columns: Vec<_> = pairs.into_iter().filter_map(|(k, v)| parse_drizzle_column(&k, v, src).map(|(c, fk)| (k, c, fk))).collect();

        // Composite keys in the third argument: `primaryKey({ columns: [t.a, t.b] })`.
        if let Some(extra) = args.named_child(2) {
            let extra_text = text(extra, src);
            if let Some(pos) = extra_text.find("primaryKey(") {
                let tail = &extra_text[pos..];
                let end = tail.find(')').unwrap_or(tail.len());
                for (key, c, _) in columns.iter_mut() {
                    if tail[..end].contains(&format!(".{key}")) {
                        c.pk = true;
                        c.nullable = false;
                    }
                }
            }
        }

        let var = {
            let mut p = call.parent();
            while let Some(n) = p {
                if n.kind() == "variable_declarator" {
                    break;
                }
                p = n.parent();
            }
            p.and_then(|d| d.child_by_field_name("name")).map(|n| text(n, src).to_string())
        };
        columns.retain(|(_, c, _)| !c.name.is_empty());
        out.push(DrizzleTable { var, name, line: call.start_position().row + 1, columns });
    }
    out
}

/// camelCase -> snake_case, for Drizzle's `casing: "snake_case"`.
pub fn snake_case(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// Turns Drizzle tables from all files into resolved tables (variables -> table names).
pub fn resolve_drizzle(found: Vec<(String, DrizzleTable)>, snake: bool) -> Vec<Table> {
    let by_var: HashMap<String, &DrizzleTable> = found.iter().filter_map(|(_, t)| t.var.clone().map(|v| (v, t))).collect();
    // Column names as Drizzle derives them: explicit name, else the key (snake_cased if configured).
    let col_name = |key: &str, c: &Column| if c.name == key && snake { snake_case(key) } else { c.name.clone() };
    found
        .iter()
        .map(|(file, t)| Table {
            name: t.name.clone(),
            origin: "drizzle",
            source: file.clone(),
            line: t.line,
            model: t.var.clone(),
            columns: t
                .columns
                .iter()
                .map(|(key, c, fk)| {
                    let mut c = c.clone();
                    c.name = col_name(key, &c);
                    c.fk = fk.as_ref().map(|(var, prop)| match by_var.get(var) {
                        Some(target) => ForeignKey {
                            table: target.name.clone(),
                            column: target.columns.iter().find(|(k, _, _)| k == prop).map(|(k, tc, _)| col_name(k, tc)).unwrap_or_else(|| prop.clone()),
                        },
                        None => ForeignKey { table: var.clone(), column: prop.clone() },
                    });
                    c
                })
                .collect(),
        })
        .collect()
}

// ---------- Where code touches tables ----------

#[derive(Debug, Clone, PartialEq)]
pub enum DbRef {
    /// `prisma.user.findMany()` / `db.query.users.findFirst()`: matched against Prisma models and Drizzle variables.
    Accessor { name: String, write: bool },
    /// `db.select().from(users)`, `db.insert(users)`: a Drizzle table variable.
    Ident { name: String, write: bool },
    /// A table name inside a raw SQL string.
    Sql { table: String, write: bool },
}

const PRISMA_READ: &[&str] = &["findMany", "findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"];
const PRISMA_WRITE: &[&str] = &["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"];
const BUILDER_READ: &[&str] = &["from", "innerJoin", "leftJoin", "rightJoin", "fullJoin", "crossJoin", "join"];
const BUILDER_WRITE: &[&str] = &["insert", "update", "delete"];

static DB_RECEIVER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?i:prisma\w*|\w*db|\w*DB|tx|trx|database|orm|query|enhanced\w*)$").unwrap());
static SQL_HINT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(select\s.+\sfrom|insert\s+into|update\s+\S+\s+set|delete\s+from)\b").unwrap());
static SQL_READ: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\b(?:from|join)\s+"?([A-Za-z_][\w.]*)"?"#).unwrap());
static SQL_WRITE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\b(?:insert\s+into|update|delete\s+from)\s+"?([A-Za-z_][\w.]*)"?"#).unwrap());

pub fn collect_db_refs(node: Node, src: &[u8], out: &mut Vec<DbRef>) {
    match node.kind() {
        "call_expression" => {
            if let Some(f) = node.child_by_field_name("function").filter(|f| f.kind() == "member_expression") {
                let method = f.child_by_field_name("property").map(|p| text(p, src)).unwrap_or("");
                if PRISMA_READ.contains(&method) || PRISMA_WRITE.contains(&method) {
                    let accessor = f.child_by_field_name("object").filter(|o| o.kind() == "member_expression");
                    // Only on something that looks like a database client: `prisma.user`, `ctx.db.user`,
                    // `tx.user`, `db.query.users` — not `authClient.organization.create()`.
                    let receiver = accessor.and_then(|a| a.child_by_field_name("object")).map(|r| text(r, src)).unwrap_or("");
                    let last = receiver.rsplit('.').next().unwrap_or(receiver);
                    if let (Some(acc), true) = (accessor.and_then(|a| a.child_by_field_name("property")), DB_RECEIVER.is_match(last)) {
                        out.push(DbRef::Accessor { name: text(acc, src).to_string(), write: PRISMA_WRITE.contains(&method) });
                    }
                }
                if BUILDER_READ.contains(&method) || BUILDER_WRITE.contains(&method) {
                    if let Some(arg) = first_arg(node).filter(|a| a.kind() == "identifier") {
                        out.push(DbRef::Ident { name: text(arg, src).to_string(), write: BUILDER_WRITE.contains(&method) });
                    }
                }
            }
        }
        "string" | "template_string" => {
            let t = text(node, src);
            if t.len() > 12 && SQL_HINT.is_match(t) {
                for c in SQL_WRITE.captures_iter(t) {
                    out.push(DbRef::Sql { table: table_ident(&c[1]), write: true });
                }
                for c in SQL_READ.captures_iter(t) {
                    out.push(DbRef::Sql { table: table_ident(&c[1]), write: false });
                }
            }
            return;
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_db_refs(child, src, out);
    }
}

/// Resolves a reference to a table name, given all tables of the repo.
pub fn resolve_ref<'a>(r: &DbRef, tables: &'a [Table]) -> Option<&'a Table> {
    match r {
        DbRef::Accessor { name, .. } => tables.iter().find(|t| {
            t.model.as_deref().map(|m| m == name || lower_first(m) == *name).unwrap_or(false)
        }),
        DbRef::Ident { name, .. } => tables.iter().find(|t| t.origin == "drizzle" && t.model.as_deref() == Some(name)),
        DbRef::Sql { table, .. } => tables.iter().find(|t| t.name.eq_ignore_ascii_case(table)),
    }
}

fn lower_first(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_lowercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    #[test]
    fn prisma_models_relations_and_maps() {
        let src = r#"
model User {
  id        String   @id @default(cuid())
  email     String   @unique // login
  posts     Post[]
  createdAt DateTime @default(now()) @map("created_at")
  @@map("users")
}

enum Role { ADMIN USER }

model Post {
  id       Int     @id @default(autoincrement())
  title    String?
  authorId String  @map("author_id")
  author   User    @relation(fields: [authorId], references: [id], onDelete: Cascade)
  role     Role
  tags     String[]
}

model Membership {
  userId String
  orgId  String
  @@id([userId, orgId])
}
"#;
        let t = parse_prisma(&[("schema.prisma".to_string(), src.to_string())]);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["users", "Post", "Membership"]);
        let users = &t[0];
        assert_eq!(users.model.as_deref(), Some("User"));
        assert_eq!(users.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["id", "email", "created_at"]);
        assert!(users.columns[0].pk && users.columns[1].unique);
        let post = &t[1];
        let author = post.columns.iter().find(|c| c.name == "author_id").unwrap();
        assert_eq!(author.fk, Some(ForeignKey { table: "users".into(), column: "id".into() }));
        assert!(post.columns.iter().any(|c| c.name == "role" && c.ty == "Role"));
        assert!(post.columns.iter().any(|c| c.name == "tags" && c.ty == "String[]"));
        assert!(post.columns.iter().find(|c| c.name == "title").unwrap().nullable);
        assert!(t[2].columns.iter().all(|c| c.pk), "composite @@id");
    }

    #[test]
    fn zenstack_models_across_files() {
        let base = "abstract model TenantScoped {\n  organizationId String\n  organization Organization @relation(fields: [organizationId], references: [id])\n  @@allow('all', auth() != null)\n}\n";
        let members = "import 'base'\nmodel ClubMember extends TenantScoped {\n  id String @id\n  name String\n}\n";
        let auth = "model Organization {\n  id String @id\n  members ClubMember[]\n}\n";
        let t = parse_prisma(&[("base.zmodel".into(), base.into()), ("members.zmodel".into(), members.into()), ("auth.zmodel".into(), auth.into())]);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["ClubMember", "Organization"], "abstract models aren't tables");
        let cm = &t[0];
        assert_eq!(cm.source, "members.zmodel");
        assert_eq!(cm.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["organizationId", "id", "name"]);
        assert_eq!(cm.columns[0].fk, Some(ForeignKey { table: "Organization".into(), column: "id".into() }));
    }

    #[test]
    fn sql_migrations_replay() {
        let files = vec![
            (
                "001_init.sql".to_string(),
                r#"-- schema
create table if not exists accounts (
  id serial primary key,
  name text not null unique, -- display name
  created_at timestamptz not null default now()
);
CREATE TABLE "public"."folder_cursors" (
  account_id integer not null references accounts(id) on delete cascade,
  folder text not null,
  primary key (account_id, folder)
);
create table tmp (x int);
create or replace function f() returns trigger as $$ begin update accounts set name = 'x'; end; $$ language plpgsql;
"#
                .to_string(),
            ),
            (
                "002_more.sql".to_string(),
                "alter table accounts add column if not exists host text;\nalter table accounts drop column created_at;\nalter table folder_cursors add constraint fk_x foreign key (folder) references accounts (name);\nALTER TABLE accounts RENAME COLUMN host TO hostname;\ndrop table if exists tmp;\n".to_string(),
            ),
        ];
        let t = replay_sql(&files);
        assert_eq!(t.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["accounts", "folder_cursors"]);
        let acc = &t[0];
        assert_eq!(acc.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["id", "name", "hostname"]);
        assert!(acc.columns[0].pk && acc.columns[1].unique && !acc.columns[1].nullable);
        let fc = &t[1];
        assert_eq!(fc.columns[0].fk, Some(ForeignKey { table: "accounts".into(), column: "id".into() }));
        assert!(fc.columns.iter().all(|c| c.pk), "table-level primary key");
        assert_eq!(fc.columns[1].fk.as_ref().unwrap().column, "name", "fk added by alter table");
    }

    fn ts(src: &str) -> (tree_sitter::Tree, Vec<u8>) {
        let mut p = Parser::new();
        p.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()).unwrap();
        (p.parse(src, None).unwrap(), src.as_bytes().to_vec())
    }

    #[test]
    fn drizzle_tables() {
        let (tree, src) = ts(r#"
import { users } from "./auth-schema";
const timestamps = { createdAt: text('created_at').notNull() };
export const addresses = pgTable("addresses", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
}, (t) => [index("x").on(t.userId)]);
export const users = pgTable("users", { id: text("id").primaryKey(), fullName: text() });
export const members = sqliteTable("members", (t) => ({ a: t.text(), b: integer('b') }), (t) => [primaryKey({ columns: [t.a, t.b] })]);
"#);
        let found: Vec<_> = find_drizzle_tables(tree.root_node(), &src).into_iter().map(|t| ("schema.ts".to_string(), t)).collect();
        let tables = resolve_drizzle(found, true);
        let a = &tables[0];
        assert_eq!(a.name, "addresses");
        assert_eq!(a.model.as_deref(), Some("addresses"));
        assert_eq!(a.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["id", "user_id", "created_at"]);
        assert_eq!(a.columns[1].fk, Some(ForeignKey { table: "users".into(), column: "id".into() }));
        assert!(a.columns[0].pk && !a.columns[1].nullable);
        assert_eq!(tables[1].columns[1].name, "full_name");
        assert_eq!(tables[2].columns.iter().map(|c| (c.name.as_str(), c.ty.as_str(), c.pk)).collect::<Vec<_>>(), vec![("a", "text", true), ("b", "integer", true)]);
    }

    #[test]
    fn finds_table_usage_in_code() {
        let (tree, src) = ts(r#"
await prisma.user.findMany();
await db.post.create({ data });
await ctx.db.comment.findFirst();
await authClient.organization.create({ name });
await db.select().from(addresses).leftJoin(users, eq(a, b));
await db.insert(contracts).values(x);
await sql`SELECT id FROM senders s JOIN accounts a ON a.id = s.account_id`;
await pool.query("update folder_cursors set folder = $1 where x");
const label = "Pick one from the list";
"#);
        let mut refs = vec![];
        collect_db_refs(tree.root_node(), &src, &mut refs);
        assert!(refs.contains(&DbRef::Accessor { name: "user".into(), write: false }));
        assert!(refs.contains(&DbRef::Accessor { name: "post".into(), write: true }));
        assert!(refs.contains(&DbRef::Accessor { name: "comment".into(), write: false }));
        assert!(!refs.iter().any(|r| matches!(r, DbRef::Accessor { name, .. } if name == "organization")), "auth client isn't the database");
        assert!(refs.contains(&DbRef::Ident { name: "addresses".into(), write: false }));
        assert!(refs.contains(&DbRef::Ident { name: "users".into(), write: false }));
        assert!(refs.contains(&DbRef::Ident { name: "contracts".into(), write: true }));
        assert!(refs.contains(&DbRef::Sql { table: "senders".into(), write: false }));
        assert!(refs.contains(&DbRef::Sql { table: "accounts".into(), write: false }));
        assert!(refs.contains(&DbRef::Sql { table: "folder_cursors".into(), write: true }));
        assert!(!refs.iter().any(|r| matches!(r, DbRef::Sql { table, .. } if table == "the")), "prose isn't SQL");
    }
}
