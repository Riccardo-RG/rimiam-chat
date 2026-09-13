# ADR-0005 — PostgreSQL, stato canonico e storia con provenance

## Stato e provenance

- **Decisione:** B1 — modello di persistenza autorevole, dalla gap review della proposta architetturale v0.2.
- **Stato:** APPROVED DECISION — architetturale, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvata da:** utente, mediante approvazione esplicita e richiesta di registrazione nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, già identificata negli ADR precedenti.
- **Relazioni:** attua gli invarianti di [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md), [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md) e [ADR-0004](ADR-0004-context-efficiency-minimum-sufficient-context.md), che restano invariati.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

La review aveva classificato B1 come scelta ancora da approvare. La fonte dell’approvazione è il successivo messaggio dell’utente «Record the explicitly approved B1 decision as a new ADR», che fornisce il testo seguente e ne delimita espressamente il perimetro. Non si deduce l’approvazione dalle precedenti diciture della proposta.

## Decisione approvata

Testo fornito dall’utente, conservato nella lingua originale:

> MIRIAM will use PostgreSQL as the authoritative system of record for domain state. Current state will be materialized and directly queryable, while sources, versions, provenance and relevant transitions will be preserved as immutable/historical records. Canonical state changes will occur through validated, transactional application commands. Full event sourcing will not be adopted as the foundation of the MVP.

I punti seguenti registrano il perimetro richiesto nello stesso atto di approvazione:

1. **System of record.** PostgreSQL è il sistema autorevole per lo stato del dominio di MIRIAM; lo stato appartiene al Workspace, non al provider AI o agli agenti.
2. **Stato corrente.** Lo stato canonico corrente è materializzato e direttamente interrogabile. Non occorre ricostruirlo normalmente tramite replay. Questo non prescrive una specifica vista SQL, una duplicazione dei valori o l’esatto meccanismo di rappresentazione; il Current State di prodotto resta la proiezione definita dalla specifica.
3. **Fonti e storia.** Fonti, versioni, provenance e transizioni rilevanti richieste dagli invarianti sono conservate come record immutabili/storici. Correzioni e nuove interpretazioni non riscrivono silenziosamente le fonti o le versioni precedenti; la storia non viene ricreata rieseguendo modelli AI.
4. **Comandi validati.** Le operazioni di dominio che modificano lo stato passano attraverso comandi applicativi validati, nel rispetto di identità, versioni, isolamento, accesso, accettazione e authority applicabili secondo gli ADR approvati.
5. **Atomicità di dominio.** Le modifiche che devono essere atomiche dal punto di vista del dominio vengono committate transazionalmente, mantenendo coerenti lo stato corrente, la storia e la provenance richiesti dalla transizione.
6. **Disponibilità della storia.** Record storici e provenance restano disponibili, entro i confini di accesso applicabili, per ispezione, correzione, verifica dell’authority e futuro recupero selettivo del contesto. Nessuna strategia di retrieval è selezionata da questo atto.
7. **Output AI.** Un risultato di inferenza non è di per sé stato autorevole. Attribuzioni, candidati, informazioni accettate ed effetti normativi continuano a seguire le distinzioni e i processi approvati; confidence o classificazione AI non autorizzano una transizione.
8. **Infrastruttura.** Meccanismi di delivery, code e record diagnostici delle inferenze non sono il system of record del dominio. La loro presenza nello stesso database non cambia questa distinzione né sostituisce la storia e la provenance canoniche.
9. **Full event sourcing.** Non è adottato come fondazione dell’MVP. Un log storico o una cronologia di versioni non implicano che lo stato corrente debba essere una proiezione ricostruita da un ledger autorevole di eventi. Un’eventuale riconsiderazione segue il criterio sotto indicato; CQRS non è approvato da questo ADR.
10. **Schema non ratificato.** Il disegno esatto di schema e tabelle resta una scelta implementativa vincolata alle semantiche degli ADR approvati. Non sono approvati lo schema illustrativo v0.2 invariato, il suo numero di tabelle, il layout esatto o una rappresentazione generica `context_item` per ogni concetto di dominio.

## Motivazione e conseguenze

- Le letture ordinarie e le query sullo stato corrente sono più semplici: non richiedono replay della conversazione, riesecuzione dei modelli o ricostruzione normale da un ledger di transizioni.
- L’applicazione deve mantenere esplicitamente coerenti stato corrente, storia immutabile e provenance, con validazione e transazioni appropriate; la presenza della storia non garantisce da sola tale coerenza.
- Le migrazioni devono preservare identità stabili e riferimenti storici, comprese le versioni rilevanti per adesioni, mandati, accettazioni e obblighi.
- La storia durevole permette ispezione e recupero selettivo futuro senza dipendere dalla conservazione dei diagnostici AI o dei feed di trasporto. Non impone vector database, knowledge graph o una particolare architettura di retrieval.
- Cambiare successivamente il modello autorevole di persistenza sarebbe costoso: coinvolgerebbe comandi, riferimenti persistenti, migrazioni, consistenza e procedure di recovery.

L’alternativa di un ledger autorevole di transizioni con stato corrente derivato richiederebbe gestione di replay, proiezioni e compatibilità degli eventi. I requisiti attuali dell’MVP non ne giustificano la complessità aggiuntiva.

## Raffinamenti e limiti

**V0.2, F01 / §§2, 6–7 e 21 — APPROVED soltanto il modello autorevole:** il precedente stato di mera proposta è superato per il perimetro di questo ADR. Rimangono provvisori la rappresentazione concreta tramite current pointers, lo schema illustrativo e gli altri dettagli non approvati. Le formulazioni storiche sono conservate e annotate; non diventano retroattivamente approvazioni.

**Atomicità:** il punto 5 non ratifica automaticamente tutte le transazioni illustrate nella v0.2, l’enqueue tramite Graphile nello stesso database, i lock, i gate o gli altri meccanismi di F04/F05. Approva l’atomicità richiesta dal dominio, non una particolare soluzione infrastrutturale.

ADR-0001–0004 non sono riaperti o modificati. Questo atto non approva altre scelte di stack, policy di accesso, retention/cancellazione, schema o retrieval e non autorizza bootstrap, implementazione, codice o migrazioni.

## Criterio di riconsiderazione

Riconsiderare il modello soltanto se emergono requisiti misurati che traggano un beneficio materiale da un ledger autorevole di transizioni / modello event-sourced e giustifichino i costi aggiuntivi di replay, proiezioni e compatibilità. Una preferenza tecnologica o una necessità ipotetica non bastano; l’eventuale revisione deve essere esplicita.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione dell’approvazione esplicita di B1 e dei suoi limiti; riferimenti documentali minimi, ADR-0001–0004 invariati, nessuna implementazione. |
