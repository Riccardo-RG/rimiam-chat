"use client";
import { useEffect, useState } from "react";
import {
  pendingCommands,
  recoverCommand,
  sendCommand,
  forgetCommand,
  type PendingCommand,
} from "./command-journal";

const descriptions: Record<PendingCommand["command"]["type"], string> = {
  "beta.feedback.add": "Salvataggio del feedback beta",
  "voice.send": "Condividi messaggio vocale",
  "call.join": "Entra nella chiamata",
  "call.leave": "Lascia la chiamata",
  "call.recording.request": "Richiedi registrazione",
  "call.recording.consent": "Consenti registrazione e trascrizione",
  "call.recording.withdraw": "Ritira consenso alla registrazione",
  "call.transcription.retry": "Riprova trascrizione",
  "call.analyze": "Richiedi analisi della chiamata",
  "workspace.link": "Collegamento di navigazione fra spazi",
  "artifact.compose": "Bozza di documento condiviso",
  "artifact.from_contribution": "Documento da contributo di Miriam",
  "attention.aligned": "Segna il punto di allineamento personale",
  "attention.preference": "Preferenza d’intervento di Miriam",
  "workstream.save": "Organizzazione di un filone di lavoro",
  "workstream.transition": "Cambio di stato del filone",
  "workstream.link": "Collegamento semantico a un filone",
  "mandate.offer": "Proposta di mandato circoscritto",
  "mandate.respond": "Risposta al mandato",
  "goal.propose": "Proposta di evoluzione del Goal",
  "goal.approve": "Approvazione dell’evoluzione del Goal",
  "project.propose": "Proposta di decisione, vincolo o impegno",
  "project.approve": "Approvazione dell’atto di progetto",
  "access.propose": "Proposta di gestione accessi",
  "access.approve": "Approvazione della gestione accessi",
  "work.converse": "Controllo Active Work",
  "work.apply_suggestion": "Applica suggerimento di Miriam",
  "task.create": "Registra Task senza assegnazione",
  "task.revise": "Modifica Task non assegnato",
  "task.propose_revision": "Proponi modifica del Task",
  "task.adopt_revision": "Accetta il nuovo perimetro del Task",
  "task.accept": "Assumi personalmente la responsabilità",
  "task.relinquish": "Lascia la responsabilità del Task",
  "task.status": "Aggiorna stato operativo del Task",
  "followup.create": "Registra follow-up personale",
  "followup.revise": "Rivedi follow-up personale",
  "followup.close": "Chiudi follow-up personale",
  "email.draft.create": "Crea bozza email privata",
  "email.draft.revise": "Modifica bozza email privata",
  "email.propose": "Proponi invio email",
  "email.authorize": "Autorizza invio email",
  "email.reject": "Rifiuta invio email",
  "email.retry": "Riprova invio invariato",
  "email.reconcile": "Verifica esito email",
  "email.read": "Leggi mailbox privata",
  "email.disclose": "Condividi estratto email",
  "email.attachment.disclose": "Condividi allegato email",
  "email.disconnect": "Disconnetti mailbox",
  "temporal.create": "Registrazione di un appuntamento personale",
  "temporal.revise": "Modifica di un appuntamento personale",
  "commitment.time.set": "Data di un impegno personale",
  "calendar.propose": "Proposta Calendar",
  "calendar.revise": "Revisione della proposta Calendar",
  "calendar.authorize": "Autorizzazione dell’azione Calendar",
  "calendar.reject": "Rifiuto della proposta Calendar",
  "calendar.retry": "Nuovo tentativo dell’azione Calendar",
  "calendar.reconcile": "Verifica dell’esito Calendar",
  "calendar.read": "Lettura del calendario esterno",
  "calendar.disconnect": "Disconnessione del calendario",
  "workspace.create": "Creazione di uno spazio",
  "message.send": "Invio di un messaggio",
  "goal.establish": "Definizione dell’intento iniziale",
  "goal.adhere": "Adesione al Goal",
  "artifact.draft": "Preparazione di un brief",
  "artifact.revise": "Revisione di un brief",
  "artifact.review": "Proposta di adozione del brief",
  "artifact.approve": "Approvazione del brief",
  "question.open": "Registrazione di una domanda",
  "question.answer": "Collegamento di una risposta",
  "question.reopen": "Riapertura di una domanda",
  "document.upload": "Condivisione di un documento",
  "document.retry": "Nuovo tentativo di lettura del documento",
  "research.request": "Richiesta di ricerca",
  "research.retry": "Nuovo tentativo di ricerca",
  "research.cancel": "Interruzione della ricerca",
  "invitation.create": "Creazione di un invito",
  "invitation.revoke": "Revoca di un invito",
  "member.remove": "Rimozione di un partecipante",
  "member.leave": "Uscita dal Workspace",
  "access.relinquish": "Rinuncia alla gestione degli accessi",
  "information.accept": "Accettazione di un riferimento",
  "information.correct": "Correzione di un riferimento",
  "commitment.propose": "Proposta di impegno",
  "commitment.approve": "Approvazione di un impegno",
  "interpretation.retry": "Nuova lettura di una fonte",
};

export function PendingCommands({
  actor,
  action,
  refreshed,
}: {
  actor: string;
  action: (fn: () => Promise<void>) => Promise<void>;
  refreshed: () => Promise<void>;
}) {
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => {
      void pendingCommands(actor)
        .then((rows) => {
          if (active) setCommands(rows);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("miriam-pending-commands", load);
    return () => {
      active = false;
      window.removeEventListener("miriam-pending-commands", load);
    };
  }, [actor]);
  const visible = commands.filter((c) => c.actor === actor);
  if (!visible.length) return null;
  return (
    <section className="card" aria-label="Operazioni da verificare">
      <h2>Operazioni da verificare</h2>
      <p>
        Una risposta può essere andata persa. Verifica l’esito prima di ripetere
        l’operazione; un nuovo invio usa lo stesso identificativo e contenuto.
      </p>
      {visible.map((c) => (
        <div key={c.commandId}>
          <p>
            {descriptions[c.command.type]} ·{" "}
            {new Date(c.createdAt).toLocaleString("it-IT")}
          </p>
          <button
            onClick={() =>
              void action(async () => {
                await recoverCommand(c);
                await refreshed();
              })
            }
          >
            Verifica esito
          </button>
          <button
            onClick={() =>
              void action(async () => {
                await sendCommand(c);
                await refreshed();
              })
            }
          >
            Riprova la stessa operazione
          </button>
          <button
            onClick={() =>
              void action(async () => {
                await forgetCommand(c.commandId);
              })
            }
          >
            Rimuovi promemoria locale
          </button>
        </div>
      ))}
      <p className="hint">
        Rimuovere il promemoria non annulla né modifica un’operazione già
        ricevuta dal server. Le condizioni e l’authority vengono sempre
        verificate dal server.
      </p>
    </section>
  );
}
