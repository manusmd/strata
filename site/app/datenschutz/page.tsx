import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LegalPage } from "@/components/LegalPage";
import { Nav } from "@/components/Nav";
import { PRIVACY } from "@/lib/legal";
import { downloadInfo, getReleases } from "@/lib/releases";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: PRIVACY.de.title,
  description: PRIVACY.de.intro,
  alternates: { canonical: `${SITE_URL}/datenschutz/`, languages: { de: `${SITE_URL}/datenschutz/`, en: `${SITE_URL}/privacy/` } },
};

export default async function Page() {
  const dl = downloadInfo((await getReleases())[0]);
  return (
    <>
      <Nav downloadHref={dl.href} />
      <LegalPage content={PRIVACY.de} locale="de" other={{ href: "/privacy/", label: "English version" }} />
      <Footer />
    </>
  );
}
