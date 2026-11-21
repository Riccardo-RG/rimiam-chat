"use client";
import { useUiLanguage } from "./ui-language";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type {
  acceptedInvitationSchema,
  incomingInvitationsSchema,
} from "@/contracts/v1";
import { api, errorText } from "./api";
import type { Snapshot } from "./types";
import { invitationDeliveryLabel } from "@/shared/invitation-delivery";
import { ProductHelp } from "./product-help";

export interface PersonalInvitation {
  id: string;
  link: string;
  recipient: string;
  emailRequested: boolean;
}

export function InvitationAdmission({
  workspaceName,
  busy,
  accept,
}: {
  workspaceName: string;
  busy: boolean;
  accept: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <form
      className="invitation-admission"
      onSubmit={(event) => {
        event.preventDefault();
        accept();
      }}
    >
      <h2>
        {uiText("Entra in ")}
        {workspaceName}
      </h2>
      <p>
        {uiText(
          "Entrando potrai leggere tutti i contenuti condivisi conservati nello spazio, comprese conversazioni, fonti e versioni precedenti al tuo ingresso o ai periodi di assenza. Anche i futuri membri avranno questa visibilità. Uscire interrompe l’accesso successivo, ma non ritira quanto è già stato condiviso.",
        )}
      </p>
      <p>
        {uiText(
          "Potrai scrivere in chat. Entrare nello spazio non ti dà il permesso di invitare o amministrare e non implica la tua adesione all’obiettivo o alle decisioni.",
        )}
      </p>
      <label className="check">
        <input type="checkbox" required />
        {uiText(
          "Accetto esplicitamente di entrare con questa visibilità della storia.",
        )}
      </label>
      <button disabled={busy}>
        {busy
          ? uiText("Ingresso in corso…")
          : uiText("Accetta invito ed entra")}
      </button>
    </form>
  );
}

type ReceivedInvitations = z.infer<typeof incomingInvitationsSchema>;
export type InboxAvailability =
  "checking" | "pending" | "empty" | "unavailable";

export function IncomingInvitations({
  accepted,
  refreshSpaces,
  onAvailability,
  showSingle,
}: {
  accepted: (workspaceId: string) => void;
  refreshSpaces: () => void;
  onAvailability: (status: InboxAvailability) => void;
  showSingle: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [invitations, setInvitations] = useState<
    ReceivedInvitations["invitations"]
  >([]);
  const [readError, setReadError] = useState("");
  const [acceptError, setAcceptError] = useState("");
  const [accepting, setAccepting] = useState("");
  const [expanded, setExpanded] = useState(false);
  const read = useRef<AbortController | null>(null);
  const submission = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (read.current) return;
    const controller = new AbortController();
    read.current = controller;
    return api<ReceivedInvitations>(
      "/api/v1/invitations",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setInvitations(result.invitations);
        onAvailability(result.invitations.length ? "pending" : "empty");
        setReadError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setInvitations([]);
        onAvailability("unavailable");
        setReadError(errorText(error));
      })
      .finally(() => {
        if (read.current === controller) read.current = null;
      });
  }, [onAvailability]);
  useEffect(() => {
    void refresh();
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refresh();
    };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      read.current?.abort();
      read.current = null;
      submission.current?.abort();
      submission.current = null;
    };
  }, [refresh]);
  async function accept(id: string) {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setAccepting(id);
    setAcceptError("");
    try {
      const result = await api<z.infer<typeof acceptedInvitationSchema>>(
        `/api/v1/invitations/${id}/accept`,
        { fullHistoryAccepted: true },
        controller.signal,
      );
      if (!controller.signal.aborted) accepted(result.workspaceId);
    } catch (error) {
      if (controller.signal.aborted) return;
      setAcceptError(errorText(error));
      // Re-read both views after an invalid invitation or an uncertain response.
      read.current?.abort();
      read.current = null;
      void refresh();
      refreshSpaces();
    } finally {
      if (submission.current === controller) {
        submission.current = null;
        setAccepting("");
      }
    }
  }
  if (!invitations.length && !readError && !acceptError) return null;
  return (
    <section
      className="incoming-invitations"
      aria-label={uiText("Inviti ricevuti")}
    >
      <div className="invitation-heading">
        <h2>{uiText("Inviti ricevuti")}</h2>
        {invitations.length > 1 && (
          <button
            type="button"
            className="quiet"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? uiText("Nascondi inviti")
              : uiText("Mostra {0} inviti", String(invitations.length))}
          </button>
        )}
      </div>
      {readError && (
        <div role="alert">
          <p>
            {uiText("Non riesco a caricare gli inviti. ")}
            {readError}
          </p>
          <button
            type="button"
            className="quiet"
            onClick={() => void refresh()}
          >
            {uiText("Ricarica inviti")}
          </button>
        </div>
      )}
      {acceptError && (
        <div role="alert">
          <p>{acceptError}</p>
          <button
            type="button"
            className="quiet"
            onClick={() => setAcceptError("")}
          >
            {uiText("Chiudi avviso")}
          </button>
        </div>
      )}
      {(expanded || invitations.length === 1) &&
        invitations.map((invitation) => (
          <details
            key={invitation.id}
            open={showSingle && invitations.length === 1}
          >
            <summary>
              <span className="invitation-identities">
                <strong>{invitation.workspaceName}</strong>
                <span>
                  {uiText("Ti invita ")}
                  {invitation.inviterName}
                </span>
              </span>
              <span className="invitation-detail-link">
                {uiText("Vedi invito")}
              </span>
            </summary>
            <InvitationAdmission
              workspaceName={invitation.workspaceName}
              busy={!!accepting}
              accept={() => void accept(invitation.id)}
            />
          </details>
        ))}
    </section>
  );
}

export function WorkspaceInvitation({
  receipt,
  record,
  busy,
  error,
  create,
  another,
}: {
  receipt: PersonalInvitation | null;
  record?: Snapshot["invitations"][number];
  busy: boolean;
  error: string;
  create: (email: string, sendEmail: boolean) => void;
  another: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const linkField = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const expiresAt = record?.expires_at;
  const [expired, setExpired] = useState(
    () => !!expiresAt && Date.parse(expiresAt) <= Date.now(),
  );
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  if (receipt) {
    const ended = record?.accepted_at
      ? "Invito accettato"
      : record?.revoked_at
        ? "Invito revocato"
        : expired
          ? "Invito scaduto"
          : null;
    return (
      <div className="invitation-flow">
        <div role="status">
          <h3>{ended ?? uiText("Invito creato")}</h3>
          <p>{receipt.recipient}</p>
          {!ended && (
            <>
              <p>
                {uiText(
                  "La persona vedrà l’invito quando accede con questa email verificata. Puoi anche copiare il link e mandarglielo.",
                )}
              </p>
              <p className="hint">
                {record
                  ? uiText(invitationDeliveryLabel(record.delivery_status))
                  : receipt.emailRequested
                    ? uiText("Invio email richiesto.")
                    : uiText(
                        "Invito disponibile tramite link. Nessuna email richiesta.",
                      )}
              </p>
            </>
          )}
        </div>
        {!ended && (
          <>
            <label>
              {uiText("Condividi il link solo con il destinatario")}
              <input
                ref={linkField}
                readOnly
                value={receipt.link}
                aria-label={uiText("Link invito")}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(receipt.link);
                  setCopyStatus("Link copiato.");
                } catch {
                  linkField.current?.focus();
                  linkField.current?.select();
                  setCopyStatus("Seleziona e copia il link dal campo.");
                }
              }}
            >
              {uiText("Copia link")}
            </button>
            <span role="status">{copyStatus}</span>
          </>
        )}
        <button className="quiet" type="button" onClick={another}>
          {uiText("Invita un’altra persona")}
        </button>
      </div>
    );
  }
  return (
    <form
      className="invitation-flow"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        create(
          String(data.get("email")).trim(),
          data.get("sendEmail") === "on",
        );
      }}
    >
      <label>
        {uiText("Email del destinatario")}
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <p className="hint">
        {uiText(
          "Chi accetta può scrivere in chat. Per invitare altre persone o gestire gli accessi servono permessi separati.",
        )}
      </p>
      <fieldset className="invitation-history">
        <legend>{uiText("Cosa potrà vedere")}</legend>
        <p>
          {uiText(
            "Dal momento in cui accetta, la persona può leggere tutta la storia condivisa conservata, anche conversazioni, fonti e versioni precedenti al suo ingresso. Questa visibilità vale anche per i futuri membri.",
          )}
        </p>
        <label className="check">
          <input type="checkbox" required />
          {uiText(
            "Confermo che l’invito concede accesso all’intera storia condivisa conservata.",
          )}
        </label>
      </fieldset>
      <label className="check">
        <input type="checkbox" name="sendEmail" />
        {uiText("Invia anche un’email al destinatario")}
      </label>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      <button disabled={busy}>
        {busy ? uiText("Creazione in corso…") : uiText("Crea invito personale")}
      </button>
      <ProductHelp screen="people" field="email" />
    </form>
  );
}
