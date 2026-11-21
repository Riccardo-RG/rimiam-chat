"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import type { Command } from "../contracts/commands";
import { newCommand, type PendingCommand } from "./command-journal";
import { errorText } from "./api";
import { pageMessage } from "./shared-file-library";
import { WorkspaceIcon } from "./workspace-icon";
import type { Snapshot } from "./types";
import styles from "./library-links.module.css";

type Props = {
  personal?: boolean;
  state: Snapshot;
  actor: string;
  busy: boolean;
  contributes: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  command: (
    command: Command,
    onReceipt?: () => void,
    replay?: PendingCommand,
  ) => Promise<unknown>;
};

export function LibraryLinks({
  personal = false,
  state,
  actor,
  busy,
  contributes,
  action,
  command,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [retry, setRetry] = useState<PendingCommand | null>(null);
  const sending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnToTrigger = useRef(false);
  useEffect(() => {
    if (!open && !busy && returnToTrigger.current) {
      trigger.current?.focus();
      returnToTrigger.current = false;
    }
  }, [busy, open]);
  function close() {
    returnToTrigger.current = true;
    setOpen(false);
    setError("");
  }
  async function save() {
    if (!contributes || busy || sending.current) return;
    const content = pageMessage(address, personal);
    if (!content) {
      setError(
        personal
          ? uiText(
              "Inserisci il link HTTP o HTTPS di una pagina. I link di accesso e di invito non possono essere salvati qui.",
            )
          : uiText(
              "Inserisci un link HTTP o HTTPS condivisibile. I link personali, di accesso o di invito non vanno nel raccoglitore.",
            ),
      );
      return;
    }
    const payload: Command = { type: "message.send", content };
    const request = retry ?? newCommand(actor, state.workspace.id, payload);
    sending.current = true;
    setError("");
    try {
      await action(async () => {
        try {
          await command(payload, undefined, request);
        } catch (cause) {
          setRetry(request);
          setError(errorText(cause));
          return;
        }
        setRetry(null);
        setAddress("");
        close();
        setReceipt(
          personal
            ? "Link salvato nella tua chat personale."
            : "Link condiviso nella chat e salvato qui.",
        );
      });
    } finally {
      sending.current = false;
    }
  }
  return (
    <>
      {contributes && (
        <button
          className={`quiet ${styles.trigger}`}
          type="button"
          ref={trigger}
          aria-expanded={open}
          disabled={busy}
          onClick={() => {
            if (open) {
              if (!retry) setAddress("");
              close();
            } else {
              setOpen(true);
              setReceipt("");
            }
          }}
        >
          <WorkspaceIcon name="link" />
          {open
            ? retry
              ? uiText("Chiudi")
              : uiText("Annulla")
            : uiText("Aggiungi link")}
        </button>
      )}
      {open && contributes && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            {uiText("Indirizzo della pagina")}
            <input
              autoFocus
              required
              type="url"
              placeholder="https://…"
              value={address}
              readOnly={busy || !!retry}
              onChange={(e) => {
                setAddress(e.target.value);
                setError("");
              }}
            />
          </label>
          <small className="hint">
            {personal
              ? uiText(
                  "Il link sarà visibile solo a te, anche nella chat personale.",
                )
              : uiText("Il link sarà visibile anche nella chat dello spazio.")}
          </small>
          {error && <p role="alert">{error}</p>}
          <div>
            <button type="submit" disabled={busy || !address.trim()}>
              {retry
                ? uiText("Riprova lo stesso invio")
                : personal
                  ? uiText("Salva link")
                  : uiText("Condividi link")}
            </button>
          </div>
        </form>
      )}
      {receipt && (
        <p role="status" className="hint">
          {uiText(receipt)}
        </p>
      )}
    </>
  );
}
