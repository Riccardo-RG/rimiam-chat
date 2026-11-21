"use client";
import { useUiLanguage } from "./ui-language";

import { ProductHelp } from "./product-help";
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { MailboxConnections } from "./mailbox-connections";
import type { Command } from "@/contracts/commands";
import type {
  EmailView,
  EmailEnvelope,
  EmailComposition,
} from "@/contracts/email";
const empty = (sender: string): EmailEnvelope => ({
  sender,
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body: "",
  attachments: [],
  kind: "new",
  target: null,
});
const sendLabels: Record<EmailView["actions"][number]["status"], string> = {
  PROPOSED: "Da autorizzare",
  AUTHORIZED: "Autorizzato · in coda",
  EXECUTING: "Invio in corso",
  SUCCEEDED: "Richiesta accettata",
  FAILED: "Invio interrotto",
  OUTCOME_UNKNOWN: "Esito da verificare",
  REJECTED: "Invio rifiutato",
};
const addresses = (s: string) => s.split(",").map((s) => s.trim());
export function WorkspaceEmail({
  workspace,
  actor,
  email,
  canConnect,
  command,
  action,
  busy,
}: {
  workspace: string;
  actor: string;
  email: string;
  canConnect: boolean;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [view, setView] = useState<EmailView | null>(null),
    [error, setError] = useState(""),
    [showEditor, setShowEditor] = useState(false),
    [draft, setDraft] = useState(empty(email)),
    [connection, setConnection] = useState<string | null>(null),
    [editing, setEditing] = useState<EmailView["drafts"][number] | null>(null),
    [reason, setReason] = useState(""),
    [query, setQuery] = useState(""),
    [excerpt, setExcerpt] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<unknown>(null);
  const [instruction, setInstruction] = useState("");
  const [composition, setComposition] = useState<EmailComposition | null>(null);
  const [compositionId, setCompositionId] = useState<string | undefined>();
  const [before, setBefore] = useState<string | null>(null);
  const baseUrl = `/api/v1/workspaces/${workspace}/email`;
  const url = baseUrl + (before ? `?before=${before}` : "");
  useEffect(() => {
    let live = true;
    const read = () => {
      void api<EmailView>(url)
        .then((v) => {
          if (live) {
            setView(v);
            setError("");
          }
        })
        .catch((e) => {
          if (live) {
            setView(null);
            setError(errorText(e));
          }
        });
    };
    read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, actor]);
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setView(await api<EmailView>(url));
    });
  const change = (key: keyof EmailEnvelope, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function load(d: EmailView["drafts"][number]) {
    setShowEditor(true);
    setCompositionId(undefined);
    setEditing(d);
    setDraft(d.envelope);
    setConnection(d.connectionId);
    setReason("");
  }
  function reset() {
    setCompositionId(undefined);
    setEditing(null);
    setDraft(empty(email));
    setConnection(null);
    setReason("");
  }
  return (
    <section
      className="card source-work"
      aria-label={uiText("Email dello spazio")}
    >
      <p className="hint">
        {uiText("Solo tu vedi la tua posta e le tue bozze.")}
      </p>
      {!view && !error && (
        <p role="status">{uiText("Caricamento della posta…")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <MailboxConnections
            workspace={workspace}
            canConnect={canConnect}
            connections={view.connections}
          />
          {!view.connections.some((c) => c.active && c.canSend) && (
            <p className="hint">
              {uiText(
                "Puoi già salvare una bozza. Per inviarla serve una casella collegata con il permesso di invio.",
              )}
            </p>
          )}
          <details
            open={showEditor}
            onToggle={(event) => setShowEditor(event.currentTarget.open)}
          >
            <summary
              onClick={() => {
                if (showEditor || editing || connection) return;
                const available = view.connections.filter(
                  (c) => c.active && c.canSend,
                );
                if (available.length === 1) {
                  setConnection(available[0].id);
                  change("sender", available[0].sender);
                }
              }}
            >
              {editing
                ? uiText("Modifica bozza · v{0}", String(editing.version))
                : uiText("Scrivi una bozza")}
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await command(
                    editing
                      ? {
                          type: "email.draft.revise",
                          draftId: editing.id,
                          expectedVersion: editing.version,
                          compositionId,
                          connectionId: connection,
                          envelope: {
                            ...draft,
                            to: draft.to.filter(Boolean),
                            cc: draft.cc.filter(Boolean),
                            bcc: draft.bcc.filter(Boolean),
                          },
                          reason,
                        }
                      : {
                          type: "email.draft.create",
                          connectionId: connection,
                          envelope: {
                            ...draft,
                            to: draft.to.filter(Boolean),
                            cc: draft.cc.filter(Boolean),
                            bcc: draft.bcc.filter(Boolean),
                          },
                          reason,
                        },
                  );
                  reset();
                  setView(await api<EmailView>(url));
                });
              }}
            >
              <label>
                {uiText("Mailbox verificata")}
                <select
                  value={connection ?? ""}
                  onChange={(e) => {
                    const c = view.connections.find(
                      (c) => c.id === e.target.value,
                    );
                    setConnection(c?.id ?? null);
                    change("sender", c?.sender ?? email);
                  }}
                >
                  <option value="">
                    {uiText("Non collegata — solo bozza")}
                  </option>
                  {view.connections
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · {c.sender}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                {uiText("Da: ")}
                {draft.sender} · {draft.kind}
                {draft.target
                  ? uiText(" · messaggio {0}", String(draft.target.messageId))
                  : ""}
              </p>
              {(["to", "cc", "bcc"] as const).map((k) => (
                <label key={k}>
                  {k.toUpperCase()}
                  <input
                    aria-label={uiText("Email {0}", String(k.toUpperCase()))}
                    value={draft[k].join(", ")}
                    onChange={(e) => change(k, addresses(e.target.value))}
                  />
                </label>
              ))}
              <label>
                {uiText("Oggetto email")}
                <input
                  value={draft.subject}
                  onChange={(e) => change("subject", e.target.value)}
                  maxLength={500}
                />
              </label>
              <label>
                {uiText("Corpo email")}
                <textarea
                  aria-label={uiText("Corpo email")}
                  value={draft.body}
                  onChange={(e) => change("body", e.target.value)}
                  maxLength={24000}
                  rows={6}
                />
              </label>
              <p>
                {uiText(
                  "Selezionare un allegato non lo invia e non lo condivide nello spazio.",
                )}
              </p>
              {[...view.workspaceAttachments, ...view.attachments].map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={draft.attachments.some((x) => x.id === a.id)}
                    onChange={(e) =>
                      change(
                        "attachments",
                        e.target.checked
                          ? [
                              ...draft.attachments,
                              {
                                kind: a.kind,
                                id: a.id,
                                version: a.version,
                                hash: a.hash,
                                filename: a.filename,
                              },
                            ]
                          : draft.attachments.filter((x) => x.id !== a.id),
                      )
                    }
                  />
                  {a.filename}
                  {uiText(" · v")}
                  {a.version} ·{" "}
                  {a.kind === "mailbox_attachment"
                    ? uiText("privato")
                    : uiText("Workspace")}{" "}
                  · {a.hash.slice(0, 12)}
                </label>
              ))}
              <label>
                {uiText("Motivo bozza")}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <button disabled={busy}>{uiText("Salva bozza interna")}</button>
              <button type="button" onClick={reset}>
                {uiText("Nuova bozza")}
              </button>
            </form>
          </details>
          {view.drafts.length > 0 && (
            <label>
              {uiText(
                "Istruzione per Emme (solo testo della bozza e questa richiesta)",
              )}
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={4000}
              />
            </label>
          )}
          {composition && (
            <div>
              {composition.suggestion.needsClarification ? (
                <p>{composition.suggestion.needsClarification}</p>
              ) : (
                <>
                  <h4>
                    {uiText("Testo suggerito da Emme — ancora da salvare")}
                  </h4>
                  <p>{composition.suggestion.subject}</p>
                  <pre>{composition.suggestion.body}</pre>
                  <button
                    onClick={() => {
                      const d = view.drafts.find(
                        (d) =>
                          d.id === composition.draftId &&
                          d.version === composition.version,
                      );
                      if (!d) {
                        setError(errorText("EMAIL_DRAFT_STALE"));
                        return;
                      }
                      load(d);
                      setDraft({
                        ...d.envelope,
                        subject: composition.suggestion.subject,
                        body: composition.suggestion.body,
                      });
                      setCompositionId(composition.id);
                    }}
                  >
                    {uiText("Usa come revisione da controllare")}
                  </button>
                </>
              )}
            </div>
          )}
          {view.drafts.map((d) => (
            <article
              key={d.id}
              aria-label={uiText("Bozza: {0}", String(d.envelope.subject))}
              className="source-work-item"
            >
              <h3>
                {d.envelope.subject || uiText("Senza oggetto")}
                {uiText(" · v")}
                {d.version}
              </h3>
              <Envelope e={d.envelope} />
              <button
                disabled={busy || !instruction.trim()}
                onClick={() =>
                  void action(async () =>
                    setComposition(
                      await api<EmailComposition>(`${baseUrl}-compose`, {
                        draftId: d.id,
                        version: d.version,
                        instruction,
                      }),
                    ),
                  )
                }
              >
                {uiText("Suggerisci testo con Emme")}
              </button>
              <button disabled={busy} onClick={() => load(d)}>
                {uiText("Modifica bozza")}
              </button>
              <button
                disabled={
                  busy ||
                  !view.connections.some(
                    (c) => c.id === d.connectionId && c.active && c.canSend,
                  ) ||
                  view.actions.some(
                    (a) => a.draftId === d.id && a.version === d.version,
                  )
                }
                onClick={() =>
                  void perform({
                    type: "email.propose",
                    draftId: d.id,
                    version: d.version,
                    discloseToRecipients: true,
                  })
                }
              >
                {uiText("Controlla invio")}
              </button>
              <button
                onClick={() =>
                  void action(async () =>
                    setHistory(await api(`${baseUrl}-history?draftId=${d.id}`)),
                  )
                }
              >
                {uiText("Storia privata della bozza")}
              </button>
            </article>
          ))}
          {view.nextDrafts && (
            <button onClick={() => setBefore(view.nextDrafts)}>
              {uiText("Bozze precedenti")}
            </button>
          )}
          {before && (
            <button onClick={() => setBefore(null)}>
              {uiText("Bozze recenti")}
            </button>
          )}
          {view.actions.length > 0 && <h3>{uiText("Invii da controllare")}</h3>}
          {view.actions.map((a) => (
            <article
              key={a.id}
              data-testid={`email-action-${a.id}`}
              className="source-work-item"
            >
              <h4>
                {a.envelope.subject} · {uiText(sendLabels[a.status])}
                {uiText(" · v")}
                {a.version}
              </h4>
              <Envelope e={a.envelope} />
              {a.canAuthorize && (
                <p>
                  {uiText(
                    "Controlla destinatari, testo e allegati. Con la conferma invii questa versione dalla tua casella.",
                  )}
                </p>
              )}
              {a.error && (
                <details>
                  <summary>{uiText("Dettagli del servizio")}</summary>
                  <code>{a.error}</code>
                </details>
              )}
              {a.status === "OUTCOME_UNKNOWN" && (
                <p>
                  {uiText(
                    "Il provider potrebbe aver già accettato l’email. Non reinviare senza prova sufficiente.",
                  )}
                </p>
              )}
              {a.receipt && (
                <p>
                  {"submissionStatus" in a.receipt &&
                  a.receipt.submissionStatus === "accepted_for_processing"
                    ? uiText("Accettata da Outlook per l’invio.")
                    : uiText("Invio accettato dal servizio di posta.")}{" "}
                  {uiText("La consegna al destinatario resta da verificare.")}
                </p>
              )}
              {a.canAuthorize && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.authorize",
                      actionId: a.id,
                      version: a.version,
                      expectedContextRevision: view.contextRevision,
                      expectedAccessRevision: view.accessRevision,
                      representSelf: true,
                      discloseToRecipients: true,
                    })
                  }
                >
                  {uiText("Autorizza e invia")}
                </button>
              )}
              {a.canReject && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.reject",
                      actionId: a.id,
                      version: a.version,
                      reason: "Rifiuto esplicito",
                    })
                  }
                >
                  {uiText("Rifiuta invio")}
                </button>
              )}
              {a.canRetry && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.retry",
                      actionId: a.id,
                      version: a.version,
                    })
                  }
                >
                  {uiText("Riprova stesso invio")}
                </button>
              )}
              {a.canReconcile && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.reconcile",
                      actionId: a.id,
                      version: a.version,
                    })
                  }
                >
                  {uiText("Verifica l’invio")}
                </button>
              )}
            </article>
          ))}
          <h3>{uiText("Lettura privata")}</h3>
          <label>
            {uiText("Cerca nella tua posta")}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={500}
            />
          </label>
          {view.connections
            .filter((c) => c.active)
            .map((c) => (
              <div key={c.id}>
                <p>
                  {c.label} · {c.sender}
                  {uiText(" · lettura")}{" "}
                  {c.canRead
                    ? uiText("disponibile")
                    : uiText("non disponibile")}
                  {uiText(" · invio")}{" "}
                  {c.canSend ? uiText("personale") : uiText("non disponibile")}
                </p>
                <button
                  disabled={busy || !query.trim() || !c.canRead}
                  onClick={() =>
                    void perform({
                      type: "email.read",
                      connectionId: c.id,
                      request: { mode: "search", query },
                    })
                  }
                >
                  {uiText("Cerca privatamente · ")}
                  {c.label}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.disconnect",
                      connectionId: c.id,
                      expectedVersion: c.version,
                    })
                  }
                >
                  {uiText("Scollega casella")}
                </button>
              </div>
            ))}
          {view.observations.map((o) => (
            <div key={o.id}>
              <p>
                {uiText("Osservazione privata · ")}
                {new Date(o.observedAt).toLocaleString()} ·{" "}
                {o.data.complete
                  ? uiText("completa per la richiesta")
                  : uiText("parziale: recupera altro contesto")}
              </p>
              {o.data.messages.map((m) => {
                const key = `${o.id}:${m.id}`;
                return (
                  <article key={m.id} className="source-work-item">
                    <h4>{m.subject}</h4>
                    <p>
                      {uiText("Da ")}
                      {m.from}
                      {uiText(" · thread ")}
                      {m.threadId ?? uiText("non disponibile")}
                      {uiText(" · messaggio ")}
                      {m.id}
                    </p>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{m.body}</pre>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform({
                          type: "email.read",
                          connectionId: o.connectionId,
                          request: { mode: "message", targetId: m.id },
                        })
                      }
                    >
                      {uiText("Rileggi messaggio privato")}
                    </button>
                    {m.threadId && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            type: "email.read",
                            connectionId: o.connectionId,
                            request: {
                              mode: "thread",
                              targetId: m.threadId!,
                            },
                          })
                        }
                      >
                        {uiText("Leggi la conversazione in privato")}
                      </button>
                    )}
                    {(["reply", "forward"] as const).map((kind) => (
                      <button
                        key={kind}
                        disabled={busy}
                        onClick={() => {
                          reset();
                          setConnection(o.connectionId);
                          setShowEditor(true);
                          setDraft({
                            ...empty(
                              view.connections.find(
                                (c) => c.id === o.connectionId,
                              )!.sender,
                            ),
                            kind,
                            target: { observationId: o.id, messageId: m.id },
                            to:
                              kind === "reply"
                                ? m.replyTo.length
                                  ? m.replyTo
                                  : [m.from]
                                : [],
                            subject: `${kind === "reply" ? "Re" : "Fwd"}: ${m.subject}`,
                            body: kind === "forward" ? m.body : "",
                          });
                        }}
                      >
                        {kind === "reply"
                          ? uiText("Prepara risposta")
                          : uiText("Prepara inoltro")}
                      </button>
                    ))}
                    <label>
                      {uiText("Estratto da condividere")}
                      <textarea
                        aria-label={uiText("Estratto da condividere")}
                        value={excerpt[key] ?? ""}
                        onChange={(e) =>
                          setExcerpt({ ...excerpt, [key]: e.target.value })
                        }
                      />
                    </label>
                    <p>
                      {uiText(
                        "Condividi solo questo estratto con tutti i membri attuali e futuri ammessi alla storia conservata. Non diventa automaticamente informazione accettata.",
                      )}
                    </p>
                    <button
                      disabled={busy || !excerpt[key]?.trim()}
                      onClick={() =>
                        void perform({
                          type: "email.disclose",
                          observationId: o.id,
                          messageId: m.id,
                          text: excerpt[key],
                          fullHistoryDisclosed: true,
                        })
                      }
                    >
                      {uiText("Condividi questo estratto nello spazio")}
                    </button>
                    {m.attachments.map((a) => (
                      <button
                        key={a.id}
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            type: "email.read",
                            connectionId: o.connectionId,
                            request: {
                              mode: "attachment",
                              observationId: o.id,
                              messageId: m.id,
                              attachmentId: a.id,
                            },
                          })
                        }
                      >
                        {uiText("Leggi allegato privato: ")}
                        {a.filename}
                      </button>
                    ))}
                  </article>
                );
              })}
              {o.data.nextCursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      type: "email.read",
                      connectionId: o.connectionId,
                      request:
                        o.request.mode === "search"
                          ? {
                              mode: "search",
                              query: o.request.query!,
                              cursor: o.data.nextCursor!,
                            }
                          : {
                              mode: o.request.mode,
                              targetId: o.request.targetId!,
                              cursor: o.data.nextCursor!,
                            },
                    })
                  }
                >
                  {uiText("Continua lettura privata")}
                </button>
              )}
            </div>
          ))}
          {view.attachments.map((a) => (
            <div key={a.id}>
              <a href={`${baseUrl}-attachment?id=${a.id}`}>
                {uiText("Scarica per te: ")}
                {a.filename}
              </a>
              <p>
                {uiText(
                  "Condividere questo file ne rende visibile il contenuto a tutti i membri attuali e futuri ammessi alla storia conservata.",
                )}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void perform({
                    type: "email.attachment.disclose",
                    attachmentId: a.id,
                    fullHistoryDisclosed: true,
                  })
                }
              >
                {uiText("Condividi allegato nello spazio: ")}
                {a.filename}
              </button>
            </div>
          ))}
          {view.reads
            .filter((r) => r.status !== "COMPLETED")
            .map((r) => (
              <p key={r.id}>
                {uiText("Lettura: ")}
                {r.status} {r.error}
              </p>
            ))}
          {view.disclosures.length > 0 && (
            <h3>{uiText("Estratti condivisi")}</h3>
          )}
          {view.disclosures.map((d) => (
            <p key={d.id}>
              {uiText("Fonte condivisa esplicitamente ·")}{" "}
              <a href={`/api/workspaces/${workspace}/sources/${d.sourceId}`}>
                {d.sourceId}
              </a>{" "}
              · {d.createdAt}
            </p>
          ))}
          {history !== null && (
            <details open>
              <summary>{uiText("Storia privata")}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(history, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
      <ProductHelp screen="email" />
    </section>
  );
}
function Envelope({ e }: { e: EmailEnvelope }) {
  const { t: uiText } = useUiLanguage();
  return (
    <>
      <p>
        {uiText("Da: ")}
        {e.sender}
        <br />
        {uiText("To: ")}
        {e.to.join(", ")}
        <br />
        {uiText("CC: ")}
        {e.cc.join(", ") || "—"}
        <br />
        {uiText("BCC: ")}
        {e.bcc.join(", ") || "—"}
      </p>
      <p>
        {e.kind}{" "}
        {e.target ? uiText("· messaggio {0}", String(e.target.messageId)) : ""}
      </p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{e.body}</pre>
      {e.attachments.map((a) => (
        <p key={a.id}>
          {uiText("Allegato: ")}
          {a.filename}
          {uiText(" · v")}
          {a.version}
          {uiText(" · SHA256 ")}
          {a.hash}
        </p>
      ))}
    </>
  );
}
