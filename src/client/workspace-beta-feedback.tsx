"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import {
  betaFeedbackViewSchema,
  type BetaFeedbackView,
} from "@/contracts/beta-feedback";
import type { Command } from "@/contracts/commands";
import { betaFeedbackMarkdown } from "@/shared/beta-feedback";
import { aiUsageViewSchema, type AIUsageView } from "@/contracts/ai-usage";
import { api, errorText } from "./api";

export function WorkspaceBetaFeedback({
  workspace,
  actor,
  revision,
  message,
  canContribute,
  command,
  action,
  busy,
}: {
  workspace: string;
  actor: string;
  revision: number;
  message: { id: string; content: string } | null;
  canContribute: boolean;
  command: (command: Command) => Promise<unknown>;
  action: (run: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [content, setContent] = useState("");
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    view?: BetaFeedbackView;
    error?: string;
  }>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [days, setDays] = useState(30);
  const [usageResult, setUsageResult] = useState<{
    days: number;
    view?: AIUsageView;
    error?: string;
  }>();
  const [usageLoading, setUsageLoading] = useState(false);
  const usageRequest = useRef(0);
  const generation = useRef(0);
  const url = `/api/v1/workspaces/${workspace}/beta-feedback`;
  useEffect(() => {
    const current = ++generation.current;
    return () => {
      generation.current = current + 1;
    };
  }, [workspace, actor]);
  useEffect(() => {
    let live = true;
    void api<unknown>(url)
      .then((payload) => {
        const view = betaFeedbackViewSchema.parse(payload);
        if (live) setResult({ view });
      })
      .catch((error: unknown) => {
        if (live) setResult({ error: errorText(error) });
      });
    return () => {
      live = false;
    };
  }, [url, actor, revision, retry]);

  async function loadUsage(period: number) {
    const current = generation.current,
      request = ++usageRequest.current;
    setShowUsage(true);
    setDays(period);
    setUsageLoading(true);
    try {
      const view = aiUsageViewSchema.parse(
        await api<unknown>(
          `/api/v1/workspaces/${workspace}/ai-usage?days=${period}`,
        ),
      );
      if (current === generation.current && request === usageRequest.current)
        setUsageResult({ days: period, view });
    } catch (error) {
      if (current === generation.current && request === usageRequest.current)
        setUsageResult({ days: period, error: errorText(error) });
    } finally {
      if (current === generation.current && request === usageRequest.current)
        setUsageLoading(false);
    }
  }

  async function download() {
    const current = generation.current;
    setExporting(true);
    setExportError("");
    try {
      // Recheck current access; never export a cached view after revoked membership.
      const view = betaFeedbackViewSchema.parse(await api<unknown>(url));
      if (current !== generation.current) return;
      const usage = showUsage
        ? aiUsageViewSchema.parse(
            await api<unknown>(
              `/api/v1/workspaces/${workspace}/ai-usage?days=${days}`,
            ),
          )
        : undefined;
      if (current !== generation.current) return;
      setResult({ view });
      const blob = new Blob([betaFeedbackMarkdown(view, usage)], {
        type: "text/markdown;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `rimiam-feedback-${workspace}-${view.generatedAt.slice(0, 10)}.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) {
      if (current === generation.current) {
        setExportError(errorText(error));
        setResult({ error: errorText(error) });
      }
    } finally {
      if (current === generation.current) setExporting(false);
    }
  }

  return (
    <section aria-label={uiText("Feedback beta")}>
      <p>
        {uiText(
          "Note condivise con i membri dello spazio, separate dal Context e dalle risposte di Emme. Puoi scrivere anche ",
        )}
        <code>{uiText("/feedback …")}</code>
        {uiText(" nella chat. Per correggere una nota, aggiungine una nuova.")}
      </p>
      {canContribute && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const sent = content;
            if (!sent.trim() || busy) return;
            const current = generation.current;
            void action(async () => {
              await command({
                type: "beta.feedback.add",
                content: sent,
                ...(message ? { messageId: message.id } : {}),
              });
              if (current !== generation.current) return;
              setContent((draft) => (draft === sent ? "" : draft));
              setSaved(true);
              setRetry((n) => n + 1);
            });
          }}
        >
          {message && (
            <details open>
              <summary>
                {uiText("Messaggio incluso nel feedback e nel report")}
              </summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
            </details>
          )}
          <label>
            {uiText("Cosa hai notato?")}
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setSaved(false);
              }}
              placeholder={uiText(
                "Cosa è successo e cosa ti aspettavi? Anche una frase basta.",
              )}
              rows={4}
              maxLength={6000}
              required
            />
          </label>
          <button disabled={busy || !content.trim()}>
            {uiText("Salva feedback")}
          </button>
          {saved && <p role="status">{uiText("Feedback salvato.")}</p>}
        </form>
      )}
      <p className="hint">
        {uiText(
          "Il report contiene le note di tutti e solo i messaggi collegati esplicitamente. Controllalo prima di condividerlo fuori dallo spazio: potrebbe contenere informazioni personali. Nulla viene inviato automaticamente.",
        )}
      </p>
      <button
        className="quiet"
        onClick={() => (showUsage ? setShowUsage(false) : void loadUsage(days))}
      >
        {showUsage
          ? uiText("Nascondi utilizzo e costi")
          : uiText("Mostra utilizzo e costi stimati")}
      </button>
      {showUsage && (
        <section aria-label={uiText("Utilizzo e costi stimati")}>
          <p>
            {uiText(
              "La stima copre le risposte in chat e le analisi svolte in questo spazio. Apri il riepilogo per includerlo nel report.",
            )}
          </p>
          <label>
            {uiText("Periodo")}{" "}
            <select
              value={days}
              onChange={(event) => void loadUsage(Number(event.target.value))}
            >
              <option value={7}>{uiText("Ultimi 7 giorni")}</option>
              <option value={30}>{uiText("Ultimi 30 giorni")}</option>
            </select>
          </label>
          <button
            className="quiet"
            disabled={usageLoading}
            onClick={() => void loadUsage(days)}
          >
            {uiText("Aggiorna consumi")}
          </button>
          {usageLoading && <p role="status">{uiText("Lettura consumi…")}</p>}
          {usageResult?.days === days && usageResult.error && (
            <p role="alert">{usageResult.error}</p>
          )}
          {usageResult?.days === days && usageResult.view && (
            <>
              <p className="hint">
                {uiText("Misurazione disponibile dal")}{" "}
                {usageResult.view.instrumentationSince
                  ? new Date(
                      usageResult.view.instrumentationSince,
                    ).toLocaleDateString(uiLocale)
                  : uiText("dato non disponibile")}
                {uiText(". Non ricostruisce i consumi precedenti.")}
              </p>
              {usageResult.view.groups.length === 0 && (
                <p>
                  {uiText(
                    "Nessun tentativo AI misurato nel periodo. Non significa che l’intera app non abbia costi.",
                  )}
                </p>
              )}
              {usageResult.view.groups.map((group, index) => (
                <article key={index}>
                  <strong>
                    {group.operation === "conversation"
                      ? uiText("Conversation")
                      : uiText("Active Work")}{" "}
                    · {group.provider} / {group.model}
                  </strong>
                  <p>
                    {group.attempts}
                    {uiText(" tentativi · token input misurati:")}{" "}
                    {group.inputTokens ?? uiText("non disponibili")}
                    {uiText(" · output:")}{" "}
                    {group.outputTokens ?? uiText("non disponibili")}.
                  </p>
                  <p>
                    {uiText("Subtotale stimabile:")}{" "}
                    {group.estimatedSubtotalUsd === null
                      ? uiText("non disponibile")
                      : uiText(
                          "${0} USD",
                          String(group.estimatedSubtotalUsd.toFixed(6)),
                        )}{" "}
                    ({group.pricedAttempts}/{group.attempts}
                    {uiText(" tentativi con stima).")}
                  </p>
                  {(group.unresolved > 0 || group.missingTokenUsage > 0) && (
                    <p>
                      {uiText("Esiti incompleti/in corso: ")}
                      {group.unresolved}
                      {uiText("; tentativi senza conteggi completi: ")}
                      {group.missingTokenUsage}
                      {uiText(". Costo sconosciuto, non zero.")}
                    </p>
                  )}
                  {group.failed > 0 && (
                    <p>
                      {group.failed}
                      {uiText(
                        " tentativi falliti: anche un risultato inutilizzabile può consumare token.",
                      )}
                    </p>
                  )}
                  <small>
                    {group.rates
                      ? uiText(
                          "Tariffe configurate, verificate il {0}.",
                          String(group.rates.verifiedOn),
                        )
                      : uiText(
                          "Tariffe da configurare: la stima resta sconosciuta.",
                        )}
                  </small>
                </article>
              ))}
            </>
          )}
          <p className="hint">
            {uiText(
              "Stima parziale in USD, non fattura. Esclusi voce/trascrizione, immagini, Email, ricerche web, chiamate, hosting, storage, abbonamenti, tasse e sconti. Il consuntivo resta quello dei provider.",
            )}
          </p>
        </section>
      )}
      <button onClick={() => void download()} disabled={exporting}>
        {exporting ? uiText("Preparazione…") : uiText("Scarica report (.md)")}
      </button>
      {exportError && <p role="alert">{exportError}</p>}
      {!result && <p role="status">{uiText("Caricamento feedback…")}</p>}
      {result?.error && (
        <p role="alert">
          {result.error}{" "}
          <button className="quiet" onClick={() => setRetry((n) => n + 1)}>
            {uiText("Riprova")}
          </button>
        </p>
      )}
      {result?.view?.entries.length === 0 && (
        <p>{uiText("Nessun feedback registrato.")}</p>
      )}
      {result?.view?.entries.map((entry) => (
        <article key={entry.id}>
          <strong>{entry.authorName}</strong>{" "}
          <time dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString(uiLocale)}
          </time>
          <p style={{ whiteSpace: "pre-wrap" }}>{entry.content}</p>
          {entry.message && (
            <details>
              <summary>{uiText("Messaggio collegato")}</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{entry.message.content}</p>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
