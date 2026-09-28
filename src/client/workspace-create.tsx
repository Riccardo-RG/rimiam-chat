"use client";

import { useEffect, useRef, useState } from "react";
import { errors } from "./api";
import {
  newWorkspaceCommand,
  pendingCommands,
  sendCommand,
} from "./command-journal";

/** Key by authenticated account: unsent introductory text is never shared across accounts. */
export function WorkspaceCreation({
  actor,
  onCreated,
}: {
  actor: string;
  onCreated: (workspace: { id: string; name: string }) => void;
}) {
  const active = useRef(false);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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
        },
        () => {
          if (!live || read !== currentRead) return;
          setReady(false);
          setError(errors.COMMAND_STORAGE_UNAVAILABLE);
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
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (sending.current || !ready || pending) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const name = String(values.get("name") ?? "").trim();
        const description = String(values.get("description") ?? "").trim();
        if (!name || [...name].length > 120 || [...description].length > 2000) {
          setError(
            "Usa un nome entro 120 caratteri e un’introduzione entro 2.000 caratteri.",
          );
          return;
        }
        const command = newWorkspaceCommand(actor, name, description);
        sending.current = true;
        setBusy(true);
        setError("");
        void sendCommand(command)
          .then(() => {
            if (!active.current) return;
            form.reset();
            onCreated({ id: command.workspace, name });
          })
          .catch((failure: unknown) => {
            if (!active.current) return;
            const code =
              failure instanceof Error ? failure.message : "REQUEST_FAILED";
            setError(
              errors[code] ??
                "Creazione non confermata. Verifica l’esito nelle operazioni da verificare.",
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
          Nuovo spazio
          <input
            id="new-workspace-name"
            name="name"
            required
            placeholder="RIMIAM · Prima beta"
          />
        </label>
        <label>
          Da dove partite? (facoltativo)
          <textarea
            id="new-workspace-description"
            name="description"
            rows={3}
            aria-describedby="workspace-description-hint"
            placeholder="Un’idea, una domanda o qualcosa da costruire insieme…"
          />
        </label>
        <p id="workspace-description-hint" className="hint">
          La tua introduzione comparirà nella conversazione, attribuita a te. Il
          Goal potrà essere definito dopo. Potrai invitare altre persone dopo la
          creazione.
        </p>
        <button disabled={busy || !ready || pending}>
          {busy ? "Creazione in corso…" : "Crea spazio"}
        </button>
      </fieldset>
      {pending && !busy && (
        <p role="status" className="hint">
          Una creazione precedente è da verificare. Usa «Verifica esito» o
          «Riprova la stessa operazione» nelle operazioni da verificare prima di
          creare un altro spazio. La descrizione resta nel promemoria.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!ready && error && (
        <button
          type="button"
          onClick={() => {
            setError("");
            window.dispatchEvent(new Event("miriam-pending-commands"));
          }}
        >
          Riprova l’accesso ai promemoria
        </button>
      )}
    </form>
  );
}
