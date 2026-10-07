import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import { s } from "@/lib/style";
import { StrataLogo } from "./StrataLogo";

export function Footer() {
  const link = { color: "var(--text-2)" };
  return (
    <footer style={{ borderTop: "1px solid var(--line)", padding: "32px var(--pad) 40px" }}>
      <div style={s("max-width:1120px; margin:0 auto; display:flex; flex-wrap:wrap; align-items:center; gap:20px 28px")}>
        <Link href="/" style={s("display:flex; align-items:center; gap:10px; color:var(--text); text-decoration:none")}>
          <span className="app-tile" style={s("width:26px; height:26px; border-radius:7px")}>
            <StrataLogo size={19} />
          </span>
          <span className="wordmark" style={{ fontSize: 17 }}>
            Strata
          </span>
        </Link>
        <nav aria-label="Footer" style={s("display:flex; gap:8px 20px; font-size:14px; flex-wrap:wrap")}>
          <a href={REPO_URL} style={link}>GitHub</a>
          <Link href="/#changelog" style={link}>Changelog</Link>
          <Link href="/#faq" style={link}>FAQ</Link>
          <Link href="/imprint/" style={link}>Imprint</Link>
          <Link href="/privacy/" style={link}>Privacy</Link>
        </nav>
        <p style={s("margin:0; flex:1 1 260px; font-size:13px; color:var(--text-3); line-height:1.5")}>Strata runs on your Mac. No account, no analytics, no code upload. This site has no cookies or trackers.</p>
        <div style={s("font-size:13px; color:var(--text-3)")}>© {new Date().getFullYear()} Manuel Schmid · MIT license</div>
      </div>
    </footer>
  );
}
