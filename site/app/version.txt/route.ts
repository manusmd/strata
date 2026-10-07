import { getReleases } from "@/lib/releases";

export const dynamic = "force-static";

/** The release this build shows; the Site workflow compares it with GitHub to decide whether to rebuild. */
export async function GET() {
  const latest = (await getReleases())[0];
  return new Response(`${latest?.tag ?? "none"}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
