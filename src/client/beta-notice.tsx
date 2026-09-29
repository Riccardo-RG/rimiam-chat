"use client";

import { useEffect, useState } from "react";
import {
  betaRulesViewSchema,
  type BetaRulesView,
} from "@/contracts/beta-rules";
import { api } from "./api";
import styles from "./beta-notice.module.css";

export function BetaNotice({ actorId }: { actorId: string }) {
  const [view, setView] = useState<BetaRulesView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void api("/api/v1/beta-rules")
      .then((result) => {
        const current = betaRulesViewSchema.parse(result);
        if (current.actorId !== actorId)
          throw new Error("AUTH_CONTEXT_CHANGED");
        if (active) {
          setView(current);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError("Non riesco a verificare l’accettazione. Riprova.");
      });
    return () => {
      active = false;
    };
  }, [actorId, attempt]);

  async function accept() {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = betaRulesViewSchema.parse(
        await api("/api/v1/beta-rules", {
          expectedActorId: actorId,
          version: view.version,
          contentDigest: view.contentDigest,
        }),
      );
      if (
        result.actorId !== actorId ||
        result.version !== view.version ||
        result.contentDigest !== view.contentDigest ||
        !result.acceptedAt
      )
        throw new Error("INVALID_ACKNOWLEDGEMENT");
      setView(result);
    } catch (failure) {
      if (
        failure instanceof Error &&
        failure.message === "BETA_RULES_VERSION_STALE"
      ) {
        setView(null);
        setError("Le regole sono cambiate: rileggile prima di accettare.");
      } else {
        setError("Accettazione non confermata. Puoi riprovare.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (view?.acceptedAt || (!view && !error)) return null;

  return (
    <aside className={styles.notice} aria-label="Regole della beta">
      <div className={styles.copy}>
        {view && (
          <details>
            <summary>Prima di partecipare: regole sui dati condivisi</summary>
            <p>{view.text}</p>
            <p className="hint">
              Accetti questa regola d’uso, non un consenso privacy generale.
              Versione {view.version}.
            </p>
          </details>
        )}
        {error && <p role="status">{error}</p>}
      </div>
      {!view ? (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          Riprova
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void accept()}
          aria-label="Accetto la regola d’uso della beta"
        >
          {busy ? "Salvataggio…" : "Accetto"}
        </button>
      )}
    </aside>
  );
}
