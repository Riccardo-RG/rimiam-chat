# ADR-0013 — Tasks, responsabilità e follow-up

## Stato e provenance

- **Stato:** APPROVED DECISION — FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di registrazione e conferma verificabile:** 2026-09-10 (Europe/Rome). **Versione:** 1.
- **Fonte:** messaggio dell’utente «Resume the exact next increment from STATUS.md: Tasks + Follow-up BUILD», conversazione `01a082d6-6a10-7d30-8e76-71c7928fcb96`. L’utente identifica la decisione come già approvata, ne riporta le sei semantiche seguenti e richiede registrazione e BUILD. Questo messaggio è la conferma esplicita disponibile; non si attribuiscono data o testo integrale a un precedente atto di approvazione non disponibile. La precedente raccomandazione di Codex non costituisce da sola approvazione.
- **Relazioni:** applica ADR-0001–0012, invariati, e [MVP §5](../product/MVP_SPEC_v0.1.md#5-artifacts-e-tasks). Persistenza, temporalità, accesso e client mantengono i rispettivi confini approvati.

## Semantiche approvate — testo dell’utente

- `suggestion ≠ Task ≠ responsibility ≠ Commitment ≠ authority to act`;
- responsibility for another person requires their explicit acceptance of the relevant Task/version;
- accepted responsibility permits normal operational management of that Task, but material changes to accepted scope/deadline/expectations require new acceptance or already-valid pertinent authority;
- a person may explicitly relinquish their own responsibility; this returns the Task to unassigned and does not erase or satisfy linked obligations;
- Task completion has no automatic normative consequence for Commitment, Goal, Decision or Constraint;
- Miriam follow-up/reminders may remember, monitor, request updates or propose actions, but never create responsibility or authority for consequential actions.

## Contesto e conseguenze

Registrare lavoro concreto non equivale a impegnare qualcuno. Separare proposta, attività, accettazione personale e obblighi evita che una menzione, una revisione o un reminder trasferiscano responsabilità o autorizzino effetti. Le modifiche materiali non estendono silenziosamente il lavoro accettato; rinuncia e completamento non riscrivono gli obblighi collegati.

Occorrono identità e versioni durevoli, atti attribuiti, provenance, controlli di accesso/staleness e gestione deterministica delle transizioni. Le scadenze e i reminder mantengono la propria identità secondo ADR-0011; recovery e retry non producono nuovi incarichi o effetti. Cambiare il significato di accettazioni o chiusure già registrate sarebbe costoso. Layout SQL, comandi, stati operativi minimi e UI restano implementativi entro queste semantiche.

## Perimetro e non-goal

Autorizzato Tasks + Follow-up BUILD sul backend comune e sui tre client, con verifiche e checkpoint. Nessun nuovo potere di rappresentanza, delega implicita, effetto normativo automatico, workflow configurabile o motore generale di policy/scheduling. Nessuna attivazione di servizi, OAuth, push, email/SMS reali, hosting o deploy. Il [checkpoint](../development/STATUS.md) registra separatamente implementazione, verifiche e limiti.
