"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import {
  pendingCommands,
  recoverCommand,
  sendCommand,
  forgetCommand,
  type PendingCommand,
} from "./command-journal";

const descriptions: Record<PendingCommand["command"]["type"], string> = {
  "document.withdraw": "Ritira il file dallo spazio",
  "document.restore": "Ripristina il file nello spazio",
  "library.copy": "Copia documento",
  "library.favorite": "Aggiorna preferiti",
  "conversation.requestAnswer": "Richiedi una risposta",
  "conversation.answered": "Segna come già risposto",
  "reminder.set_time": "Conferma l’orario del promemoria",
  "temporal.respond": "Rispondi all’invito in calendario",
  "task.decline": "Rifiuta l’attività proposta",
  "followup.occurrence": "Aggiorna la scadenza del promemoria",
  "followup.previous": "Gestisci i promemoria precedenti",
  "beta.feedback.add": "Salva feedback",
  "voice.send": "Condividi messaggio vocale",
  "call.join": "Entra nella chiamata",
  "call.leave": "Lascia la chiamata",
  "call.recording.request": "Richiedi registrazione",
  "call.recording.consent": "Consenti registrazione e trascrizione",
  "call.recording.withdraw": "Ritira il consenso alla registrazione",
  "call.transcription.retry": "Riprova trascrizione",
  "call.analyze": "Richiedi analisi della chiamata",
  "workspace.link": "Collega due spazi",
  "artifact.compose": "Prepara un documento condiviso",
  "artifact.from_contribution": "Crea un documento dal risultato dell’analisi",
  "attention.aligned": "Aggiorna il tuo punto di lettura",
  "attention.preference": "Aggiorna la preferenza sugli interventi di Emme",
  "workstream.save": "Salva argomento",
  "workstream.transition": "Aggiorna lo stato dell’argomento",
  "workstream.link": "Collega un elemento all’argomento",
  "mandate.offer": "Proponi una delega",
  "mandate.respond": "Rispondi alla delega",
  "goal.editShared": "Modifica l’obiettivo condiviso",
  "goal.propose": "Proponi una modifica all’obiettivo",
  "goal.approve": "Approva la modifica all’obiettivo",
  "project.propose": "Proponi una decisione, un vincolo o un impegno",
  "project.approve": "Approva la proposta",
  "access.propose": "Proponi una modifica agli accessi",
  "access.approve": "Approva la modifica agli accessi",
  "work.converse": "Invia istruzioni per l’analisi",
  "work.apply_suggestion": "Applica il suggerimento di Emme",
  "task.create": "Crea un’attività da assegnare",
  "task.revise": "Modifica un’attività da assegnare",
  "task.propose_revision": "Proponi una modifica all’attività",
  "task.adopt_revision": "Accetta le modifiche all’attività",
  "task.comment": "Commenta l’attività",
  "task.accept": "Accetta la responsabilità dell’attività",
  "task.relinquish": "Lascia la responsabilità dell’attività",
  "task.status": "Aggiorna lo stato dell’attività",
  "followup.create": "Crea un promemoria per la chat",
  "followup.revise": "Modifica il promemoria della chat",
  "followup.close": "Chiudi il promemoria della chat",
  "email.draft.create": "Crea una bozza email privata",
  "email.draft.revise": "Modifica la bozza email privata",
  "email.propose": "Proponi l’invio dell’email",
  "email.authorize": "Autorizza l’invio dell’email",
  "email.reject": "Rifiuta l’invio dell’email",
  "email.retry": "Riprova lo stesso invio",
  "email.reconcile": "Verifica l’invio",
  "email.read": "Leggi la tua posta",
  "email.disclose": "Condividi un estratto dell’email",
  "email.attachment.disclose": "Condividi un allegato dell’email",
  "email.disconnect": "Scollega la casella di posta",
  "temporal.create": "Crea un appuntamento personale",
  "temporal.revise": "Modifica l’appuntamento personale",
  "commitment.time.set": "Imposta la data dell’impegno personale",
  "calendar.propose": "Proponi una modifica al calendario",
  "calendar.revise": "Modifica la proposta per il calendario",
  "calendar.authorize": "Autorizza la modifica al calendario",
  "calendar.reject": "Rifiuta la modifica al calendario",
  "calendar.retry": "Riprova la stessa modifica al calendario",
  "calendar.reconcile": "Verifica sul calendario collegato",
  "calendar.read": "Leggi il calendario collegato",
  "calendar.disconnect": "Scollega il calendario",
  "workspace.create": "Creazione di uno spazio",
  "message.send": "Invio di un messaggio",
  "goal.establish": "Definisci l’obiettivo iniziale",
  "goal.adhere": "Aderisci all’obiettivo",
  "artifact.draft": "Prepara un brief",
  "artifact.revise": "Modifica il brief",
  "artifact.review": "Proponi l’adozione del brief",
  "artifact.approve": "Approva il brief",
  "question.open": "Apri una domanda",
  "question.answer": "Collega una risposta alla domanda",
  "question.reopen": "Riapri la domanda",
  "document.upload": "Condividi un documento",
  "document.retry": "Riprova a leggere il documento",
  "research.private_request": "Avvia ricerca privata",
  "research.private_publish": "Condividi la ricerca nello spazio scelto",
  "research.brief_retry": "Riprova il confronto delle fonti",
  "research.request": "Avvia una ricerca",
  "research.retry": "Riprova la ricerca",
  "research.cancel": "Interrompi la ricerca",
  "invitation.create": "Crea un invito",
  "invitation.revoke": "Revoca l’invito",
  "member.remove": "Rimuovi un partecipante",
  "member.leave": "Esci dallo spazio",
  "access.relinquish": "Rinuncia alla gestione degli accessi",
  "information.accept": "Accetta un’informazione come riferimento",
  "information.correct": "Correggi un riferimento",
  "commitment.propose": "Proponi un impegno",
  "commitment.approve": "Approva un impegno",
  "interpretation.retry": "Riprova la lettura della fonte",
};

export function PendingCommands({
  actor,
  sendingCommandId,
  workspace,
  inlineRetryId,
  action,
  confirmed,
  refreshed,
}: {
  actor: string;
  sendingCommandId: string | null;
  workspace?: string;
  inlineRetryId?: string;
  action: (fn: () => Promise<void>) => Promise<void>;
  confirmed: (commandId: string) => void;
  refreshed: () => Promise<void>;
}) {
  const { locale: uiLocale, t: uiText } = useUiLanguage();
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = () => {
      const read = ++revision;
      void pendingCommands(actor, workspace)
        .then((rows) => {
          if (active && read === revision) {
            setCommands(rows);
            setStorageUnavailable(false);
          }
        })
        .catch(() => {
          if (active && read === revision) setStorageUnavailable(true);
        });
    };
    load();
    window.addEventListener("miriam-pending-commands", load);
    return () => {
      active = false;
      window.removeEventListener("miriam-pending-commands", load);
    };
  }, [actor, workspace, readAttempt]);
  async function perform(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    try {
      await action(operation);
    } finally {
      running.current = false;
      setWorking(false);
    }
  }
  // A normally pending chat POST does not need a recovery panel. Reminders
  // reappear on failure or reload, with the same command ID.
  const visible = commands.filter(
    (c) =>
      c.actor === actor &&
      (!workspace || c.workspace === workspace) &&
      c.commandId !== sendingCommandId,
  );
  if (!visible.length && !storageUnavailable) return null;
  return (
    <section
      className="card pending-operations"
      tabIndex={0}
      aria-label={uiText("Operazioni da verificare")}
      aria-busy={working}
    >
      <h2>{uiText("Operazioni da verificare")}</h2>
      {storageUnavailable && (
        <div role="status">
          <p>
            {uiText(
              "Le richieste salvate su questo dispositivo non sono disponibili. Una richiesta già inviata potrebbe essere stata completata.",
            )}
          </p>
          <button
            type="button"
            disabled={working}
            onClick={() => setReadAttempt((attempt) => attempt + 1)}
          >
            {uiText("Aggiorna elenco richieste")}
          </button>
        </div>
      )}
      {!!visible.length && (
        <>
          <p>
            {uiText(
              "Una richiesta potrebbe essere arrivata anche senza conferma. Controlla l’esito prima di riprovare. Il nuovo tentativo usa la stessa richiesta.",
            )}
          </p>
          {visible.map((c) => (
            <div key={c.commandId}>
              <p>
                {uiText(descriptions[c.command.type])} ·{" "}
                {new Date(c.createdAt).toLocaleString(uiLocale)}
              </p>
              <button
                disabled={working || storageUnavailable}
                onClick={() =>
                  void perform(async () => {
                    await recoverCommand(c);
                    confirmed(c.commandId);
                    await refreshed();
                  })
                }
              >
                {uiText("Verifica esito")}
              </button>
              {c.commandId !== inlineRetryId && (
                <button
                  disabled={working || storageUnavailable}
                  onClick={() =>
                    void perform(async () => {
                      await sendCommand(c);
                      confirmed(c.commandId);
                      await refreshed();
                    })
                  }
                >
                  {uiText("Riprova la stessa operazione")}
                </button>
              )}
              <button
                disabled={working || storageUnavailable}
                onClick={() =>
                  void perform(async () => {
                    await forgetCommand(c.commandId);
                  })
                }
              >
                {uiText("Rimuovi da questo dispositivo")}
              </button>
            </div>
          ))}
          <p className="hint">
            {uiText(
              "Rimuovere una richiesta da questo elenco non annulla ciò che è già avvenuto. A ogni tentativo RIMIAM ricontrolla i permessi.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
