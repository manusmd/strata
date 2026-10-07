import { RELEASES_URL, REPO } from "./site";

export type Release = {
  version: string; // "0.1.0"
  tag: string; // "v0.1.0"
  date: string; // ISO
  url: string; // release page
  dmgUrl: string | null;
  notes: string[];
};

/** Bullet points of the release notes: the "What's new" section if there is one, otherwise every bullet. */
export function releaseNotes(body: string): string[] {
  const clean = (l: string) =>
    l
      .replace(/^\s*[-*]\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
  const lines = body.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^#+\s*what.?s new/i.test(l));
  const section = start >= 0 ? lines.slice(start + 1, lines.findIndex((l, i) => i > start && /^#+\s/.test(l)) >>> 0) : lines;
  return section.filter((l) => /^\s*[-*]\s+/.test(l)).map(clean).filter((l) => l && !/^\(.*\)$/.test(l)).slice(0, 5);
}

/** Published releases, newest first, read at build time. Empty when there are none yet or GitHub is unreachable. */
export async function getReleases(): Promise<Release[]> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, { headers, cache: "force-cache" });
    if (!res.ok) return [];
    const list = (await res.json()) as any[];
    return list
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({
        version: String(r.tag_name).replace(/^v/, ""),
        tag: r.tag_name,
        date: r.published_at ?? r.created_at,
        url: r.html_url,
        dmgUrl: (r.assets ?? []).find((a: any) => String(a.name).endsWith(".dmg"))?.browser_download_url ?? null,
        notes: releaseNotes(r.body ?? ""),
      }));
  } catch {
    return [];
  }
}

export function formatDate(iso: string, long = false) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", long ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}

/** What the download buttons need, with sensible fallbacks before the first release. */
export function downloadInfo(latest: Release | undefined) {
  return {
    href: latest?.dmgUrl ?? `${RELEASES_URL}/latest`,
    version: latest ? `v${latest.version}` : null,
    date: latest ? formatDate(latest.date) : null,
  };
}
