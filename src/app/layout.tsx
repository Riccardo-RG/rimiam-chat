import { WebLanguageProvider } from "@/client/ui-language";
import { pageLanguage } from "./ui-language-server";
import { AppearanceRoot } from "@/client/appearance-control";
import { WebReleaseNotice } from "@/client/web-release-notice";
import type { Metadata } from "next";
import "./globals.css";
import "./ritmo.css";
import "./chat-composer.css";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { initialLocale } = await pageLanguage();
  return {
    title: "RIMIAM · Workspace",
    description:
      initialLocale === "en"
        ? "A shared workspace for turning conversations into collaborative work."
        : "Uno spazio condiviso per trasformare conversazioni in lavoro consapevole.",
  };
}
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { initial, initialLocale } = await pageLanguage();
  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const mode=localStorage.getItem("rimiam-appearance");if(mode==="light"||mode==="dark")document.documentElement.dataset.appearance=mode;const accent=localStorage.getItem("rimiam-accent");if(["ocean","forest","plum"].includes(accent))document.documentElement.dataset.accent=accent}catch{}`,
          }}
        />
      </head>
      <body>
        <WebLanguageProvider initial={initial} initialLocale={initialLocale}>
          <AppearanceRoot />
          <WebReleaseNotice initialRelease={process.env.RIMIAM_WEB_RELEASE!}>
            {children}
          </WebReleaseNotice>
        </WebLanguageProvider>
      </body>
    </html>
  );
}
