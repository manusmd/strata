/** Imprint and privacy policy, adapted from the afterhive legal pages. German is the binding version. */

export type LegalLocale = "de" | "en";
export type LegalBlock = { h: string; p: string; list?: string[] };
export type LegalContent = { title: string; updated: string; intro: string; blocks: LegalBlock[] };

export const OPERATOR = {
  name: "Manuel Schmid",
  street: "Hardtstr. 27",
  city: "78467 Konstanz",
  country: { de: "Deutschland", en: "Germany" },
  email: "info@afterhive.de",
  phone: "+49 172 3758429",
} as const;

/** Bump whenever either text changes. */
const UPDATED: Record<LegalLocale, string> = { de: "Stand: Oktober 2026", en: "Last updated: October 2026" };

const address = (l: LegalLocale) => [OPERATOR.name, OPERATOR.street, OPERATOR.city, OPERATOR.country[l]].join("\n");

export const IMPRINT: Record<LegalLocale, LegalContent> = {
  de: {
    title: "Impressum",
    updated: UPDATED.de,
    intro: "Strata ist ein privates, nicht-kommerzielles Open-Source-Projekt. Die App und diese Website werden kostenlos bereitgestellt.",
    blocks: [
      { h: "Angaben gemäß § 5 DDG", p: address("de") },
      { h: "Kontakt", p: `E-Mail: ${OPERATOR.email}\nTelefon: ${OPERATOR.phone}` },
      { h: "Verantwortlich für den Inhalt (§ 18 Abs. 2 MStV)", p: `${OPERATOR.name}, Anschrift wie oben.` },
      { h: "Umsatzsteuer", p: "Als privates Projekt ohne unternehmerische Tätigkeit wird keine Umsatzsteuer-Identifikationsnummer geführt." },
      { h: "Verbraucherstreitbeilegung", p: "Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen." },
      {
        h: "Haftung für Inhalte",
        p: "Die Inhalte dieser Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen. Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich.",
      },
      {
        h: "Haftung für Links",
        p: "Unser Angebot enthält Links zu externen Websites Dritter (insbesondere GitHub), auf deren Inhalte wir keinen Einfluss haben. Für diese fremden Inhalte übernehmen wir keine Gewähr. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich.",
      },
      {
        h: "Urheberrecht und Lizenz",
        p: "Die Inhalte dieser Seiten unterliegen dem deutschen Urheberrecht. Der Quellcode von Strata ist unter der MIT-Lizenz veröffentlicht und darf im Rahmen dieser Lizenz genutzt, verändert und weitergegeben werden.",
      },
    ],
  },
  en: {
    title: "Legal notice",
    updated: UPDATED.en,
    intro: "Strata is a private, non-commercial open-source project. The app and this website are provided free of charge. The legally binding version of this notice is the German one.",
    blocks: [
      { h: "Information pursuant to § 5 DDG", p: address("en") },
      { h: "Contact", p: `Email: ${OPERATOR.email}\nPhone: ${OPERATOR.phone}` },
      { h: "Responsible for content (§ 18 (2) MStV)", p: `${OPERATOR.name}, address as above.` },
      { h: "VAT", p: "As a private project with no commercial activity, no VAT identification number is held." },
      { h: "Consumer dispute resolution", p: "We are neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board." },
      {
        h: "Liability for content",
        p: "The contents of these pages were created with the greatest care. However, we cannot guarantee that the content is accurate, complete or up to date. As a service provider, we are responsible for our own content on these pages in accordance with general law (§ 7 (1) DDG).",
      },
      {
        h: "Liability for links",
        p: "Our site contains links to external third-party websites (in particular GitHub) over whose content we have no control. We therefore accept no liability for such external content. The respective provider or operator of the linked pages is always responsible for their content.",
      },
      {
        h: "Copyright and license",
        p: "The content of these pages is subject to German copyright law. The source code of Strata is published under the MIT license and may be used, modified and distributed under its terms.",
      },
    ],
  },
};

const RIGHTS = {
  de: [
    "Auskunft über die zu dir gespeicherten Daten (Art. 15)",
    "Berichtigung unrichtiger Daten (Art. 16)",
    "Löschung deiner Daten (Art. 17)",
    "Einschränkung der Verarbeitung (Art. 18)",
    "Datenübertragbarkeit (Art. 20)",
    "Widerspruch gegen die Verarbeitung (Art. 21)",
  ],
  en: [
    "Access to the data stored about you (Art. 15)",
    "Rectification of inaccurate data (Art. 16)",
    "Erasure of your data (Art. 17)",
    "Restriction of processing (Art. 18)",
    "Data portability (Art. 20)",
    "Objection to processing (Art. 21)",
  ],
};

export const PRIVACY: Record<LegalLocale, LegalContent> = {
  de: {
    title: "Datenschutzerklärung",
    updated: UPDATED.de,
    intro:
      "Nachfolgend informieren wir dich gemäß Art. 13 DSGVO darüber, welche Daten beim Besuch dieser Website und bei der Nutzung der App Strata verarbeitet werden. Kurz gesagt: Wir selbst erheben und speichern keine personenbezogenen Daten. Es gibt keine Konten, keine Cookies, kein Tracking und keine Analyse.",
    blocks: [
      { h: "1. Verantwortlicher", p: `Verantwortlich im Sinne der DSGVO ist:\n${address("de")}\nE-Mail: ${OPERATOR.email}` },
      {
        h: "2. Hosting über GitHub Pages",
        p: "Diese Website wird über GitHub Pages bereitgestellt, einen Dienst der GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA. Beim Aufruf der Seiten verarbeitet GitHub technisch notwendige Daten, insbesondere deine IP-Adresse, Datum und Uhrzeit des Zugriffs, die aufgerufene Seite sowie Browser- und Betriebssystemangaben (Server-Logdateien). Dies dient der Auslieferung, Sicherheit und Stabilität der Website. Rechtsgrundlage ist unser berechtigtes Interesse an einer zuverlässigen, kostenfreien Bereitstellung (Art. 6 Abs. 1 lit. f DSGVO). Dabei können Daten in die USA übermittelt werden; GitHub ist unter dem EU-US Data Privacy Framework zertifiziert, für das ein Angemessenheitsbeschluss der EU-Kommission besteht (Art. 45 DSGVO). Details: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement",
      },
      {
        h: "3. Keine Cookies, kein Tracking",
        p: "Diese Website setzt keine Cookies und verwendet keine Analyse- oder Tracking-Werkzeuge. Wenn du zwischen hellem und dunklem Design wechselst, wird deine Auswahl ausschließlich lokal in deinem Browser gespeichert (localStorage) und nicht an uns übertragen. Diese Speicherung ist für die von dir gewünschte Funktion erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
      },
      { h: "4. Schriftarten", p: "Alle Schriftarten werden direkt von dieser Website ausgeliefert. Es findet keine Verbindung zu Servern von Google oder anderen Schriftanbietern statt." },
      {
        h: "5. Downloads und Links zu GitHub",
        p: "Der Download der App sowie die Links zum Quellcode und zu den Versionen führen zu GitHub. Beim Aufruf dieser Seiten gelten die Datenschutzbestimmungen von GitHub. Für die Darstellung der aktuellen Version und des Changelogs wird GitHub nur beim Erstellen dieser Website abgefragt, nicht bei deinem Besuch.",
      },
      {
        h: "6. Die App Strata",
        p: "Strata läuft vollständig lokal auf deinem Mac. Es gibt kein Nutzerkonto und keine Telemetrie; dein Quellcode und deine Projektdaten verlassen deinen Rechner nicht durch uns. Folgende Verbindungen stellt die App her:",
        list: [
          "Update-Prüfung: Beim Start und danach alle paar Stunden ruft die App eine Versionsdatei bei GitHub ab und lädt bei deiner Zustimmung Updates von dort herunter. Dabei wird deine IP-Adresse an GitHub übermittelt (Art. 6 Abs. 1 lit. f DSGVO).",
          "KI-Funktionen (Ask Strata, Zusammenfassungen, Canvases): Diese nutzen die auf deinem Rechner installierte Claude Code CLI mit deinem eigenen Konto bei Anthropic. Deine Fragen und die dafür nötigen Code-Ausschnitte gehen direkt von deinem Rechner an Anthropic, nicht an uns. Es gelten die Bedingungen und die Datenschutzerklärung von Anthropic. Die KI-Funktionen sind optional und werden nur genutzt, wenn du sie aufrufst bzw. aktivierst.",
        ],
      },
      { h: "7. Empfänger", p: "Wir selbst geben keine personenbezogenen Daten weiter. Empfänger der oben genannten technischen Daten ist GitHub als Hosting-Anbieter; bei Nutzung der KI-Funktionen in der App Anthropic über dein eigenes Konto." },
      { h: "8. Speicherdauer", p: "Wir speichern keine personenbezogenen Daten. Die Speicherdauer der Server-Logdateien richtet sich nach den Vorgaben von GitHub." },
      { h: "9. Deine Rechte", p: "Dir stehen nach der DSGVO folgende Rechte zu:", list: RIGHTS.de },
      {
        h: "10. Beschwerderecht",
        p: "Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns zuständig ist:\nDer Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg\nLautenschlagerstraße 20, 70173 Stuttgart\nhttps://www.baden-wuerttemberg.datenschutz.de",
      },
      { h: "11. Keine automatisierte Entscheidungsfindung", p: "Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne des Art. 22 DSGVO findet nicht statt." },
      { h: "12. Änderungen", p: "Wir passen diese Datenschutzerklärung an, sobald sich die Datenverarbeitung ändert. Es gilt die jeweils aktuelle, hier veröffentlichte Fassung." },
    ],
  },
  en: {
    title: "Privacy policy",
    updated: UPDATED.en,
    intro:
      "Below we inform you pursuant to Art. 13 GDPR about the data processed when you visit this website and use the Strata app. In short: we do not collect or store any personal data ourselves. There are no accounts, no cookies, no tracking and no analytics. The legally binding version of this policy is the German one.",
    blocks: [
      { h: "1. Controller", p: `The controller within the meaning of the GDPR is:\n${address("en")}\nEmail: ${OPERATOR.email}` },
      {
        h: "2. Hosting on GitHub Pages",
        p: "This website is served by GitHub Pages, a service of GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA. When you open the pages, GitHub processes technically necessary data, in particular your IP address, date and time of access, the page requested and browser and operating system information (server log files). This serves the delivery, security and stability of the website. The legal basis is our legitimate interest in reliable, free hosting (Art. 6(1)(f) GDPR). Data may be transferred to the USA; GitHub is certified under the EU-US Data Privacy Framework, for which an adequacy decision of the European Commission exists (Art. 45 GDPR). Details: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement",
      },
      {
        h: "3. No cookies, no tracking",
        p: "This website sets no cookies and uses no analytics or tracking tools. If you switch between light and dark mode, your choice is stored only locally in your browser (localStorage) and is never sent to us. This storage is necessary for the function you requested (§ 25(2) no. 2 TDDDG).",
      },
      { h: "4. Fonts", p: "All fonts are served directly from this website. No connection is made to servers of Google or any other font provider." },
      {
        h: "5. Downloads and links to GitHub",
        p: "Downloading the app and the links to the source code and releases lead to GitHub, where GitHub's privacy policy applies. To show the latest version and changelog, GitHub is queried only when this website is built, not during your visit.",
      },
      {
        h: "6. The Strata app",
        p: "Strata runs entirely on your Mac. There is no user account and no telemetry; your source code and project data never leave your machine through us. The app makes the following connections:",
        list: [
          "Update check: on launch and every few hours, the app fetches a version file from GitHub and, with your consent, downloads updates from there. Your IP address is transmitted to GitHub (Art. 6(1)(f) GDPR).",
          "AI features (Ask Strata, summaries, canvases): these use the Claude Code CLI installed on your machine with your own Anthropic account. Your questions and the code excerpts needed to answer them go directly from your machine to Anthropic, not to us. Anthropic's terms and privacy policy apply. The AI features are optional and only used when you invoke or enable them.",
        ],
      },
      { h: "7. Recipients", p: "We do not pass on any personal data ourselves. The technical data described above is received by GitHub as the hosting provider and, when you use the AI features in the app, by Anthropic through your own account." },
      { h: "8. Storage period", p: "We do not store any personal data. How long server log files are kept is determined by GitHub." },
      { h: "9. Your rights", p: "Under the GDPR you have the following rights:", list: RIGHTS.en },
      {
        h: "10. Right to lodge a complaint",
        p: "You have the right to lodge a complaint with a data protection supervisory authority. The authority responsible for us is:\nThe State Commissioner for Data Protection and Freedom of Information Baden-Württemberg\nLautenschlagerstraße 20, 70173 Stuttgart, Germany\nhttps://www.baden-wuerttemberg.datenschutz.de",
      },
      { h: "11. No automated decision-making", p: "Automated decision-making, including profiling within the meaning of Art. 22 GDPR, does not take place." },
      { h: "12. Changes", p: "We will update this privacy policy as soon as the data processing changes. The current version published here applies." },
    ],
  },
};
