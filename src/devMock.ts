// Dev-only: lets the UI run in a plain browser (`pnpm dev`) with fake backend data,
// so screens can be iterated on without launching the native app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Graph, GraphEdge, GraphNode, Project, Repo } from "./api";

const now = Math.floor(Date.now() / 1000);
const repo = (id: string, name: string, path: string, remote: string | null = null, scanned = false): Repo => ({
  id,
  name,
  path,
  remote,
  lastScanAt: scanned ? now - 120 : null,
  scanStatus: scanned ? "ok" : "never",
  scanError: null,
  stats: scanned ? { files: 14, symbols: 41, imports: 22, unresolved: 1, packages: 6, parse_errors: 0 } : null,
  alsoIn: [],
});

const chats: { id: string; projectId: string; title: string; sessionId: string | null; createdAt: number; updatedAt: number }[] = [];
const chatMessages: Record<string, { role: string; content: unknown; createdAt: number }[]> = {};

const summaries: Record<string, { projectId: string; nodeId: string; hash: string; text: string; model: string; createdAt: number }> = {};

let projects: Project[] = [
  {
    id: "p1",
    name: "Acme Cloud",
    color: "#8B5CF6",
    createdAt: now,
    aiMode: "click",
    aiModel: "haiku",
    logo: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0EA5E9"/><path d="M18 40l14-18 14 18z" fill="#fff"/></svg>') + "",
    repos: [repo("r1", "web-app", "/Users/dev/acme/web-app", null, true), repo("r2", "api", "/Users/dev/acme/api", "git@github.com:acme/api.git", true)],
  },
  { id: "p2", name: "Internal Tools", color: "#14B8A6", createdAt: now, aiMode: "off", aiModel: "haiku", repos: [repo("r2", "api", "/Users/dev/acme/api", "git@github.com:acme/api.git", true), repo("r3", "auth-service", "/Users/dev/acme/auth-service")] },
  { id: "p3", name: "Billing v2", color: "#9B9A97", createdAt: now, aiMode: "off", aiModel: "haiku", repos: [] },
];

/** A small but realistic graph: an API with routes/services/db/queue and a Next.js web app. */
function mockGraph(): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const files: Record<string, [string, number, [string, string, boolean][]]> = {
    "r2:src/routes/checkout.ts": ["checkout.ts", 86, [["checkoutRoute", "function", true]]],
    "r2:src/routes/orders.ts": ["orders.ts", 142, [["listOrders", "function", true], ["getOrder", "function", true]]],
    "r2:src/routes/users.ts": ["users.ts", 98, [["usersRoute", "function", true]]],
    "r2:src/routes/webhooks.ts": ["webhooks.ts", 64, [["stripeWebhook", "function", true]]],
    "r2:src/services/checkout.service.ts": ["checkout.service.ts", 214, [["createCheckoutSession", "function", true], ["validateCart", "function", false], ["applyCoupon", "function", false], ["CheckoutError", "class", true]]],
    "r2:src/services/pricing.ts": ["pricing.ts", 96, [["quote", "function", true], ["TAX_RATE", "const", true]]],
    "r2:src/services/payment.client.ts": ["payment.client.ts", 58, [["PaymentClient", "class", true]]],
    "r2:src/services/mailer.ts": ["mailer.ts", 71, [["sendReceipt", "function", true]]],
    "r2:src/db/orders.repo.ts": ["orders.repo.ts", 120, [["ordersRepo", "const", true], ["Order", "type", true]]],
    "r2:src/db/users.repo.ts": ["users.repo.ts", 74, [["usersRepo", "const", true]]],
    "r2:src/db/index.ts": ["index.ts", 22, [["db", "const", true]]],
    "r2:src/queue/jobs.ts": ["jobs.ts", 88, [["enqueueInvoice", "function", true]]],
    "r2:src/queue/redis.ts": ["redis.ts", 22, [["redis", "const", true]]],
    "r2:src/index.ts": ["index.ts", 40, [["start", "function", true]]],
    "r1:app/checkout/page.tsx": ["page.tsx", 120, [["CheckoutPage", "function", true]]],
    "r1:app/layout.tsx": ["layout.tsx", 48, [["RootLayout", "function", true]]],
    "r1:lib/graphql/client.ts": ["client.ts", 36, [["client", "const", true]]],
    "r1:components/Cart.tsx": ["Cart.tsx", 92, [["Cart", "function", true], ["CartProps", "type", true]]],
    "r1:components/Button.tsx": ["Button.tsx", 30, [["Button", "function", true]]],
    "r1:middleware.ts": ["middleware.ts", 28, [["middleware", "function", true]]],
  };
  const dirs = new Set<string>();
  for (const [id, [name, lines, syms]] of Object.entries(files)) {
    const repoId = id.split(":")[0];
    const path = id.slice(repoId.length + 1);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (dir) dirs.add(`${repoId}:${dir}`);
    nodes.push({ id, repoId, kind: "file", name, path, parentId: dir ? `${repoId}:${dir}` : `${repoId}:`, meta: { lines, symbols: syms.length } });
    syms.forEach(([s, k, exp], i) =>
      nodes.push({ id: `${id}#${s}`, repoId, kind: "symbol", name: s, path, parentId: id, meta: { symbolKind: k, exported: exp, line: 3 + i * 18, lines: 12 + i * 3 } }),
    );
  }
  for (const d of dirs) {
    const [repoId, path] = [d.split(":")[0], d.slice(d.indexOf(":") + 1)];
    nodes.push({ id: d, repoId, kind: "folder", name: path.split("/").pop()!, path, parentId: `${repoId}:`, meta: {} });
  }
  const imp = (a: string, b: string) => edges.push({ src: a, dst: b, kind: "imports" });
  const api = (p: string) => `r2:src/${p}`;
  imp(api("routes/checkout.ts"), api("services/checkout.service.ts"));
  imp(api("routes/orders.ts"), api("db/orders.repo.ts"));
  imp(api("routes/users.ts"), api("db/users.repo.ts"));
  imp(api("routes/webhooks.ts"), api("queue/jobs.ts"));
  imp(api("services/checkout.service.ts"), api("services/pricing.ts"));
  imp(api("services/checkout.service.ts"), api("services/payment.client.ts"));
  imp(api("services/checkout.service.ts"), api("db/orders.repo.ts"));
  imp(api("services/mailer.ts"), api("queue/jobs.ts"));
  imp(api("db/orders.repo.ts"), api("db/index.ts"));
  imp(api("db/users.repo.ts"), api("db/index.ts"));
  imp(api("queue/jobs.ts"), api("queue/redis.ts"));
  imp(api("index.ts"), api("routes/checkout.ts"));
  imp(api("index.ts"), api("routes/orders.ts"));
  imp("r1:app/checkout/page.tsx", "r1:components/Cart.tsx");
  imp("r1:app/checkout/page.tsx", "r1:lib/graphql/client.ts");
  imp("r1:components/Cart.tsx", "r1:components/Button.tsx");
  imp("r1:app/layout.tsx", "r1:components/Button.tsx");
  imp(api("routes/orders.ts"), "pkg:@acme/shared-types");
  imp(api("services/checkout.service.ts"), "pkg:@acme/shared-types");
  imp("r1:components/Cart.tsx", "pkg:@acme/shared-types");
  imp(api("services/payment.client.ts"), "pkg:stripe");
  nodes.push(
    { id: "r1:unit:", repoId: "r1", kind: "unit", name: "web-app", path: "", parentId: null, meta: { deps: ["next", "react", "@acme/shared-types"], devDeps: [], scripts: { dev: "next dev -p 3100" }, ports: [3100], files: 6, lines: 354 } },
    { id: "r2:unit:", repoId: "r2", kind: "unit", name: "api", path: "", parentId: null, meta: { deps: ["fastify", "stripe", "pg", "@acme/shared-types"], devDeps: [], scripts: { start: "node dist/index.js" }, ports: [3000], files: 14, lines: 1233 } },
    { id: "r2:infra:db", repoId: "r2", kind: "infra", name: "db", path: "compose.yaml", parentId: null, meta: { image: "postgres:16", ports: [5432], dependsOn: [] } },
  );
  edges.push({ src: "r1:lib/graphql/client.ts", dst: "port:3000", kind: "calls" });

  // A small Prisma schema in api, with reads and writes from its repos.
  type Col = [name: string, type: string, extra?: { pk?: boolean; unique?: boolean; nullable?: boolean; fk?: [string, string] }];
  const tables: Record<string, Col[]> = {
    user: [["id", "String", { pk: true }], ["email", "String", { unique: true }], ["name", "String", { nullable: true }], ["createdAt", "DateTime"]],
    session: [["id", "String", { pk: true }], ["userId", "String", { fk: ["user", "id"] }], ["token", "String", { unique: true }], ["expiresAt", "DateTime"]],
    product: [["id", "String", { pk: true }], ["name", "String"], ["priceCents", "Int"], ["active", "Boolean"]],
    order: [["id", "String", { pk: true }], ["userId", "String", { fk: ["user", "id"] }], ["status", "OrderStatus"], ["totalCents", "Int"], ["couponId", "String", { nullable: true, fk: ["coupon", "id"] }], ["createdAt", "DateTime"]],
    orderItem: [["id", "String", { pk: true }], ["orderId", "String", { fk: ["order", "id"] }], ["productId", "String", { fk: ["product", "id"] }], ["quantity", "Int"]],
    payment: [["id", "String", { pk: true }], ["orderId", "String", { fk: ["order", "id"] }], ["stripeId", "String", { unique: true }], ["amountCents", "Int"], ["status", "String"]],
    invoice: [["id", "String", { pk: true }], ["orderId", "String", { fk: ["order", "id"] }], ["number", "String", { unique: true }], ["pdfUrl", "String", { nullable: true }]],
    coupon: [["id", "String", { pk: true }], ["code", "String", { unique: true }], ["percentOff", "Int"]],
  };
  let line = 10;
  for (const [name, cols] of Object.entries(tables)) {
    nodes.push({
      id: `r2:table:${name}`,
      repoId: "r2",
      kind: "table",
      name,
      path: "prisma/schema.prisma",
      parentId: null,
      meta: { origin: "prisma", model: name[0].toUpperCase() + name.slice(1), line, columns: cols.map(([n, type, x]) => ({ name: n, type, pk: !!x?.pk, unique: !!x?.unique, nullable: !!x?.nullable, ...(x?.fk ? { fk: { table: x.fk[0], column: x.fk[1] } } : {}) })) },
    });
    line += cols.length + 4;
    for (const [, , x] of cols) if (x?.fk) edges.push({ src: `r2:table:${name}`, dst: `r2:table:${x.fk[0]}`, kind: "references" });
  }
  const touch = (file: string, table: string, kind: "reads" | "writes") => edges.push({ src: api(file), dst: `r2:table:${table}`, kind });
  touch("db/orders.repo.ts", "order", "reads");
  touch("db/orders.repo.ts", "order", "writes");
  touch("db/orders.repo.ts", "orderItem", "writes");
  touch("db/users.repo.ts", "user", "reads");
  touch("db/users.repo.ts", "session", "writes");
  touch("services/checkout.service.ts", "product", "reads");
  touch("services/checkout.service.ts", "coupon", "reads");
  touch("routes/webhooks.ts", "payment", "writes");
  touch("queue/jobs.ts", "invoice", "writes");
  return {
    nodes,
    edges,
    packages: [
      { repoId: "r2", name: "@acme/shared-types", uses: 2, declared: false },
      { repoId: "r1", name: "@acme/shared-types", uses: 1, declared: false },
      { repoId: "r2", name: "stripe", uses: 1, declared: true },
    ],
  };
}

function withAlsoIn(): Project[] {
  return projects.map((p) => ({
    ...p,
    repos: p.repos.map((r) => ({ ...r, alsoIn: projects.filter((o) => o.id !== p.id && o.repos.some((x) => x.id === r.id)).map((o) => o.name) })),
  }));
}

/** `?fixture` loads public/fixture.json (a real scan exported from the app database) instead of the sample graph. */
let fixture: (Graph & { repoIds: string[] }) | null = null;

export async function installDevMock() {
  document.documentElement.dataset.web = "1";
  const params = new URLSearchParams(location.search);
  if (params.has("fixture")) {
    // ?fixture=strata loads public/fixture-strata.json and names the project and its repo after it.
    const named = params.get("fixture");
    fixture = await fetch(named ? `/fixture-${named}.json` : "/fixture.json").then((r) => r.json()).catch(() => null);
    if (fixture) {
      const title = named ? named[0].toUpperCase() + named.slice(1) : "Fixture";
      projects = [{ id: "fx", name: title, color: "#8B5CF6", createdAt: now, aiMode: "click", aiModel: "haiku", repos: fixture.repoIds.map((id) => repo(id, named ?? id, `/fixture/${id}`, null, true)) }];
    }
  }
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
    const a = (args ?? {}) as Record<string, any>;
    switch (cmd) {
      case "list_projects":
        return withAlsoIn();
      case "current_user":
        return "dev";
      case "app_version":
        return "0.1.0";
      // ?update shows an available update; the install only simulates the download.
      case "check_update":
        return new URLSearchParams(location.search).has("update")
          ? { version: "0.2.0", currentVersion: "0.1.0", date: "2026-10-07", notes: "## New\n- **Logos** for projects\n- Clickable canvases with routed lines\n\n## Fixed\n- AI sections are about 10× faster" }
          : null;
      case "install_update": {
        let d = 0;
        const t = setInterval(() => {
          d += 1_500_000;
          emit("update-progress", { downloaded: Math.min(d, 9_000_000), total: 9_000_000 });
          if (d >= 9_000_000) clearInterval(t);
        }, 250);
        return new Promise(() => {}); // the real app restarts here
      }
      case "get_graph":
        return fixture ?? mockGraph();
      case "set_project_ai":
        projects = projects.map((p) => (p.id === a.id ? { ...p, aiMode: a.mode, aiModel: a.model } : p));
        return null;
      case "project_summaries":
        return Object.values(summaries).filter((x) => x.projectId === a.projectId);
      case "clear_summaries":
        for (const k of Object.keys(summaries)) if (summaries[k].projectId === a.projectId) delete summaries[k];
        return 0;
      case "summarize":
        return new Promise((resolve) =>
          setTimeout(() => {
            const r = a.request;
            const name = r.nodeId.split(/[:/]/).pop() ?? "";
            const known = Object.keys(MOCK_SUMMARIES).find((k) => k === name || r.prompt.includes(`"${k}"`));
            const text = known ? MOCK_SUMMARIES[known] : `Mock summary of ${name}: ${r.prompt.split("\n")[0].slice(0, 90)}. It is used by the parts listed in its inspector.`;
            summaries[`${r.projectId}|${r.nodeId}`] = { projectId: r.projectId, nodeId: r.nodeId, hash: r.hash, text, model: r.model, createdAt: now };
            resolve(text);
          }, 1200),
        );
      case "list_chats":
        return chats
          .filter((c) => c.projectId === a.projectId)
          .sort((x, y) => y.updatedAt - x.updatedAt)
          .map((c) => {
            const msgs = chatMessages[c.id] ?? [];
            const last = [...msgs].reverse().find((m) => m.role === "assistant") as any;
            return { ...c, messages: msgs.length, preview: last?.content?.text?.split("\n").find((l: string) => l.trim()) ?? null };
          });
      case "create_chat": {
        const id = "c" + Math.random().toString(36).slice(2, 8);
        const t = Date.now() / 1000;
        chats.push({ id, projectId: a.projectId, title: a.title, sessionId: null, createdAt: t, updatedAt: t });
        return id;
      }
      case "chat_messages":
        return chatMessages[a.chatId] ?? [];
      case "append_chat_message": {
        (chatMessages[a.chatId] ??= []).push({ role: a.role, content: a.content, createdAt: Date.now() / 1000 });
        const c = chats.find((x) => x.id === a.chatId);
        if (c) c.updatedAt = Date.now() / 1000;
        return null;
      }
      case "update_chat": {
        const c = chats.find((x) => x.id === a.chatId);
        if (c && a.title) c.title = a.title;
        if (c && a.sessionId) c.sessionId = a.sessionId;
        return null;
      }
      case "delete_chat":
        chats.splice(chats.findIndex((c) => c.id === a.chatId), 1);
        return null;
      case "organize":
        return new Promise((resolve) =>
          setTimeout(() => {
            // Groups the items by a keyword in their description — enough to exercise the UI.
            const items = [...String(a.prompt).matchAll(/^(i\d+): (.*)$/gm)].map((m) => ({ id: m[1], text: m[2].toLowerCase() }));
            const rules: [string, RegExp][] = [["Checkout & payments", /checkout|pay|pricing|stripe|cart|order/], ["Data", /db|repo|database|postgres|schema/], ["Apps & UI", /app|page|layout|component|button|web/], ["Background work", /queue|job|redis|mailer|worker/]];
            const sections = rules.map(([name]) => ({ name, description: `Everything about ${name.toLowerCase()}.`, members: [] as string[] }));
            const other = { name: "Platform", description: "Entry points and everything else.", members: [] as string[] };
            for (const it of items) {
              const i = rules.findIndex(([, re]) => re.test(it.text));
              (i >= 0 ? sections[i] : other).members.push(it.id);
            }
            const plan = JSON.stringify({ sections: [...sections, other].filter((x) => x.members.length) });
            summaries[`${a.projectId}|plan:${a.lens}`] = { projectId: a.projectId, nodeId: `plan:${a.lens}`, hash: a.hash, text: plan, model: a.model, createdAt: now };
            resolve(plan);
          }, 1500),
        );
      case "claude_status":
        return { available: true, path: "/mock/claude", version: "mock" };
      case "ask_start":
        mockAnswer(a.request.askId, a.request.question);
        return null;
      case "ask_cancel":
        return null;
      case "workspace_packages":
        return [{ packageName: "@acme/shared-types", repoId: "r9", repoName: "shared-types", path: "/Users/dev/acme/shared-types", projects: ["Internal Tools"] }];
      case "create_project": {
        const id = "p" + Math.random().toString(36).slice(2, 7);
        projects.push({ id, name: a.name, color: a.color, createdAt: now, aiMode: "off", aiModel: "haiku", repos: [] });
        return id;
      }
      case "update_project":
        projects = projects.map((p) => (p.id === a.id ? { ...p, name: a.name, color: a.color } : p));
        return null;
      case "delete_project":
        projects = projects.filter((p) => p.id !== a.id);
        return null;
      case "add_repo": {
        const existing = projects.flatMap((p) => p.repos).find((r) => r.path === a.path);
        const r = existing ?? repo("r" + Math.random().toString(36).slice(2, 7), a.path.split("/").pop(), a.path);
        projects = projects.map((p) => (p.id === a.projectId && !p.repos.some((x) => x.id === r.id) ? { ...p, repos: [...p.repos, r] } : p));
        return r.id;
      }
      case "remove_repo":
        projects = projects.map((p) => (p.id === a.projectId ? { ...p, repos: p.repos.filter((r) => r.id !== a.repoId) } : p));
        return null;
      default:
        return null; // scans, window theme
    }
    },
    { shouldMockEvents: true },
  );
}

/** Realistic summaries for the items in the screenshots; everything else gets a generic one. */
const MOCK_SUMMARIES: Record<string, string> = {
  api: "Fastify service on port 3000 that owns orders, users and checkout. web-app calls it over GraphQL; it stores data in PostgreSQL through the pg client and creates payments with Stripe.",
  invoice: "Invoice per order, numbered uniquely, with a link to the generated PDF. Written only by the invoice job in api/src/queue/jobs.ts after a payment succeeds; references order through orderId.",
  order: "Central table of the checkout: one row per order with its user, status, total and an optional coupon. orders.repo.ts reads and writes it; order items, payments and invoices all point to it.",
  "CanvasView.tsx": "Renders the diagrams Claude draws in chat answers: lays out groups and routed edges with ELK, sizes cards to their text, and opens the real component's inspector when you click a node that exists today.",
};

const CANVAS_ANSWER = [
  "I'd move payments out of **api** into their own service, so Stripe, invoices and webhooks live in one place:",
  "",
  "```strata-canvas",
  JSON.stringify(
    {
      title: "Proposal: a dedicated payment-service",
      kind: "architecture",
      description: "api keeps orders; a new payment-service owns Stripe, invoices and webhooks.",
      groups: [{ id: "clients", label: "Clients" }, { id: "core", label: "Core services" }, { id: "data", label: "Data & external" }, { id: "ops", label: "Operations" }],
      nodes: [
        { id: "web", label: "web-app", type: "App", status: "existing", ref: "web-app", group: "clients" },
        { id: "api", label: "api (modular monolith)", type: "Service", status: "changed", ref: "api", group: "core", note: "Stateless, horizontally scalable; no in-process jobs; writes outbox events for the worker and no longer calls Stripe directly" },
        { id: "obs", label: "Observability (OpenTelemetry collector)", type: "Infra", status: "new", group: "ops", note: "Traces, metrics, logs, alerts" },
        { id: "pay", label: "payment-service", type: "Service", status: "new", group: "core", note: "Owns checkout sessions, invoices and webhooks" },
        { id: "db", label: "PostgreSQL", type: "Database", status: "existing", ref: "db", group: "data" },
        { id: "stripe", label: "Stripe", type: "External", status: "existing", ref: "Stripe", group: "data" },
        { id: "mail", label: "mailer (in api)", type: "Library", status: "removed", group: "core", note: "Replaced by receipts from payment-service" },
      ],
      edges: [
        { from: "web", to: "api", label: "GraphQL", status: "existing", kind: "calls" },
        { from: "api", to: "pay", label: "createCheckout()", status: "new", kind: "calls" },
        { from: "pay", to: "stripe", label: "Checkout + webhooks", status: "new", kind: "calls" },
        { from: "api", to: "stripe", status: "removed", kind: "calls" },
        { from: "api", to: "db", label: "orders, users", status: "existing", kind: "data" },
        { from: "pay", to: "db", label: "invoices", status: "new", kind: "data" },
        { from: "api", to: "obs", label: "telemetry", status: "new", kind: "uses" },
        { from: "pay", to: "obs", label: "telemetry", status: "new", kind: "uses" },
      ],
    },
    null,
    2,
  ),
  "```",
  "",
  "This keeps [api](strata:node/api) focused on orders and makes payments testable on their own.",
].join("\n");

/** Streams a canned answer the way the Claude CLI does, to exercise the Ask panel. */
function mockAnswer(askId: string, question = "") {
  const ev = (event: unknown) => emit("ask-event", { askId, event });
  const answer = /canvas|architecture|draw|improve/i.test(question) ? CANVAS_ANSWER :
    "Checkout spans two services and two tables:\n\n1. The Pay button in [page.tsx](strata:file/web-app/app/checkout/page.tsx) calls [api](strata:node/api) through `lib/graphql/client.ts`.\n2. [checkout.service.ts](strata:file/api/src/services/checkout.service.ts) validates the cart, prices it with `quote()` and writes a pending order via `src/db/orders.repo.ts`.\n3. Payment goes to **Stripe** through `PaymentClient`.\n\nThe order is stored in the [orders](strata:table/api/orders) table.";
  const steps = ["Reading app/checkout/page.tsx", "Searching for createCheckoutSession", "Reading src/services/checkout.service.ts"];
  let t = 0;
  setTimeout(() => ev({ type: "system", subtype: "init", session_id: "mock-session" }), (t += 100));
  for (const s of steps) setTimeout(() => ev({ type: "system", subtype: "task_summary", detail: s }), (t += 450));
  for (const chunk of answer.match(/.{1,40}/gs) ?? []) setTimeout(() => ev({ type: "stream_event", event: { delta: { type: "text_delta", text: chunk } } }), (t += 25));
  setTimeout(() => ev({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.42 } } } }), (t += 50));
  setTimeout(() => ev({ type: "result", subtype: "success", result: answer, session_id: "mock-session", total_cost_usd: 0.04 }), (t += 50));
  setTimeout(() => emit("ask-done", { askId, ok: true, error: null }), (t += 50));
}
