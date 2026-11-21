import { pageLanguage } from "../ui-language-server";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSignature } from "@/client/brand-signature";
import { AppearanceControl } from "@/client/appearance-control";
import { betaRules } from "@/shared/beta-rules";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Regole della beta · RIMIAM",
  description: "Limiti sui dati condivisi durante la beta di RIMIAM.",
};

export default async function BetaRules() {
  const { initialLocale, t: uiText } = await pageLanguage();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link
          href="/"
          className="wordmark"
          aria-label={uiText("RIMIAM — Home")}
        >
          <BrandSignature />
        </Link>
        <AppearanceControl />
      </header>
      <article>
        <h1>{uiText("Regole della beta")}</h1>
        <p className="hint">
          {uiText("Versione 1 · ")}
          <time dateTime="2026-09-29">{uiText("29 settembre 2026")}</time>
        </p>
        <h2>{uiText("Dati che non devono essere inseriti")}</h2>
        <p>{uiText(betaRules.text)}</p>
        {initialLocale === "en" && (
          <details>
            <summary>Original Italian text</summary>
            <p lang="it">{betaRules.text}</p>
          </details>
        )}
        <h2>{uiText("Segnalare un inserimento accidentale")}</h2>
        <p>
          {uiText(
            "Contatta direttamente chi organizza la beta attraverso il canale con cui avete concordato la prova, indicando il riferimento al messaggio o al contenuto. Non reinviare nella segnalazione i dati da proteggere.",
          )}
        </p>
        <p className="hint">
          {uiText(
            "Questa pagina pubblica la regola d’uso della beta; non sostituisce l’informativa privacy. Non costituisce una rinuncia ai tuoi diritti o una liberatoria generale per il gestore.",
          )}
        </p>
        <p>
          <Link href="/connessioni-e-dati">
            {uiText("Come vengono usati i dati di account e calendari")}
          </Link>
        </p>
      </article>
      <Link href="/">{uiText("Torna a RIMIAM")}</Link>
    </main>
  );
}
