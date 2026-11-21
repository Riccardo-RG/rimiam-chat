"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import {
  betaRulesViewSchema,
  type BetaRulesView,
} from "@/contracts/beta-rules";
import { betaRules, currentBetaRule } from "@/shared/beta-rules";
import { api } from "./api";
import styles from "./beta-notice.module.css";

export function BetaNotice({ actorId }: { actorId: string }) {
  const { t: uiText, locale } = useUiLanguage();
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
          setError(uiText("Non riesco a verificare l’accettazione. Riprova."));
      });
    return () => {
      active = false;
    };
  }, [actorId, attempt, uiText]);

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
        setError(
          uiText("Le regole sono cambiate: rileggile prima di accettare."),
        );
      } else {
        setError(uiText("Accettazione non confermata. Puoi riprovare."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (view?.acceptedAt || (!view && !error)) return null;

  return (
    <aside className={styles.notice} aria-label={uiText("Regole della beta")}>
      <div className={styles.copy}>
        {view && (
          <details>
            <summary>
              {uiText("Prima di partecipare: regole sui dati condivisi")}
            </summary>
            <p>{currentBetaRule(view) ? uiText(betaRules.text) : view.text}</p>
            {locale === "en" && currentBetaRule(view) && (
              <details>
                <summary>{uiText("Testo originale in italiano")}</summary>
                <p lang="it">{view.text}</p>
              </details>
            )}
            <p className="hint">
              {uiText(
                "Accetti questa regola d’uso, non un consenso privacy generale. Versione ",
              )}
              {view.version}.
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
          {uiText("Riprova")}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void accept()}
          aria-label={uiText("Accetto la regola d’uso della beta")}
        >
          {busy ? uiText("Salvataggio…") : uiText("Accetto")}
        </button>
      )}
    </aside>
  );
}
