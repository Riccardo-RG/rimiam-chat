# ADR-0007 — Bootstrap dell’accesso, uscita volontaria e continuità del Workspace

## Stato e provenance

- **Decisione:** fondazione del bootstrap B2; approvazione circoscritta, non approvazione della restante policy B2.
- **Stato:** APPROVED DECISION — architetturale e di prodotto, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvata da:** utente, mediante approvazione formale esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, già identificata negli ADR precedenti.
- **Fonte primaria:** messaggio dell’utente «I explicitly APPROVE the revised B2 bootstrap foundational decision exactly as proposed in section 10 of your latest analysis», seguito dal testo integrale e dalla richiesta di registrarlo come ADR-0007.
- **Relazioni:** precisa il bootstrap lasciato aperto da [ADR-0006](ADR-0006-accesso-workspace-capability-relazioni-authority.md); ADR-0001–ADR-0006 restano invariati.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

L’approvazione segue la revisione del vincolo proposto sull’ultimo titolare della governance di accesso. La fonte vincolante è l’atto esplicito dell’utente, non la precedente raccomandazione dell’assistente. I chiarimenti seguenti registrano soltanto il perimetro richiesto nello stesso atto; le altre proposte B2 non sono incorporate.

## Testo esatto approvato

Testo fornito dall’utente, conservato nella lingua originale:

> Workspace creation establishes the creator’s membership and a normal, attributable, versioned access relationship whose authorization basis is Workspace initialization. It provides initial invitation administration and authority to establish, modify or revoke supported access-capability relationships within their applicable conditions. Operational capabilities, change authority and account/security eligibility remain distinct. The initial relationship persists until validly changed; joining, inactivity and elapsed time do not transform it automatically. Subsequent arrangements must supersede or constrain conflicting initial powers, and historical creator status never supplies an override. Members may voluntarily leave, and holders may relinquish their own access-governance participation, through explicit authenticated acts without providing a successor or obtaining another participant’s approval. Departure ends the person’s membership-dependent access and governance participation while preserving history and existing project obligations. Unaccepted succession offers whose sole authorizing basis ends cannot subsequently activate. A Workspace may continue without exercisable access governance: existing permitted participation continues, while changes lacking authority remain blocked. No automatic promotion, succession, closure, archival or deletion follows. Account-security restrictions remain separate. Workspace closure, archival and deletion require separately established authorization and are not granted by bootstrap access authority. The remaining B2 policy is not approved by this decision.

## Chiarimenti e perimetro richiesti nell’atto di approvazione

1. **Relazione iniziale ordinaria.** Non è richiesto uno speciale stato o lifecycle temporaneo di bootstrap. L’atto di creazione stabilisce membership e una normale relazione di accesso attribuita e versionata; l’inizializzazione ne è la base autorizzante. La persistenza deriva dalla relazione corrente valida, non dall’identità storica del creator. Ingresso di membri, inattività e tempo trascorso non la trasformano automaticamente; accordi successivi devono supersedere o limitare i poteri iniziali incompatibili.
2. **Dimensioni indipendenti.** Provenance di creazione, membership, capability operative, authority per modificare relazioni di accesso e idoneità dell’account non sono equivalenti. La capability di compiere un’operazione non implica il potere di concederla o revocarla. La governance dell’accesso non conferisce authority di progetto né authority per chiudere, archiviare o eliminare il Workspace; restano applicabili le condizioni delle relazioni supportate.
3. **Uscita e rinuncia personali.** Un membro può uscire volontariamente; un titolare può rinunciare alla propria partecipazione alla governance restando membro. Sono atti espliciti autenticati distinti e non richiedono un successore o l’approvazione altrui. L’uscita non può essere bloccata soltanto per mantenere un titolare della governance. Termina membership e partecipazione all’accesso/governance dipendente da essa, preservando storia e obblighi di progetto; non autorizza a modificare la partecipazione altrui o a considerare soddisfatte approvazioni mancanti.
4. **Continuità senza governance esercitabile.** Il Workspace può rimanere attivo senza authority di accesso esercitabile, anche senza una durata predeterminata di tale assenza. Continuano le attività già permesse; restano bloccate soltanto le operazioni che richiedono authority indisponibile. L’assenza di governance non produce automaticamente chiusura, archiviazione o cancellazione e non obbliga a introdurre un nuovo stato generale del lifecycle.
5. **Successione esplicita.** Una successione pendente non è una successione efficace. Un’offerta non accettata la cui unica base autorizzante termina non può attivarsi successivamente. I membri rimasti non vengono promossi automaticamente; tempo, inattività, silenzio, anzianità o inferenze di Miriam non possono fabbricare successione. Questa regola non definisce tutte le altre condizioni degli inviti, delle offerte o delle deleghe.
6. **Sicurezza e recovery.** L’idoneità dell’account determina la possibilità di esercitare accesso, ma non costituisce governance. Restrizioni di sicurezza restano distinte da uscita volontaria e rinuncia; non generano nuove authority. Il creator non ha un override di recupero in virtù della creazione storica. Non viene approvata una procedura eccezionale di successione o recovery della governance.
7. **Chiusura, archiviazione e cancellazione.** Uscire o rinunciare alla propria governance non equivale a chiudere, archiviare o eliminare lo spazio condiviso. Queste operazioni richiedono autorizzazione stabilita separatamente, non concessa dalla relazione iniziale. La loro policy resta irrisolta e separata; questa decisione non ne stabilisce titolari, procedura o effetti.

## Contesto, motivazione e conseguenze

La creazione deve fornire una base concreta per iniziare a invitare e organizzare l’accesso, senza rendere il creator un proprietario permanente né imporre una seconda fase artificiale di bootstrap. Una relazione ordinaria permette di mantenere la continuità e di evolvere nello stesso modello approvato da ADR-0006.

Il precedente vincolo conversazionale che impediva l’uscita dell’ultimo titolare confondeva continuità amministrativa e obbligo personale di restare. Non era stato approvato. La regola adottata preserva l’autonomia individuale senza attribuire automaticamente poteri ai membri rimasti e senza trasformare l’uscita in una decisione sul destino dello spazio comune.

- Non serve un lifecycle speciale con scadenza o conversione automatica dei poteri iniziali.
- Provenance e condizioni correnti devono rendere verificabile perché un potere esiste oggi; creazione storica e nomi di ruolo non bastano.
- La continuità della collaborazione non garantisce continuità della governance. Alcune operazioni possono rimanere bloccate a tempo indeterminato, senza elezioni, promozioni o recovery inventati dal sistema.
- La perdita della base autorizzante deve impedire l’attivazione successiva delle offerte pendenti interessate; l’interfaccia deve distinguere chiaramente un’offerta da una successione già efficace.
- Le transizioni devono conservare stato, storia e provenance coerenti secondo [ADR-0005](ADR-0005-postgresql-stato-canonico-storia-provenance.md). Una concorrenza tra uscita e successione non può usare authority già terminata; lock, schema e protocollo esatto non sono selezionati qui.
- Cambiare successivamente il significato dell’uscita, dei poteri iniziali o delle offerte pendenti sarebbe costoso per dati persistenti, autorizzazione e aspettative dei partecipanti.

Restano preservati [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) e [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md): accesso, adesioni, accettazione editoriale, mandati e obblighi non si sostituiscono reciprocamente. Uscire non cancella gli obblighi di progetto. [ADR-0004](ADR-0004-context-efficiency-minimum-sufficient-context.md) continua a vincolare l’uso del contesto entro accesso e authority applicabili.

## Raffinamenti e stato delle proposte precedenti

| Fonte precedente | Effetto della registrazione |
| --- | --- |
| ADR-0006, chiarimenti 6 e 9: bootstrap ancora aperto | **RISOLTO PARZIALMENTE:** questo ADR stabilisce soltanto la fondazione del bootstrap e i confini sopra indicati. ADR-0006 rimane invariato come record dell’approvazione precedente; la restante B2 resta aperta. |
| Proposta conversazionale: impedire l’uscita/rinuncia dell’ultimo titolare senza successore | **SOSTITUITA PRIMA DELL’APPROVAZIONE:** non è mai diventata una decisione approvata. Nessun obbligo di restare deriva dalla sola esigenza di preservare la governance. |
| V0.2 §§7, 9 e 13: owner membership e bootstrap dell’accesso | **REFINED:** la creazione stabilisce la relazione ordinaria descritta qui; `owner/member` resta schema illustrativo incompleto, non un privilegio residuo né una policy B2 approvata integralmente. I riferimenti tecnici a bootstrap di snapshot/database non sono lifecycle di governance. |
| V0.2 §§13 e 20: cambiamenti di membership, authority indisponibile e sicurezza | **REFINED:** uscita, rinuncia, idoneità dell’account e lifecycle del Workspace sono distinti. L’assenza di governance non sospende da sola le attività già permesse e non autorizza successione o distruzione. |
| MVP §§14 e 17; v0.2 note di stato e §22 | **AGGIORNAMENTO DI STATO:** fondazione ADR-0006 e bootstrap ADR-0007 approvati; B2 nel suo insieme e la restante proposta architetturale non sono ratificati. |

## Non-goal e questioni escluse

- Non sono approvate le restanti regole B2: forme concrete successive della governance, protezione tra pari, condizioni di modifica/revoca, deleghe supportate, inviti/ammissioni/rimozioni, visibilità della storia e altri casi del lifecycle non risolti dal testo.
- Non sono stabilite policy di chiusura, archiviazione, cancellazione, retention o recovery straordinario. La conferma di un’operazione distruttiva non sostituisce l’authority separata necessaria.
- Non sono introdotti privilegi permanenti, gerarchie sociali, voto, tribunali, RBAC generico, permission matrix, policy DSL, motori di governance o deleghe arbitrarie.
- Non sono selezionati schema, enum, tabelle, migrazioni, lock, procedure tecniche di autenticazione/recovery o dettagli UX.
- ADR-0001–ADR-0006 e la proposta storica v0.1 rimangono invariati. La v0.2 resta una proposta. Non è autorizzato né avviato bootstrap implementativo, codice o installazione di dipendenze.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione verbatim del bootstrap B2 approvato e dei chiarimenti richiesti; riferimenti canonici minimi, ADR-0001–ADR-0006 invariati, restante B2 non approvata, nessuna implementazione. |
