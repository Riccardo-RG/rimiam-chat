# ADR-0015 — Voce, chiamate e consenso alla registrazione

## Stato e provenance

- **Stato:** APPROVED DECISION; estensione del perimetro MVP con BUILD autorizzato, non attivazione di servizi.
- **Data:** 2026-09-13 (Europe/Rome).
- **Fonte:** richieste dell’utente nella conversazione `01a082d6-6a10-7d30-8e76-71c7928fcb96`: «Extend the currently closed MVP foundation with the following final approved voice/calling scope», seguita da «Approved, with one refinement to make the consent boundary explicit». Il secondo messaggio approva la regola seguente e richiede registrazione e implementazione continua. Nessun timestamp del messaggio viene ricostruito.
- **Relazioni:** [MVP](../product/MVP_SPEC_v0.1.md), ADR-0002 (fonte/adozione), ADR-0004 (Minimum Sufficient Context), ADR-0005 (storia/provenance), ADR-0009 (visibilità storica), ADR-0010 (client), ADR-0014 (analisi/Contributions). ADR-0001–0014 restano invariati.

## Perimetro approvato

Messaggi vocali registrabili, inviabili e riproducibili nella Conversation su Web, iOS e Android, con trascrizione reale e provenance. Conversazione vocale con RIMIAM sullo stesso Context della Conversation testuale; richieste naturali di ricerca/analisi, con effetti consequenziali sempre attraverso la capability e il Commit Point autenticato pertinenti. Chiamate audio reali fra partecipanti umani dello stesso Workspace, con permessi microfono, connessione/riconnessione, lifecycle e stati di errore visibili. RIMIAM non partecipa né parla live nelle chiamate umane.

Pipeline: chiamata umana → registrazione autorizzata → trascrizione/fonte → richiesta separata di analisi RIMIAM → recap/candidati → adozione/azioni governate esistenti. La fonte grezza resta distinta dal Context operativo; la selezione successiva segue ADR-0004, senza inserire sistematicamente la trascrizione integrale in ogni inferenza.

## Regola esatta approvata — consenso

- Any authenticated call participant may request recording, but recording starts only after **every participant whose audio would be captured has explicitly consented**. No participant may consent on behalf of another.
- The consent must clearly cover **audio recording, transcription, retention as a shared Workspace Source, and the resulting history-visibility consequences under ADR-0009**, including visibility to eligible members according to the Workspace history policy.
- If a new participant joins while recording is active, recording pauses before capturing that participant and resumes only after their explicit consent. If a participant withdraws consent, recording stops immediately for subsequent audio; the call itself may continue without recording.
- A participant leaving the call does not revoke previously valid consent or delete already authorised material. Recording may continue for the remaining participants if all remaining captured participants still have valid consent.
- Withdrawal is prospective. It does not automatically delete recordings, transcripts or derived material already created under valid consent; deletion/lifecycle semantics remain a separate governed operation.
- Recording consent does **not** authorise RIMIAM analysis. Post-call analysis/summarisation requires a separate explicit request.
- Recording/transcription alone must not promote content into Accepted Information, commitments, decisions or other governed state. Existing Context/provenance/adoption rules remain authoritative.

## Conseguenze e limiti

Il consenso è personale, esplicito, attribuito e verificabile rispetto alla registrazione; non deriva da membership, creator, access governance, comportamento o silenzio. Consenso, esito del trasporto, registrazione conservata, trascrizione e richiesta di analisi mantengono riferimenti distinguibili. Retry e recovery non riattivano una registrazione ritirata né trasformano un esito ignoto in successo. Cambiare questi significati successivamente sarebbe costoso per storia, privacy e attribuzione.

**Superseded nel perimetro audio:** MVP §§2.5 e 15 e precedenti checkpoint escludevano chiamate native live. L’esclusione rimane per videochiamate e per RIMIAM live nelle chiamate umane; la presente approvazione aggiunge soltanto il perimetro sopra. Nessuna nuova authority su impegni o azioni, nessuna policy di cancellazione, push, billing, eredità avanzata di Context o framework generale multi-agent. SDK, trasporto, storage e composizione UI restano scelte implementative entro gli invarianti.
