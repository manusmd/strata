/** Text measurement for sizing map cards before layout, so their content always fits. */

export const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

let ctx: CanvasRenderingContext2D | null = null;
const context = () => (ctx ??= document.createElement("canvas").getContext("2d")!);

export function textWidth(text: string, font: string) {
  const c = context();
  c.font = font;
  return c.measureText(text).width;
}

/** Lines `text` wraps to at `width` (words, breaking overlong ones like `overflow-wrap: anywhere`), at most `max`. */
export function lineCount(text: string, font: string, width: number, max: number) {
  const c = context();
  c.font = font;
  const space = c.measureText(" ").width;
  // A little slack: canvas and CSS round differently.
  const w = Math.max(20, width - 3);
  let lines = 1;
  let cur = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const ww = c.measureText(word).width;
    if (cur > 0 && cur + space + ww <= w) {
      cur += space + ww;
      continue;
    }
    if (cur > 0) lines++;
    const extra = Math.max(0, Math.ceil(ww / w) - 1);
    lines += extra;
    cur = ww - extra * w;
  }
  return Math.min(lines, max);
}

/** Webfonts must be in before measuring, or the widths are the fallback font's. */
export function fontsReady(): Promise<unknown> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return Promise.all([document.fonts.load(`600 13.5px ${MONO}`), document.fonts.load(`500 11px ${MONO}`)]).catch(() => undefined);
}
