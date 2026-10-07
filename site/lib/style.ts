import type { CSSProperties } from "react";

/**
 * Inline styles written as CSS text: `s("display:flex; gap:8px")`.
 * Keeps the many one-off, absolutely positioned illustration styles readable and
 * close to the original design; layout and responsive rules live in globals.css.
 */
export function s(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop) continue;
    const key = prop.startsWith("--") ? prop : prop.replace(/^-webkit-/, "Webkit-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = decl.slice(i + 1).trim();
  }
  return out as CSSProperties;
}
