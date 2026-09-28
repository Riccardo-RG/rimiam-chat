"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  activitySchema,
  referenceDetailSchema,
  type ConversationReference,
  type ReferenceDetail,
} from "@/contracts/activity";
import { api, errorText } from "./api";

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
    <section className="workspace-activity" aria-label="Activity">
      <p className="hint">
        Eventi registrati nello spazio. Apri un passaggio per ritrovare la sua
        versione, le fonti e ciò che significa.
      </p>
      {!resultForPage && <p role="status">Caricamento dell’Activity…</p>}
      {resultForPage?.error && (
        <p role="alert">
          {resultForPage.error}
          <button className="quiet" onClick={() => setRetry((n) => n + 1)}>
            Riprova
          </button>
        </p>
      )}
      {resultForPage?.view?.events.length === 0 && (
        <p>Nessun evento da mostrare in questa finestra.</p>
      )}
      <ol className="activity-timeline">
        {resultForPage?.view?.events.map((event) => (
          <li key={event.eventId}>
            <button onClick={() => inspect(event.reference)}>
              <span className="activity-meta">
                <span>{event.actorName}</span>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString("it-IT", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </span>
              <strong>{event.title}</strong>
              <span className="activity-summary">{event.summary}</span>
              <small>{event.qualification}</small>
              <span className="activity-inspect">Apri questo passaggio ↗</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="actions">
        {before && (
          <button className="quiet" onClick={() => setBefore(undefined)}>
            Eventi recenti
          </button>
        )}
        {resultForPage?.view?.next && (
          <button
            className="quiet"
            onClick={() => setBefore(resultForPage.view!.next!)}
          >
            Eventi precedenti
          </button>
        )}
      </div>
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
  ask: (reference: ConversationReference, title: string) => void;
  open: (panel: string) => void;
  inspect: (reference: ConversationReference) => void;
}) {
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
          Riprova
        </button>
      </p>
    );
  if (!detail) return <p role="status">Caricamento del riferimento…</p>;
  return (
    <article className="reference-detail">
      <p className="eyebrow">
        {detail.event ? "IL PASSAGGIO REGISTRATO" : "IL RIFERIMENTO"}
      </p>
      <h2>{detail.event?.title ?? detail.title}</h2>
      <p className="reference-qualification">
        {detail.event?.qualification ?? detail.qualification}
      </p>
      {!detail.current && (
        <p className="hint">
          Questo riferimento appartiene alla storia. Non rappresenta
          necessariamente lo stato attuale.
        </p>
      )}
      {detail.event && (
        <p className="hint">
          {detail.event.actorName} ·{" "}
          {new Date(detail.event.occurredAt).toLocaleString("it-IT")}
        </p>
      )}
      <p className="reference-content">{detail.content}</p>
      {detail.event && (
        <details>
          <summary>Relazione con lo stato attuale</summary>
          <p>{detail.qualification}</p>
          <p className="hint">
            {detail.current
              ? "La versione coincide con la proiezione corrente. Questo non aggiunge consenso, adozione o authority."
              : "Il riferimento storico non coincide con la proiezione corrente."}
          </p>
        </details>
      )}
      <button onClick={() => ask(detail.reference, detail.title)}>
        Chiedi a RIMIAM su questo passaggio
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
        Apri i controlli di questa area
      </button>
      <details>
        <summary>Versione e riferimenti di origine</summary>
        <p className="hint">
          {reference.kind === "active_work"
            ? "Revisione dell’evento di lavoro"
            : "Versione"}{" "}
          {detail.reference.version} ·{" "}
          {new Date(detail.createdAt).toLocaleString("it-IT")}
        </p>
        <p className="hint">Identità: {detail.reference.id}</p>
        {detail.sourceIds.map((id) => (
          <button
            className="quiet reference-source"
            key={id}
            onClick={() => inspect({ kind: "source", id, version: 1 })}
          >
            Apri fonte conservata · {id}
          </button>
        ))}
        <p className="hint">
          Autore dell’atto: {detail.actor ?? "Atto registrato dal sistema"}. I
          dati correnti qui indicati sono distinti dal passaggio storico.
        </p>
        <pre className="source-text reference-provenance">
          {JSON.stringify(detail.provenance, null, 2)}
        </pre>
      </details>
    </article>
  );
}
