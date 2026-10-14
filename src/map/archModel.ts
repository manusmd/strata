import type { Graph, GraphNode, Repo } from "../api";

export type WorkspacePackage = { packageName: string; repoId: string; repoName: string; path: string; projects: string[] };

export type ArchKind = "App" | "Service" | "Worker" | "CLI" | "Extension" | "Library" | "Database" | "Cache" | "Queue" | "Storage" | "Search" | "AI" | "Mail" | "Proxy" | "Infra" | "External" | "Missing";

export type ArchNode = {
  id: string;
  kind: ArchKind;
  name: string;
  /** One line under the name: framework, image, engine… */
  detail: string;
  repoId: string | null;
  /** Column in the left-to-right layout: clients → services → libraries → data & external. */
  layer: 0 | 1 | 2 | 3;
  unit?: { dir: string; packageName: string; files: number; lines: number; ports: number[]; deps: string[]; description?: string; routes?: { pages: number; api: number } };
  infra?: { image: string | null; ports: number[]; file: string; dependsOn: string[] };
  datastore?: { engine: string; tables: string[] };
  external?: { via: string[] };
  missing?: { packageName: string; uses: number; repo?: WorkspacePackage };
  /** Packages folded into this one: nested in its folder, or a crowd of siblings shown as one group. */
  parts?: string[];
};

export type ArchEdgeKind = "imports" | "calls" | "data" | "uses" | "depends";
export type ArchEdge = {
  id: string;
  source: string;
  target: string;
  kind: ArchEdgeKind;
  /** Human-readable reasons, e.g. "14 imports", "localhost:3000", "reads 12 tables". */
  reasons: string[];
  weight: number;
  inferred?: boolean;
  /** Files in the source unit that make up this connection (for jumping to code). */
  files: string[];
  /** Imports of a library: code structure, not architecture. Drawn only when one end is selected. */
  minor?: boolean;
  /** Container view: the shared libraries this connection goes through (web → Stripe via lib). */
  via?: string[];
};

export type ArchModel = { nodes: ArchNode[]; edges: ArchEdge[]; byId: Map<string, ArchNode>; fileUnit: Map<string, string> };

// ---------- Catalogs ----------

type Framework = { kind: ArchKind; label: string };
/** First match wins, so more specific frameworks come first. */
const FRAMEWORKS: [string, Framework][] = [
  ["expo", { kind: "App", label: "Expo" }],
  ["react-native", { kind: "App", label: "React Native" }],
  ["electron", { kind: "App", label: "Electron" }],
  ["@tauri-apps/api", { kind: "App", label: "Tauri" }],
  ["next", { kind: "App", label: "Next.js" }],
  ["@remix-run/react", { kind: "App", label: "Remix" }],
  ["@react-router/dev", { kind: "App", label: "React Router" }],
  ["nuxt", { kind: "App", label: "Nuxt" }],
  ["@sveltejs/kit", { kind: "App", label: "SvelteKit" }],
  ["astro", { kind: "App", label: "Astro" }],
  ["wxt", { kind: "Extension", label: "WXT" }],
  ["plasmo", { kind: "Extension", label: "Plasmo" }],
  ["webextension-polyfill", { kind: "Extension", label: "Web extension" }],
  ["@nestjs/core", { kind: "Service", label: "NestJS" }],
  ["fastify", { kind: "Service", label: "Fastify" }],
  ["express", { kind: "Service", label: "Express" }],
  ["hono", { kind: "Service", label: "Hono" }],
  ["koa", { kind: "Service", label: "Koa" }],
  ["elysia", { kind: "Service", label: "Elysia" }],
  ["@trpc/server", { kind: "Service", label: "tRPC" }],
  ["@modelcontextprotocol/sdk", { kind: "Service", label: "MCP server" }],
  ["bullmq", { kind: "Worker", label: "BullMQ" }],
  ["@temporalio/worker", { kind: "Worker", label: "Temporal" }],
  ["node-cron", { kind: "Worker", label: "Cron" }],
];
const UI_LIBS = ["react", "vue", "svelte", "solid-js", "preact"];
const DEV_FRAMEWORKS = new Set(["electron", "wxt", "plasmo", "@tauri-apps/api"]);
const CLI_LIBS = ["commander", "yargs", "cac", "citty", "clipanion", "oclif"];
const DB_DRIVERS = ["pg", "postgres", "mysql2", "better-sqlite3", "@libsql/client", "@prisma/client", "drizzle-orm", "@zenstackhq/runtime", "kysely", "knex", "typeorm", "sequelize", "mongoose", "mongodb", "sqlite3"];

type Ext = { key: string; name: string; category: string };
const EXTERNAL_PACKAGES: [RegExp, Ext][] = [
  [/^stripe$|^@stripe\//, { key: "stripe", name: "Stripe", category: "Payments" }],
  [/^@aws-sdk\/client-s3$|^@aws-sdk\/s3-|^minio$/, { key: "s3", name: "S3", category: "Object storage" }],
  [/^@aws-sdk\/client-ses$|^@aws-sdk\/client-sesv2$/, { key: "ses", name: "Amazon SES", category: "Email" }],
  [/^@aws-sdk\/client-sqs$/, { key: "sqs", name: "Amazon SQS", category: "Queue" }],
  [/^@aws-sdk\/client-dynamodb$|^@aws-sdk\/lib-dynamodb$/, { key: "dynamodb", name: "DynamoDB", category: "Database" }],
  [/^openai$/, { key: "openai", name: "OpenAI", category: "AI" }],
  [/^@anthropic-ai\/sdk$|^@anthropic-ai\/claude-agent-sdk$/, { key: "anthropic", name: "Anthropic", category: "AI" }],
  [/^@google\/genai$|^@google\/generative-ai$/, { key: "gemini", name: "Google Gemini", category: "AI" }],
  [/^ollama$/, { key: "ollama", name: "Ollama", category: "AI" }],
  [/^@elevenlabs\/|^elevenlabs$/, { key: "elevenlabs", name: "ElevenLabs", category: "Voice AI" }],
  [/^resend$/, { key: "resend", name: "Resend", category: "Email" }],
  [/^@sendgrid\//, { key: "sendgrid", name: "SendGrid", category: "Email" }],
  [/^postmark$/, { key: "postmark", name: "Postmark", category: "Email" }],
  [/^nodemailer$/, { key: "smtp", name: "SMTP", category: "Email" }],
  [/^imapflow$|^imap$|^node-imap$/, { key: "imap", name: "IMAP", category: "Email" }],
  [/^twilio$/, { key: "twilio", name: "Twilio", category: "SMS" }],
  [/^@sentry\//, { key: "sentry", name: "Sentry", category: "Monitoring" }],
  [/^posthog-js$|^posthog-node$/, { key: "posthog", name: "PostHog", category: "Analytics" }],
  [/^countly-sdk-web$|^countly-sdk-nodejs$/, { key: "countly", name: "Countly", category: "Analytics" }],
  [/^@supabase\/supabase-js$/, { key: "supabase", name: "Supabase", category: "Backend" }],
  [/^firebase$|^firebase-admin$/, { key: "firebase", name: "Firebase", category: "Backend" }],
  [/^@clerk\//, { key: "clerk", name: "Clerk", category: "Auth" }],
  [/^@auth0\//, { key: "auth0", name: "Auth0", category: "Auth" }],
  [/^googleapis$|^@googleapis\//, { key: "google", name: "Google APIs", category: "API" }],
  [/^@octokit\//, { key: "github", name: "GitHub API", category: "API" }],
  [/^@slack\//, { key: "slack", name: "Slack", category: "Messaging" }],
  [/^@microsoft\/microsoft-graph-client$|^@azure\/msal-/, { key: "microsoft", name: "Microsoft 365", category: "API" }],
  [/^@zoom\//, { key: "zoom", name: "Zoom", category: "Video" }],
  [/^discord\.js$/, { key: "discord", name: "Discord", category: "Messaging" }],
  [/^algoliasearch$/, { key: "algolia", name: "Algolia", category: "Search" }],
  [/^@upstash\/redis$/, { key: "upstash", name: "Upstash Redis", category: "Cache" }],
  [/^@vercel\/blob$/, { key: "vercel-blob", name: "Vercel Blob", category: "Object storage" }],
  [/^mapbox-gl$|^@mapbox\//, { key: "mapbox", name: "Mapbox", category: "Maps" }],
  [/^pusher$|^pusher-js$/, { key: "pusher", name: "Pusher", category: "Realtime" }],
];
const EXTERNAL_HOSTS: [RegExp, string][] = [
  [/stripe\.com$/, "stripe"],
  [/openai\.com$/, "openai"],
  [/anthropic\.com$/, "anthropic"],
  [/elevenlabs\.io$/, "elevenlabs"],
  [/googleapis\.com$/, "google"],
  [/github\.com$/, "github"],
  [/slack\.com$/, "slack"],
  [/(^|\.)microsoft(online)?\.com$|(^|\.)office\.com$|(^|\.)live\.com$/, "microsoft"],
  [/(^|\.)zoom\.us$/, "zoom"],
];

const IMAGE_KINDS: [RegExp, ArchKind, string][] = [
  [/postgres|postgis|timescale/, "Database", "PostgreSQL"],
  [/mysql|mariadb/, "Database", "MySQL"],
  [/mongo/, "Database", "MongoDB"],
  [/cockroach/, "Database", "CockroachDB"],
  [/clickhouse/, "Database", "ClickHouse"],
  [/redis|valkey|keydb|dragonfly/, "Cache", "Redis"],
  [/memcached/, "Cache", "Memcached"],
  [/rabbitmq/, "Queue", "RabbitMQ"],
  [/kafka|redpanda/, "Queue", "Kafka"],
  [/nats/, "Queue", "NATS"],
  [/minio|localstack|seaweedfs/, "Storage", "S3-compatible"],
  [/elasticsearch|opensearch/, "Search", "Elasticsearch"],
  [/meilisearch/, "Search", "Meilisearch"],
  [/typesense/, "Search", "Typesense"],
  [/ollama/, "AI", "Ollama"],
  [/mailhog|mailpit|maildev/, "Mail", "Mail catcher"],
  [/nginx|traefik|caddy|haproxy/, "Proxy", "Reverse proxy"],
];

/** Tools for developers (mail catchers, database UIs): part of the local setup, not of the system. */
export const DEV_TOOL = /mailhog|mailpit|maildev|smtp4dev|adminer|pgadmin|phpmyadmin|redis-?commander|redisinsight|mongo-express|kafdrop|kafka-ui|portainer|dozzle|prisma.*studio|^studio$|drizzle-studio/i;

/** What a compose service is, by its image: "PostgreSQL", "Redis", "Mail catcher"… */
export const imageLabel = (image: string) => IMAGE_KINDS.find(([re]) => re.test(image))?.[2] ?? null;

const ENGINE_LABEL: Record<string, string> = { postgres: "PostgreSQL", sqlite: "SQLite", mysql: "MySQL", mongodb: "MongoDB", sqlserver: "SQL Server", cockroachdb: "CockroachDB" };

const LAYER: Record<ArchKind, ArchNode["layer"]> = {
  App: 0, Extension: 0, Service: 1, Worker: 1, CLI: 1, Library: 2,
  Database: 3, Cache: 3, Queue: 3, Storage: 3, Search: 3, AI: 3, Mail: 3, Proxy: 1, Infra: 3, External: 3, Missing: 3,
};

export const shortName = (n: string) => n.replace(/^@[^/]+\//, "");

const EXAMPLE_DIR = /(^|\/)(examples?|example-[\w-]+|demos?|samples?|templates?|playgrounds?|fixtures?|sandbox)(\/|$)/i;

function classify(meta: Record<string, any>, dir: string, name: string): { kind: ArchKind; label: string } | null {
  const deps: string[] = meta.deps ?? [];
  const all = [...deps, ...(meta.devDeps ?? [])];
  const scripts: Record<string, string> = meta.scripts ?? {};
  const lower = `${dir}/${name}`.toLowerCase();
  // End-to-end test packages connect to everything; they're not part of the running system.
  if (/(^|\/)(e2e|tests?|testing|test-utils|playwright|cypress)(\/|$)|[-/]e2e$/.test(lower) && !deps.some((d) => FRAMEWORKS.some(([f]) => f === d))) return null;
  // Examples, templates and playgrounds show how to use the system; they aren't part of it.
  if (EXAMPLE_DIR.test(dir)) return null;
  // A shared package (packages/, libs/) that nothing starts is code other parts run, even with a server framework in it.
  const shared = /^(packages|libs?|modules)\//.test(dir);
  const starts = Object.keys(scripts).some((s) => /^(dev|start|serve)(:|$)/.test(s)) || (meta.ports ?? []).length > 0;
  for (const [dep, fw] of FRAMEWORKS) {
    // Frameworks count when they're runtime deps; desktop/extension tooling usually sits in devDependencies.
    if (!(deps.includes(dep) || (DEV_FRAMEWORKS.has(dep) && all.includes(dep)))) continue;
    if (fw.label === "tRPC" && deps.some((d) => UI_LIBS.includes(d))) continue;
    if (shared && !starts && (fw.kind === "Service" || fw.kind === "Worker")) return { kind: "Library", label: `${fw.label} library` };
    const mcp = fw.kind === "Service" && fw.label !== "MCP server" && deps.includes("@modelcontextprotocol/sdk");
    return { kind: fw.kind, label: mcp ? `${fw.label} + MCP` : fw.label };
  }
  if (all.some((d) => d === "@types/chrome" || d === "@types/webextension-polyfill" || d === "@types/firefox-webext-browser")) return { kind: "Extension", label: "Browser extension" };
  if (all.includes("vite") && deps.some((d) => UI_LIBS.includes(d))) {
    const ui = deps.find((d) => UI_LIBS.includes(d))!;
    return { kind: "App", label: `Vite + ${ui === "solid-js" ? "Solid" : ui[0].toUpperCase() + ui.slice(1)}` };
  }
  // A shared package with a bin (seed scripts, codegen) is still a package; a real CLI says so in its name or deps.
  if ((meta.hasBin && (!shared || /cli$/.test(name))) || deps.some((d) => CLI_LIBS.includes(d))) return { kind: "CLI", label: "Command line" };
  const runnable = /\bnode\b|\btsx\b|\bbun\b|\bdeno\b|ts-node/.test(`${scripts.start ?? ""} ${scripts.dev ?? ""}`);
  if (runnable && !/^(packages|libs?)\//.test(dir)) return { kind: "Service", label: "Node service" };
  return { kind: "Library", label: deps.some((d) => UI_LIBS.includes(d)) ? "UI library" : "Library" };
}

// ---------- Model ----------

export function buildArchModel(graph: Graph, repos: Repo[], workspace: WorkspacePackage[]): ArchModel {
  const nodes = new Map<string, ArchNode>();
  const add = (n: ArchNode) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, n), n));

  // Units, and which unit every file belongs to (deepest folder wins).
  const unitNodes = graph.nodes.filter((n) => n.kind === "unit" && !n.meta?.workspaceRoot);
  const unitsByRepo = new Map<string, GraphNode[]>();
  for (const u of unitNodes) unitsByRepo.set(u.repoId!, [...(unitsByRepo.get(u.repoId!) ?? []), u]);
  const fileUnit = new Map<string, string>();
  for (const f of graph.nodes) {
    if (f.kind !== "file" || !f.repoId || !f.path) continue;
    const owner = (unitsByRepo.get(f.repoId) ?? [])
      .filter((u) => !u.path || f.path === u.path || f.path!.startsWith(`${u.path}/`))
      .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
    if (owner) fileUnit.set(f.id, owner.id);
  }
  const shownUnits = new Set<string>();
  for (const u of unitNodes) {
    const c = classify(u.meta ?? {}, u.path ?? "", u.name);
    if (!c) continue;
    shownUnits.add(u.id);
    add({
      id: u.id,
      kind: c.kind,
      name: shortName(u.name),
      detail: [c.label, (u.meta?.ports ?? []).length ? `:${u.meta.ports.join(", :")}` : null].filter(Boolean).join(" · "),
      repoId: u.repoId,
      layer: LAYER[c.kind],
      unit: { dir: u.path ?? "", packageName: u.name, files: u.meta?.files ?? 0, lines: u.meta?.lines ?? 0, ports: u.meta?.ports ?? [], deps: u.meta?.deps ?? [], description: u.meta?.description ?? undefined },
    });
  }
  for (const [f, u] of fileUnit) if (!shownUnits.has(u)) fileUnit.delete(f);

  // Routes by file convention (Next.js app/ and pages/, Remix routes/): what an app offers, without AI.
  const PAGE = /(^|\/)(app\/.*\/page|pages\/(?!api\/)[^_][^/]*|routes\/[^/]+)\.(t|j)sx?$/;
  const API = /(^|\/)(app\/.*\/route|pages\/api\/.+)\.(t|j)s$/;
  const pathOf = new Map(graph.nodes.filter((x) => x.kind === "file").map((x) => [x.id, x.path ?? ""]));
  for (const [f, u] of fileUnit) {
    const n = nodes.get(u);
    const path = pathOf.get(f) ?? "";
    if (!n?.unit) continue;
    const rel = n.unit.dir ? path.slice(n.unit.dir.length + 1) : path;
    const r = (n.unit.routes ??= { pages: 0, api: 0 });
    if (API.test(rel)) r.api++;
    else if (PAGE.test(rel)) r.pages++;
  }

  // Packages inside another package's folder (an app store's integrations) are part of it.
  const foldInto = new Map<string, string>();
  const withDir = [...nodes.values()].filter((n) => n.unit?.dir);
  for (const n of withDir) {
    if (n.kind !== "Library") continue;
    const parent = withDir.filter((p) => p !== n && p.repoId === n.repoId && n.unit!.dir.startsWith(`${p.unit!.dir}/`)).sort((a, b) => b.unit!.dir.length - a.unit!.dir.length)[0];
    if (parent) foldInto.set(n.id, parent.id);
  }
  // A crowd of sibling libraries without a parent package (packages/platform/*) becomes one group.
  const siblings = new Map<string, ArchNode[]>();
  for (const n of withDir) {
    if (n.kind !== "Library" || foldInto.has(n.id)) continue;
    const dir = n.unit!.dir.split("/").slice(0, -1).join("/");
    if (dir.includes("/")) siblings.set(`${n.repoId}:${dir}`, [...(siblings.get(`${n.repoId}:${dir}`) ?? []), n]);
  }
  for (const [key, members] of siblings) {
    if (members.length < 5) continue;
    const dir = key.slice(key.indexOf(":") + 1);
    const id = `group:${key}`;
    add({
      id,
      kind: "Library",
      name: dir.split("/").pop()!,
      detail: `${members.length} packages`,
      repoId: members[0].repoId,
      layer: LAYER.Library,
      unit: { dir, packageName: dir, files: 0, lines: 0, ports: [], deps: [...new Set(members.flatMap((m) => m.unit!.deps))] },
    });
    for (const m of members) foldInto.set(m.id, id);
  }
  const ownerOf = (id: string): string => (foldInto.has(id) ? ownerOf(foldInto.get(id)!) : id);
  const packageOwner = new Map<string, string>();
  for (const [member] of foldInto) {
    const m = nodes.get(member)!;
    const owner = nodes.get(ownerOf(member))!;
    owner.parts = [...(owner.parts ?? []), m.name];
    owner.unit!.files += m.unit!.files;
    owner.unit!.lines += m.unit!.lines;
    packageOwner.set(m.unit!.packageName, owner.id);
    nodes.delete(member);
  }
  for (const [f, u] of fileUnit) if (foldInto.has(u)) fileUnit.set(f, ownerOf(u));
  for (const n of nodes.values()) if (n.parts && !n.id.startsWith("group:")) n.detail = `${n.detail} · +${n.parts.length} packages`;
  // Two packages both called "ui": tell them apart by folder.
  const named = new Map<string, ArchNode[]>();
  for (const n of nodes.values()) if (n.unit) named.set(n.name, [...(named.get(n.name) ?? []), n]);
  for (const same of named.values()) if (same.length > 1) for (const n of same) n.name = n.unit!.dir.split("/").pop() || n.name;

  // Datastores: one per repo that has tables, named after the engine or its compose service.
  const repoRoot = new Map(graph.nodes.filter((n) => n.kind === "folder" && n.parentId === null).map((n) => [n.repoId!, n]));
  const tablesByRepo = new Map<string, GraphNode[]>();
  for (const t of graph.nodes.filter((n) => n.kind === "table")) tablesByRepo.set(t.repoId!, [...(tablesByRepo.get(t.repoId!) ?? []), t]);
  const infraNodes = graph.nodes.filter((n) => n.kind === "infra");
  const datastoreOf = new Map<string, string>(); // repoId -> node id
  const composeAlias = new Map<string, string>(); // `${repo}:${service}` -> node id

  for (const [repoId, tables] of tablesByRepo) {
    const engines: string[] = repoRoot.get(repoId)?.meta?.engines ?? [];
    const dbService = infraNodes.find((i) => i.repoId === repoId && IMAGE_KINDS.some(([re, k]) => k === "Database" && re.test(i.meta?.image ?? "")));
    const engineFromImage = dbService ? IMAGE_KINDS.find(([re]) => re.test(dbService.meta?.image ?? ""))?.[2] : undefined;
    const engine = engines[0] ? ENGINE_LABEL[engines[0]] ?? engines[0] : engineFromImage ?? "Database";
    const id = `ds:${repoId}`;
    add({
      id,
      kind: "Database",
      name: engine,
      detail: `${tables.length} tables${dbService ? ` · ${dbService.meta?.image}` : ""}`,
      repoId,
      layer: 3,
      datastore: { engine, tables: tables.map((t) => t.id) },
      infra: dbService ? { image: dbService.meta?.image ?? null, ports: dbService.meta?.ports ?? [], file: dbService.path ?? "", dependsOn: [] } : undefined,
    });
    datastoreOf.set(repoId, id);
    if (dbService) composeAlias.set(`${repoId}:${dbService.name}`, id);
  }

  // Compose services: either one of our units (by build context or name), or infrastructure.
  const repoSlug = new Map(repos.map((r) => [r.id, r.name.toLowerCase().replace(/[^a-z0-9]/g, "")]));
  for (const i of infraNodes) {
    const key = `${i.repoId}:${i.name}`;
    if (composeAlias.has(key)) continue;
    // Compose files for tests and examples describe throwaway setups, not the system.
    if (/(^|\/)(tests?|e2e|__tests__|examples?|fixtures?)\//.test(i.path ?? "")) continue;
    const image: string = i.meta?.image ?? "";
    // Every database service of a repo with a schema is that schema's database (dev, test, healthcheck copies).
    const dbKind = IMAGE_KINDS.find(([re]) => re.test(image));
    if (dbKind?.[1] === "Database" && datastoreOf.has(i.repoId!)) {
      composeAlias.set(key, datastoreOf.get(i.repoId!)!);
      continue;
    }
    // Dev tools belong to the local setup (Deployment view), not to the system.
    if (DEV_TOOL.test(image) || DEV_TOOL.test(i.name)) continue;
    // The project's own image (`…/calcom/cal.diy`) is the app itself, deployed.
    const slug = repoSlug.get(i.repoId!) ?? "";
    if (slug.length >= 4 && image.toLowerCase().replace(/[^a-z0-9/]/g, "").includes(slug)) continue;
    const units = unitsByRepo.get(i.repoId!) ?? [];
    const build: string | null = i.meta?.build ?? null;
    const unit = units.find((u) => build !== null && build !== "" && u.path === build) ?? units.find((u) => shortName(u.name) === i.name || (u.path ?? "").split("/").pop() === i.name);
    if (unit && shownUnits.has(unit.id)) {
      composeAlias.set(key, unit.id);
      continue;
    }
    if (build !== null && !i.meta?.image) continue; // a build step (migrations, seeding) of the app itself
    // One-shot helpers that reuse another service's image (`ollama-pull`, `minio-init`) are that service.
    const twin = infraNodes.find((o) => o !== i && o.repoId === i.repoId && o.meta?.image && o.meta.image === i.meta?.image && ((i.meta?.dependsOn ?? []).includes(o.name) || ((o.meta?.ports ?? []).length > 0 && !(i.meta?.ports ?? []).length)));
    if (twin) continue;
    const match = IMAGE_KINDS.find(([re]) => re.test(i.meta?.image ?? ""));
    const kind = match?.[1] ?? "Infra";
    const id = `infra:${i.id}`;
    add({ id, kind, name: i.name, detail: [match?.[2], i.meta?.image].filter(Boolean).join(" · "), repoId: i.repoId, layer: LAYER[kind], infra: { image: i.meta?.image ?? null, ports: i.meta?.ports ?? [], file: i.path ?? "", dependsOn: i.meta?.dependsOn ?? [] } });
    composeAlias.set(key, id);
  }

  // ---- Edges ----
  const edges = new Map<string, ArchEdge>();
  const link = (source: string, target: string, kind: ArchEdgeKind, reason: string, file?: string, inferred = false) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const id = `${source}>${target}:${kind}`;
    const e = edges.get(id) ?? { id, source, target, kind, reasons: [], weight: 0, files: [], inferred };
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    e.weight += 1;
    if (file && !e.files.includes(file)) e.files.push(file);
    if (!inferred) e.inferred = false;
    edges.set(id, e);
  };

  // Shared ports: who listens where (units and compose services).
  const portOwner = new Map<number, string>();
  for (const n of nodes.values()) for (const p of [...(n.unit?.ports ?? []), ...(n.infra?.ports ?? [])]) if (!portOwner.has(p)) portOwner.set(p, n.id);

  const externalNode = (ext: Ext) => add({ id: `ext:${ext.key}`, kind: "External", name: ext.name, detail: ext.category, repoId: null, layer: 3, external: { via: [] } });
  const extByKey = new Map(EXTERNAL_PACKAGES.map(([, e]) => [e.key, e]));

  // Missing: packages that another repo in the workspace provides, or that nothing declares.
  const inProject = new Set(repos.map((r) => r.id));
  const providers = new Map(workspace.filter((w) => !inProject.has(w.repoId)).map((w) => [w.packageName, w]));
  // Undeclared packages only count as missing when they look like ours (`@calcom/…` in a `@calcom` project);
  // an undeclared `express` is a hoisted npm dependency, not a missing part of the system.
  const scopeOf = (pkg: string) => (pkg.startsWith("@") ? pkg.split("/")[0] : null);
  const ownScopes = new Set(unitNodes.map((u) => scopeOf(u.name)).filter(Boolean));
  const undeclared = new Map<string, number>();
  for (const p of graph.packages) if (!p.declared && ownScopes.has(scopeOf(p.name))) undeclared.set(p.name, (undeclared.get(p.name) ?? 0) + p.uses);

  const tableRepo = new Map(graph.nodes.filter((n) => n.kind === "table").map((t) => [t.id, t.repoId!]));

  // Packages that another repo of this project provides: a real cross-repo dependency.
  const unitByPackage = new Map<string, string>(packageOwner);
  for (const n of nodes.values()) if (n.unit) unitByPackage.set(n.unit.packageName, n.id);

  for (const e of graph.edges) {
    const from = fileUnit.get(e.src);
    if (!from) continue;
    if (e.kind === "imports") {
      if (e.dst.startsWith("pkg:")) {
        const pkg = e.dst.slice(4);
        const provider = unitByPackage.get(pkg);
        if (provider && provider !== from) {
          link(from, provider, "imports", pkg, e.src);
          continue;
        }
        const ext = EXTERNAL_PACKAGES.find(([re]) => re.test(pkg))?.[1];
        if (ext) {
          // An S3 SDK pointed at a local MinIO is that MinIO.
          const local = ext.key === "s3" ? [...nodes.values()].find((n) => n.kind === "Storage" && n.repoId === nodes.get(from)?.repoId) : undefined;
          const target = local ?? externalNode(ext);
          target.external?.via.includes(pkg) || target.external?.via.push(pkg);
          link(from, target.id, "uses", pkg, e.src);
        } else if (providers.has(pkg) || undeclared.has(pkg)) {
          const id = `missing:${pkg}`;
          add({ id, kind: "Missing", name: pkg, detail: providers.has(pkg) ? `In ${providers.get(pkg)!.repoName} · not in this project` : "Not declared · not connected", repoId: null, layer: 3, missing: { packageName: pkg, uses: 0, repo: providers.get(pkg) } });
          nodes.get(id)!.missing!.uses += 1;
          link(from, id, "imports", pkg, e.src);
        }
        continue;
      }
      const to = fileUnit.get(e.dst);
      if (to && to !== from) link(from, to, "imports", "imports", e.src);
    } else if (e.kind === "reads" || e.kind === "writes") {
      const ds = datastoreOf.get(tableRepo.get(e.dst) ?? "");
      if (ds) link(from, ds, "data", e.kind, e.src);
    } else if (e.kind === "calls") {
      if (e.dst.startsWith("port:")) {
        const owner = portOwner.get(Number(e.dst.slice(5)));
        // A backend mentioning a frontend's port is CORS or redirect config, not a call.
        const backendToApp = nodes.get(owner ?? "")?.kind === "App" && ["Service", "Worker", "CLI"].includes(nodes.get(from)?.kind ?? "");
        if (owner && owner !== from && !backendToApp) link(from, owner, nodes.get(owner)?.unit ? "calls" : "uses", `localhost:${e.dst.slice(5)}`, e.src);
      } else if (e.dst.startsWith("host:")) {
        const host = e.dst.slice(5);
        const key = EXTERNAL_HOSTS.find(([re]) => re.test(host))?.[1];
        const target = key ? externalNode(extByKey.get(key)!) : add({ id: `host:${host}`, kind: "External", name: host, detail: "HTTP API", repoId: null, layer: 3, external: { via: [] } });
        target.external?.via.includes(host) || target.external?.via.push(host);
        link(from, target.id, "calls", host, e.src);
      }
    }
  }

  // Import edges: say how many files are involved.
  for (const e of edges.values()) {
    if (e.kind === "imports" && !e.target.startsWith("missing:")) e.reasons = [`${e.files.length} ${e.files.length === 1 ? "file imports" : "files import"} it`];
    if (e.kind === "data") {
      const reads = graph.edges.filter((x) => x.kind === "reads" && fileUnit.get(x.src) === e.source && datastoreOf.get(tableRepo.get(x.dst) ?? "") === e.target);
      const writes = graph.edges.filter((x) => x.kind === "writes" && fileUnit.get(x.src) === e.source && datastoreOf.get(tableRepo.get(x.dst) ?? "") === e.target);
      const t = (xs: typeof reads) => new Set(xs.map((x) => x.dst)).size;
      e.reasons = [reads.length ? `reads ${t(reads)} tables` : null, writes.length ? `writes ${t(writes)} tables` : null].filter(Boolean) as string[];
    }
  }

  // Database drivers: a package that owns the client talks to the database even without table access.
  for (const n of nodes.values()) {
    if (!n.unit) continue;
    // The schema's datastore, or a database from docker-compose when no schema was found.
    const ds = datastoreOf.get(n.repoId ?? "") ?? [...nodes.values()].find((x) => x.kind === "Database" && x.repoId === n.repoId)?.id;
    const driver = n.unit.deps.find((d) => DB_DRIVERS.includes(d));
    if (ds && driver && ![...edges.values()].some((e) => e.source === n.id && e.target === ds)) link(n.id, ds, "data", `${driver} client`);
    // Queues & caches from client libraries, pointed at the compose service when there is one.
    if (n.unit.deps.some((d) => ["ioredis", "redis", "bullmq", "@redis/client"].includes(d))) {
      const cache = [...nodes.values()].find((x) => x.kind === "Cache" && x.repoId === n.repoId);
      if (cache) link(n.id, cache.id, "uses", n.unit.deps.find((d) => ["bullmq", "ioredis", "redis", "@redis/client"].includes(d))!);
    }
  }

  // Compose depends_on.
  for (const i of infraNodes) {
    const from = composeAlias.get(`${i.repoId}:${i.name}`);
    for (const dep of i.meta?.dependsOn ?? []) {
      const to = composeAlias.get(`${i.repoId}:${dep}`);
      if (from && to && ![...edges.values()].some((e) => e.source === from && e.target === to)) link(from, to, "depends", `depends_on: ${dep}`);
    }
  }

  // Compose environment naming another service: `OLLAMA_HOST: http://ollama:11434`.
  for (const i of infraNodes) {
    const from = composeAlias.get(`${i.repoId}:${i.name}`);
    for (const [host, key] of (i.meta?.links ?? []) as [string, string][]) {
      const to = composeAlias.get(`${i.repoId}:${host}`);
      if (from && to) link(from, to, nodes.get(to)?.unit ? "calls" : "uses", `via ${key}`);
    }
  }
  // Code reading an env var named after a compose service (`OLLAMA_URL`, `REDIS_HOST`).
  const serviceEnv = new Map<string, string>(); // `${repo}:PREFIX` -> node id
  for (const i of infraNodes) {
    const id = composeAlias.get(`${i.repoId}:${i.name}`);
    if (id && !nodes.get(id)?.unit) serviceEnv.set(`${i.repoId}:${i.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, id);
  }
  for (const e of graph.edges) {
    if (e.kind !== "env") continue;
    const from = fileUnit.get(e.src);
    const repo = from ? nodes.get(from)?.repoId : undefined;
    const name = e.dst.slice(4);
    const prefix = name.split("_")[0];
    const to = serviceEnv.get(`${repo}:${prefix}`) ?? serviceEnv.get(`${repo}:${name.replace(/_(URL|HOST|ADDR|ADDRESS|ENDPOINT|BASE_URL|PORT)$/, "")}`);
    if (from && to && /_(URL|HOST|ADDR|ADDRESS|ENDPOINT|PORT)$/.test(name)) link(from, to, "uses", `via ${name}`, e.src);
  }

  // An app with an *_API_URL variable and exactly one backend in its repo most likely calls it.
  const apiEnv = /(^|_)(API|BACKEND|SERVER)_?(URL|BASE|BASE_URL|ORIGIN)$/;
  for (const e of graph.edges) {
    if (e.kind !== "env" || !apiEnv.test(e.dst.slice(4))) continue;
    const from = fileUnit.get(e.src);
    const app = from ? nodes.get(from) : undefined;
    if (!app || app.kind !== "App") continue;
    const services = [...nodes.values()].filter((n) => n.kind === "Service" && n.repoId === app.repoId);
    if (services.length === 1 && ![...edges.values()].some((x) => x.source === app.id && x.target === services[0].id && x.kind === "calls"))
      link(app.id, services[0].id, "calls", `via ${e.dst.slice(4)}`, e.src, true);
  }

  // Imports of shared libraries are code structure; the map draws them only on selection, so what's
  // left is how the system runs: calls, data, queues and external services.
  for (const e of edges.values()) if (e.kind === "imports" && nodes.get(e.target)?.kind === "Library") e.minor = true;

  // Many web APIs reached only from one place (an app store's integrations) become one box.
  const hostUsers = new Map<string, Set<string>>();
  for (const e of edges.values()) if (e.target.startsWith("host:")) hostUsers.set(e.target, (hostUsers.get(e.target) ?? new Set()).add(e.source));
  const exclusive = new Map<string, string[]>();
  for (const [host, users] of hostUsers) if (users.size === 1) exclusive.set([...users][0], [...(exclusive.get([...users][0]) ?? []), host]);
  for (const [source, hosts] of exclusive) {
    if (hosts.length < 4) continue;
    const names = hosts.map((h) => nodes.get(h)!.name);
    const id = `apis:${source}`;
    add({ id, kind: "External", name: `${hosts.length} web APIs`, detail: names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : ""), repoId: null, layer: 3, external: { via: names } });
    for (const h of hosts) {
      const old = edges.get(`${source}>${h}:calls`);
      link(source, id, "calls", nodes.get(h)!.name, old?.files[0]);
      for (const f of old?.files.slice(1) ?? []) link(source, id, "calls", nodes.get(h)!.name, f);
      edges.delete(`${source}>${h}:calls`);
      nodes.delete(h);
    }
  }

  // Drop tiny libraries that nothing uses and that use nothing.
  const touched = new Set([...edges.values()].flatMap((e) => [e.source, e.target]));
  for (const n of [...nodes.values()]) if (n.kind === "Library" && !touched.has(n.id) && (n.unit?.files ?? 0) < 3) nodes.delete(n.id);

  return { nodes: [...nodes.values()], edges: [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target)), byId: nodes, fileUnit };
}

/**
 * The C4 "container" view: only what runs or stores data (apps, services, workers, datastores,
 * external systems). Shared libraries are code inside those containers, so they're hidden and what
 * they do is credited to the containers that use them: web imports lib, lib calls Stripe → web uses Stripe.
 */
export function containerView(m: ArchModel): ArchModel {
  const hidden = (id: string) => m.byId.get(id)?.kind === "Library";
  const nodes = m.nodes.filter((n) => !hidden(n.id));
  const imports = new Map<string, string[]>();
  for (const e of m.edges) if (e.kind === "imports" && hidden(e.target)) imports.set(e.source, [...(imports.get(e.source) ?? []), e.target]);
  const edges = new Map(m.edges.filter((e) => !hidden(e.source) && !hidden(e.target)).map((e) => [e.id, { ...e }]));
  for (const c of nodes) {
    // Every library this container reaches, directly or through other libraries.
    const seen = new Set<string>();
    const queue = [...(imports.get(c.id) ?? [])];
    while (queue.length) {
      const lib = queue.shift()!;
      if (seen.has(lib)) continue;
      seen.add(lib);
      queue.push(...(imports.get(lib) ?? []));
    }
    for (const lib of seen) {
      const name = m.byId.get(lib)!.name;
      for (const e of m.edges) {
        if (e.source !== lib || e.kind === "imports" || hidden(e.target) || e.target === c.id) continue;
        const id = `${c.id}>${e.target}:${e.kind}`;
        const have = edges.get(id);
        if (have) {
          if (have.via && !have.via.includes(name)) have.via.push(name);
          continue;
        }
        edges.set(id, { ...e, id, source: c.id, files: [...e.files], reasons: [...e.reasons], via: [name] });
      }
    }
  }
  // Plain web hosts (api.close.com, a "12 web APIs" group) become one box; named services stay.
  let shown = nodes;
  const hosts = nodes.filter((n) => n.kind === "External" && (n.id.startsWith("host:") || n.id.startsWith("apis:")));
  if (hosts.length > 1) {
    const names = hosts.flatMap((h) => h.external?.via.length ? h.external.via : [h.name]);
    const apis: ArchNode = { id: "apis:web", kind: "External", name: `${names.length} web APIs`, detail: names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : ""), repoId: null, layer: 3, external: { via: names } };
    const ids = new Set(hosts.map((h) => h.id));
    shown = [...nodes.filter((n) => !ids.has(n.id)), apis];
    for (const e of edges.values()) if (ids.has(e.target)) e.target = apis.id;
  }
  // One line per pair: the strongest kind wins (calls > data > uses > depends > imports), evidence merged.
  const rank: Record<ArchEdgeKind, number> = { calls: 0, data: 1, uses: 2, depends: 3, imports: 4 };
  const pairs = new Map<string, ArchEdge>();
  for (const e of edges.values()) {
    const key = `${e.source}>${e.target}`;
    const have = pairs.get(key);
    if (!have) {
      pairs.set(key, { ...e, id: `${key}:${e.kind}` });
      continue;
    }
    const [strong, weak] = rank[e.kind] < rank[have.kind] ? [e, have] : [have, e];
    pairs.set(key, {
      ...strong,
      id: `${key}:${strong.kind}`,
      reasons: [...new Set([...strong.reasons, ...weak.reasons])],
      files: [...new Set([...strong.files, ...weak.files])],
      weight: strong.weight + weak.weight,
      // Direct beats "via a library": only keep `via` when every part went through one.
      via: strong.via && weak.via ? [...new Set([...strong.via, ...weak.via])] : undefined,
      minor: strong.minor && weak.minor,
    });
  }
  return { nodes: shown, edges: [...pairs.values()], byId: new Map(shown.map((n) => [n.id, n])), fileUnit: m.fileUnit };
}

/** A few words for a line, always visible: how the two talk (protocol, data, SDK). */
export function edgeLabel(e: ArchEdge, model: ArchModel): string {
  const target = model.byId.get(e.target);
  const r = e.reasons;
  let base: string;
  if (e.kind === "data") {
    const n = r.map((x) => Number(x.match(/(\d+) tables/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
    base = `${target?.datastore?.engine === "MongoDB" ? "queries" : "SQL"}${n ? ` · ${n} tables` : ""}`;
  } else if (e.kind === "calls") {
    const port = r.map((x) => x.match(/localhost:(\d+)/)?.[1]).find(Boolean);
    base = port ? `HTTP :${port}` : target?.kind === "External" ? "HTTPS" : r.some((x) => /trpc/i.test(x)) ? "tRPC" : "HTTP";
  } else if (e.kind === "uses") {
    base = target?.kind === "Cache" || target?.kind === "Queue" ? (target.name.toLowerCase().includes("redis") || r.some((x) => /redis|bull/.test(x)) ? "Redis" : "queue") : target?.kind === "Mail" ? "SMTP" : target?.kind === "External" || target?.kind === "AI" ? "SDK" : "uses";
  } else if (e.kind === "depends") base = "depends on";
  else base = "imports";
  return e.via?.length ? `${base} · via ${e.via[0]}${e.via.length > 1 ? ` +${e.via.length - 1}` : ""}` : base;
}

export const KIND_COLOR: Record<ArchKind, string> = {
  App: "#8B5CF6", Extension: "#8B5CF6", Service: "#6366F1", Worker: "#6366F1", CLI: "#6366F1", Library: "#9B9A97",
  Database: "#14B8A6", Cache: "#14B8A6", Queue: "#14B8A6", Storage: "#14B8A6", Search: "#14B8A6", AI: "#E879A0", Mail: "#9B9A97", Proxy: "#9B9A97", Infra: "#9B9A97",
  External: "#9B9A97", Missing: "#F59E0B",
};
