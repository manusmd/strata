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

let projects: Project[] = [
  {
    id: "p1",
    name: "Acme Cloud",
    color: "#8B5CF6",
    createdAt: now,
    repos: [repo("r1", "web-app", "/Users/dev/acme/web-app", null, true), repo("r2", "api", "/Users/dev/acme/api", "git@github.com:acme/api.git", true)],
  },
  { id: "p2", name: "Internal Tools", color: "#14B8A6", createdAt: now, repos: [repo("r2", "api", "/Users/dev/acme/api", "git@github.com:acme/api.git", true), repo("r3", "auth-service", "/Users/dev/acme/auth-service")] },
  { id: "p3", name: "Billing v2", color: "#9B9A97", createdAt: now, repos: [] },
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
  if (new URLSearchParams(location.search).has("fixture")) {
    fixture = await fetch("/fixture.json").then((r) => r.json()).catch(() => null);
    if (fixture) {
      projects = [{ id: "fx", name: "Fixture", color: "#8B5CF6", createdAt: now, repos: fixture.repoIds.map((id) => repo(id, id, `/fixture/${id}`, null, true)) }];
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
      case "get_graph":
        return fixture ?? mockGraph();
      case "claude_status":
        return { available: true, path: "/mock/claude", version: "mock" };
      case "ask_start":
        mockAnswer(a.request.askId);
        return null;
      case "ask_cancel":
        return null;
      case "workspace_packages":
        return [{ packageName: "@acme/shared-types", repoId: "r9", repoName: "shared-types", path: "/Users/dev/acme/shared-types", projects: ["Internal Tools"] }];
      case "create_project": {
        const id = "p" + Math.random().toString(36).slice(2, 7);
        projects.push({ id, name: a.name, color: a.color, createdAt: now, repos: [] });
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

/** Streams a canned answer the way the Claude CLI does, to exercise the Ask panel. */
function mockAnswer(askId: string) {
  const ev = (event: unknown) => emit("ask-event", { askId, event });
  const answer =
    "Checkout spans two services and two tables:\n\n1. The Pay button in [page.tsx](strata:file/web-app/app/checkout/page.tsx) calls [api](strata:node/api) through `lib/graphql/client.ts`.\n2. [checkout.service.ts](strata:file/api/src/services/checkout.service.ts) validates the cart, prices it with `quote()` and writes a pending order via `src/db/orders.repo.ts`.\n3. Payment goes to **Stripe** through `PaymentClient`.\n\nThe order is stored in the [orders](strata:table/api/orders) table.";
  const steps = ["Reading app/checkout/page.tsx", "Searching for createCheckoutSession", "Reading src/services/checkout.service.ts"];
  let t = 0;
  setTimeout(() => ev({ type: "system", subtype: "init", session_id: "mock-session" }), (t += 100));
  for (const s of steps) setTimeout(() => ev({ type: "system", subtype: "task_summary", detail: s }), (t += 450));
  for (const chunk of answer.match(/.{1,14}/gs) ?? []) setTimeout(() => ev({ type: "stream_event", event: { delta: { type: "text_delta", text: chunk } } }), (t += 25));
  setTimeout(() => ev({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.42 } } } }), (t += 50));
  setTimeout(() => ev({ type: "result", subtype: "success", result: answer, session_id: "mock-session", total_cost_usd: 0.04 }), (t += 50));
  setTimeout(() => emit("ask-done", { askId, ok: true, error: null }), (t += 50));
}
