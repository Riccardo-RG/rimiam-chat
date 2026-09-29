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

export default function BetaRules() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className="wordmark" aria-label="RIMIAM — Home">
          <BrandSignature />
        </Link>
        <AppearanceControl />
      </header>
      <article>
        <h1>Regole della beta</h1>
        <p className="hint">
          Versione 1 · <time dateTime="2026-09-29">29 settembre 2026</time>
        </p>
        <h2>Dati che non devono essere inseriti</h2>
        <p>{betaRules.text}</p>
        <h2>Segnalare un inserimento accidentale</h2>
        <p>
          Contatta direttamente chi organizza la beta attraverso il canale con
          cui avete concordato la prova, indicando il riferimento al messaggio o
          al contenuto. Non reinviare nella segnalazione i dati da proteggere.
        </p>
        <p className="hint">
          Questa pagina pubblica la regola d’uso della beta; non sostituisce
          l’informativa privacy. Non costituisce una rinuncia ai tuoi diritti o
          una liberatoria generale per il gestore.
        </p>
      </article>
      <Link href="/">Torna a RIMIAM</Link>
    </main>
  );
}
