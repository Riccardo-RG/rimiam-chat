"use client";

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
    <section aria-label="Feedback beta">
      <p>
        Note condivise con i membri dello spazio, separate dal Context e dalle
        risposte di RIMIAM. Puoi scrivere anche <code>/feedback …</code> nella
        chat. Per correggere una nota, aggiungine una nuova.
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
              <summary>Messaggio incluso nel feedback e nel report</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
            </details>
          )}
          <label>
            Cosa hai notato?
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setSaved(false);
              }}
              placeholder="Cosa è successo e cosa ti aspettavi? Anche una frase basta."
              rows={4}
              maxLength={6000}
              required
            />
          </label>
          <button disabled={busy || !content.trim()}>Salva feedback</button>
          {saved && <p role="status">Feedback salvato.</p>}
        </form>
      )}
      <p className="hint">
        Il report contiene le note di tutti e solo i messaggi collegati
        esplicitamente. Controllalo prima di condividerlo fuori dallo spazio:
        potrebbe contenere informazioni personali. Nulla viene inviato
        automaticamente.
      </p>
      <button
        className="quiet"
        onClick={() => (showUsage ? setShowUsage(false) : void loadUsage(days))}
      >
        {showUsage
          ? "Nascondi utilizzo e costi"
          : "Mostra utilizzo e costi stimati"}
      </button>
      {showUsage && (
        <section aria-label="Utilizzo e costi stimati">
          <p>
            Solo AI di Conversation e Active Work nello spazio. Se aperto,
            questo riepilogo viene incluso nel report.
          </p>
          <label>
            Periodo{" "}
            <select
              value={days}
              onChange={(event) => void loadUsage(Number(event.target.value))}
            >
              <option value={7}>Ultimi 7 giorni</option>
              <option value={30}>Ultimi 30 giorni</option>
            </select>
          </label>
          <button
            className="quiet"
            disabled={usageLoading}
            onClick={() => void loadUsage(days)}
          >
            Aggiorna consumi
          </button>
          {usageLoading && <p role="status">Lettura consumi…</p>}
          {usageResult?.days === days && usageResult.error && (
            <p role="alert">{usageResult.error}</p>
          )}
          {usageResult?.days === days && usageResult.view && (
            <>
              <p className="hint">
                Misurazione disponibile dal{" "}
                {usageResult.view.instrumentationSince
                  ? new Date(
                      usageResult.view.instrumentationSince,
                    ).toLocaleDateString("it-IT")
                  : "dato non disponibile"}
                . Non ricostruisce i consumi precedenti.
              </p>
              {usageResult.view.groups.length === 0 && (
                <p>
                  Nessun tentativo AI misurato nel periodo. Non significa che
                  l’intera app non abbia costi.
                </p>
              )}
              {usageResult.view.groups.map((group, index) => (
                <article key={index}>
                  <strong>
                    {group.operation === "conversation"
                      ? "Conversation"
                      : "Active Work"}{" "}
                    · {group.provider} / {group.model}
                  </strong>
                  <p>
                    {group.attempts} tentativi · token input misurati:{" "}
                    {group.inputTokens ?? "non disponibili"} · output:{" "}
                    {group.outputTokens ?? "non disponibili"}.
                  </p>
                  <p>
                    Subtotale stimabile:{" "}
                    {group.estimatedSubtotalUsd === null
                      ? "non disponibile"
                      : `$${group.estimatedSubtotalUsd.toFixed(6)} USD`}{" "}
                    ({group.pricedAttempts}/{group.attempts} tentativi con
                    stima).
                  </p>
                  {(group.unresolved > 0 || group.missingTokenUsage > 0) && (
                    <p>
                      Esiti incompleti/in corso: {group.unresolved}; tentativi
                      senza conteggi completi: {group.missingTokenUsage}. Costo
                      sconosciuto, non zero.
                    </p>
                  )}
                  {group.failed > 0 && (
                    <p>
                      {group.failed} tentativi falliti: anche un risultato
                      inutilizzabile può consumare token.
                    </p>
                  )}
                  <small>
                    {group.rates
                      ? `Tariffe configurate, verificate il ${group.rates.verifiedOn}.`
                      : "Tariffe da configurare: la stima resta sconosciuta."}
                  </small>
                </article>
              ))}
            </>
          )}
          <p className="hint">
            Stima parziale in USD, non fattura. Esclusi voce/trascrizione,
            immagini, Email, ricerche web, chiamate, hosting, storage,
            abbonamenti, tasse e sconti. Il consuntivo resta quello dei
            provider.
          </p>
        </section>
      )}
      <button onClick={() => void download()} disabled={exporting}>
        {exporting ? "Preparazione…" : "Scarica report (.md)"}
      </button>
      {exportError && <p role="alert">{exportError}</p>}
      {!result && <p role="status">Caricamento feedback…</p>}
      {result?.error && (
        <p role="alert">
          {result.error}{" "}
          <button className="quiet" onClick={() => setRetry((n) => n + 1)}>
            Riprova
          </button>
        </p>
      )}
      {result?.view?.entries.length === 0 && <p>Nessun feedback registrato.</p>}
      {result?.view?.entries.map((entry) => (
        <article key={entry.id}>
          <strong>{entry.authorName}</strong>{" "}
          <time dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString("it-IT")}
          </time>
          <p style={{ whiteSpace: "pre-wrap" }}>{entry.content}</p>
          {entry.message && (
            <details>
              <summary>Messaggio collegato</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{entry.message.content}</p>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
