/** Positions of matched characters, for highlighting. */
export type Match = { score: number; indices: number[] };

const BOUNDARY = /[\s/._\-:@]/;

/**
 * Scores `query` against `text`: every query character must appear in order.
 * Contiguous runs, word starts (after / . _ - or a camelCase hump) and
 * substring hits rank higher; long texts rank slightly lower.
 */
export function fuzzy(query: string, text: string): Match | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // A plain substring is the strongest signal; prefer one that starts a word.
  let sub = -1;
  for (let from = 0; ; ) {
    const i = t.indexOf(q, from);
    if (i === -1) break;
    if (sub === -1 || i === 0 || BOUNDARY.test(text[i - 1]) || (text[i] !== t[i] && text[i - 1] === t[i - 1])) {
      sub = i;
      if (i === 0 || BOUNDARY.test(text[i - 1])) break;
    }
    from = i + 1;
  }
  if (sub !== -1) {
    const start = sub === 0 || BOUNDARY.test(text[sub - 1]);
    return { score: 100 + (start ? 40 : 0) + (sub === 0 ? 20 : 0) + (q.length === t.length ? 50 : 0) - t.length * 0.2, indices: Array.from({ length: q.length }, (_, k) => sub + k) };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const pos = t.indexOf(ch, from);
    if (pos === -1) return null;
    const wordStart = pos === 0 || BOUNDARY.test(text[pos - 1]) || (text[pos] !== t[pos] && text[pos - 1] === t[pos - 1]);
    score += pos === last + 1 ? 6 : wordStart ? 8 : 1;
    indices.push(pos);
    last = pos;
    from = pos + 1;
  }
  return { score: score - t.length * 0.15, indices };
}

/** Matches every word of the query against the title, falling back to the subtitle. */
export function scoreItem(query: string, title: string, subtitle: string): { score: number; titleIdx: number[] } | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, titleIdx: [] };
  let total = 0;
  const titleIdx: number[] = [];
  for (const w of words) {
    const inTitle = fuzzy(w, title);
    const inSub = w.includes("/") || !inTitle ? fuzzy(w, subtitle) : null;
    if (inTitle && (!inSub || inTitle.score >= inSub.score * 0.7)) {
      total += inTitle.score;
      titleIdx.push(...inTitle.indices);
    } else if (inSub) total += inSub.score * 0.6;
    else return null;
  }
  return { score: total, titleIdx };
}
