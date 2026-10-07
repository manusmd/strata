import Link from "next/link";
import type { LegalContent, LegalLocale } from "@/lib/legal";
import { s } from "@/lib/style";

/** Turns bare URLs in legal text into links. */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} rel="noopener">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export function LegalPage({ content, locale, other }: { content: LegalContent; locale: LegalLocale; other: { href: string; label: string } }) {
  return (
    <main id="top" className="wrap" style={{ paddingBlock: "calc(var(--sec) * .7) var(--sec)" }}>
      <article lang={locale} style={s("max-width:720px; margin:0 auto; display:flex; flex-direction:column; gap:28px")}>
        <header style={s("display:flex; flex-direction:column; gap:12px")}>
          <div style={s("display:flex; align-items:center; gap:12px; flex-wrap:wrap")}>
            <Link href="/" style={{ fontSize: 14, color: "var(--text-2)" }}>
              ← {locale === "de" ? "Zur Startseite" : "Back to Strata"}
            </Link>
            <Link href={other.href} hrefLang={locale === "de" ? "en" : "de"} style={{ marginLeft: "auto", fontSize: 14 }}>
              {other.label}
            </Link>
          </div>
          <h1 className="h2" style={{ fontSize: "var(--h2)" }}>
            {content.title}
          </h1>
          <div className="verline">{content.updated}</div>
          <p className="lead">{content.intro}</p>
        </header>
        {content.blocks.map((b) => (
          <section key={b.h} style={s("display:flex; flex-direction:column; gap:8px")}>
            <h2 style={s("margin:0; font-size:17px; font-weight:600; letter-spacing:-.01em")}>{b.h}</h2>
            <p style={s("margin:0; font-size:15px; line-height:1.65; color:var(--text-2); white-space:pre-line; overflow-wrap:anywhere")}>{linkify(b.p)}</p>
            {b.list && (
              <ul style={s("margin:0; padding-left:20px; display:flex; flex-direction:column; gap:6px; font-size:15px; line-height:1.6; color:var(--text-2)")}>
                {b.list.map((li) => (
                  <li key={li}>{linkify(li)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </main>
  );
}
