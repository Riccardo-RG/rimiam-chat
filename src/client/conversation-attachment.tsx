"use client";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { errorText } from "./api";
import {
  acceptedFiles,
  createFileUploadCommand,
  optionalMediaReading,
  type FileUploadRequest,
} from "./file-upload";
import styles from "./composer-actions.module.css";

export interface AttachmentPicker {
  open: (trigger: HTMLButtonElement) => void;
  choose: (file: File, trigger: HTMLButtonElement) => void;
}

export function ConversationAttachment({
  ref,
  actor,
  workspace,
  focus,
  focusLabel,
  disabled,
  personal = false,
  submit,
}: {
  ref: Ref<AttachmentPicker>;
  actor: string;
  workspace: string;
  focus?: { workstreamId: string; version: number };
  focusLabel?: string;
  disabled: boolean;
  personal?: boolean;
  submit: (request: FileUploadRequest) => Promise<unknown>;
}) {
  const { t: uiText } = useUiLanguage();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<FileUploadRequest | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const heading = useId();
  const [file, setFile] = useState<File | null>(null);
  const [allowModelProcessing, allowReading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!file || !element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, [file]);
  function selectFile(chosen: File) {
    allowReading(false);
    setError("");
    setConfirmed("");
    setPending(null);
    setFile(chosen);
  }
  useImperativeHandle(
    ref,
    () => ({
      open(button) {
        if (disabled || file || inFlight.current) return;
        trigger.current = button;
        input.current?.click();
      },
      choose(chosen, button) {
        if (disabled || file || inFlight.current) return;
        trigger.current = button;
        selectFile(chosen);
      },
    }),
    [disabled, file],
  );

  function dismiss() {
    dialog.current?.close();
    setFile(null);
    const previous = trigger.current;
    if (previous?.getClientRects().length)
      previous.focus({ preventScroll: true });
    else
      input.current
        ?.closest("section")
        ?.querySelector<HTMLTextAreaElement>('textarea[name="message"]')
        ?.focus({ preventScroll: true });
  }

  async function share() {
    if (!file || disabled || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const request =
        pending ??
        (await createFileUploadCommand(actor, workspace, file, {
          allowModelProcessing,
          conversationShare: focus ? { workstreamFocus: focus } : {},
        }));
      if (!mounted.current) return;
      // Preserve the exact original command and disclosure choice if the receipt is lost.
      setPending(request);
      await submit(request);
      if (!mounted.current) return;
      setPending(null);
      setConfirmed(
        `${personal ? "File salvato" : "File condiviso"}: ${file.name}`,
      );
      dismiss();
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  }

  return (
    <>
      <input
        hidden
        ref={input}
        type="file"
        aria-label={uiText("Scegli un file o una foto")}
        accept={acceptedFiles}
        disabled={disabled}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!chosen || disabled) return;
          selectFile(chosen);
        }}
      />
      {file && (
        <dialog
          ref={dialog}
          className={styles.picker}
          aria-labelledby={heading}
          onClose={(event) => event.stopPropagation()}
          onCancel={(event) => {
            event.stopPropagation();
            event.preventDefault();
            if (!inFlight.current) dismiss();
          }}
        >
          <div className={styles.header}>
            <h3 id={heading}>
              {personal
                ? uiText("Salva allegato")
                : uiText("Condividi allegato")}
            </h3>
          </div>
          <strong className={styles.attachmentName}>{file.name}</strong>
          <p>
            {personal ? (
              uiText("Il file sarà visibile solo a te nella chat personale.")
            ) : (
              <>
                {focusLabel
                  ? uiText("Nell’argomento «{0}». ", String(focusLabel))
                  : ""}
                {uiText(
                  "Tutti i membri attuali e futuri dello spazio potranno aprire questo file.",
                )}
              </>
            )}
          </p>
          {optionalMediaReading(file.name) && (
            <label className="check">
              <input
                type="checkbox"
                checked={allowModelProcessing}
                disabled={disabled || sending || !!pending}
                onChange={(event) => allowReading(event.currentTarget.checked)}
              />
              <span>
                {uiText("Consenti l’elaborazione con AI")}
                <small className={styles.disclosure}>
                  {uiText("Invia questo file al servizio AI per leggerlo.")}
                </small>
              </span>
            </label>
          )}
          {error && (
            <p className="composer-error" role="alert">
              {error}
            </p>
          )}
          <div className={styles.attachmentActions}>
            <button
              type="button"
              className="quiet"
              disabled={sending}
              onClick={dismiss}
            >
              {pending ? uiText("Chiudi") : uiText("Annulla")}
            </button>
            <button
              type="button"
              disabled={disabled || sending}
              onClick={() => void share()}
            >
              {personal
                ? sending
                  ? uiText("Salvataggio…")
                  : uiText("Salva in chat")
                : sending
                  ? uiText("Condivisione…")
                  : uiText("Condividi in chat")}
            </button>
          </div>
        </dialog>
      )}
      <span className={styles.attachmentAnnouncement} role="status">
        {confirmed}
      </span>
    </>
  );
}
