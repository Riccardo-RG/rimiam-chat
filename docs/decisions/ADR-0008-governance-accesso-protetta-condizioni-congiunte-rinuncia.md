# ADR-0008 — Governance dell’accesso protetta, condizioni congiunte e rinuncia personale

## Stato e provenance

- **Decisione:** protezione e modifica delle relazioni di governance dell’accesso; approvazione circoscritta, non chiusura della restante policy B2.
- **Stato:** APPROVED DECISION — architetturale e di prodotto, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvata da:** utente, mediante approvazione formale esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, già identificata negli ADR precedenti.
- **Fonte primaria:** messaggio «I explicitly APPROVE the revised protected access-governance decision exactly as proposed in section 10 of your latest analysis», fornito nell’allegato `8ff6ef56-2528-45a9-93e5-157aea849d52/pasted-text.txt`; contiene il testo integrale approvato e i limiti della registrazione.
- **Relazioni:** precisa [ADR-0006](ADR-0006-accesso-workspace-capability-relazioni-authority.md) entro i confini di [ADR-0007](ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md). ADR-0001–ADR-0007 rimangono invariati.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

L’approvazione segue la review dei bypass della protezione e la verifica mirata della rinuncia personale nelle condizioni congiunte. La fonte vincolante è l’atto dell’utente; le precedenti proposte e la successiva closure review di B2 non diventano decisioni approvate per effetto di questa registrazione.

## Testo esatto approvato

Testo fornito dall’utente, conservato nella lingua originale:

> Access relationships may be established or changed only through explicit, attributable, versioned acts authorized by the valid pre-transition grant/change conditions and the conditions of every affected protected relationship. Protection applies to direct changes and indirect disabling through membership, prerequisite capabilities or governing conditions; a replacement condition cannot authorize its own adoption. The MVP supports ordinary stewardship, explicitly adopted named joint stewardship and bounded revocable operational delegation. Protected shared stewardship consists conceptually of individual participations governed by explicit named joint change conditions. Under that pattern, changes to protected participation or the governing participants require the named joint approvals; routine invitation operations and bounded invitation delegation may be individually authorized explicitly. Operational delegates gain no peer protection or authority to change governance or delegate onward. New grants, material authority increases and adopted protection changes require holder acceptance; restrictions or revocations within previously accepted reserved powers do not require renewed consent. Effective relationships continue under their own terms rather than depending merely on their original authorizer’s presence. As a narrow exception to ordinary joint change conditions, a holder may voluntarily relinquish their own governance participation, or leave under ADR-0007, through an explicit authenticated act without a successor or another participant’s approval. This exception ends the holder’s own participation and applicable membership-dependent access; it does not amend other actors’ capabilities, authority, protections or change conditions. Named joint conditions refer to the specified governance participations, not permanently to the historical persons. When a required participation ends, the condition remains binding but that authorization path becomes unavailable: it does not shrink to the remaining stewards, confer unilateral powers or preserve approval authority for the former holder. This possible loss of future governance availability forms part of the accepted shared-stewardship terms. Security ineligibility may prevent exercise without transferring authority or automatically revoking protection. Missing required authority leaves the affected transition blocked while independently permitted operations and personal withdrawal remain available, without creator overrides or inferred succession. Project authority, Workspace closure/archive/delete policy and the remaining B2 rules are not approved by this decision.

## Chiarimenti e perimetro richiesti nell’atto di approvazione

1. **Protezione e transizione completa.** Le condizioni valide prima dell’atto governano anche i suoi effetti indiretti. Rimozione della membership, sottrazione di capability necessarie e modifica delle condizioni sovraordinate non possono aggirare una partecipazione protetta. La nuova condizione non autorizza la propria adozione. Non ne deriva una protezione di governance universale per ogni membro ordinario.
2. **Partecipazioni individuali e rinuncia.** La stewardship condivisa comprende partecipazioni individuali soggette alle condizioni congiunte adottate. La rinuncia personale è un’eccezione circoscritta: termina soltanto la propria partecipazione e, in caso di uscita, gli accessi dipendenti dalla membership secondo ADR-0007. Non modifica protezione, capability, authority o condizioni altrui e non autorizza una riscrittura della propria relazione mantenuta in essere.
3. **Condizioni congiunte non esercitabili.** I riferimenti nominativi identificano le partecipazioni di governance pertinenti, non poteri permanenti delle persone storiche. Se una partecipazione richiesta termina, la condizione resta vincolante ma quel percorso autorizzativo non è più esercitabile. Non si riduce ai titolari rimasti, non conserva poteri di approvazione al precedente titolare e non ripristina privilegi del creator. Questa possibile indisponibilità futura appartiene ai termini accettati della stewardship condivisa.
4. **Delega operativa distinta dalla protezione.** La delega circoscritta revocabile non attribuisce protezione tra pari, authority per modificare la governance o potere di delegare ulteriormente. Accettazione del titolare e authority per concedere/modificare restano verifiche distinte; una restrizione o revoca entro poteri riservati già accettati non richiede un nuovo consenso del destinatario.
5. **Provenance e validità corrente.** La presenza dell’autorizzante originario non è una dipendenza implicita della relazione efficace: valgono i suoi termini correnti. La provenance storica resta consultabile e non crea authority residua. Le offerte non ancora efficaci mantengono le regole di ADR-0007; non vengono confuse con deleghe già valide.
6. **Indisponibilità e sicurezza.** Deadlock o authority non disponibile bloccano le transizioni interessate, non le operazioni autorizzate indipendentemente né la rinuncia personale. Non si inventano successione, consensi o governance da silenzio, inferenze o creator status. L’idoneità dell’account può impedire l’esercizio senza trasferire authority o revocare automaticamente la protezione; recovery e policy di sicurezza non sono definiti qui.

## Motivazione e conseguenze

Proteggere soltanto la revoca diretta lascerebbe aperto il bypass attraverso rimozione della membership o capability. Equiparare tutti i gestori dell’accesso renderebbe invece una semplice delega operativa inseparabile dalla protezione tra pari. La decisione conserva le distinzioni di ADR-0006 e rende esplicito il confine delle transizioni consentite.

La rinuncia individuale approvata da ADR-0007 non può obbligare qualcuno a restare, ma neppure riscrivere le condizioni altrui. Conservare una condizione divenuta non esercitabile evita sia la riduzione automatica dei consensi sia un potere residuo dell’ex titolare. L’indisponibilità risultante può durare indefinitamente: il prodotto non garantisce recovery della governance.

- Il server deve verificare atti, partecipazioni correnti e protezioni effettivamente interessate, senza affidare l’autorizzazione a etichette o valutazioni AI.
- I pattern concreti limitano la complessità; non servono un linguaggio generale di policy, voto o grafi di delega arbitrari.
- L’UX deve rendere comprensibili capability, protezioni, condizioni di revoca e conseguenze della rinuncia quando vengono accettate.
- Le transizioni conservano storia e provenance coerenti secondo [ADR-0005](ADR-0005-postgresql-stato-canonico-storia-provenance.md). Cambiare retroattivamente il significato di protezione o partecipazione sarebbe costoso per autorizzazione, dati e aspettative dei partecipanti.
- [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) e [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md) mantengono authority di progetto, accettazione editoriale, adesioni e obblighi distinti dall’accesso. [ADR-0004](ADR-0004-context-efficiency-minimum-sufficient-context.md) resta applicabile entro tali confini.

## Raffinamenti e stato precedente

| Fonte precedente | Effetto della registrazione |
| --- | --- |
| ADR-0006: condizioni concrete di protezione/modifica ancora aperte | **RISOLTO NEL PERIMETRO APPROVATO:** protezione contro bypass, pattern minimi e condizioni di modifica seguono questo ADR. Il record precedente resta invariato; B2 nel suo insieme non viene ratificata. |
| ADR-0007: uscita/rinuncia senza successore e continuità senza governance esercitabile | **PRECISATO, NON SUPERSEDED:** partecipazioni individuali e condizioni congiunte distinguono fine della partecipazione personale, protezione altrui e percorso autorizzativo non esercitabile. Nessun punto di ADR-0007 cambia. |
| Prima proposta conversazionale: approvazioni nominative senza la precisazione finale sulla partecipazione terminata | **RAFFINATA PRIMA DELL’APPROVAZIONE:** l’ex titolare non mantiene authority per il solo riferimento storico; non si sostituisce la condizione con “tutti i rimasti”. |
| V0.2 §§7, 13 e 20: access role, membership e cambiamenti di accesso | **REFINED:** lo schema illustrativo e i percorsi applicativi devono rispettare le relazioni approvate e impedire bypass della protezione. Non sono approvati schema, catalogo completo delle operazioni o rimozione universale dei membri. |
| MVP §§14 e 17; v0.2 note di stato e §22 | **AGGIORNAMENTO DI STATO:** ADR-0008 risolve questa parte della governance; restano da chiudere soltanto le regole B2 ancora necessarie. Le diciture storiche non approvano la restante architettura. |

## Non-goal e limiti

- Non sono selezionati schema, tabelle, lock, migrazioni o dettagli di implementazione.
- Non sono approvati RBAC generico, permission matrix, policy DSL, voto, gerarchie sociali, deleghe arbitrarie o un motore universale di governance.
- Restano da definire, ove necessari, catalogo operativo concreto, inviti/ammissioni, rimozione ordinaria, visibilità storica e altri dettagli B2 non risolti dal testo. I pattern approvati non ratificano tutte le clausole delle precedenti bozze.
- Chiusura, archiviazione, cancellazione del Workspace e recovery eccezionale restano fuori da questa decisione; non se ne stabiliscono policy o nuove authority.
- La closure review richiesta nello stesso messaggio è sola analisi, senza ulteriori ADR o approvazioni implicite.
- ADR-0001–ADR-0007 e v0.1 rimangono invariati; v0.2 resta una proposta. Nessun codice, schema, migrazione, dipendenza o bootstrap implementativo è autorizzato o avviato.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione verbatim dell’approvazione e dei chiarimenti richiesti; riferimenti canonici minimi, ADR-0001–ADR-0007 invariati, restante B2 non approvata, nessuna implementazione. |
