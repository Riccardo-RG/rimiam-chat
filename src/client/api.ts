import { translateUi } from "../shared/i18n";
import { workspaceCreationErrors } from "../shared/workspace-creation-errors";

const domainErrorCode = /^[A-Z][A-Z0-9_]*$/;

export async function api<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const options: RequestInit = {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
    signal,
  };
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    // Reuse the exact command ID and body after an uncertain transport outcome.
    if (signal?.aborted) throw error;
    if (data !== undefined && path.startsWith("/api/workspaces")) {
      try {
        response = await fetch(path, options);
      } catch (retryError) {
        if (signal?.aborted) throw retryError;
        throw new Error("NETWORK_UNAVAILABLE");
      }
    } else throw new Error("NETWORK_UNAVAILABLE");
  }
  const fallback =
    response.status === 401
      ? "AUTHENTICATION_REQUIRED"
      : response.status === 429
        ? "REQUEST_RATE_LIMITED"
        : response.status >= 500
          ? "SERVICE_UNAVAILABLE"
          : "REQUEST_FAILED";
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(response.ok ? "INVALID_RESPONSE" : fallback);
  }
  if (!response.ok) {
    const code = result?.error?.code ?? result?.error;
    // The snapshot route uses REQUEST_FAILED for unexpected server failures.
    // Retain the HTTP failure class for read-only reconnect/backoff.
    if (data === undefined && code === "REQUEST_FAILED")
      throw new Error(fallback);
    throw new Error(
      typeof code === "string" && domainErrorCode.test(code) ? code : fallback,
    );
  }
  return result;
}
export const errors: Record<string, string> = {
  ...workspaceCreationErrors,
  PERSONAL_CHAT_UNAVAILABLE:
    "Questa conversazione personale non è disponibile.",
  CONSULTATION_SELECTION_CHANGED:
    "La conversazione in consultazione è cambiata. Controlla lo spazio selezionato.",
  RESEARCH_BRIEF_FAILED:
    "La sintesi della ricerca non è riuscita. Puoi riprovarla.",
  RESEARCH_INTERRUPTED:
    "La preparazione della sintesi si è interrotta. Puoi riprenderla.",
  DIRECT_CHAT_NOT_FOUND:
    "Questa chat privata non è disponibile per il tuo account.",
  DIRECT_CONSENT_STALE:
    "Il tuo consenso è cambiato. Controlla lo stato aggiornato prima di riprovare.",
  DIRECT_RECAP_CONSENT_REQUIRED:
    "Servono i consensi di entrambe le persone per chiedere il riepilogo.",
  DIRECT_RECAP_IN_PROGRESS: "Il tuo riepilogo è in preparazione.",
  DIRECT_RECAP_ATTEMPT_EXISTS:
    "Questa richiesta è già stata elaborata o interrotta. Controlla i riepiloghi disponibili.",
  NO_MESSAGES_TO_SUMMARIZE:
    "Scrivi almeno un messaggio prima di chiedere un riepilogo.",
  INVALID_ANSWER_RECIPIENT:
    "Controlla i destinatari: devono essere altre persone con accesso allo spazio.",
  MENTION_NOT_AVAILABLE:
    "Una delle persone menzionate non è più disponibile. Controlla il messaggio prima di inviarlo.",
  READING_ADMISSION_CHANGED:
    "L’accesso allo spazio è cambiato. Riapri la conversazione.",
  AGENDA_DATE_CHANGED: "È iniziato un nuovo giorno. Ricarica l’agenda.",
  AGENDA_NOTHING_PENDING: "Queste scadenze sono già state archiviate.",
  AGENDA_TIME_INVALID: "Scegli un orario futuro per la giornata indicata.",
  FOLLOWUP_OCCURRENCE_STALE:
    "Questa scadenza è cambiata. Riapri il promemoria.",
  REMINDER_ALREADY_SCHEDULED:
    "Il promemoria ha già un orario. Riaprilo per modificarlo.",
  CALENDAR_ALREADY_RESPONDED:
    "È già stata registrata una risposta per questo invito.",
  CALENDAR_NOT_INVITED: "Non sei tra gli invitati a questo appuntamento.",
  CALENDAR_INVITEE_UNAVAILABLE:
    "Una delle persone scelte non è più disponibile. Rivedi gli invitati.",
  TASK_NOT_OFFERED: "La proposta non è più in attesa di una tua risposta.",
  FOLLOWUP_NO_OCCURRENCE:
    "Nessuno dei giorni scelti cade tra l’inizio e la fine. Sposta la data finale o cambia i giorni.",
  SIGN_OUT_FAILED:
    "Non riesco a chiudere la sessione. Controlla la connessione e riprova a uscire.",
  AI_USAGE_LIMIT_REACHED:
    "Il limite operativo delle elaborazioni AI è stato raggiunto. Il contenuto è conservato: riprova più tardi. Nessun risultato parziale è stato adottato.",
  AI_LIMIT_CONFIGURATION_INVALID:
    "La configurazione dei limiti AI richiede una verifica. Le elaborazioni restano sospese.",
  AUTHENTICATION_REQUIRED:
    "La sessione è terminata. Accedi di nuovo per continuare.",
  NETWORK_UNAVAILABLE:
    "Non riesco a raggiungere il servizio. Controlla la connessione; per le operazioni inviate verifica prima l’esito nei promemoria locali.",
  SERVICE_UNAVAILABLE:
    "Il servizio non è disponibile in questo momento. Attendi e riprova; un’operazione già inviata potrebbe essere stata registrata.",
  REQUEST_RATE_LIMITED:
    "Sono arrivate molte richieste. Attendi qualche istante prima di riprovare.",
  INVALID_RESPONSE:
    "La risposta del servizio non è leggibile. Per un’operazione inviata, verifica l’esito prima di riprovare.",
  SOURCE_NOT_FOUND:
    "La fonte selezionata non è disponibile per questa operazione. La bozza è conservata: riesamina i riferimenti prima di riprovare.",
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
    "Questo argomento non è disponibile nello spazio corrente.",
  WORKSTREAM_NOT_ACTIVE:
    "L’argomento non è attivo. Puoi consultarne la storia oppure riaprirlo dai suoi controlli prima di inviare nuovi messaggi.",
  WORKSTREAM_TRANSITION_INVALID:
    "Lo stato dell’argomento non consente questo passaggio. Rileggi il suo stato attuale.",
  CALL_CONFIGURATION_REQUIRED: "Il servizio chiamate non è ancora configurato.",
  TRANSCRIPTION_CONFIGURATION_REQUIRED:
    "La trascrizione non è configurata. Puoi ascoltare l’audio originale.",
  TRANSCRIPTION_RATE_LIMITED:
    "Il servizio di trascrizione è al limite di utilizzo. Puoi ascoltare l’audio originale.",
  TRANSCRIPTION_FAILED:
    "Il servizio di trascrizione non ha potuto trascrivere l’audio. L’originale resta disponibile.",
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
  DOCUMENT_WITHDRAWN: "Il file è stato ritirato da questo spazio.",
  DOCUMENT_VISIBILITY_DENIED:
    "Solo chi ha condiviso il file può ritirarlo o ripristinarlo.",
  DOCUMENT_VISIBILITY_STALE:
    "Il file è cambiato. Riaprilo per vedere lo stato aggiornato.",
  GOAL_REQUIRES_SEPARATE_OBLIGATION_CHANGE:
    "Questa modifica richiede prima di aggiornare una decisione, un vincolo o un impegno collegato.",
  GOAL_VERSION_STALE:
    "Il Goal o il suo stato è cambiato. La bozza resta da riesaminare rispetto alla versione corrente prima di procedere.",
  EMAIL_DRAFT_STALE:
    "Questa bozza è cambiata. Apri l’ultima versione prima di continuare.",
  EMAIL_MAILBOX_ACCESS_DENIED:
    "Verifica che la casella sia ancora collegata e abilitata a questa operazione.",
  EMAIL_ATTACHMENT_STALE_OR_DENIED:
    "Un allegato è cambiato o non è più disponibile. Ricontrolla la bozza.",
  MICROSOFT_CONFIGURATION_REQUIRED:
    "Il collegamento Outlook deve essere configurato sul server.",
  MICROSOFT_ACCOUNT_MISMATCH:
    "Scegli la casella Microsoft con lo stesso indirizzo verificato del tuo account RIMIAM.",
  MICROSOFT_RECONNECT_REQUIRED:
    "Ricollega la tua casella Outlook per continuare.",
  MICROSOFT_CONNECTION_RATE_LIMITED:
    "Troppi tentativi di collegamento. Riprova tra qualche minuto.",
  GOOGLE_CONNECTION_RATE_LIMITED:
    "Troppi tentativi di collegamento. Riprova tra qualche minuto.",
  GOOGLE_CONFIGURATION_REQUIRED:
    "Il collegamento Google non è ancora configurato per questa installazione.",
  GOOGLE_CAPABILITY_DISABLED:
    "Questa funzione Google non è attiva su questa installazione.",
  GOOGLE_ACCOUNT_MISMATCH:
    "Per questo collegamento usa l’account Google con lo stesso indirizzo verificato su RIMIAM.",
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
    "Istruzione non applicata. Apri il lavoro e specifica come vuoi contribuire, oppure chiarisci la richiesta a Emme.",
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
    "Scegli un file TXT, MD, CSV, PDF, DOCX, una foto JPEG, PNG o WebP, oppure un audio MP3, M4A, WAV, WebM o OGG.",
  DOCUMENT_FORMAT_INVALID:
    "Il contenuto del file non corrisponde al suo formato. Esportalo di nuovo e riprova.",
  DOCUMENT_TOO_LARGE: "Il file supera 8 MiB. Scegli un file più piccolo.",
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
    "Limite orario delle ricerche raggiunto. Riprova più tardi.",
  RESEARCH_RETRY_LIMIT:
    "I tentativi sono terminati. Rivaluta la richiesta prima di avviare una nuova ricerca.",
  WORK_REQUESTER_REQUIRED:
    "Solo chi ha richiesto la ricerca può interromperla o riprovarla.",
  WORKSPACE_ACCESS_DENIED:
    "Non hai più accesso a questo spazio. Se sei stato invitato, apri il link personale ricevuto o controlla gli inviti in «Tutti gli spazi».",
  ACCOUNT_INELIGIBLE: "Verifica il tuo account prima di continuare.",
  CANDIDATE_STALE:
    "Il contesto è cambiato. Chiedi a Emme di rileggere questa fonte prima di accettarla.",
  INFORMATION_EXISTS_USE_CORRECTION:
    "Esiste già un riferimento per questo argomento. Usa la correzione, conservando la storia.",
  INFORMATION_VERSION_STALE:
    "Qualcuno ha già aggiornato questa informazione. Rileggi la versione corrente.",
  INVITATION_INVALID:
    "Verifica di aver usato l’email invitata. Il link potrebbe essere scaduto, revocato o già utilizzato.",
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
    "Non è stato possibile completare la richiesta. Se avevi inviato un’operazione, verifica prima il suo esito; altrimenti attendi e riprova.",
};

export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const source = Object.hasOwn(errors, code) ? errors[code] : undefined;
  const language =
    typeof document !== "undefined" && document.documentElement.lang === "en"
      ? "en"
      : "it";
  // A server code has no meaning to a reader. Keep authored validation messages translatable.
  const fallback = domainErrorCode.test(code) ? errors.REQUEST_FAILED : code;
  return translateUi(language, source ?? fallback);
}
