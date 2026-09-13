"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
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
const addresses = (s: string) => s.split(",").map((s) => s.trim());
export function WorkspaceEmail({
  workspace,
  actor,
  email,
  command,
  action,
  busy,
}: {
  workspace: string;
  actor: string;
  email: string;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [view, setView] = useState<EmailView | null>(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
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
    if (!open) return;
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
            setError(e.message);
          }
        });
    };
    read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, actor, open]);
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setView(await api<EmailView>(url));
    });
  const change = (key: keyof EmailEnvelope, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function load(d: EmailView["drafts"][number]) {
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
    <section className="card source-work" aria-label="Email dello spazio">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Workspace Email</summary>
        <p>
          Mailbox, bozze e invii qui sono riservati a te. Solo i contenuti che
          condividi esplicitamente entrano nella storia dello spazio.
        </p>
        {error && <p role="alert">{error}</p>}
        {view && (
          <>
            {!view.providerConfigured && (
              <p>
                Provider Email non configurato. Puoi preparare bozze interne;
                nessuna mailbox o email esterna viene simulata.
              </p>
            )}
            <h3>Bozza interna {editing ? `· v${editing.version}` : ""}</h3>
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
                Mailbox verificata
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
                  <option value="">Non collegata — solo bozza</option>
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
                Da: {draft.sender} · {draft.kind}
                {draft.target ? ` · messaggio ${draft.target.messageId}` : ""}
              </p>
              {(["to", "cc", "bcc"] as const).map((k) => (
                <label key={k}>
                  {k.toUpperCase()}
                  <input
                    aria-label={`Email ${k.toUpperCase()}`}
                    value={draft[k].join(", ")}
                    onChange={(e) => change(k, addresses(e.target.value))}
                  />
                </label>
              ))}
              <label>
                Oggetto email
                <input
                  value={draft.subject}
                  onChange={(e) => change("subject", e.target.value)}
                  maxLength={500}
                />
              </label>
              <label>
                Corpo email
                <textarea
                  aria-label="Corpo email"
                  value={draft.body}
                  onChange={(e) => change("body", e.target.value)}
                  maxLength={24000}
                  rows={6}
                />
              </label>
              <p>
                Allegati precisi. Selezionarli non invia né condivide
                automaticamente.
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
                  {a.filename} · v{a.version} ·{" "}
                  {a.kind === "mailbox_attachment" ? "privato" : "Workspace"} ·{" "}
                  {a.hash.slice(0, 12)}
                </label>
              ))}
              <label>
                Motivo bozza
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <button disabled={busy}>Salva bozza interna</button>
              <button type="button" onClick={reset}>
                Nuova bozza
              </button>
            </form>
            <label>
              Istruzione per Miriam (solo testo della bozza e questa richiesta)
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={4000}
              />
            </label>
            {composition && (
              <div>
                {composition.suggestion.needsClarification ? (
                  <p>{composition.suggestion.needsClarification}</p>
                ) : (
                  <>
                    <h4>Testo suggerito da Miriam — ancora da salvare</h4>
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
                          setError("EMAIL_DRAFT_STALE");
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
                      Usa come revisione da controllare
                    </button>
                  </>
                )}
              </div>
            )}
            {view.drafts.map((d) => (
              <article
                key={d.id}
                aria-label={`Bozza: ${d.envelope.subject}`}
                className="source-work-item"
              >
                <h3>
                  {d.envelope.subject || "Senza oggetto"} · v{d.version}
                </h3>
                <Envelope e={d.envelope} />
                <button
                  disabled={busy || !instruction.trim()}
                  onClick={() =>
                    void action(async () =>
                      setComposition(
                        await api<EmailComposition>(`${baseUrl}-compose`, {
                          method: "POST",
                          body: JSON.stringify({
                            draftId: d.id,
                            version: d.version,
                            instruction,
                          }),
                        }),
                      ),
                    )
                  }
                >
                  Suggerisci testo con Miriam
                </button>
                <button disabled={busy} onClick={() => load(d)}>
                  Modifica bozza
                </button>
                <button
                  disabled={
                    busy ||
                    !d.connectionId ||
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
                  Prepara proposta di invio esatta
                </button>
                <button
                  onClick={() =>
                    void action(async () =>
                      setHistory(
                        await api(`${baseUrl}-history?draftId=${d.id}`),
                      ),
                    )
                  }
                >
                  Storia privata della bozza
                </button>
              </article>
            ))}
            {view.nextDrafts && (
              <button onClick={() => setBefore(view.nextDrafts)}>
                Bozze precedenti
              </button>
            )}
            {before && (
              <button onClick={() => setBefore(null)}>Bozze recenti</button>
            )}
            <h3>Proposte e risultati privati</h3>
            {view.actions.map((a) => (
              <article
                key={a.id}
                data-testid={`email-action-${a.id}`}
                className="source-work-item"
              >
                <h4>
                  {a.envelope.subject} · {a.status} · v{a.version}
                </h4>
                <Envelope e={a.envelope} />
                <p>
                  Autorizzare divulga esattamente questo contenuto e questi
                  allegati ai destinatari indicati, inclusi CC e BCC.
                  Rappresenti soltanto te.
                </p>
                {a.error && <p>{a.error}</p>}
                {a.status === "OUTCOME_UNKNOWN" && (
                  <p>
                    Il provider potrebbe aver già accettato l’email. Non
                    reinviare senza prova sufficiente.
                  </p>
                )}
                {a.receipt && (
                  <p>
                    Accettata dal provider: {a.receipt.providerMessageId}. Non
                    prova lettura o consegna finale.
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
                    Autorizzo invio e disclosure per me
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
                    Rifiuta invio
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
                    Riprova stesso invio
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
                    Verifica esito email
                  </button>
                )}
              </article>
            ))}
            <h3>Lettura privata</h3>
            <label>
              Ricerca nella mailbox
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
                    {c.label} · {c.sender} · lettura{" "}
                    {c.canRead ? "disponibile" : "non disponibile"} · invio{" "}
                    {c.canSend ? "personale" : "non disponibile"}
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
                    Cerca privatamente · {c.label}
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
                    Disconnetti mailbox
                  </button>
                </div>
              ))}
            {view.observations.map((o) => (
              <div key={o.id}>
                <p>
                  Osservazione privata ·{" "}
                  {new Date(o.observedAt).toLocaleString()} ·{" "}
                  {o.data.complete
                    ? "completa per la richiesta"
                    : "parziale: recupera altro contesto"}
                </p>
                {o.data.messages.map((m) => {
                  const key = `${o.id}:${m.id}`;
                  return (
                    <article key={m.id} className="source-work-item">
                      <h4>{m.subject}</h4>
                      <p>
                        Da {m.from} · thread {m.threadId ?? "non disponibile"} ·
                        messaggio {m.id}
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
                        Rileggi messaggio privato
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
                          Leggi thread privato
                        </button>
                      )}
                      {(["reply", "forward"] as const).map((kind) => (
                        <button
                          key={kind}
                          disabled={busy}
                          onClick={() => {
                            reset();
                            setConnection(o.connectionId);
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
                            ? "Prepara reply"
                            : "Prepara forward"}
                        </button>
                      ))}
                      <label>
                        Estratto da condividere
                        <textarea
                          aria-label="Estratto da condividere"
                          value={excerpt[key] ?? ""}
                          onChange={(e) =>
                            setExcerpt({ ...excerpt, [key]: e.target.value })
                          }
                        />
                      </label>
                      <p>
                        Condividi solo questo estratto con tutti i membri
                        attuali e futuri ammessi alla storia conservata. Non
                        diventa automaticamente informazione accettata.
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
                        Condividi questo estratto nello spazio
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
                          Leggi allegato privato: {a.filename}
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
                    Continua lettura privata
                  </button>
                )}
              </div>
            ))}
            {view.attachments.map((a) => (
              <div key={a.id}>
                <a href={`${baseUrl}-attachment?id=${a.id}`}>
                  Scarica privatamente {a.filename}
                </a>
                <p>
                  Condividere questo file ne rende visibile il contenuto a tutti
                  i membri attuali e futuri ammessi alla storia conservata.
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
                  Condividi allegato nello spazio: {a.filename}
                </button>
              </div>
            ))}
            {view.reads
              .filter((r) => r.status !== "COMPLETED")
              .map((r) => (
                <p key={r.id}>
                  Lettura: {r.status} {r.error}
                </p>
              ))}
            <h3>Disclosure condivise</h3>
            {view.disclosures.map((d) => (
              <p key={d.id}>
                Fonte condivisa esplicitamente ·{" "}
                <a href={`/api/workspaces/${workspace}/sources/${d.sourceId}`}>
                  {d.sourceId}
                </a>{" "}
                · {d.createdAt}
              </p>
            ))}
            {history !== null && (
              <details open>
                <summary>Storia privata</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(history, null, 2)}
                </pre>
              </details>
            )}
          </>
        )}
      </details>
    </section>
  );
}
function Envelope({ e }: { e: EmailEnvelope }) {
  return (
    <>
      <p>
        Da: {e.sender}
        <br />
        To: {e.to.join(", ")}
        <br />
        CC: {e.cc.join(", ") || "—"}
        <br />
        BCC: {e.bcc.join(", ") || "—"}
      </p>
      <p>
        {e.kind} {e.target ? `· messaggio ${e.target.messageId}` : ""}
      </p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{e.body}</pre>
      {e.attachments.map((a) => (
        <p key={a.id}>
          Allegato: {a.filename} · v{a.version} · SHA256 {a.hash}
        </p>
      ))}
    </>
  );
}
