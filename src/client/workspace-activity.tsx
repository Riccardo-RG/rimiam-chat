"use client";
import { FilePreviewBody } from "./file-preview";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  activitySchema,
  referenceDetailSchema,
  type ConversationReference,
  type ReferenceDetail,
} from "@/contracts/activity";
import { api, errorText } from "./api";

const eventMeaning: Record<ConversationReference["kind"], string> = {
  goal: "L’obiettivo espresso in quel momento.",
  commitment: "Un aggiornamento della proposta.",
  information: "Un’informazione che il gruppo usa come riferimento.",
  task: "Un aggiornamento dell’attività.",
  workstream: "Un tema che raccoglie messaggi della stessa chat.",
  active_work: "Un passaggio del lavoro di Emme.",
  artifact: "Un passaggio nella storia del documento.",
  question: "Una domanda dello spazio e il suo stato.",
  scheduled_event: "Un aggiornamento del calendario dello spazio.",
  source: "Un materiale condiviso nello spazio.",
};

export function WorkspaceActivity({
  workspace,
  actor,
  revision,
  inspect,
}: {
  workspace: string;
  actor: string;
  revision: number;
  inspect: (reference: ConversationReference) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [before, setBefore] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    url: string;
    view?: z.infer<typeof activitySchema>;
    error?: string;
  }>();
  const url = `/api/v1/workspaces/${workspace}/activity?limit=12${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  useEffect(() => {
    let live = true;
    void api<unknown>(url)
      .then((payload) => {
        const view = activitySchema.parse(payload);
        if (live) setResult({ url, view });
      })
      .catch((e: unknown) => {
        if (live) setResult({ url, error: errorText(e) });
      });
    return () => {
      live = false;
    };
  }, [url, actor, revision, retry]);
  const resultForPage = result?.url === url ? result : undefined;
  return (
    <section className="workspace-activity" aria-label={uiText("Activity")}>
      <details className="activity-group">
        <summary>
          <span>
            <strong>{uiText("Registro attività")}</strong>
            <small>
              {uiText(
                "Obiettivi, decisioni e altri aggiornamenti dello spazio.",
              )}
            </small>
          </span>
        </summary>
        {!resultForPage && (
          <p role="status">{uiText("Caricamento del registro…")}</p>
        )}
        {resultForPage?.error && (
          <p role="alert">
            {resultForPage.error}
            <button className="quiet" onClick={() => setRetry((n) => n + 1)}>
              {uiText("Riprova")}
            </button>
          </p>
        )}
        {resultForPage?.view?.events.length === 0 && (
          <p>{uiText("Nessun aggiornamento da mostrare.")}</p>
        )}
        <ol className="activity-timeline">
          {resultForPage?.view?.events.map((event) => (
            <li key={event.eventId}>
              <details>
                <summary>
                  <span className="activity-heading">
                    <strong>{event.title}</strong>
                    <small>{uiText(eventMeaning[event.reference.kind])}</small>
                  </span>
                </summary>
                <div className="activity-event-body">
                  <span className="activity-meta">
                    <span>{event.actorName}</span>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString(uiLocale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </span>
                  <p className="activity-summary">{event.summary}</p>
                  <small>{event.qualification}</small>
                  <button
                    className="quiet"
                    onClick={() => inspect(event.reference)}
                  >
                    {uiText("Apri dettaglio e fonti")}
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ol>
        <div className="actions">
          {before && (
            <button className="quiet" onClick={() => setBefore(undefined)}>
              {uiText("Eventi recenti")}
            </button>
          )}
          {resultForPage?.view?.next && (
            <button
              className="quiet"
              onClick={() => setBefore(resultForPage.view!.next!)}
            >
              {uiText("Eventi precedenti")}
            </button>
          )}
        </div>
      </details>
    </section>
  );
}

export function ReferenceInspector({
  workspace,
  actor,
  reference,
  ask,
  open,
  inspect,
}: {
  workspace: string;
  actor: string;
  reference: ConversationReference;
  ask: (
    reference: ConversationReference,
    title: string,
    displayVersion?: number,
  ) => void;
  open: (panel: string) => void;
  inspect: (reference: ConversationReference) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [detail, setDetail] = useState<ReferenceDetail>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({
    kind: reference.kind,
    id: reference.id,
    version: String(reference.version),
    ...(reference.eventId ? { eventId: reference.eventId } : {}),
  }).toString();
  useEffect(() => {
    let live = true;
    void api<unknown>(`/api/v1/workspaces/${workspace}/reference?${query}`)
      .then((payload) => {
        const next = referenceDetailSchema.parse(payload);
        if (live) {
          setDetail(next);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setDetail(undefined);
          setError(errorText(e));
        }
      });
    return () => {
      live = false;
    };
  }, [workspace, actor, query, retry]);
  if (error)
    return (
      <p role="alert">
        {error}
        <button className="quiet" onClick={() => setRetry((n) => n + 1)}>
          {uiText("Riprova")}
        </button>
      </p>
    );
  if (!detail)
    return <p role="status">{uiText("Caricamento del riferimento…")}</p>;
  return (
    <article className="reference-detail">
      <p className="eyebrow">
        {detail.event
          ? uiText("IL PASSAGGIO REGISTRATO")
          : uiText("Dettagli del riferimento")}
      </p>
      <h2>{detail.event?.title ?? detail.title}</h2>
      {reference.kind === "source" &&
        detail.provenance.sourceKind === "document" &&
        !detail.provenance.withdrawn && (
          <FilePreviewBody
            path={`/api/v1/workspaces/${workspace}/source-file?id=${reference.id}`}
            original={`/api/workspaces/${workspace}/sources/${reference.id}?preview=1`}
          />
        )}
      <p className="reference-qualification">
        {detail.event?.qualification ?? detail.qualification}
      </p>
      {!detail.current && (
        <p className="hint">
          {uiText(
            "Stai leggendo la versione citata. Da allora potrebbe essere cambiata.",
          )}
        </p>
      )}
      {detail.event && (
        <p className="hint">
          {detail.event.actorName} ·{" "}
          {new Date(detail.event.occurredAt).toLocaleString(uiLocale)}
        </p>
      )}
      <p className="reference-content">{detail.content}</p>
      {detail.event && (
        <details>
          <summary>{uiText("Relazione con lo stato attuale")}</summary>
          <p>{detail.qualification}</p>
          <p className="hint">
            {detail.current
              ? uiText(
                  "È la versione attuale. I consensi, le approvazioni e i permessi restano quelli già registrati.",
                )
              : uiText("La versione citata è diversa da quella attuale.")}
          </p>
        </details>
      )}
      <button
        onClick={() =>
          ask(
            detail.reference,
            detail.title,
            typeof detail.provenance.documentVersion === "number"
              ? detail.provenance.documentVersion
              : undefined,
          )
        }
      >
        {uiText("Chiedi a Emme su questo passaggio")}
      </button>
      <button
        className="quiet"
        onClick={() =>
          open(
            {
              goal: "goal",
              information: "context",
              commitment: "goal",
              task: "work",
              artifact: "artifacts",
              question: "context",
              workstream: "attention",
              active_work: "work",
              scheduled_event: "calendar",
              source: "sources",
            }[reference.kind],
          )
        }
      >
        {uiText("Apri i controlli di questa area")}
      </button>
      <details>
        <summary>{uiText("Versione e riferimenti di origine")}</summary>
        <p className="hint">
          {reference.kind === "active_work"
            ? uiText("Revisione dell’evento di lavoro")
            : uiText("Versione")}{" "}
          {typeof detail.provenance.documentVersion === "number"
            ? detail.provenance.documentVersion
            : detail.reference.version}{" "}
          · {new Date(detail.createdAt).toLocaleString(uiLocale)}
        </p>
        <p className="hint">
          {uiText("Identità: ")}
          {detail.reference.id}
        </p>
        {detail.sourceIds.map((id) => (
          <button
            className="quiet reference-source"
            key={id}
            onClick={() => inspect({ kind: "source", id, version: 1 })}
          >
            {uiText("Apri fonte conservata · ")}
            {id}
          </button>
        ))}
        <p className="hint">
          {uiText("Autore dell’atto: ")}
          {detail.actor ?? uiText("Atto registrato dal sistema")}
          {uiText(
            ". I dati correnti qui indicati sono distinti dal passaggio storico.",
          )}
        </p>
        <pre className="source-text reference-provenance">
          {JSON.stringify(detail.provenance, null, 2)}
        </pre>
      </details>
    </article>
  );
}
