export const collaborationModeLabels = {
  discreet: "Solo quando chiamata",
  collaborative: "Collaborativa",
  proactive: "Propositiva",
};
export const workspaceChangeLabels: Record<string, string> = {
  goal: "Goal",
  information: "Informazioni accettate",
  commitment: "Impegni",
  project: "Decisioni e vincoli",
  task: "Task",
  work: "Lavoro di Emme",
  artifact: "Documenti",
  question: "Domande",
  workstream: "Argomenti di lavoro",
};

export const researchStatusLabels: Record<string, string> = {
  queued: "In attesa",
  running: "Ricerca in corso",
  completed: "Risultati disponibili",
  failed: "Ricerca non riuscita",
  stale: "Da rivalutare: le condizioni sono cambiate",
  cancelled: "Interrotta",
  needs_configuration: "Ricerca web da attivare",
};

// The change feed records the command or worker event. An approval event
// alone does not say whether every required person has approved.
const changeEvents = new Map<string, string>([
  ["goal.establish", "Obiettivo definito"],
  ["goal.editShared", "Obiettivo modificato"],
  ["goal.adhere", "Adesione all’obiettivo registrata"],
  ["goal.propose", "Modifica all’obiettivo proposta"],
  ["goal.approve", "Approvazione della proposta sull’obiettivo registrata"],
  ["information.accept", "Informazione accettata"],
  ["information.correct", "Informazione corretta"],
  ["commitment.propose", "Impegno proposto"],
  ["commitment.approve", "Approvazione dell’impegno registrata"],
  ["commitment.time.set", "Data dell’impegno aggiornata"],
  ["project.propose", "Nuova proposta per lo spazio"],
  ["project.approve", "Approvazione della proposta registrata"],
  ["task.create", "Attività creata"],
  ["task.revise", "Attività modificata"],
  ["task.propose_revision", "Modifica all’attività proposta"],
  ["task.adopt_revision", "Modifica all’attività accettata"],
  ["task.comment", "Commento aggiunto all’attività"],
  ["task.accept", "Incarico accettato"],
  ["task.decline", "Incarico rifiutato"],
  ["task.relinquish", "Incarico lasciato"],
  ["task.status", "Stato dell’attività aggiornato"],
  ["artifact.draft", "Bozza creata"],
  ["artifact.compose", "Bozza salvata"],
  ["artifact.revise", "Bozza modificata"],
  ["artifact.from_contribution", "Documento creato dal risultato dell’analisi"],
  ["artifact.review", "Documento proposto per l’approvazione"],
  ["artifact.approve", "Approvazione del documento registrata"],
  ["question.open", "Domanda aperta"],
  ["question.answer", "Risposta collegata alla domanda"],
  ["question.reopen", "Domanda riaperta"],
  ["work.started", "Analisi avviata"],
  ["work.working", "Analisi in corso"],
  ["work.needs_input", "Analisi da verificare"],
  ["work.resumed", "Analisi ripresa"],
  ["work.stopped", "Analisi interrotta"],
  ["work.paused", "Analisi in pausa"],
  ["work.outdated", "Risultato da ricontrollare"],
  ["work.completed", "Analisi completata"],
  ["work.contract_changed", "Incarico dell’analisi aggiornato"],
  ["work.control_proposed", "Modifica all’analisi suggerita"],
  ["work.input", "Indicazioni sull’analisi aggiornate"],
  ["work.continuing", "Analisi in corso"],
  ["work.recovering", "Analisi rimessa in coda"],
  ["workstream.save", "Argomento salvato"],
  ["workstream.link", "Fonti dell’argomento aggiornate"],
  ["workstream.activate", "Argomento attivato"],
  ["workstream.resolve", "Argomento concluso"],
  ["workstream.reopen", "Argomento riaperto"],
  ["workstream.archive", "Argomento archiviato"],
  ["workstream.restore", "Argomento ripristinato"],
  ["workstream.organized", "Organizzazione degli argomenti aggiornata"],
]);

export function workspaceChangeLabel(kind: string) {
  return changeEvents.get(kind) ?? "Aggiornamento dello spazio";
}

// These values are emitted by the shared attention read model. The adjacent
// item title is Workspace content and is rendered verbatim.
const attentionReasonLabels = new Map<string, string>([
  ["Risultato da ricontrollare", "Risultato da ricontrollare"],
  ["Miriam ha bisogno di un chiarimento", "Serve un chiarimento"],
  ["Analisi in pausa", "Analisi in pausa"],
  ["Emme sta lavorando", "Analisi avviata"],
  ["Domanda aperta", "Domanda aperta"],
  [
    "Scadenza trascorsa; stato ancora aperto",
    "Attività scaduta e ancora aperta",
  ],
  ["Responsabilità che hai accettato", "Incarico accettato da te"],
  [
    "Task senza responsabilità accettata",
    "Nessuno ha ancora accettato l’incarico",
  ],
  [
    "Decisione, vincolo o impegno ancora proposto",
    "Proposta in attesa di approvazione",
  ],
]);

export function attentionReasonLabel(reason: string) {
  return attentionReasonLabels.get(reason) ?? "Da seguire";
}
