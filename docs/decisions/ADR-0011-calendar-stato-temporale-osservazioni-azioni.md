# ADR-0011 — Calendar: stato temporale, osservazioni e azioni esterne

## Stato e provenance

- **Stato:** APPROVED DECISION — modello richiesto esplicitamente dall’utente, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data:** 2026-09-10 (Europe/Rome). **Versione:** 1.
- **Fonte:** brief `25f3d646-de1d-4073-9855-e9e9ee8095b9/pasted-text.txt`, conversazione `01a082d6-6a10-7d30-8e76-71c7928fcb96`. L’utente richiede questo modello e autorizza BUILD e registrazione mirata; non è un’approvazione implicita di scelte ulteriori.
- **Relazioni:** applica ADR-0001–0010 e [MVP §13](../product/MVP_SPEC_v0.1.md#13-capability-operative-incluse-nellmvp). I record precedenti rimangono invariati.

## Decisione

1. **Temporal State interno.** Calendar è una vista dello stato temporale canonico del Workspace. La dimensione temporale di un Commitment, Task o altro concetto resta associata alla sua identità; un Scheduled Event distinto serve soltanto per un appuntamento autonomo. Modifiche canoniche richiedono authority pertinente, atti attribuiti, versioni, provenance e transazioni.
2. **External Calendar Observation.** Connection e risorse autorizzate permettono letture circoscritte di eventi/disponibilità, con provenance e privacy. Un’osservazione non è automaticamente Accepted Information, Decision, Commitment o stato canonico. Non si importano calendari completi indiscriminatamente. Credenziali e contenuti esterni non condivisi restano fuori dal confine condiviso secondo ADR-0009.
3. **External Calendar Action.** Need/intention → proposal → authorization → Commit Point → execution → receipt → reconciliation → provenance. La proposta identifica connection, risorsa, operazione, payload/versione e fonti. Modifiche materiali invalidano autorizzazioni precedenti. Il server rivalida idoneità di sessione/account, accesso, risorsa/connection, versioni, authority, precondizioni e stato dell’operazione immediatamente prima dell’effetto. Connection, proposta, autorizzazione e successo esterno sono distinti.
4. **Identità e riconciliazione.** Una pubblicazione conserva la relazione esplicita fra identità/versione interna e rappresentazione esterna. Overlap non prova identità, somiglianza non autorizza merge, sincronizzazione non attribuisce ownership. Cambiamenti esterni o interni possono produrre divergenze e proposte; nessuna propagazione automatica in alcuna direzione. Vale sempre observation → detection → proposal → authorization → change.
5. **Affidabilità.** Identità stabile, stato durevole e ricevute distinguono almeno PROPOSED, AUTHORIZED, EXECUTING, SUCCEEDED, FAILED e OUTCOME_UNKNOWN. Esito ignoto non significa fallimento. Prima di ripetere un effetto incerto occorrono garanzie di idempotenza o riconciliazione esterna sufficiente a escludere duplicazioni; nessun workflow engine generico è richiesto.
6. **Perimetro minimo di authority.** Questo incremento supporta una persona che controlla una propria risorsa e autorizza un’azione precisa che rappresenta soltanto sé. Accesso tecnico, membership, adesione e connection non costituiscono deleghe o rappresentanza altrui. Casi non rappresentabili restano unsupported, senza scorciatoie.
7. **Provider e client.** Boundary piccolo e indipendente dal provider per discovery, bounded reads/free-busy, create/update e fetch/reconciliation. Stato autorevole e Commit Points restano server-side; Web, SwiftUI e Compose consumano lo stesso contratto. Doubles deterministici soltanto nei test; runtime non configurato dichiara indisponibilità.

## Motivazione e conseguenze

Un semplice mirror del provider confonderebbe osservazione, impegno e permesso di agire; due calendari indipendenti perderebbero la continuità della stessa iniziativa. Identità esplicite e versioni ancorate consentono confronto e riconciliazione senza modifiche silenziose. Distinguere gli esiti incerti evita retry duplicanti dopo response loss o restart.

La persistenza deve conservare gli atti interni separatamente dalle osservazioni e dalle prove degli effetti. Serve disciplina sui riferimenti, sulla privacy e sulla rivalidazione; cambiare queste semantiche dopo dati reali sarebbe costoso. Il database e un provider esterno non condividono una transazione: la riconciliazione è necessaria, non una promessa di atomicità distribuita.

## Limiti

Non sono scelti Google/Microsoft, OAuth reale, hosting, account, costi, notifiche, recurring-event policy, una tassonomia universale o un framework di integrazioni. La disposizione esatta di tabelle, code, endpoint e test resta implementativa. Il brief autorizza Calendar BUILD, non Workspace Email o WIRE. L’implementazione e i suoi limiti verificati sono nel [checkpoint](../development/STATUS.md).
