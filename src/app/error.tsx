"use client";
import { useUiLanguage } from "../client/ui-language";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { BrandSignature } from "@/client/brand-signature";
import styles from "@/client/account-access.module.css";

/** A render failure is not evidence that a submitted command failed. */
export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [error]);

  return (
    <main className={styles.recovery}>
      <header className={styles.recoveryHeader}>
        <Link
          className="wordmark brand-home"
          href="/"
          aria-label={uiText("RIMIAM — Home")}
        >
          <BrandSignature />
        </Link>
      </header>
      <section
        className={styles.recoveryContent}
        aria-labelledby="app-error-title"
      >
        <h1 id="app-error-title" tabIndex={-1} ref={heading}>
          {uiText("Impossibile aprire la pagina.")}
        </h1>
        <p>
          {uiText(
            "Se hai appena inviato una richiesta, controlla l’esito nella chat o nella sezione interessata prima di inviarla di nuovo.",
          )}
        </p>
        <p className="hint">
          {uiText("Le bozze non inviate potrebbero andare perse.")}
        </p>
        <button type="button" onClick={reset}>
          {uiText("Riapri la pagina")}
        </button>
        <Link className={styles.recoveryBack} href="/">
          {uiText("Torna ai tuoi spazi")}
        </Link>
      </section>
    </main>
  );
}
