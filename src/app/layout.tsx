import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MIRIAM · Workspace",
  description:
    "Uno spazio condiviso per trasformare conversazioni in lavoro consapevole.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
