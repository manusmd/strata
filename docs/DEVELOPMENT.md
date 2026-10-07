# Developing Strata

Built with Tauri 2 (Rust) + React 19 + TypeScript. Maps are drawn with React Flow and laid out with ELK; source is parsed with Tree-sitter; everything is stored in a local SQLite database.

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

## Project logos

During a scan Strata looks for the most logo-like image in each repo (`*logo*`, app icons, `icon.svg`, apple-touch-icon, favicons; svg/png preferred, tests and docs skipped — see `src-tauri/src/logo.rs`). The best one across a project's repos becomes the project image; projects without one show their initials.

## Releases & updates

Strata updates itself with the Tauri updater: it checks the feed in `tauri.conf.json` (`plugins.updater.endpoints`) a few seconds after launch and every 6 hours, and offers to install a newer version. "v0.x.y" in the sidebar footer checks manually.

- Updates are signed with the updater key in `~/.tauri/strata-updater.key` (never commit it; back it up — without it no installed copy accepts updates). The public half is `plugins.updater.pubkey`.
- The app itself is only ad-hoc signed (`bundle.macOS.signingIdentity: "-"`), not notarized: on first launch users allow it under System Settings → Privacy & Security → Open Anyway. Updates installed by the app don't need that again.
- A release build with update artifacts (`Strata.app.tar.gz` + `.sig`):

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/strata-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build --bundles app,dmg
```

- The feed is a `latest.json` next to the artifacts: `{ "version", "notes", "pub_date", "platforms": { "darwin-aarch64": { "signature": <contents of .sig>, "url": <tar.gz url> } } }`.
- Testing an update locally: serve a feed over http, build with `--config '{"plugins":{"updater":{"dangerousInsecureTransportProtocol":true}}}'` and start the app with `STRATA_UPDATE_URL=http://127.0.0.1:8765/latest.json`.

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
- `src-tauri/src/summary.rs` — tool-less Claude calls with their own system prompt: AI summaries of map items (source inlined from disk, at most 3 at once) and AI sections plans (JSON). Stored in SQLite with a hash of their inputs, so they're reused until the code changes.
- `src/summary/` — what Strata knows about each item (`subjects.ts`), the summary store/queue, and the inspector section. Off by default; per project in settings: off, on click, or on click + pre-generate components and tables.
- `src/home/` — the project Overview: project summary, figures, and saved chats (stored in SQLite with their Claude session, so they can be continued).
- `src/canvas/` — canvases: Claude draws diagrams as ```strata-canvas JSON (format and instructions in `spec.ts`); rendered with ELK in the map style, with new/changed/removed status, full screen and side by side with the current architecture.
- `src/sections/` — AI sections: Claude groups components, tables or folders into domain sections (short ids in, validated plan out); the maps lay them out as frames.
- `src/palette/` — ⌘K: fuzzy search over files, symbols, tables, components and folders of the open project (`index.ts`, `fuzzy.ts`), plus actions (switch view or project, rescan, settings, theme) and “Ask Strata: …” (⌘↵).
- `src/map/` — Code lens: graph model, ELK layout (folder hierarchy; flow for small folders, packing for big ones), React Flow nodes with semantic zoom, inspector. Database lens in `db*.ts(x)`: ER diagram grouped by schema file, hub tables kept out of the layout, crow's-foot relations, jumps between tables and the code that uses them. Architecture lens in `arch*.ts(x)`: classifies units (app / service / worker / library …), maps SDKs and hosts to external services, links units by imports, DB access, localhost ports, compose config and `*_API_URL` variables (marked as inferred), and traces missing packages to repos elsewhere in the workspace.
- `src/` — React UI (sidebar, projects overview, create-project flow, project view, settings). Design tokens in `src/styles.css`.
