import { CanvasDemo, CopyButton, MissingDemo, ShareLink } from "@/components/Interactive";
import { HeroMock } from "@/components/HeroMock";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { StrataLogo } from "@/components/StrataLogo";
import { FAQS } from "@/lib/faq";
import { downloadInfo, formatDate, getReleases, type Release } from "@/lib/releases";
import { DESCRIPTION, NAME, RELEASES_URL, REPO_URL, REQUIREMENTS, SITE_URL } from "@/lib/site";
import { s } from "@/lib/style";

const mono = "var(--font-mono), monospace";
const V = "#8B5CF6", T = "#14B8A6", I = "#6366F1";

export default async function Home() {
  const releases = await getReleases();
  const latest = releases[0];
  const dl = downloadInfo(latest);
  const verLine = [dl.version, dl.date, REQUIREMENTS].filter(Boolean).join(" · ");

  return (
    <>
      <JsonLd latest={latest} downloadHref={dl.href} />
      <Nav downloadHref={dl.href} />
      <main id="top">
        <Hero dl={dl} verLine={verLine} />
        <TrustStrip />
        <Lenses />
        <Missing />
        <AskStrata />
        <Canvases />
        <FeatureGrid />
        <Steps />
        <Install version={dl.version} />
        <Changelog releases={releases} />
        <Faq />
        <FinalCta href={dl.href} verLine={verLine} />
      </main>
      <Footer />
    </>
  );
}

/* ---------- Structured data (search engines and AI answer engines) ---------- */

function JsonLd({ latest, downloadHref }: { latest?: Release; downloadHref: string }) {
  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: NAME,
    description: DESCRIPTION,
    url: `${SITE_URL}/`,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Code visualization",
    operatingSystem: "macOS 11 or later (Apple Silicon and Intel)",
    downloadUrl: downloadHref,
    installUrl: downloadHref,
    ...(latest ? { softwareVersion: latest.version, datePublished: latest.date } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    codeRepository: REPO_URL,
    sameAs: [REPO_URL],
    image: `${SITE_URL}/opengraph-image.png`,
    screenshot: `${SITE_URL}/opengraph-image.png`,
    author: { "@type": "Person", name: "Manuel Schmid", url: "https://github.com/manusmd" },
    featureList: [
      "Zoomable code map: folders, files, imports and symbols",
      "Architecture view detected from package.json, docker-compose, environment variables and code",
      "Database ER diagrams from Prisma, ZenStack, Drizzle and SQL migrations",
      "Detection of missing dependencies across repositories",
      "Ask Strata: AI answers about the code using your own Claude Code subscription",
      "Canvases: AI-drawn architecture proposals compared with the current architecture",
      "AI summaries and AI sections",
      "Runs locally; code never leaves the Mac",
    ],
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(app) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
    </>
  );
}

/* ---------- Hero ---------- */

function Hero({ dl, verLine }: { dl: ReturnType<typeof downloadInfo>; verLine: string }) {
  return (
    <section className="hero dots" aria-labelledby="hero-title">
      <div style={s("position:absolute; left:50%; top:420px; width:900px; max-width:100%; height:500px; transform:translateX(-50%); background:radial-gradient(closest-side, rgba(139,92,246,.16), transparent); pointer-events:none")} />
      <div style={s("position:relative; max-width:1120px; margin:0 auto; display:flex; flex-direction:column; align-items:center; text-align:center")}>
        <a
          href="#canvases"
          style={s("display:flex; align-items:center; gap:8px; min-height:30px; padding:0 12px 0 6px; border-radius:99px; background:var(--glass); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border:1px solid var(--glass-border); color:var(--text-2); font-size:13px; text-decoration:none; animation:stPop .6s ease-out")}
        >
          <span style={s(`font:500 12px ${mono}; padding:2px 7px; border-radius:99px; background:rgba(139,92,246,.18); color:var(--violet-text)`)}>{dl.version ?? "New"}</span>
          Canvases for architecture proposals →
        </a>
        <h1 id="hero-title">
          See your whole system. <span style={{ color: "var(--text-2)" }}>Zoom into any line.</span>
        </h1>
        <p className="hero-lead">Strata maps your repos into one living atlas: architecture, code and database, with an AI that reads the code with you.</p>
        <div style={s("margin-top:32px; display:flex; flex-direction:column; align-items:center; gap:10px; width:100%")}>
          <div className="not-mobile" style={s("display:flex; align-items:center; gap:18px; flex-wrap:wrap; justify-content:center")}>
            <a href={dl.href} className="btn-primary">
              Download for macOS
            </a>
            <a href="#install" style={s("font-size:14.5px; color:var(--text-2)")}>
              How to install →
            </a>
          </div>
          <div className="only-mobile" style={s("display:flex; flex-direction:column; align-items:center; gap:12px; width:100%")}>
            <div style={s("height:50px; width:100%; max-width:340px; box-sizing:border-box; border-radius:12px; border:1px solid var(--line); background:var(--chip); color:var(--text); font-size:15px; font-weight:600; display:flex; align-items:center; justify-content:center")}>
              Download on your Mac
            </div>
            <ShareLink />
          </div>
          <div className="verline">{verLine}</div>
        </div>
        <HeroMock />
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <div className="band" style={{ padding: "20px var(--pad)" }}>
      <ul style={s("list-style:none; margin:0 auto; padding:0; max-width:1120px; display:flex; flex-wrap:wrap; justify-content:center; gap:12px 32px; font-size:14px; color:var(--text-2)")}>
        {(
          [
            ["Runs locally on your Mac", T],
            ["Your code never leaves your machine", T],
            ["Uses your own Claude subscription", V],
            ["Free and open source", V],
          ] as const
        ).map(([label, c]) => (
          <li key={label} style={s("display:flex; align-items:center; gap:9px")}>
            <span style={s(`width:6px; height:6px; border-radius:50%; background:${c}`)} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- One map, three lenses ---------- */

function LensCard({ color, title, text, meta, children }: { color: string; title: string; text: string; meta: string; children: React.ReactNode }) {
  return (
    <article className="glass-card" style={s("overflow:hidden; display:flex; flex-direction:column")}>
      <div className="dots" aria-hidden style={s("height:178px; position:relative; background-size:16px 16px; border-bottom:1px solid var(--line); display:grid; place-items:center")}>
        <div style={s("position:relative; width:268px; height:140px")}>{children}</div>
      </div>
      <div style={s("padding:20px 22px 22px; display:flex; flex-direction:column; gap:10px")}>
        <h3 style={s("margin:0; display:flex; align-items:center; gap:9px; font-size:18px; font-weight:600; letter-spacing:-.02em")}>
          <span style={s(`width:9px; height:9px; border-radius:3px; background:${color}`)} />
          {title}
        </h3>
        <p style={s("margin:0; font-size:14.5px; line-height:1.55; color:var(--text-2)")}>{text}</p>
        <div style={s(`font:400 12px ${mono}; color:var(--text-3)`)}>{meta}</div>
      </div>
    </article>
  );
}

const box = (x: number, y: number, w: number, h: number, extra = "") => s(`position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; box-sizing:border-box; border-radius:7px; background:var(--card); border:1px solid var(--card-border); font:500 10.5px ${mono}; display:grid; place-items:center; ${extra}`);

function Lenses() {
  const codeFiles: [string, number, number, boolean?][] = [["checkout.ts", 7, 35], ["orders.ts", 7, 63], ["users.ts", 7, 91], ["checkout.svc.ts", 157, 29, true], ["pricing.ts", 157, 57], ["payment.ts", 157, 85]];
  const col = (n: string, k?: "PK" | "FK") => (
    <div key={n} style={s(`height:20px; border-top:1px solid var(--line); display:flex; align-items:center; gap:5px; padding:0 8px; font:400 9.5px ${mono}`)}>
      <span style={s(`width:14px; color:${k === "FK" ? "#818CF8" : "#F59E0B"}; font-weight:600; font-size:8px`)}>{k ?? ""}</span>
      {n}
    </div>
  );
  return (
    <section id="features" className="wrap section" aria-labelledby="lenses-title">
      <div className="intro">
        <div className="eyebrow">One map · three lenses</div>
        <h2 id="lenses-title" className="h2">
          Switch how you look at it, not what you’re looking at.
        </h2>
        <p className="lead">Every lens shares the same graph. Select a table to see the code that reads and writes it; select a service to see what it talks to and which tables it owns.</p>
      </div>
      <div className="grid-3">
        <LensCard color={I} title="Code" text="Folders and files as a zoomable map, with imports as lines. Zoom all the way in and you’re looking at functions." meta="folders → files → symbols">
          <svg width="268" height="140" style={s("position:absolute; inset:0")}>
            <path d="M118,46 C134,46 134,40 150,40" style={s("fill:none; stroke:#6366F1; stroke-width:1.3")} />
            <path d="M118,74 C134,74 134,96 150,96" style={s("fill:none; stroke:#6366F1; stroke-width:1.3; stroke-dasharray:1.5 3.5")} />
            <path d="M118,102 C134,102 134,68 150,68" style={s("fill:none; stroke:#6366F1; stroke-width:1.3")} />
          </svg>
          {[["routes/", 0, false], ["services/", 150, true]].map(([n, x, hl]) => (
            <div key={n as string} style={s(`position:absolute; left:${x}px; top:4px; width:118px; height:126px; box-sizing:border-box; border-radius:11px; border:1px solid ${hl ? "rgba(99,102,241,.4)" : "var(--line)"}; background:rgba(127,127,127,.03); padding:7px`)}>
              <div style={s(`font:600 10.5px ${mono}; color:var(--text-2)`)}>{n as string}</div>
            </div>
          ))}
          {codeFiles.map(([n, x, y, hl]) => (
            <div key={n} style={s(`position:absolute; left:${x}px; top:${y}px; width:104px; height:22px; box-sizing:border-box; border-radius:6px; background:var(--card); border:1px solid ${hl ? I : "var(--card-border)"}; font:500 10px ${mono}; display:flex; align-items:center; padding:0 7px; color:var(--text)`)}>
              {n}
            </div>
          ))}
        </LensCard>
        <LensCard color={V} title="Architecture" text="Apps, services, libraries, databases and external APIs, with the calls between them. Detected, not drawn." meta="package.json · docker-compose · .env · code">
          <svg width="268" height="140" style={s("position:absolute; inset:0")}>
            <path d="M74,30 C96,30 96,70 106,70" style={s("fill:none; stroke:#8B5CF6; stroke-width:1.4")} />
            <path d="M180,62 C192,62 192,26 196,26" style={s("fill:none; stroke:#8B5CF6; stroke-width:1.4")} />
            <path d="M180,78 C192,78 192,112 196,112" style={s("fill:none; stroke:#14B8A6; stroke-width:1.5")} />
            <path d="M143,88 C143,104 110,112 74,112" style={s("fill:none; stroke:#8B5CF6; stroke-width:1.4; stroke-dasharray:4 3")} />
          </svg>
          <div style={box(0, 16, 74, 28)}>web-app</div>
          <div style={box(106, 54, 74, 34, "border-radius:8px; border-color:#8B5CF6; box-shadow:0 0 0 3px rgba(139,92,246,.15); font-weight:600; font-size:11px")}>api</div>
          <div style={box(196, 12, 72, 28)}>Stripe</div>
          <div style={box(196, 98, 72, 28, "border-color:rgba(20,184,166,.5); color:var(--teal-text)")}>Postgres</div>
          <div style={box(0, 98, 74, 28)}>worker</div>
        </LensCard>
        <LensCard color={T} title="Database" text="An ER diagram built from your schema, plus which code reads and writes each table." meta="Prisma · ZenStack · Drizzle · SQL migrations">
          <svg width="268" height="140" style={s("position:absolute; inset:0")}>
            <path d="M150,72 C130,72 130,42 112,42" style={s("fill:none; stroke:var(--edge); stroke-width:1.3")} />
            <path d="M150,66 L162,72 L150,78 M150,72 L162,72 M158,64 L158,80" style={s("fill:none; stroke:var(--edge); stroke-width:1.3")} />
            <path d="M118,36 L118,48 M122,36 L122,48" style={s("fill:none; stroke:var(--edge); stroke-width:1.3")} />
          </svg>
          <div style={s("position:absolute; left:0; top:10px; width:112px; box-sizing:border-box; border-radius:9px; background:var(--card); border:1px solid var(--card-border); overflow:hidden")}>
            <div style={s(`height:24px; display:flex; align-items:center; padding:0 8px; font:600 10.5px ${mono}`)}>users</div>
            {col("id", "PK")}
            {col("email")}
            {col("name")}
          </div>
          <div style={s("position:absolute; left:162px; top:30px; width:106px; box-sizing:border-box; border-radius:9px; background:var(--card); border:1px solid rgba(20,184,166,.5); box-shadow:0 0 0 3px rgba(20,184,166,.12); overflow:hidden")}>
            <div style={s(`height:24px; display:flex; align-items:center; padding:0 8px; font:600 10.5px ${mono}`)}>orders</div>
            {col("id", "PK")}
            {col("user_id", "FK")}
            {col("status")}
          </div>
        </LensCard>
      </div>
    </section>
  );
}

/* ---------- Missing dependencies ---------- */

function Missing() {
  const reasons = [
    "Packages your code imports that live in a repo outside the project, traced back to that repo",
    "Tables your foreign keys point to in another schema, shown as dashed placeholders",
    "External services like Stripe, OpenAI or S3, recognized from SDKs, hosts and env vars",
  ];
  return (
    <section className="wrap" style={{ paddingBottom: "var(--sec)" }} aria-labelledby="missing-title">
      <div className="split">
        <div style={s("flex:1 1 360px; min-width:0; display:flex; flex-direction:column; gap:16px")}>
          <div className="eyebrow" style={{ color: "var(--warn-text)" }}>Missing dependencies</div>
          <h2 id="missing-title" className="h2">
            Missing pieces, found.
          </h2>
          <p className="lead">Real systems span more repos than you have open. Strata notices what your code depends on but the project doesn’t contain, puts it on the map, and tells you where to find it.</p>
          <ol style={s("list-style:none; margin:6px 0 0; padding:0; display:flex; flex-direction:column; gap:10px")}>
            {reasons.map((r, i) => (
              <li key={r} style={s("display:flex; gap:12px; align-items:baseline")}>
                <span style={s(`font:500 12.5px ${mono}; color:var(--warn-text); flex:none; width:22px`)}>0{i + 1}</span>
                <span style={s("font-size:15px; line-height:1.5")}>{r}</span>
              </li>
            ))}
          </ol>
        </div>
        <div style={s("flex:1 1 440px; min-width:0")}>
          <MissingDemo />
        </div>
      </div>
    </section>
  );
}

/* ---------- Ask Strata ---------- */

function AskStrata() {
  type Seg = { t: string } | { c: string; l: string };
  const steps: Seg[][] = [
    [{ t: "The Pay button in " }, { c: V, l: "web-app" }, { t: " sends POST /checkout to " }, { c: V, l: "api" }, { t: "." }],
    [{ c: I, l: "checkout.service.ts" }, { t: " prices the cart and writes a pending row to " }, { c: T, l: "orders" }, { t: "." }],
    [{ t: "A Stripe webhook lands in " }, { c: V, l: "worker" }, { t: ", which marks the order paid and writes " }, { c: T, l: "invoices" }, { t: "." }],
  ];
  return (
    <section className="band section" aria-labelledby="ask-title" style={{ paddingInline: "var(--pad)" }}>
      <div style={s("max-width:1136px; margin:0 auto; display:flex; flex-wrap:wrap-reverse; gap:48px; align-items:center")}>
        <div style={s("flex:1 1 400px; min-width:0; display:flex; justify-content:center")}>
          <div aria-label="Example: Ask Strata explains how checkout works" role="figure" style={s("width:100%; max-width:460px; border-radius:16px; background:var(--glass-strong); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1px solid var(--glass-border); box-shadow:var(--shadow); overflow:hidden")}>
            <div style={s("height:46px; display:flex; align-items:center; gap:8px; padding:0 16px; border-bottom:1px solid var(--line); font-size:13.5px")}>
              <span style={{ color: V }}>✦</span>
              <b style={{ fontWeight: 600 }}>Ask Strata</b>
              <span style={s("color:var(--text-3); font-size:12.5px")}>· Acme Cloud</span>
            </div>
            <div style={s("padding:18px 16px; display:flex; flex-direction:column; gap:16px; font-size:14px; line-height:1.6")}>
              <div style={s("display:flex; gap:10px; align-items:center")}>
                <span style={s("width:22px; height:22px; border-radius:50%; background:#8B5CF6; color:#fff; display:grid; place-items:center; font-size:9.5px; font-weight:600; flex:none")}>ML</span>
                <b style={{ fontWeight: 500 }}>How does checkout work?</b>
              </div>
              <div style={s("display:flex; gap:10px")}>
                <StrataLogo size={22} />
                <div style={s("display:flex; flex-direction:column; gap:10px; min-width:0")}>
                  {steps.map((segs, i) => (
                    <div key={i} style={s("display:flex; gap:10px")}>
                      <span style={s(`font:500 11.5px ${mono}; color:var(--text-3); padding-top:3px`)}>0{i + 1}</span>
                      <div style={{ textWrap: "pretty" }}>
                        {segs.map((g, j) =>
                          "t" in g ? (
                            <span key={j}>{g.t}</span>
                          ) : (
                            <span key={j} style={s(`display:inline-flex; align-items:center; gap:5px; height:21px; padding:0 7px; border-radius:6px; background:${g.c}22; font:500 12px ${mono}; vertical-align:1px`)}>
                              <span style={s(`width:5px; height:5px; border-radius:50%; background:${g.c}`)} />
                              {g.l}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={s("font-size:12.5px; color:var(--text-3)")}>Read 23 files across 3 repos</div>
                </div>
              </div>
            </div>
            <div style={s("padding:12px; border-top:1px solid var(--line)")}>
              <div style={s("height:38px; display:flex; align-items:center; padding:0 6px 0 12px; border-radius:10px; border:1px solid var(--line); background:var(--chip); color:var(--text-3); font-size:13.5px")}>
                <span style={{ flex: 1 }}>Ask a follow-up…</span>
                <span style={s("width:26px; height:26px; border-radius:7px; background:#8B5CF6; color:#fff; display:grid; place-items:center")}>↑</span>
              </div>
            </div>
          </div>
        </div>
        <div style={s("flex:1 1 380px; min-width:0; display:flex; flex-direction:column; gap:16px")}>
          <div className="eyebrow" style={{ color: "var(--violet-text)" }}>Ask Strata</div>
          <h2 id="ask-title" className="h2">
            Ask the codebase. Get answers you can click.
          </h2>
          <p className="lead">Claude starts from Strata’s map and reads the actual code to answer. Every file, table and service in an answer is a chip: click one and the map jumps there and selects it.</p>
          <div style={s("display:flex; flex-direction:column; gap:8px; padding:14px 16px; border-radius:12px; border:1px solid var(--line); background:var(--card); font-size:14px; line-height:1.55; color:var(--text-2)")}>
            <div>
              <b style={s("color:var(--text); font-weight:600")}>Runs on the Claude Code CLI</b> with your own subscription. No extra account, no API keys.
            </div>
            <div>
              <b style={s("color:var(--text); font-weight:600")}>Read-only.</b> It can look at your code, never change it.
            </div>
            <div>
              <b style={s("color:var(--text); font-weight:600")}>Saved chats per project</b>, so you can pick up a conversation later.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Canvases ---------- */

function Canvases() {
  return (
    <section id="canvases" className="wrap section" aria-labelledby="canvas-title">
      <div className="intro" style={{ marginBottom: 40 }}>
        <div className="eyebrow">Canvases</div>
        <h2 id="canvas-title" className="h2">
          Plan changes on the map, not in a doc.
        </h2>
        <p className="lead">Ask what a change would take and Strata answers with a canvas: a proposed architecture, marked up against the one you have. Click any part to see the real component behind it.</p>
      </div>
      <CanvasDemo />
    </section>
  );
}

function FeatureGrid() {
  const features: [string, string, string, string][] = [
    ["✦", V, "AI summaries on click", "Select any component, file or table and get a short plain-English summary of what it does."],
    ["§", V, "AI sections", "Strata groups a large map by domain, like billing, auth and search."],
    ["⌘K", I, "Search everything", "Files, symbols, tables and services from one box. Jump straight to them."],
    ["⧉", T, "Monorepo and multi-repo", "Workspaces, packages and separate repos land on one map."],
    ["◐", "var(--text-2)", "Light and dark", "Follows your system, or pick one."],
    ["↻", T, "Automatic updates", "New versions install in the app with one click."],
  ];
  return (
    <section className="wrap" style={{ paddingBottom: "var(--sec)" }} aria-label="More features">
      <ul style={s("list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden")}>
        {features.map(([g, c, t, d]) => (
          <li key={t} style={s("background:var(--bg); padding:24px; display:flex; flex-direction:column; gap:8px")}>
            <div aria-hidden style={s(`width:30px; height:30px; border-radius:8px; background:${c.startsWith("#") ? c + "22" : "var(--chip)"}; color:${c}; display:grid; place-items:center; font:600 12px ${mono}; margin-bottom:4px`)}>{g}</div>
            <h3 style={s("margin:0; font-size:15.5px; font-weight:600; letter-spacing:-.01em")}>{t}</h3>
            <p style={s("margin:0; font-size:14px; line-height:1.55; color:var(--text-2)")}>{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Steps() {
  const steps: [string, string, string][] = [
    ["Create a project", "Name the system and add the local repos that belong to it.", I],
    ["Strata scans them", "Imports, services, schemas and external APIs, parsed in seconds on your machine.", V],
    ["Explore, ask, plan", "Zoom from system to symbol, ask questions, sketch changes on a canvas.", T],
  ];
  return (
    <section id="how" className="band section" style={{ paddingInline: "var(--pad)" }} aria-labelledby="how-title">
      <div style={s("max-width:1120px; margin:0 auto")}>
        <h2 id="how-title" className="h2" style={{ textAlign: "center", marginBottom: 40 }}>
          From repo to map in three steps.
        </h2>
        <ol style={s("list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:28px")}>
          {steps.map(([t, d, c], i) => (
            <li key={t} style={s(`display:flex; flex-direction:column; gap:10px; padding-top:18px; border-top:2px solid ${c}`)}>
              <div style={s(`font:500 13px ${mono}; color:${c}`)}>0{i + 1}</div>
              <h3 style={s("margin:0; font-size:19px; font-weight:600; letter-spacing:-.02em")}>{t}</h3>
              <p style={s("margin:0; font-size:15px; line-height:1.55; color:var(--text-2)")}>{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Install ---------- */

function Install({ version }: { version: string | null }) {
  const stepText = (n: number, b: string, rest: string) => (
    <div style={s("display:flex; gap:12px")}>
      <span style={s(`font:500 13px ${mono}; color:var(--text-3)`)}>{n}</span>
      <p style={s("margin:0; font-size:15px; line-height:1.55")}>
        <b style={{ fontWeight: 600 }}>{b}</b> <span style={{ color: "var(--text-2)" }}>{rest}</span>
      </p>
    </div>
  );
  const frame = "height:190px; border-radius:14px; border:1px solid var(--line); background:var(--bg-2); overflow:hidden";
  return (
    <section id="install" className="wrap section" aria-labelledby="install-title">
      <div className="intro" style={{ maxWidth: 660, marginBottom: 40 }}>
        <div className="eyebrow">Install</div>
        <h2 id="install-title" className="h2">
          One extra click on first launch.
        </h2>
        <p className="lead">Strata isn’t notarized by Apple, so macOS asks before opening it the first time. Here’s the whole process.</p>
      </div>
      <ol style={s("list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px")}>
        <li style={s("display:flex; flex-direction:column; gap:14px")}>
          <div aria-hidden style={s(`${frame}; display:flex; flex-direction:column`)}>
            <div style={s("height:28px; display:flex; align-items:center; gap:6px; padding:0 10px; border-bottom:1px solid var(--line)")}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <span key={c} style={s(`width:9px; height:9px; border-radius:50%; background:${c}`)} />
              ))}
              <span style={s("margin-left:8px; font-size:12px; color:var(--text-3)")}>Strata {version?.replace(/^v/, "") ?? ""}</span>
            </div>
            <div style={s("flex:1; display:flex; align-items:center; justify-content:center; gap:26px")}>
              <div style={s("display:flex; flex-direction:column; align-items:center; gap:6px")}>
                <div className="app-tile" style={s("width:62px; height:62px; border-radius:15px; box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 8px 18px rgba(0,0,0,.35)")}>
                  <StrataLogo size={44} />
                </div>
                <span style={{ fontSize: 12 }}>Strata</span>
              </div>
              <div style={s("font-size:22px; color:var(--text-3)")}>→</div>
              <div style={s("display:flex; flex-direction:column; align-items:center; gap:6px")}>
                <div style={s(`width:62px; height:62px; border-radius:15px; background:rgba(99,102,241,.18); border:1px solid rgba(99,102,241,.35); display:grid; place-items:center; font:600 11px ${mono}; color:var(--indigo-text)`)}>/Apps</div>
                <span style={{ fontSize: 12 }}>Applications</span>
              </div>
            </div>
          </div>
          {stepText(1, "Drag Strata into Applications.", "Open the .dmg and drop the app on the folder.")}
        </li>
        <li style={s("display:flex; flex-direction:column; gap:14px")}>
          <div aria-hidden style={s(`${frame}; display:flex`)}>
            <div style={s("width:96px; border-right:1px solid var(--line); padding:12px 8px; display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--text-2)")}>
              <span style={{ padding: "4px 6px" }}>General</span>
              <span style={{ padding: "4px 6px" }}>Appearance</span>
              <span style={s("padding:4px 6px; border-radius:5px; background:#3B82F6; color:#fff")}>Privacy &amp; Security</span>
              <span style={{ padding: "4px 6px" }}>Desktop</span>
            </div>
            <div style={s("flex:1; padding:14px; display:flex; flex-direction:column; gap:10px; min-width:0")}>
              <div style={s("font-size:12.5px; font-weight:600")}>Security</div>
              <div style={s("font-size:12px; line-height:1.45; color:var(--text-2)")}>“Strata” was blocked to protect your Mac.</div>
              <div style={s("align-self:flex-start; height:26px; padding:0 11px; border-radius:6px; background:var(--card); border:1px solid var(--edge); font-size:12px; display:flex; align-items:center; box-shadow:0 0 0 3px rgba(139,92,246,.35)")}>Open Anyway</div>
            </div>
          </div>
          {stepText(2, "Allow it once.", "macOS says it can’t verify the app. Open System Settings → Privacy & Security and click “Open Anyway”.")}
        </li>
        <li style={s("display:flex; flex-direction:column; gap:14px")}>
          <div aria-hidden className="dots" style={s(`${frame}; background-size:16px 16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px`)}>
            <StrataLogo size={64} />
            <div style={s("display:flex; align-items:center; gap:7px; height:28px; padding:0 11px; border-radius:99px; background:var(--glass-strong); border:1px solid var(--glass-border); font-size:12.5px")}>
              <span style={s("width:6px; height:6px; border-radius:50%; background:#3FB47C")} />
              Up to date{version ? ` · ${version}` : ""}
            </div>
          </div>
          {stepText(3, "Done.", "It opens normally from now on, and updates install themselves inside the app.")}
        </li>
      </ol>
      <details className="damaged" style={s("max-width:720px; margin:32px auto 0; border-radius:12px; border:1px solid var(--line); background:var(--card); overflow:hidden")}>
        <summary>
          <span style={{ flex: 1 }}>Seeing “Strata is damaged and can’t be opened”?</span>
        </summary>
        <div style={s("padding:0 16px 16px; display:flex; flex-direction:column; gap:10px")}>
          <p style={s("margin:0; font-size:14px; line-height:1.55; color:var(--text-2)")}>That’s macOS quarantining a download it can’t verify. Run this once in Terminal, then open Strata again:</p>
          <div style={s("display:flex; align-items:center; gap:10px; height:44px; padding:0 6px 0 14px; border-radius:9px; background:var(--code-bg); border:1px solid var(--line)")}>
            <code style={s(`flex:1; min-width:0; font:400 13px ${mono}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`)}>xattr -cr /Applications/Strata.app</code>
            <CopyButton text="xattr -cr /Applications/Strata.app" />
          </div>
        </div>
      </details>
    </section>
  );
}

/* ---------- Changelog (from GitHub releases) ---------- */

function Changelog({ releases }: { releases: Release[] }) {
  const shown = releases.slice(0, 3);
  return (
    <section id="changelog" className="band section" style={{ paddingInline: "var(--pad)" }} aria-labelledby="changelog-title">
      <div style={s("max-width:1120px; margin:0 auto")}>
        <div style={s("display:flex; align-items:flex-end; gap:16px; margin-bottom:28px; flex-wrap:wrap")}>
          <h2 id="changelog-title" className="h2" style={{ flex: 1 }}>
            Changelog
          </h2>
          <a href={RELEASES_URL} style={s("font-size:14.5px; color:var(--violet-text)")}>
            All releases →
          </a>
        </div>
        {shown.length === 0 ? (
          <p className="lead">
            The first release is on its way. Follow it on <a href={RELEASES_URL}>GitHub</a>.
          </p>
        ) : (
          <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {shown.map((r, i) => (
              <article key={r.tag} style={s("border-radius:14px; background:var(--card); border:1px solid var(--card-border); padding:20px; display:flex; flex-direction:column; gap:12px")}>
                <div style={s("display:flex; align-items:center; gap:10px")}>
                  <h3 style={s(`margin:0; font:600 15px ${mono}`)}>
                    <a href={r.url} style={{ color: "var(--text)" }}>
                      v{r.version}
                    </a>
                  </h3>
                  {i === 0 && <span style={s("font-size:12px; padding:2px 8px; border-radius:99px; background:rgba(139,92,246,.16); color:var(--violet-text)")}>Latest</span>}
                  <time dateTime={r.date} style={s("margin-left:auto; font-size:13px; color:var(--text-3)")}>
                    {formatDate(r.date, true)}
                  </time>
                </div>
                <ul style={s("list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px")}>
                  {(r.notes.length ? r.notes : [`Strata ${r.version}`]).map((n) => (
                    <li key={n} style={s("display:flex; gap:9px; font-size:14px; line-height:1.5; color:var(--text-2)")}>
                      <span style={{ color: "var(--text-3)" }}>–</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

function Faq() {
  return (
    <section id="faq" className="section" style={s("max-width:800px; margin:0 auto; padding-inline:var(--pad); box-sizing:border-box")} aria-labelledby="faq-title">
      <h2 id="faq-title" className="h2" style={{ textAlign: "center", marginBottom: 28 }}>
        Questions
      </h2>
      <div style={s("display:flex; flex-direction:column; border-top:1px solid var(--line)")}>
        {FAQS.map(([q, a], i) => (
          <details key={q} className="faq-item" open={i === 0} style={{ borderBottom: "1px solid var(--line)" }}>
            <summary>
              <h3 style={s("margin:0; flex:1; font-size:16px; font-weight:500")}>{q}</h3>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ href, verLine }: { href: string; verLine: string }) {
  return (
    <section style={{ padding: "0 var(--pad) var(--sec)" }} aria-labelledby="cta-title">
      <div className="dots" style={s("max-width:1120px; margin:0 auto; position:relative; border-radius:24px; overflow:hidden; border:1px solid var(--line); background-size:20px 20px")}>
        <div style={s("position:absolute; left:50%; top:50%; width:700px; height:400px; transform:translate(-50%,-50%); background:radial-gradient(closest-side, rgba(139,92,246,.18), rgba(20,184,166,.06) 60%, transparent); pointer-events:none")} />
        <div style={s("position:relative; margin:var(--cta-margin); border-radius:20px; background:var(--glass); backdrop-filter:blur(20px) saturate(1.4); -webkit-backdrop-filter:blur(20px) saturate(1.4); border:1px solid var(--glass-border); box-shadow:var(--shadow); padding:var(--cta-pad) 24px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:18px")}>
          <div className="app-tile" style={s("width:76px; height:76px; border-radius:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 16px 34px rgba(0,0,0,.4)")}>
            <StrataLogo size={54} />
          </div>
          <h2 id="cta-title" className="h2">
            Map your codebase in a minute.
          </h2>
          <p className="lead">Free and open source. Local. Works with the repos you already have.</p>
          <a href={href} className="btn-primary not-mobile" style={{ boxShadow: "none" }}>
            Download for macOS
          </a>
          <span className="only-mobile">
            <ShareLink label="Send the link to your Mac" primary />
          </span>
          <div className="verline">{verLine}</div>
        </div>
      </div>
    </section>
  );
}
