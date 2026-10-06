# Strata

A visual atlas for your codebase: connect the repos of a project and explore them as one zoomable map with three lenses — Code, Architecture and Database.

Built with Tauri 2 (Rust) + React + TypeScript.

## Develop

```bash
pnpm install
pnpm tauri dev      # native app
pnpm dev            # UI only, in a browser, with mock data (src/devMock.ts)
cd src-tauri && cargo test
```

Real Claude CLI round trip (uses a few cents of your subscription):

```bash
cd src-tauri && cargo test ask:: -- --ignored --nocapture
```

Scanner on a real repo (prints stats and timing):

```bash
cd src-tauri && STRATA_SCAN=~/dev/some-repo cargo test --release real_repo -- --ignored --nocapture
```

`http://localhost:1420/?fixture` renders `public/fixture.json` (gitignored) instead of the sample graph. Create one from any repo with:

```bash
cd src-tauri && STRATA_SCAN=~/dev/some-repo STRATA_FIXTURE=../public/fixture.json cargo test --release real_repo -- --ignored --nocapture
```

## App icon

The icon is drawn in `assets/app-icon.svg` (same geometry as `StrataLogo.tsx`). Regenerate all sizes with:

```bash
pnpm tauri icon assets/app-icon.svg && rm -rf src-tauri/icons/android src-tauri/icons/ios
```

## Layout

- `src-tauri/src/db.rs` — SQLite store: projects, repos (a repo can belong to several projects), and the node/edge graph the scanner fills.
- `src-tauri/src/scanner.rs` — Tree-sitter scanner: files, symbols and imports for TS/TSX/JS, resolving relative paths, tsconfig aliases and monorepo workspace packages.
- `src-tauri/src/lib.rs` — Tauri commands, background scans with progress events, macOS vibrancy.
- `src-tauri/src/schema.rs` — database schemas from Prisma/ZenStack (`.prisma`, `.zmodel`), Drizzle tables and SQL migrations (replayed in order), plus where code reads/writes tables (Prisma client, Drizzle query builder, raw SQL strings).
- `src-tauri/src/arch.rs` — architecture signals: units (every package.json), docker-compose services (ports, depends_on, env links), database engines, and per-file hints (env vars, localhost ports, external hosts, listen ports).
- `src-tauri/src/ask.rs` — Ask Strata: runs the user's own Claude Code CLI (`claude -p … --output-format stream-json`), newest installation wins, read-only (`--tools Read Grep Glob`, `dontAsk`, `--restricted` when supported), repos added with `--add-dir`, follow-ups via `--resume`; events are streamed to the UI.
- `src/ask/` — the panel (⌘J): project context for Claude (`context.ts`), conversation store, a small Markdown renderer that turns `strata:file|table|node/…` links and known paths into chips that jump to the right lens.
- `src/map/` — Code lens: graph model, ELK layout (folder hierarchy; flow for small folders, packing for big ones), React Flow nodes with semantic zoom, inspector. Database lens in `db*.ts(x)`: ER diagram grouped by schema file, hub tables kept out of the layout, crow's-foot relations, jumps between tables and the code that uses them. Architecture lens in `arch*.ts(x)`: classifies units (app / service / worker / library …), maps SDKs and hosts to external services, links units by imports, DB access, localhost ports, compose config and `*_API_URL` variables (marked as inferred), and traces missing packages to repos elsewhere in the workspace.
- `src/` — React UI (sidebar, projects overview, create-project flow, project view, settings). Design tokens in `src/styles.css`.
