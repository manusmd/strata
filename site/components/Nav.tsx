import { REPO_URL } from "@/lib/site";
import { GitHubIcon } from "./GitHubIcon";
import { StrataLogo } from "./StrataLogo";
import { ThemeToggle } from "./ThemeToggle";

export function Nav({ downloadHref }: { downloadHref: string }) {
  return (
    <header className="nav">
      <nav className="wrap nav-inner" aria-label="Main">
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text)", textDecoration: "none" }} aria-label="Strata home">
          <span className="app-tile" style={{ width: 30, height: 30 }}>
            <StrataLogo size={22} />
          </span>
          <span className="wordmark" style={{ fontSize: 20 }}>Strata</span>
        </a>
        <div className="nav-links only-wide">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#changelog">Changelog</a>
          <a href="#faq">FAQ</a>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle />
          <a href={REPO_URL} className="icon-btn" aria-label="Strata on GitHub" style={{ color: "var(--text)" }}>
            <GitHubIcon />
          </a>
          <a
            href={downloadHref}
            className="not-mobile"
            style={{ height: 34, padding: "0 14px", borderRadius: 9, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Download for Mac
          </a>
        </div>
      </nav>
    </header>
  );
}
