import type { MetadataRoute } from "next";

import { pageLanguage } from "./ui-language-server";
export const dynamic = "force-dynamic";
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { initialLocale } = await pageLanguage();
  return {
    id: "/",
    name: "RIMIAM",
    short_name: "RIMIAM",
    description:
      initialLocale === "en"
        ? "Your shared workspace with Emme."
        : "Il tuo spazio collaborativo con Emme.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf8f7",
    theme_color: "#2f2836",
    lang: initialLocale,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/rimiam-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/rimiam-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
