"use client";

import { useEffect, useRef, useState } from "react";
import { s } from "@/lib/style";
import { StrataLogo } from "./StrataLogo";

const V = "#8B5CF6", I = "#6366F1";
const LEVELS = ["System", "Module", "File", "Symbol"];
const CAPS = ["System · 3 domains, 5 services", "Module · services, data and external APIs", "File · acme/api, 4 folders", "Symbol · createCheckoutSession()"];
const FILES: [string, number, number, number, boolean?][] = [
  ["checkout.ts", 86, 76, 96], ["orders.ts", 142, 76, 140], ["webhooks.ts", 64, 76, 184],
  ["checkout.service.ts", 214, 362, 96, true], ["pricing.ts", 96, 362, 140], ["payment.client.ts", 58, 362, 184],
  ["orders.repo.ts", 120, 76, 330], ["schema.prisma", 188, 76, 374], ["jobs.ts", 88, 362, 330], ["redis.ts", 22, 362, 374],
];
const REPOS: [string, string, string][] = [["web-app", "#7DD3FC", "2m"], ["api", "#A5B4FC", "2m"], ["worker", "#BEF264", "2m"], ["payment-service", "#F9A8D4", "1h"]];

const mono = "var(--font-mono), monospace";
const chip = s(`font:500 11.5px ${mono}; padding:3px 8px; border-radius:6px; background:var(--chip); color:var(--text-2)`);
const edgeLabel = (color: string) => s(`position:absolute; font:500 11px ${mono}; padding:3px 7px; border-radius:6px; background:var(--glass-strong); border:1px solid var(--glass-border); color:${color}`);
const flow = (d: string, color: string) => (
  <>
    <path d={d} style={s(`fill:none; stroke:${color === "#5EEAD4" ? "#14B8A6" : color === "#A5B4FC" ? I : V}; stroke-width:1.5`)} />
    <path d={d} style={s(`fill:none; stroke:${color}; stroke-width:2.4; stroke-linecap:round; stroke-dasharray:0.1 10; animation:stFlow .9s linear infinite`)} />
  </>
);

function Card({ x, y, w, h, mono: m, tint, tone, name, kind, detail, hl, detailMono }: { x: number; y: number; w: number; h: number; mono: string; tint: string; tone: string; name: string; kind: string; detail: string; hl?: boolean; detailMono?: boolean }) {
  return (
    <div style={s(`position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; box-sizing:border-box; border-radius:12px; background:var(--card); border:1px solid ${hl ? V : "var(--card-border)"}; ${hl ? "box-shadow:0 0 0 5px rgba(139,92,246,.15), 0 12px 40px rgba(139,92,246,.25);" : ""} padding:12px; display:flex; flex-direction:column; gap:6px`)}>
      <div style={s("display:flex; align-items:center; gap:8px")}>
        <span style={s(`width:24px; height:24px; border-radius:7px; background:${tint}; color:${tone}; display:grid; place-items:center; font:600 9.5px ${mono}`)}>{m}</span>
        <span style={s("font-weight:600; font-size:13.5px")}>{name}</span>
        <span style={s("margin-left:auto; font-size:11px; padding:2px 6px; border-radius:5px; background:var(--chip); color:var(--text-2)")}>{kind}</span>
      </div>
      <div style={detailMono ? s(`font:400 11.5px ${mono}; color:var(--text-2)`) : s("font-size:12px; color:var(--text-2); line-height:1.4")}>{detail}</div>
    </div>
  );
}

/** The app window from the design: zooms from system → module → file → symbol on a loop. */
export function HeroMock() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [stage, setStage] = useState(0);
  const pauseUntil = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1120));
    ro.observe(el);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) setStage(1);
    const iv = setInterval(() => {
      if (reduce || Date.now() < pauseUntil.current || document.hidden) return;
      setStage((st) => (st + 1) % 4);
    }, 2800);
    return () => {
      ro.disconnect();
      clearInterval(iv);
    };
  }, []);

  const z = (i: number) => ({ opacity: i === stage ? 1 : 0, transform: `scale(${i === stage ? 1 : i < stage ? 1.7 : 0.72})`, transition: "opacity .7s ease, transform 1s cubic-bezier(.2,.7,.2,1)" });
  const go = (i: number) => {
    pauseUntil.current = Date.now() + 9000;
    setStage(i);
  };

  return (
    <div ref={box} style={{ marginTop: 56, width: "100%", maxWidth: 1120, aspectRatio: "1120 / 680", position: "relative" }}>
      <div
        style={{ position: "absolute", left: 0, top: 0, width: 1120, height: 680, transform: `scale(${scale ?? 1})`, transformOrigin: "0 0", textAlign: "left", opacity: scale ? 1 : 0, transition: "opacity .4s" }}
        aria-label="Animated preview of the Strata app zooming from the system level down to a single function"
        role="img"
      >
        <div style={s("position:absolute; inset:0; border-radius:14px; overflow:hidden; background:var(--bg); border:1px solid var(--glass-border); box-shadow:0 40px 100px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.3); font-size:13px")}>
          <div className="dots" style={s("position:absolute; left:200px; right:0; top:0; bottom:0; overflow:hidden")}>
            <div style={s("position:absolute; left:0; right:0; top:48px; bottom:0")}>
              {/* System */}
              <div style={{ ...s("position:absolute; inset:0; transform-origin:630px 145px"), ...z(0) }}>
                <svg width="920" height="632" style={s("position:absolute; inset:0; overflow:visible")}>
                  <path d="M360,145 C390,145 390,145 420,145" style={s("fill:none; stroke:#8B5CF6; stroke-width:1.5")} />
                  <path d="M630,230 C630,260 450,260 450,290" style={s("fill:none; stroke:#14B8A6; stroke-width:1.5")} />
                </svg>
                {[
                  [60, 60, 300, 170, V, "Clients", "One Next.js app: storefront, checkout and the account dashboard.", ["web-app"], false],
                  [420, 60, 420, 170, V, "Core services", "api is the hub. Slow work runs in worker, payments go through Stripe.", ["api", "worker"], true],
                  [60, 290, 780, 150, "#14B8A6", "Data & external", "One PostgreSQL with four tables. Stripe for payments.", ["PostgreSQL", "Stripe"], false],
                ].map(([x, y, w, h, c, title, text, chips, hl]) => (
                  <div key={title as string} style={s(`position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; box-sizing:border-box; border-radius:16px; background:var(--card); border:1px solid ${hl ? V : "var(--card-border)"}; ${hl ? "box-shadow:0 0 0 5px rgba(139,92,246,.14);" : ""} padding:20px; display:flex; flex-direction:column; gap:8px`)}>
                    <div style={s("display:flex; align-items:center; gap:9px")}>
                      <span style={s(`width:10px; height:10px; border-radius:3px; background:${c}`)} />
                      <span style={s("font-size:18px; font-weight:600; letter-spacing:-.02em")}>{title as string}</span>
                    </div>
                    <div style={s("font-size:13px; line-height:1.5; color:var(--text-2)")}>{text as string}</div>
                    <div style={s("margin-top:auto; display:flex; gap:6px")}>
                      {(chips as string[]).map((c) => (
                        <span key={c} style={chip}>{c}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Module */}
              <div style={{ ...s("position:absolute; inset:0; transform-origin:460px 208px"), ...z(1) }}>
                <svg width="920" height="632" style={s("position:absolute; inset:0; overflow:visible")}>
                  {flow("M260,108 C310,108 310,198 360,198", "#C4B5FD")}
                  <path d="M560,196 C610,196 610,108 660,108" style={s("fill:none; stroke:#8B5CF6; stroke-width:1.5")} />
                  {flow("M460,246 C460,320 460,330 460,400", "#C4B5FD")}
                  {flow("M560,226 C610,226 610,330 660,330", "#5EEAD4")}
                  <path d="M560,438 C610,438 610,350 660,350" style={s("fill:none; stroke:#14B8A6; stroke-width:1.6; stroke-dasharray:5 4")} />
                  {[[360, 198, V], [660, 108, V], [460, 400, V], [660, 330, "#14B8A6"], [660, 350, "#14B8A6"]].map(([cx, cy, c]) => (
                    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} style={{ fill: c as string }} />
                  ))}
                </svg>
                <div style={{ ...edgeLabel("var(--violet-text)"), left: 282, top: 140 }}>GraphQL</div>
                <div style={{ ...edgeLabel("var(--violet-text)"), left: 582, top: 138 }}>charges</div>
                <div style={{ ...edgeLabel("var(--violet-text)"), left: 428, top: 312 }}>enqueue</div>
                <div style={{ ...edgeLabel("var(--teal-text)"), left: 568, top: 266 }}>reads · writes</div>
                <div style={{ ...edgeLabel("var(--teal-text)"), left: 590, top: 398 }}>writes</div>
                <Card x={60} y={70} w={200} h={76} mono="WA" tint="rgba(139,92,246,.16)" tone="#A78BFA" name="web-app" kind="App" detail="Next.js storefront" />
                <Card x={360} y={160} w={200} h={86} mono="AP" tint="rgba(139,92,246,.16)" tone="#A78BFA" name="api" kind="Service" detail="GraphQL + REST gateway. Owns users and orders." hl />
                <Card x={360} y={400} w={200} h={76} mono="WK" tint="rgba(139,92,246,.16)" tone="#A78BFA" name="worker" kind="Worker" detail="Receipts, invoices, webhooks" />
                <Card x={660} y={302} w={200} h={76} mono="PG" tint="rgba(20,184,166,.16)" tone="#2DD4BF" name="PostgreSQL" kind="Database" detail="users · orders · invoices" detailMono />
                <Card x={660} y={70} w={200} h={76} mono="ST" tint="rgba(155,154,151,.16)" tone="#B3B2AE" name="Stripe" kind="External" detail="Payments and webhooks" />
              </div>

              {/* File */}
              <div style={{ ...s("position:absolute; inset:0; transform-origin:490px 110px"), ...z(2) }}>
                <div style={s("position:absolute; left:40px; top:24px; width:620px; height:450px; box-sizing:border-box; border-radius:18px; border:1px dashed var(--edge)")} />
                <div style={s(`position:absolute; left:56px; top:32px; font:600 12px ${mono}; color:var(--text-2); display:flex; align-items:center; gap:7px`)}>
                  <span style={s("width:7px; height:7px; border-radius:50%; background:#A5B4FC")} />
                  acme/api <span style={s("font-weight:400; color:var(--text-3)")}>· 128 files</span>
                </div>
                <svg width="920" height="632" style={s("position:absolute; inset:0; overflow:visible")}>
                  {flow("M318,96 C340,96 340,96 362,96", "#A5B4FC")}
                  <path d="M606,96 C640,96 640,140 606,140" style={s("fill:none; stroke:#6366F1; stroke-width:1.3")} />
                  <path d="M606,96 C650,96 650,184 606,184" style={s("fill:none; stroke:#6366F1; stroke-width:1.3")} />
                  <path d="M362,96 C330,96 330,330 318,330" style={s("fill:none; stroke:#6366F1; stroke-width:1.3")} />
                  <path d="M76,330 C48,330 48,374 76,374" style={s("fill:none; stroke:var(--edge); stroke-width:1.2; stroke-dasharray:1.5 4")} />
                </svg>
                {[
                  [64, 60, 266, 190, "src/routes", false], [350, 60, 268, 190, "src/services", true],
                  [64, 290, 266, 150, "src/db", false], [350, 290, 268, 150, "src/queue", false],
                ].map(([x, y, w, h, name, hl]) => (
                  <div key={name as string} style={s(`position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; box-sizing:border-box; border-radius:14px; background:rgba(127,127,127,.03); border:1px solid ${hl ? "rgba(99,102,241,.45)" : "var(--line)"}; padding:12px`)}>
                    <div style={s(`font:600 12px ${mono}`)}>{name as string}</div>
                  </div>
                ))}
                {FILES.map(([name, loc, x, y, hl]) => (
                  <div key={name} style={s(`position:absolute; left:${x}px; top:${y}px; width:242px; height:34px; box-sizing:border-box; border-radius:9px; background:var(--card); border:1px solid ${hl ? I : "var(--card-border)"}; box-shadow:${hl ? "0 0 0 4px rgba(99,102,241,.16)" : "none"}; display:flex; align-items:center; gap:8px; padding:0 10px`)}>
                    <span style={s(`width:20px; height:17px; border-radius:5px; background:rgba(99,102,241,.14); color:#818CF8; display:grid; place-items:center; font:600 8.5px ${mono}`)}>{name.endsWith(".prisma") ? "PR" : "TS"}</span>
                    <span style={s(`font:500 12px ${mono}`)}>{name}</span>
                    <span style={s("margin-left:auto; font-size:11px; color:var(--text-3)")}>{loc} loc</span>
                  </div>
                ))}
                {[
                  [60, "#7DD3FC", "acme/web-app", "212 files · collapsed"],
                  [140, "#BEF264", "acme/worker", "22 files · collapsed"],
                ].map(([y, c, name, sub]) => (
                  <div key={name} style={s(`position:absolute; left:690px; top:${y}px; width:190px; box-sizing:border-box; border-radius:12px; background:var(--card); border:1px solid var(--card-border); padding:12px; display:flex; flex-direction:column; gap:6px`)}>
                    <div style={s("display:flex; align-items:center; gap:7px")}>
                      <span style={s(`width:7px; height:7px; border-radius:50%; background:${c}`)} />
                      <span style={s(`font:600 12px ${mono}`)}>{name}</span>
                    </div>
                    <div style={s("font-size:12px; color:var(--text-2)")}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Symbol */}
              <div style={{ ...s("position:absolute; inset:0; transform-origin:460px 260px"), ...z(3) }}>
                {[
                  [60, 70, 200, "routes/checkout.ts"], [60, 300, 200, "db/orders.repo.ts"],
                  [680, 120, 180, "pricing.ts"], [680, 300, 180, "payment.client.ts"],
                ].map(([x, y, w, name]) => (
                  <div key={name} style={s(`position:absolute; left:${x}px; top:${y}px; width:${w}px; height:40px; box-sizing:border-box; border-radius:10px; background:var(--card); border:1px solid var(--card-border); opacity:.5; display:flex; align-items:center; padding:0 12px; font:500 12px ${mono}`)}>
                    {name}
                  </div>
                ))}
                <svg width="920" height="632" style={s("position:absolute; inset:0; overflow:visible")}>
                  <path d="M260,90 C290,90 290,130 300,130" style={s("fill:none; stroke:#6366F1; stroke-width:1.4")} />
                  <path d="M620,200 C650,200 650,140 680,140" style={s("fill:none; stroke:#6366F1; stroke-width:1.4")} />
                  <path d="M620,300 C650,300 650,320 680,320" style={s("fill:none; stroke:#6366F1; stroke-width:1.4")} />
                  <path d="M300,300 C280,300 280,320 260,320" style={s("fill:none; stroke:#14B8A6; stroke-width:1.4; stroke-dasharray:5 4")} />
                </svg>
                <div style={s("position:absolute; left:300px; top:50px; width:320px; box-sizing:border-box; border-radius:14px; background:var(--card); border:1px solid #6366F1; box-shadow:0 0 0 5px rgba(99,102,241,.15), 0 20px 50px rgba(0,0,0,.35); padding:16px; display:flex; flex-direction:column; gap:12px")}>
                  <div style={s("display:flex; align-items:center; gap:9px")}>
                    <span style={s(`width:24px; height:24px; border-radius:7px; background:rgba(99,102,241,.16); color:#A5B4FC; display:grid; place-items:center; font:600 12px ${mono}`)}>ƒ</span>
                    <span style={s(`font:600 14px ${mono}`)}>createCheckoutSession</span>
                  </div>
                  <div style={s(`font:400 11.5px ${mono}; color:var(--text-3); margin-top:-6px`)}>services/checkout.service.ts:42</div>
                  <div style={s("font-size:13px; line-height:1.5; color:var(--text-2)")}>Validates the cart, prices it, writes a pending order and asks Stripe for a session.</div>
                  <div style={s(`border-radius:9px; background:var(--code-bg); border:1px solid var(--line); padding:10px 12px; font:400 12px/1.65 ${mono}; color:var(--text-2); white-space:pre`)}>
                    <span style={{ color: "#A5B4FC" }}>export async function</span> createCheckoutSession({"\n"}
                    {"  "}userId: <span style={{ color: "#2DD4BF" }}>string</span>, cart: <span style={{ color: "#2DD4BF" }}>Cart</span>) {"{"}
                    {"\n  "}
                    <span style={{ color: "#A5B4FC" }}>const</span> quote = <span style={{ color: "var(--text)" }}>await pricing.quote</span>(cart)
                    {"\n  "}
                    <span style={{ color: "#A5B4FC" }}>const</span> order = <span style={{ color: "var(--text)" }}>await orders.create</span>(…)
                    {"\n  "}
                    <span style={{ color: "#A5B4FC" }}>return</span> <span style={{ color: "var(--text)" }}>stripe.checkout</span>(order)
                    {"\n}"}
                  </div>
                  <div style={s("display:flex; gap:6px; flex-wrap:wrap")}>
                    <span style={s(`font:500 11.5px ${mono}; padding:3px 8px; border-radius:6px; background:rgba(20,184,166,.12); color:var(--teal-text)`)}>orders · writes</span>
                    <span style={s(`font:500 11.5px ${mono}; padding:3px 8px; border-radius:6px; background:rgba(139,92,246,.12); color:var(--violet-text)`)}>called by POST /checkout</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div style={s("position:absolute; left:0; right:0; top:0; height:48px; box-sizing:border-box; background:var(--glass); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border-bottom:1px solid var(--line); display:flex; align-items:center; padding:0 14px; gap:10px")}>
              <div style={s("display:flex; align-items:center; gap:2px")}>
                {LEVELS.map((l, i) => (
                  <div key={l} style={s("display:flex; align-items:center; gap:2px")}>
                    {i > 0 && <span style={s("color:var(--text-3); font-size:12px")}>·</span>}
                    <button
                      tabIndex={-1}
                      onClick={() => go(i)}
                      style={s(`height:26px; padding:0 7px; border-radius:6px; border:none; background:${i === stage ? "var(--chip)" : "transparent"}; color:${i === stage ? "var(--text)" : "var(--text-3)"}; font-size:12px; font-weight:${i === stage ? 600 : 400}; cursor:pointer; display:flex; align-items:center; gap:5px; transition:background .3s, color .3s`)}
                    >
                      <span style={s(`width:5px; height:5px; border-radius:50%; background:${i === stage ? (i >= 2 ? I : V) : "transparent"}; transition:background .3s`)} />
                      {l}
                    </button>
                  </div>
                ))}
              </div>
              <div style={s("flex:1; display:flex; justify-content:center")}>
                <div style={s("display:flex; gap:2px; padding:3px; border-radius:9px; background:var(--chip)")}>
                  {([["Code", I, stage >= 2], ["Architecture", V, stage < 2], ["Database", "#14B8A6", false]] as const).map(([label, color, on]) => (
                    <div key={label} style={s(`height:26px; padding:0 11px; border-radius:6px; background:${on ? "var(--card)" : "transparent"}; color:${on ? "var(--text)" : "var(--text-3)"}; font-size:12px; font-weight:500; display:flex; align-items:center; gap:6px; transition:background .3s`)}>
                      <span style={s(`width:7px; height:7px; border-radius:2px; background:${color}`)} />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
              <div style={s("height:28px; width:150px; box-sizing:border-box; padding:0 8px 0 10px; border-radius:7px; border:1px solid var(--line); background:var(--chip); color:var(--text-3); font-size:12px; display:flex; align-items:center")}>
                <span style={{ flex: 1 }}>Search…</span>
                <span style={s("font-size:11px; padding:1px 5px; border-radius:4px; border:1px solid var(--line)")}>⌘K</span>
              </div>
            </div>
            <div style={s("position:absolute; left:14px; bottom:14px; height:30px; display:flex; align-items:center; gap:8px; padding:0 12px; border-radius:9px; background:var(--glass-strong); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); border:1px solid var(--glass-border); font-size:12px; color:var(--text-2)")}>
              <span style={s(`width:6px; height:6px; border-radius:50%; background:${stage >= 2 ? I : V}`)} />
              {CAPS[stage]}
            </div>
          </div>

          {/* Sidebar */}
          <div style={s("position:absolute; left:0; top:0; bottom:0; width:200px; box-sizing:border-box; background:var(--bg-2); border-right:1px solid var(--line); padding:14px 10px; display:flex; flex-direction:column; gap:16px")}>
            <div style={s("display:flex; gap:7px; padding:0 6px")}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <span key={c} style={s(`width:11px; height:11px; border-radius:50%; background:${c}`)} />
              ))}
            </div>
            <div style={s("display:flex; align-items:center; gap:8px; padding:4px 6px")}>
              <StrataLogo size={22} />
              <div>
                <div style={s("font-size:13px; font-weight:600")}>Acme Cloud</div>
                <div style={s("font-size:11px; color:var(--text-3)")}>4 repos · scanned 2m ago</div>
              </div>
            </div>
            <div style={s("display:flex; flex-direction:column; gap:2px")}>
              <div style={s("font-size:11px; font-weight:600; color:var(--text-3); padding:0 6px 4px")}>Repositories</div>
              {REPOS.map(([name, color, t], i) => (
                <div key={name} style={s(`display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; border-radius:6px; background:${i === 1 && stage >= 2 ? "var(--chip)" : "transparent"}`)}>
                  <span style={s(`width:6px; height:6px; border-radius:50%; background:${color}`)} />
                  <span style={s(`font:400 12px ${mono}; flex:1`)}>{name}</span>
                  <span style={s("font-size:11px; color:var(--text-3)")}>{t}</span>
                </div>
              ))}
            </div>
            <div style={s("display:flex; flex-direction:column; gap:2px")}>
              <div style={s("font-size:11px; font-weight:600; color:var(--text-3); padding:0 6px 4px")}>Chats</div>
              {["How does checkout work?", "Move billing out of api"].map((c) => (
                <div key={c} style={s("display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis")}>
                  <span style={s("color:#8B5CF6; font-size:10px")}>✦</span>
                  {c}
                </div>
              ))}
            </div>
            <div style={s("margin-top:auto; border-radius:9px; border:1px dashed rgba(245,158,11,.5); background:rgba(245,158,11,.07); padding:9px 10px; font-size:12px; color:var(--warn-text); font-weight:500")}>1 missing dependency</div>
          </div>
        </div>
      </div>
    </div>
  );
}
