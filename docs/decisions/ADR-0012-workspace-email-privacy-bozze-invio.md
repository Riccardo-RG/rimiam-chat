# ADR-0012 — Workspace Email: privacy, bozze e invio autorizzato

## Stato e provenance

- **Stato:** APPROVED DECISION — modello richiesto esplicitamente dall’utente; FOUNDATIONAL / COSTLY TO CHANGE.
- **Data:** 2026-09-10 (Europe/Rome). **Versione:** 1.
- **Fonte:** brief `937d13d3-a684-4e7f-88c2-5cba858f859a/pasted-text.txt`, conversazione `01a082d6-6a10-7d30-8e76-71c7928fcb96`. L’utente autorizza Workspace Email BUILD e formalizzazione mirata del modello descritto, non nuova authority o WIRE.
- **Relazioni:** applica ADR-0001–0011, [MVP/reconciliation](../product/MVP_V0.2_RECONCILIATION.md) e la separazione fra dati condivisi e sistemi esterni di ADR-0009. I precedenti ADR restano invariati.

## Decisione

1. **Mailbox Connection** verificata e capability effettive, osservazioni private, disclosure esplicita, draft interno e azione di invio sono concetti distinti. Accesso tecnico non autorizza disclosure o rappresentanza.
2. Ricerca e lettura di messaggi/thread/allegati sono circoscritte allo scopo. Contenuti e metadata restano privati al proprietario salvo disclosure esplicita. Nessuna importazione indiscriminata o promozione automatica a Accepted Information, accordo o commitment.
3. La disclosure identifica esattamente il contenuto portato nel Workspace e rende comprensibile la visibilità della storia conservata secondo ADR-0009. Conserva provenance del materiale selezionato senza esporre altro contenuto privato. L’accettazione editoriale e l’authority restano quelle di ADR-0002 e ADR-0001.
4. New, reply e forward conservano identità e relazioni appropriate con il messaggio/thread sorgente. Un draft è interno, versionato e non crea una Provider Draft. Un forward è una nuova azione con disclosure esplicita del materiale inoltrato.
5. L’invio segue intenzione → draft → proposta precisa → autorizzazione → Commit Point → effetto provider → ricevuta → riconciliazione → provenance. L’autorizzazione copre sender, To/CC/BCC, subject, body, identità/versioni degli allegati e target new/reply/forward. Modifiche materiali invalidano l’autorizzazione precedente.
6. Immediatamente prima dell’effetto il server rivalida sessione/account, membership/access, mailbox/capability, rappresentanza del sender, versione, destinatari, allegati, precondizioni e stato dell’operazione. Il perimetro è soltanto self-representation su mailbox controllata dalla persona; nessuna delega implicita.
7. Allegati privati richiedono disclosure per entrare nel confine condiviso. Allegati dello spazio richiedono autorizzazione della precisa versione e dei destinatari per uscire. Riferimenti stabili e provenance evitano copie non necessarie senza aggirare confini di accesso.
8. Stato e prove durevoli distinguono PROPOSED, AUTHORIZED, EXECUTING, SUCCEEDED, FAILED e OUTCOME_UNKNOWN. Una risposta persa dopo l’accettazione del provider non rende sicuro un reinvio. Solo idempotenza o riconciliazione sufficienti possono giustificarlo; altrimenti l’esito resta ignoto. Ricevuta di invio non significa lettura o consegna finale provata.
9. Boundary concreto indipendente dal provider per discovery/verifica, search, fetch message/thread/attachment e invio new/reply/forward/riconciliazione. Server autorevole comune e tre client nativi/web secondo ADR-0010. Doubles soltanto nei test; runtime non configurato onesto.

## Motivazione e conseguenze

Un semplice `sendEmail` perderebbe le relazioni di reply, la privacy dei contenuti letti e l’identità degli effetti incerti. Provenance e autorizzazione dell’envelope esatto sono necessarie prima di dati reali: cambiare questi confini successivamente sarebbe costoso. La mailbox e PostgreSQL non condividono una transazione; occorrono prove e riconciliazione, non una promessa di consegna exactly-once.

Bozze e dettagli operativi non autorizzano condivisione implicita; la prima implementazione li conserva nella superficie privata della capability, fuori dallo Shared Context. Non sono memoria personale nascosta di Miriam né ACL per sottogruppi sullo stato condiviso. Una futura superficie collaborativa deve usare disclosure esplicita. Schema, UI e finestre operative restano scelte implementative entro questi confini.

## Non-goal

Nessun provider scelto/attivato, OAuth reale, costo, hosting, distribuzione, push, auto-reply, mass mailing, invio autonomo o generic integration engine. Resend/account-security mail resta un servizio distinto, senza authority di mailbox. Il perimetro autorizza BUILD; limiti e verifiche sono nel [checkpoint](../development/STATUS.md).
