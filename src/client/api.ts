export async function api<T>(path: string, data?: unknown): Promise<T> {
  const options: RequestInit = {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  };
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    // Reuse the exact command ID and body after an uncertain transport outcome.
    if (data !== undefined && path.startsWith("/api/workspaces"))
      response = await fetch(path, options);
    else throw error;
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.code ?? result.error ?? "REQUEST_FAILED");
  return result;
}
export const errors: Record<string, string> = {
  FEEDBACK_MESSAGE_NOT_FOUND:
    "Il messaggio non è disponibile in questo spazio.",
  FEEDBACK_REPORT_TOO_LARGE:
    "Il report supera 1.000 note: serve un’esportazione suddivisa. Nessun feedback è stato eliminato.",
  HANDOFF_TARGET_STALE:
    "Il riferimento della proposta è cambiato. Rileggilo e rivaluta il passo prima di procedere.",
  HANDOFF_ALREADY_APPLIED:
    "Questo passo è già stato registrato. Apri il risultato o la proposta preparata; non occorre ripeterlo.",
  HANDOFF_NOT_FOUND: "La proposta non è disponibile nello spazio corrente.",
  HANDOFF_COMMAND_MISMATCH:
    "Questo comando non corrisponde al passo proposto. Rivaluta il percorso prima di procedere.",
  HANDOFF_TARGET_MISMATCH:
    "Il contenuto selezionato non è quello della proposta originale.",
  HANDOFF_CANDIDATE_MISMATCH:
    "L’informazione selezionata non corrisponde a quella proposta nel messaggio originale.",
  INVALID_RECEIPT:
    "La conferma ricevuta non corrisponde all’operazione. Il promemoria è conservato: verifica l’esito prima di riprovare.",
  WORKSTREAM_NOT_FOUND:
    "Questo filone non è disponibile nello spazio corrente.",
  WORKSTREAM_NOT_ACTIVE:
    "Il filone non è attivo. Puoi consultarne la storia oppure riaprirlo dai suoi controlli prima di inviare nuovi messaggi.",
  WORKSTREAM_TRANSITION_INVALID:
    "Lo stato del filone non consente questo passaggio. Rileggi il suo stato attuale.",
  CALL_CONFIGURATION_REQUIRED: "Il servizio chiamate non è ancora configurato.",
  CALL_ADMISSION_PENDING:
    "Ingresso in attesa: attendi che le registrazioni siano arrestate.",
  CALL_TRANSPORT_UNAVAILABLE: "Servizio chiamate non raggiungibile.",
  CALL_RECORDING_OUTCOME_UNKNOWN:
    "Esito della registrazione da riconciliare; non è sicuro avviarne un’altra.",
  CALL_RECORDING_CONFIGURATION_REQUIRED:
    "Registrazione e storage non sono ancora configurati.",
  CALL_TRANSCRIPTION_NOT_READY:
    "Attendi che tutte le trascrizioni siano pronte prima di richiedere l’analisi.",
  STATE_STALE:
    "Qualcuno ha aggiornato questo contenuto. Rileggi lo stato corrente prima di salvare.",
  GOAL_VERSION_STALE:
    "Il Goal o il suo stato è cambiato. La bozza resta da riesaminare rispetto alla versione corrente prima di procedere.",
  GOOGLE_CONFIGURATION_REQUIRED:
    "Il collegamento Google non è ancora configurato per questa installazione.",
  GOOGLE_ACCOUNT_MISMATCH:
    "Per questo collegamento usa l’account Google con lo stesso indirizzo verificato su Miriam.",
  AI_CONFIGURATION_REQUIRED:
    "Le risposte AI non sono disponibili: il modello non è ancora collegato.",
  AI_OUTPUT_PARSE_ERROR:
    "La risposta del modello è incompleta o non valida. Nessun nuovo risultato pubblicato; puoi riprovare.",
  AI_TIMEOUT:
    "Il modello non ha risposto in tempo. Il lavoro è conservato; puoi riprovare.",
  AI_RATE_LIMITED:
    "Il servizio AI ha raggiunto il limite d’uso. Attendi prima di riprovare.",
  AI_PROVIDER_UNAVAILABLE:
    "Il servizio AI non è raggiungibile in questo momento. Puoi riprovare più tardi.",
  AI_REQUEST_REJECTED:
    "Il servizio AI non può elaborare questa richiesta. Occorre verificarne dimensioni e configurazione prima di riprovare.",
  MORE_CONTEXT_REQUIRED:
    "Manca contesto sufficiente. Aggiungi le informazioni pertinenti e riprova la lettura.",
  INVALID_SOURCE_REFERENCE:
    "La risposta citava una fonte non disponibile. Nessun nuovo risultato pubblicato; puoi riprovare.",
  INVALID_ANALYSIS_CITATION:
    "L’analisi citava una fonte non disponibile. Nessun nuovo contributo pubblicato; puoi riprovare.",
  WORK_CAPABILITY_UNAVAILABLE:
    "L’analisi non può proseguire con i permessi attualmente disponibili.",
  TOO_MANY_REQUESTS: "Attendi qualche istante prima di riprovare.",

  WORK_STATE_STALE:
    "Il lavoro è cambiato. Rileggi lo stato prima di inviare nuovamente l’istruzione.",
  WORK_INSTRUCTION_UNCLEAR:
    "Istruzione non applicata. Apri il lavoro e specifica come vuoi contribuire, oppure chiarisci la richiesta a Miriam.",
  AUTH_CONTEXT_CHANGED:
    "È cambiato l’account attivo. Accedi con quello che ha preparato l’operazione.",
  COMMAND_STORAGE_UNAVAILABLE:
    "Impossibile conservare il comando su questo dispositivo. L’operazione non è stata inviata.",
  RECEIPT_NOT_FOUND:
    "Esito non ancora disponibile. Il comando potrebbe essere ancora in corso; riprova mantenendo lo stesso identificativo.",
  ARTIFACT_VERSION_STALE:
    "Esiste una bozza più recente. Rileggila prima di procedere.",
  ARTIFACT_BASIS_STALE:
    "Un riferimento del brief è cambiato. Prepara una nuova versione con una motivazione.",
  ARTIFACT_SOURCE_STALE: "Una fonte selezionata ha una versione più recente.",
  ARTIFACT_REVIEW_STALE:
    "Il brief è già stato adottato attraverso un’altra review. Rileggi la versione corrente.",
  ARTIFACT_SCOPE_CHANGE_UNSUPPORTED:
    "Questa revisione deve mantenere le persone rappresentate dalla versione adottata. La modifica di quel perimetro non è ancora supportata.",
  NOT_A_NAMED_APPROVER:
    "Questa review richiede gli atti delle persone nominate; non puoi rappresentarle tramite membership o gestione degli accessi.",
  QUESTION_VERSION_STALE:
    "La domanda è cambiata. Rileggi la versione corrente prima di procedere.",
  QUESTION_ALREADY_OPEN: "La domanda è già aperta.",
  QUESTION_ALREADY_ANSWERED:
    "È già stata collegata una risposta. Puoi riaprire la domanda con una motivazione.",
  DOCUMENT_FORMAT_UNSUPPORTED:
    "Questo formato non è supportato. Seleziona uno dei formati indicati nella condivisione dei file.",
  DOCUMENT_TOO_LARGE: "Il documento supera il limite operativo di 8 MiB.",
  INVALID_DOCUMENT_ENCODING: "Il documento deve usare la codifica UTF-8.",
  INVALID_DOCUMENT_TEXT:
    "Il documento è vuoto, non testuale o supera 200.000 caratteri.",
  DOCUMENT_VERSION_STALE:
    "È già stata condivisa una versione più recente. Seleziona quella corrente.",
  RESEARCH_STALE:
    "Il contesto o l’accesso è cambiato. Avvia una nuova ricerca dopo averlo riletto.",
  RESEARCH_BUSY:
    "Sono già presenti quattro ricerche in corso. Attendi un risultato.",
  RESEARCH_USAGE_LIMIT:
    "È stato raggiunto il limite operativo delle ricerche per quest’ora.",
  RESEARCH_RETRY_LIMIT:
    "I tentativi sono terminati. Rivaluta la richiesta prima di avviare una nuova ricerca.",
  WORK_REQUESTER_REQUIRED:
    "Solo chi ha richiesto la ricerca può interromperla o riprovarla.",
  WORKSPACE_ACCESS_DENIED: "Non hai più accesso a questo spazio.",
  ACCOUNT_INELIGIBLE: "Verifica il tuo account prima di continuare.",
  CANDIDATE_STALE:
    "Il contesto è cambiato. Chiedi a Miriam di rileggere questa fonte prima di accettarla.",
  INFORMATION_EXISTS_USE_CORRECTION:
    "Esiste già un riferimento per questo argomento. Usa la correzione, conservando la storia.",
  INFORMATION_VERSION_STALE:
    "Qualcuno ha già aggiornato questa informazione. Rileggi la versione corrente.",
  INVITATION_INVALID:
    "Questo invito non è più valido o è già stato utilizzato.",
  INVITATION_RECIPIENT_MISMATCH:
    "Accedi con l’indirizzo a cui è destinato l’invito.",
  ACCESS_AUTHORITY_REQUIRED:
    "Non disponi della facoltà necessaria per questa operazione di accesso.",
  GOVERNANCE_CHANGE_REQUIRES_OWN_CONDITIONS:
    "Questa persona ha una relazione di governo degli accessi. La rimozione ordinaria non può modificarla.",
  AUTHORITY_STALE:
    "Le condizioni di accesso sono cambiate. Rileggi prima di approvare.",
  CONTEXT_STALE: "Il contesto è cambiato. Rileggi prima di approvare.",
  PROPOSAL_STALE:
    "Il contesto della proposta è cambiato. Occorre una nuova proposta.",
  DESCRIPTIVE_CLARIFICATION_REQUIRED:
    "Questa frase richiede un chiarimento o un atto esplicito di impegno. Non può diventare un semplice riferimento descrittivo.",
  REQUEST_FAILED:
    "Operazione non riuscita. Riprova; se il problema persiste controlla il servizio locale.",
};

export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  return errors[code] ?? code;
}
