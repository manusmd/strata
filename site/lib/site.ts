/** Where the site and the app live. SITE_URL overrides the GitHub Pages address (e.g. a custom domain). */
export const REPO = "manusmd/strata";
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const SITE_URL = (process.env.SITE_URL ?? "https://manusmd.github.io/strata").replace(/\/$/, "");

export const NAME = "Strata";
export const TAGLINE = "See your whole system. Zoom into any line.";
export const DESCRIPTION =
  "Strata is a free, open-source macOS app that maps your repositories into one zoomable atlas: code, architecture and database schema — with an AI assistant that reads the code with you, using your own Claude Code subscription. Runs locally; your code never leaves your Mac.";
export const REQUIREMENTS = "Apple Silicon & Intel · macOS 11+";
