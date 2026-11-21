"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import {
  acceptedFiles,
  encodeAttachment,
  validateAttachment,
} from "./file-upload";
import { errors } from "./api";
import { ConnectionOptions, useAssistantSettings } from "./assistant-settings";
import {
  WorkspaceInvitePicker,
  invitationSelection,
  type SelectedRecipient,
} from "./workspace-invite-picker";
import {
  newWorkspaceCommand,
  pendingCommands,
  sendCommand,
} from "./command-journal";

export function workspaceCreationError(name: string, description: string) {
  if (!name.trim())
    return {
      field: "name",
      message: "Inserisci un nome per lo spazio.",
    } as const;
  if ([...name.trim()].length > 120)
    return {
      field: "name",
      message: "Il nome può contenere al massimo 120 caratteri.",
    } as const;
  if ([...description.trim()].length > 2000)
    return {
      field: "description",
      message: "L’introduzione può contenere al massimo 2.000 caratteri.",
    } as const;
  return null;
}

/** Key by authenticated account: unsent introductory text is never shared across accounts. */
export function WorkspaceCreation({
  actor,
  initialRecipient,
  assistantCatalog,
  onCancel,
  onCreated,
}: {
  actor: string;
  initialRecipient?: SelectedRecipient;
  assistantCatalog?: ReturnType<typeof useAssistantSettings>;
  onCancel?: () => void;
  onCreated: (
    workspace: { id: string; name: string },
    invited: boolean,
  ) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const ownSettings = useAssistantSettings(
    assistantCatalog ? undefined : actor,
  );
  const settings = assistantCatalog ?? ownSettings;
  const choices = settings.data?.connections;
  const [connection, setConnection] = useState("default");
  const selected = choices?.find((c) => c.id === connection);
  const active = useRef(false);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [error, setError] = useState("");
  const [draftRecipient, setDraftRecipient] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<
    SelectedRecipient[]
  >(initialRecipient ? [initialRecipient] : []);
  const recipients = invitationSelection(selectedRecipients, draftRecipient);
  const [files, setFiles] = useState<File[]>([]);
  const [fieldError, setFieldError] =
    useState<ReturnType<typeof workspaceCreationError>>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (fieldError)
      (fieldError.field === "name"
        ? nameInput
        : descriptionInput
      ).current?.focus();
  }, [fieldError]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);

  useEffect(() => {
    active.current = true;
    let currentRead = 0;
    let live = true;
    const refresh = () => {
      const read = ++currentRead;
      void pendingCommands(actor).then(
        (commands) => {
          if (!live || read !== currentRead) return;
          setPending(
            commands.some((c) => c.command.type === "workspace.create"),
          );
          setReady(true);
          setStorageError(false);
        },
        () => {
          if (!live || read !== currentRead) return;
          setReady(false);
          setStorageError(true);
        },
      );
    };
    refresh();
    window.addEventListener("miriam-pending-commands", refresh);
    return () => {
      live = false;
      active.current = false;
      window.removeEventListener("miriam-pending-commands", refresh);
    };
  }, [actor]);

  return (
    <form
      aria-busy={busy || (!ready && !storageError)}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending.current || !ready || pending || !selected) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const name = String(values.get("name") ?? "").trim();
        const description = String(values.get("description") ?? "").trim();
        const invalid = workspaceCreationError(name, description);
        setFieldError(invalid);
        if (invalid) return;
        if (recipients.length && values.get("historyDisclosure") !== "on")
          return;
        const invitations = recipients.length
          ? {
              recipients: recipients.map(({ target }) => target),
              fullHistoryDisclosed: true as const,
            }
          : undefined;
        sending.current = true;
        setBusy(true);
        setError("");
        void Promise.all(files.map(encodeAttachment))
          .then((encoded) => {
            const command = newWorkspaceCommand(
              actor,
              name,
              description,
              invitations,
              encoded,
              {
                assistantConnectionId: selected.id,
                assistantConnectionRevision: selected.revision,
              },
            );
            return sendCommand(command).then(() => {
              if (!active.current) return;
              form.reset();
              setSelectedRecipients([]);
              setDraftRecipient("");
              setConnection("default");
              onCreated({ id: command.workspace, name }, !!invitations);
            });
          })
          .catch((failure: unknown) => {
            if (!active.current) return;
            const code =
              failure instanceof Error ? failure.message : "REQUEST_FAILED";
            if (
              code === "ASSISTANT_CONNECTION_CHANGED" ||
              code === "ASSISTANT_CONNECTION_UNAVAILABLE"
            ) {
              settings.retry();
              setError(
                uiText(
                  "La connessione è cambiata. Controlla la destinazione prima di creare lo spazio.",
                ),
              );
              return;
            }
            setError(
              errors[code] ??
                uiText(
                  "Non è ancora chiaro se lo spazio è stato creato. Scegli «Verifica esito» prima di riprovare.",
                ),
            );
          })
          .finally(() => {
            sending.current = false;
            if (active.current) setBusy(false);
          });
      }}
    >
      <fieldset disabled={busy || pending}>
        <label>
          {uiText("Nuovo spazio")}
          <input
            id="new-workspace-name"
            name="name"
            ref={nameInput}
            required
            aria-invalid={fieldError?.field === "name" || undefined}
            aria-describedby={
              fieldError?.field === "name"
                ? "workspace-name-hint workspace-create-error"
                : "workspace-name-hint"
            }
            onChange={() => {
              if (fieldError?.field === "name") setFieldError(null);
            }}
            placeholder={uiText("Es. Lancio di RIMIAM")}
          />
        </label>
        <p id="workspace-name-hint" className="hint">
          {uiText("Massimo 120 caratteri.")}
        </p>
        <WorkspaceInvitePicker
          selected={selectedRecipients}
          onChange={setSelectedRecipients}
          draft={draftRecipient}
          setDraft={setDraftRecipient}
          recipients={recipients}
        />
        <label>
          {uiText("Da dove partite? (facoltativo)")}
          <textarea
            id="new-workspace-description"
            name="description"
            ref={descriptionInput}
            rows={3}
            aria-invalid={fieldError?.field === "description" || undefined}
            aria-describedby={
              fieldError?.field === "description"
                ? "workspace-description-hint workspace-create-error"
                : "workspace-description-hint"
            }
            onChange={() => {
              if (fieldError?.field === "description") setFieldError(null);
            }}
          />
        </label>
        <p id="workspace-description-hint" className="hint">
          {uiText(
            "Il testo apparirà in chat a tuo nome. Puoi definire l’obiettivo dopo. Massimo 2.000 caratteri.",
          )}
        </p>
        <label>
          {uiText("Allega file al nuovo spazio")}
          <input
            type="file"
            multiple
            accept={acceptedFiles}
            onChange={(e) => {
              const selection = Array.from(e.currentTarget.files ?? []);
              try {
                selection.forEach(validateAttachment);
                if (
                  selection.length > 10 ||
                  selection.reduce((n, f) => n + f.size, 0) > 8388608
                )
                  throw new Error("Massimo 10 file e 8 MiB in totale.");
                setFiles(selection);
                setError("");
              } catch (err) {
                setFiles([]);
                e.currentTarget.value = "";
                setError(
                  err instanceof Error
                    ? err.message
                    : uiText("File non valido"),
                );
              }
            }}
          />
        </label>
        <label>
          {uiText("Modello o agente dello spazio")}
          <select
            disabled={!choices}
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            {choices && !selected && (
              <option value={connection} disabled>
                {uiText("Connessione non disponibile")}
              </option>
            )}
            {choices ? (
              <ConnectionOptions connections={choices} />
            ) : (
              <option value="default">
                {uiText("Caricamento dei modelli e degli agenti…")}
              </option>
            )}
          </select>
        </label>
        {selected && (
          <p className="hint">
            {selected.configured
              ? uiText(
                  "Le richieste della chat e il contesto necessario saranno inviati a {0}.",
                  String(selected.destination),
                )
              : uiText(
                  "Puoi creare lo spazio ora e collegare Emme in seguito.",
                )}{" "}
            {uiText(
              "Puoi scegliere una nuova connessione da «Configura Emme».",
            )}
          </p>
        )}
        {settings.error && (
          <div role="alert">
            {uiText(
              "Non è stato possibile verificare quale servizio riceverà le richieste.",
            )}{" "}
            <button type="button" className="quiet" onClick={settings.retry}>
              {uiText("Riprova")}
            </button>
          </div>
        )}
        {fieldError && (
          <p id="workspace-create-error" role="alert">
            {uiText(fieldError.message)}
          </p>
        )}
        <button
          disabled={
            busy ||
            !ready ||
            pending ||
            !selected ||
            (selected.id !== "default" && !selected.configured)
          }
        >
          {busy
            ? uiText("Creazione in corso…")
            : recipients.length
              ? uiText("Crea spazio e invita")
              : uiText("Crea spazio")}
        </button>
      </fieldset>
      {onCancel && (
        <button
          type="button"
          disabled={busy}
          className="quiet"
          onClick={onCancel}
        >
          {uiText("Torna ai tuoi spazi")}
        </button>
      )}
      {!ready && !storageError && (
        <p role="status" className="hint">
          {uiText("Controllo delle richieste in sospeso…")}
        </p>
      )}
      {pending && !busy && (
        <p role="status" className="hint">
          {uiText(
            "Hai già chiesto di creare uno spazio. La descrizione è salvata. Controlla «Operazioni da verificare» prima di crearne un altro.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" tabIndex={-1} ref={feedback}>
          {error}
        </p>
      )}
      {storageError && (
        <>
          <p role="alert">
            {uiText(
              "Le richieste salvate su questo dispositivo non sono disponibili. Ricaricale prima di creare uno spazio.",
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setStorageError(false);
              window.dispatchEvent(new Event("miriam-pending-commands"));
            }}
          >
            {uiText("Ricarica le richieste salvate")}
          </button>
        </>
      )}
    </form>
  );
}
