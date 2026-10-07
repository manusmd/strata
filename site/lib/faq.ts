/** Shown on the page and as FAQPage structured data. */
export const FAQS: [string, string][] = [
  [
    "What is Strata?",
    "Strata is a free, open-source macOS app for developers. You group the repositories of a system into a project, and Strata scans them into one zoomable map with three views: Code (folders, files, imports and symbols), Architecture (apps, services, libraries, databases and external APIs) and Database (an ER diagram from your schema). An AI assistant, Ask Strata, answers questions about the code and can draw architecture proposals.",
  ],
  [
    "Can Strata help plan a new project?",
    "Yes. Start a project from an idea: Claude asks a few questions, proposes two or three architectures, and the one you pick becomes an editable plan with a data model and decision records. Strata then generates ARCHITECTURE.md, AGENTS.md, CLAUDE.md and ADR files, and once code exists it shows what is built, missing or built differently than planned.",
  ],
  ["Is my code uploaded anywhere?", "No. Scanning, the map and search all run on your Mac. Only the questions you ask Ask Strata go to Claude, through your own Claude Code login."],
  ["Do I need Claude?", "Only for the AI features: Ask Strata, planning, AI summaries, AI sections and canvases. The maps, the three lenses and ⌘K search work without it."],
  ["Which languages and schemas are supported?", "TypeScript and JavaScript today, including monorepos with workspaces and tsconfig path aliases. Database schemas are read from Prisma, ZenStack, Drizzle and SQL migrations. More languages are on the roadmap."],
  ["Why does macOS show a security prompt?", "Strata isn’t notarized by Apple. The source is open on GitHub, and you only need to allow it once in System Settings → Privacy & Security."],
  ["How do updates work?", "Strata checks for new versions on launch and every few hours. When one is ready, you click Install & restart and it opens on the new version. Updates are signed, so the app only installs official releases."],
  ["Is Strata free?", "Yes. Strata is free and open source under the MIT license."],
];
