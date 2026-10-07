import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { LegalPage } from "@/components/LegalPage";
import { Nav } from "@/components/Nav";
import { IMPRINT } from "@/lib/legal";
import { downloadInfo, getReleases } from "@/lib/releases";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: IMPRINT.de.title,
  description: IMPRINT.de.intro,
  alternates: { canonical: `${SITE_URL}/impressum/`, languages: { de: `${SITE_URL}/impressum/`, en: `${SITE_URL}/imprint/` } },
};

export default async function Page() {
  const dl = downloadInfo((await getReleases())[0]);
  return (
    <>
      <Nav downloadHref={dl.href} />
      <LegalPage content={IMPRINT.de} locale="de" other={{ href: "/imprint/", label: "English version" }} />
      <Footer />
    </>
  );
}
