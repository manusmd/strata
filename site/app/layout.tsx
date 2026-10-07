import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import { DESCRIPTION, NAME, REPO_URL, SITE_URL, TAGLINE } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], weight: "500", variable: "--font-outfit", display: "swap" });

const title = `${NAME} — a visual atlas for your codebase`;

export const metadata: Metadata = {
  // Origin only: file-based metadata (the OG image) already carries the base path.
  metadataBase: new URL(new URL(SITE_URL).origin),
  title: { default: title, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  applicationName: NAME,
  authors: [{ name: "Manuel Schmid", url: "https://github.com/manusmd" }],
  keywords: [
    "codebase visualization", "architecture diagram", "code map", "dependency graph", "ER diagram",
    "monorepo", "macOS app", "developer tools", "Claude Code", "Prisma", "Drizzle", "TypeScript",
  ],
  category: "developer tools",
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: { type: "website", url: `${SITE_URL}/`, siteName: NAME, title, description: `${TAGLINE} ${DESCRIPTION}` },
  twitter: { card: "summary_large_image", title, description: TAGLINE },
  robots: { index: true, follow: true },
  other: { "github-repo": REPO_URL },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1013" },
    { media: "(prefers-color-scheme: light)", color: "#FBFBFA" },
  ],
};

// Before first paint: the theme the visitor picked, else dark (the app's default look).
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem("strata-site-theme")||"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${mono.variable} ${outfit.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
