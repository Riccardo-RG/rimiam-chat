import { useUiLanguage } from "../i18n";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import type {
  EmailEnvelope,
  EmailMessage,
  EmailView,
} from "../../../src/contracts/email";
import { Action, Field } from "../ui";
import { Body, Label, Section, confirm } from "./parts";
import {
  MailEditor,
  type MailEditorInput,
  type MailPerform,
} from "./mail-editor";
import { DraftDetails } from "./DraftDetails";
import { shareFile } from "../sharedFile";
import { problem, type NativeRequest } from "../api";
import { newEnvelope } from "./inputs";

const statuses = {
  PROPOSED: "Da autorizzare",
  AUTHORIZED: "Autorizzato",
  EXECUTING: "Invio in corso",
  SUCCEEDED: "Accettato dal provider",
  FAILED: "Invio non riuscito",
  OUTCOME_UNKNOWN: "Esito incerto",
  REJECTED: "Rifiutato",
} as const;

function Envelope({ value: v }: { value: EmailEnvelope }) {
  const { t: uiText } = useUiLanguage();
  return (
    <View style={{ gap: 4 }}>
      <Body>{v.subject || uiText("Senza oggetto")}</Body>
      <Label>
        {uiText("Da ")}
        {v.sender}
      </Label>
      <Label>
        {uiText("A ")}
        {v.to.join(", ") || "—"}
      </Label>
      <Label>
        {uiText("Cc ")}
        {v.cc.join(", ") || "—"}
      </Label>
      <Label>
        {uiText("Ccn ")}
        {v.bcc.join(", ") || "—"}
      </Label>
      <Body>{v.body || uiText("Corpo vuoto")}</Body>
      {!!v.target && (
        <Label>
          {v.kind === "reply" ? uiText("In risposta a") : uiText("Inoltro di")}{" "}
          {v.target.messageId}
        </Label>
      )}
      {v.attachments.map((a) => (
        <Label key={a.kind + a.id}>
          {a.filename}
          {uiText(" · v")}
          {a.version}
          {uiText(" · SHA-256 ")}
          {a.hash}
        </Label>
      ))}
    </View>
  );
}

function ObservedMessage({
  observationId,
  message,
  activeConnection,
  busy,
  perform,
  edit,
}: {
  observationId: string;
  message: EmailMessage;
  activeConnection?: EmailView["connections"][number];
  busy: boolean;
  perform: MailPerform;
  edit: (value: MailEditorInput) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState(false);
  const [excerpt, setExcerpt] = useState("");
  const target = { observationId, messageId: message.id };
  return (
    <View style={{ gap: 6 }}>
      <Action
        label={message.subject + " · " + message.from}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Label>
            {new Date(message.sentAt).toLocaleString(locale)}
            {uiText(" · A")} {message.to.join(", ")}
          </Label>
          <Body>{message.body}</Body>
          {activeConnection?.canSend &&
            (["reply", "forward"] as const).map((kind) => (
              <Action
                key={kind}
                label={
                  kind === "reply"
                    ? uiText("Prepara risposta")
                    : uiText("Prepara inoltro")
                }
                disabled={busy}
                onPress={() =>
                  edit({
                    connectionId: activeConnection.id,
                    envelope: {
                      ...newEnvelope(activeConnection.sender),
                      kind,
                      target,
                      to:
                        kind === "reply"
                          ? message.replyTo.length
                            ? message.replyTo
                            : [message.from]
                          : [],
                      subject:
                        (kind === "reply" ? "Re: " : "Fwd: ") + message.subject,
                      body: kind === "forward" ? message.body : "",
                    },
                  })
                }
              />
            ))}
          {activeConnection?.canRead && message.threadId && (
            <Action
              label={uiText("Leggi la conversazione privata")}
              disabled={busy}
              onPress={() =>
                perform(
                  {
                    type: "email.read",
                    connectionId: activeConnection.id,
                    request: { mode: "thread", targetId: message.threadId! },
                  },
                  "Leggi conversazione email",
                )
              }
            />
          )}
          {activeConnection?.canRead &&
            message.attachments.map((a) => (
              <Action
                key={a.id}
                label={uiText("Recupera {0}", String(a.filename))}
                disabled={busy}
                onPress={() =>
                  perform(
                    {
                      type: "email.read",
                      connectionId: activeConnection.id,
                      request: {
                        mode: "attachment",
                        ...target,
                        attachmentId: a.id,
                      },
                    },
                    "Leggi allegato privato",
                  )
                }
              />
            ))}
          <Action
            label={
              share
                ? uiText("Chiudi condivisione")
                : uiText("Condividi un estratto…")
            }
            onPress={() => setShare(!share)}
          />
          {share && (
            <>
              <Field
                label={uiText("Testo esatto da condividere")}
                multiline
                maxLength={12000}
                value={excerpt}
                onChangeText={setExcerpt}
              />
              <Action
                disabled={
                  busy ||
                  !excerpt.trim() ||
                  !message.body.includes(excerpt.trim())
                }
                label={uiText("Condividi estratto nello spazio")}
                onPress={() =>
                  confirm(
                    uiText,
                    uiText("Condividere l’estratto?"),
                    "I membri attuali e futuri ammessi alla cronologia dello spazio vedranno questo testo.\n\n" +
                      excerpt.trim(),
                    uiText("Condividi"),
                    () =>
                      perform(
                        {
                          type: "email.disclose",
                          ...target,
                          text: excerpt.trim(),
                          fullHistoryDisclosed: true,
                        },
                        "Condividi estratto",
                      ),
                  )
                }
              />
            </>
          )}
        </>
      )}
    </View>
  );
}

export function EmailPanel({
  view,
  base,
  request,
  email,
  busy,
  perform,
  saved,
  canContribute,
  page,
  onPage,
}: {
  view: EmailView;
  base: string;
  request: NativeRequest;
  email: string;
  busy: boolean;
  perform: MailPerform;
  saved: number;
  canContribute: boolean;
  page: string | null;
  onPage: (next: string | null) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [editor, setEditor] = useState<MailEditorInput | null>(null);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setEditor(null), [saved]);
  const active = view.connections.filter((c) => c.active);
  const readable = active.filter((c) => c.canRead);
  function readMail(connectionId: string) {
    if (busy || !query.trim()) return;
    Keyboard.dismiss();
    perform(
      {
        type: "email.read",
        connectionId,
        request: { mode: "search", query: query.trim() },
      },
      "Leggi posta privata",
    );
  }
  function start() {
    const senders = active.filter((c) => c.canSend);
    const c = senders.length === 1 ? senders[0] : null;
    setEditor({
      connectionId: c?.id ?? null,
      envelope: newEnvelope(c?.sender ?? email),
    });
  }
  if (editor)
    return (
      <MailEditor
        editor={editor}
        email={email}
        view={view}
        busy={busy}
        perform={perform}
        onClose={() => setEditor(null)}
      />
    );
  return (
    <>
      <Section title={uiText("Bozze private")}>
        {canContribute && (
          <Action
            label={uiText("Scrivi una bozza")}
            primary
            onPress={start}
            disabled={busy || !email}
          />
        )}
        {!view.drafts.length && (
          <Label>{uiText("Nessuna bozza in questa pagina.")}</Label>
        )}
        {view.drafts.map((d) => (
          <View key={d.id} style={{ gap: 6 }}>
            <Action
              label={uiText(
                "{0} · v{1}",
                String(d.envelope.subject || "Senza oggetto"),
                String(d.version),
              )}
              onPress={() => setExpanded(expanded === d.id ? null : d.id)}
            />
            {expanded === d.id && (
              <>
                <Envelope value={d.envelope} />
                <DraftDetails
                  key={d.id + d.version}
                  draft={d}
                  base={base}
                  request={request}
                  disabled={busy}
                  canContribute={canContribute}
                  edit={setEditor}
                />
                <Action
                  label={uiText("Modifica bozza")}
                  disabled={busy || !canContribute}
                  onPress={() =>
                    setEditor({
                      envelope: d.envelope,
                      connectionId: d.connectionId,
                      existing: d,
                    })
                  }
                />
                <Action
                  label={uiText("Controlla invio")}
                  disabled={
                    busy ||
                    !canContribute ||
                    !active.some((c) => c.canSend && c.id === d.connectionId) ||
                    view.actions.some(
                      (a) => a.draftId === d.id && a.version === d.version,
                    )
                  }
                  onPress={() =>
                    perform(
                      {
                        type: "email.propose",
                        draftId: d.id,
                        version: d.version,
                        discloseToRecipients: true,
                      },
                      "Prepara conferma di invio",
                    )
                  }
                />
              </>
            )}
          </View>
        ))}
        {view.nextDrafts && (
          <Action
            label={uiText("Bozze precedenti")}
            onPress={() => onPage(view.nextDrafts)}
          />
        )}
        {page && (
          <Action
            label={uiText("Bozze recenti")}
            onPress={() => onPage(null)}
          />
        )}
      </Section>
      {view.actions.length > 0 && (
        <Section title={uiText("Invii da controllare")}>
          {view.actions.map((a) => (
            <View key={a.id} style={{ gap: 6 }}>
              <Action
                label={uiText(
                  "{0} · {1} · v{2}",
                  String(a.envelope.subject || "Senza oggetto"),
                  String(uiText(statuses[a.status])),
                  String(a.version),
                )}
                onPress={() => setExpanded(expanded === a.id ? null : a.id)}
              />
              {expanded === a.id && (
                <>
                  <Envelope value={a.envelope} />
                  {a.status === "OUTCOME_UNKNOWN" && (
                    <Label>
                      {uiText(
                        "Il provider potrebbe aver accettato il messaggio. Verifica l’esito.",
                      )}
                    </Label>
                  )}
                  {a.error && <Label>{a.error}</Label>}
                  {a.receipt && (
                    <Label>
                      {uiText("Accettazione del provider ·")}{" "}
                      {new Date(a.receipt.acceptedAt).toLocaleString(locale)}
                    </Label>
                  )}
                  {a.canAuthorize && (
                    <Action
                      primary
                      label={uiText(
                        "Autorizza l’invio v{0}",
                        String(a.version),
                      )}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          uiText,
                          uiText("Inviare dalla tua casella?"),
                          "Confermi destinatari, Cc, Ccn, testo e allegati della versione " +
                            a.version +
                            " appena mostrata.",
                          uiText("Invia"),
                          () =>
                            perform(
                              {
                                type: "email.authorize",
                                actionId: a.id,
                                version: a.version,
                                expectedAccessRevision: view.accessRevision,
                                expectedContextRevision: view.contextRevision,
                                representSelf: true,
                                discloseToRecipients: true,
                              },
                              "Autorizza invio email",
                            ),
                        )
                      }
                    />
                  )}
                  {a.canReject && (
                    <Action
                      label={uiText("Rifiuta invio")}
                      disabled={busy}
                      onPress={() =>
                        perform(
                          {
                            type: "email.reject",
                            actionId: a.id,
                            version: a.version,
                            reason: "Invio rifiutato dal mittente",
                          },
                          "Rifiuta invio",
                        )
                      }
                    />
                  )}
                  {a.canRetry && (
                    <Action
                      label={uiText("Riprova lo stesso invio")}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          uiText,
                          uiText("Riprovare questa versione?"),
                          a.envelope.subject,
                          uiText("Riprova"),
                          () =>
                            perform(
                              {
                                type: "email.retry",
                                actionId: a.id,
                                version: a.version,
                              },
                              "Riprova invio autorizzato",
                            ),
                        )
                      }
                    />
                  )}
                  {a.canReconcile && (
                    <Action
                      label={uiText("Verifica esito")}
                      disabled={busy}
                      onPress={() =>
                        perform(
                          {
                            type: "email.reconcile",
                            actionId: a.id,
                            version: a.version,
                          },
                          "Verifica esito email",
                        )
                      }
                    />
                  )}
                </>
              )}
            </View>
          ))}
        </Section>
      )}
      {active.length > 0 && (
        <Section title={uiText("Lettura privata")}>
          {active.some((c) => c.canRead) && (
            <Field
              label={uiText("Cerca nella casella")}
              value={query}
              onChangeText={setQuery}
              returnKeyType={readable.length === 1 ? "search" : "done"}
              onSubmitEditing={() => {
                if (readable.length === 1) readMail(readable[0].id);
                else Keyboard.dismiss();
              }}
              maxLength={500}
            />
          )}
          {active.map((c) => (
            <View key={c.id} style={{ gap: 6 }}>
              {c.canRead && (
                <Action
                  label={uiText("Cerca in {0}", String(c.sender))}
                  disabled={busy || !query.trim()}
                  onPress={() => readMail(c.id)}
                />
              )}
              <Action
                label={uiText("Scollega {0}", String(c.sender))}
                disabled={busy}
                onPress={() =>
                  confirm(
                    uiText,
                    uiText("Scollegare la casella?"),
                    c.sender +
                      " sarà scollegata da questo spazio. Le letture già salvate rimangono nella cronologia.",
                    uiText("Scollega"),
                    () =>
                      perform(
                        {
                          type: "email.disconnect",
                          connectionId: c.id,
                          expectedVersion: c.version,
                        },
                        "Scollega casella",
                      ),
                  )
                }
              />
            </View>
          ))}
        </Section>
      )}
      {view.reads
        .filter((r) => r.status !== "COMPLETED")
        .map((r) => (
          <Label key={r.id}>
            {uiText("Lettura · ")}
            {r.status}
            {r.error ? " · " + r.error : ""}
          </Label>
        ))}
      {view.observations.map((o) => (
        <Section
          key={o.id}
          title={uiText(
            "Lettura privata · {0}",
            String(new Date(o.observedAt).toLocaleString(locale)),
          )}
        >
          {!o.data.messages.length && (
            <Label>{uiText("Nessun messaggio in questa lettura.")}</Label>
          )}
          {o.data.messages.map((m) => (
            <ObservedMessage
              key={m.id}
              observationId={o.id}
              message={m}
              activeConnection={active.find((c) => c.id === o.connectionId)}
              busy={busy || !canContribute}
              perform={perform}
              edit={setEditor}
            />
          ))}
          {o.data.nextCursor && (
            <Action
              label={uiText("Altri risultati")}
              disabled={busy}
              onPress={() => {
                const cursor = o.data.nextCursor!;
                const request =
                  o.request.mode === "search" && o.request.query
                    ? {
                        mode: "search" as const,
                        query: o.request.query,
                        cursor,
                      }
                    : o.request.mode !== "search" && o.request.targetId
                      ? {
                          mode: o.request.mode,
                          targetId: o.request.targetId,
                          cursor,
                        }
                      : null;
                if (request)
                  perform(
                    {
                      type: "email.read",
                      connectionId: o.connectionId,
                      request,
                    },
                    "Continua lettura privata",
                  );
              }}
            />
          )}
        </Section>
      ))}
      {view.attachments.length > 0 && (
        <Section title={uiText("Allegati privati recuperati")}>
          {!!exportError && <Label>{exportError}</Label>}
          {view.attachments.map((a) => (
            <View key={a.id} style={{ gap: 6 }}>
              <Body>{a.filename}</Body>
              <Label>
                {uiText("v")}
                {a.version}
                {uiText(" · SHA-256 ")}
                {a.hash}
              </Label>
              <Action
                label={uiText("Esporta una copia sul dispositivo")}
                disabled={busy || exporting}
                onPress={() =>
                  confirm(
                    uiText,
                    uiText("Esportare il file privato?"),
                    "Scegli un’app o una destinazione sul dispositivo per " +
                      a.filename +
                      ".",
                    uiText("Continua"),
                    () => {
                      setExportError("");
                      setExporting(true);
                      void shareFile(
                        request,
                        base + "-attachment?id=" + a.id,
                        a.filename,
                        "application/octet-stream",
                      )
                        .catch((e) => setExportError(problem(e)))
                        .finally(() => setExporting(false));
                    },
                  )
                }
              />
              <Action
                label={uiText("Condividi allegato nello spazio")}
                disabled={busy || !canContribute}
                onPress={() =>
                  confirm(
                    uiText,
                    uiText("Condividere il file?"),
                    a.filename +
                      " sarà visibile ai membri attuali e futuri ammessi alla storia dello spazio.",
                    uiText("Condividi"),
                    () =>
                      perform(
                        {
                          type: "email.attachment.disclose",
                          attachmentId: a.id,
                          fullHistoryDisclosed: true,
                        },
                        "Condividi allegato",
                      ),
                  )
                }
              />
            </View>
          ))}
        </Section>
      )}
    </>
  );
}
