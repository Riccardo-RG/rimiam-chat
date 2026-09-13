# ADR-0009 — Visibilità storica dei membri e confine condiviso del Workspace

## Stato e provenance

- **Decisione:** visibilità storica dei membri umani; completa, insieme alla policy operativa B2, la risoluzione di B2 per la pianificazione implementativa dell’MVP.
- **Stato:** APPROVED DECISION — architetturale e di prodotto, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvata da:** utente, mediante approvazione esplicita per riferimento nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, già identificata negli ADR precedenti.
- **Fonte primaria:** allegato `6ee1429d-0b56-4379-af8a-64fc0e4e26e6/pasted-text.txt`; approva la sezione A della risposta precedente e la sezione B, punti 1–8, e richiede: «Treat this approval as the closure of B2 for MVP implementation planning.»
- **Policy approvata nello stesso atto:** testo completo della sezione B registrato soltanto in [MVP §14.1](../product/MVP_SPEC_v0.1.md#141-policy-operativa-b2-approvata), senza un ulteriore ADR.
- **Relazioni:** completa il confine di accesso di [ADR-0006](ADR-0006-accesso-workspace-capability-relazioni-authority.md), [ADR-0007](ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md) e [ADR-0008](ADR-0008-governance-accesso-protetta-condizioni-congiunte-rinuncia.md). ADR-0001–ADR-0008 rimangono invariati.
- **Proposta interessata:** [ARCHITECTURE_PROPOSAL_v0.2.md](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md), che resta una proposta nei passaggi non approvati.

La fonte primaria approva per riferimento i testi della risposta precedente: la sezione A è riportata sotto verbatim, la sezione B nella specifica canonica. La registrazione non estende quei testi e non trasforma la successiva architecture readiness review in un’approvazione implicita dell’intera v0.2.

## Testo esatto approvato

Testo della sezione A della proposta, approvato dall’utente per riferimento e conservato nella lingua originale:

> In MVP v0.1, active human membership, subject to applicable account/security eligibility, grants access to all retained content within the shared Workspace boundary, including current canonical state and historical conversations, sources, versions and artifacts from before admission and during periods of absence. Newly admitted and returning members follow the same rule, without per-member historical cutoffs. Full-history access is an explicit consequence of admission: the authorizing actor is informed of that consequence, and the recipient explicitly accepts membership on those terms. Existing admission authority and applicable constraints remain necessary. Departure or removal ends subsequent access but cannot recall information already disclosed; readmission does not revive ended governance relationships or establish Goal adherence, agreement or inherited commitments. Miriam may use authorized retained shared history subject to ADR-0004 and the approved provenance and information semantics. Private content outside this Workspace, credential stores, restricted diagnostics/security data and separately authorized external systems are excluded. This decision does not establish a retention policy or approve historical ACLs, selective sharing or retroactive revocation.

## Perimetro e distinzioni preservate

- La membership umana attiva, entro l’idoneità applicabile dell’account, comprende tutto il contenuto conservato nel confine condiviso: stato canonico corrente e conversazioni, fonti, versioni e Artifacts storici. Ingresso e periodi di assenza non introducono cutoff individuali.
- Questa condivisione è una conseguenza esplicita dell’ammissione, presentata all’attore autorizzante e accettata dal destinatario. Il disclosure non sostituisce l’authority richiesta o i vincoli applicabili.
- Uscita o rimozione interrompono l’accesso successivo, anche ai contenuti precedenti; non richiamano copie o informazioni già divulgate. La riammissione segue la stessa visibilità, senza ripristinare relazioni di governance terminate.
- Leggere la storia o rientrare non crea, rinnova o trasferisce per effetto della membership adesioni al Goal, accordo o impegni. Atti e obblighi preesistenti conservano il proprio perimetro secondo [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md) e [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md); l’accesso non li cancella né li attribuisce al nuovo membro.
- Attributed Statement, Accepted Information ed effetti normativi restano distinti secondo [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md). Visibilità e uso di un contenuto non ne costituiscono accettazione o authority.
- Miriam può utilizzare storia condivisa autorizzata secondo [ADR-0004](ADR-0004-context-efficiency-minimum-sufficient-context.md); disponibilità di tutta la storia non richiede di inserirla tutta in ogni inferenza. Provenance e storia durevole seguono [ADR-0005](ADR-0005-postgresql-stato-canonico-storia-provenance.md).
- Contenuti privati esterni al Workspace, credenziali, dati diagnostici/di sicurezza riservati e autorizzazione dei sistemi esterni restano separati. La decisione non sposta questi dati nel confine condiviso e non impone conservazione indefinita.

## Motivazione e conseguenze

La scelta rende l’ingresso partecipazione a un ambiente collaborativo esistente, comprensivo del percorso che ne spiega lo stato corrente. Una sola regola di visibilità evita provenance frammentata e permette catch-up e comprensione coerenti anche dopo cambiamenti del gruppo.

Non è una mera ottimizzazione tecnica: ammettere una persona può divulgare materiale anteriore alla sua partecipazione. Il prodotto deve rendere esplicita tale conseguenza. Se il contenuto conservato non può essere condiviso con quella persona, l’ammissione a quel Workspace non è appropriata sotto questa regola.

L’alternativa del cutoff di ingresso offrirebbe una diversa proprietà di privacy, ma richiederebbe definire anche l’accesso alle informazioni storiche esposte attraverso stato corrente, fonti e risposte AI. Non è adottata nell’MVP. La soluzione approvata conserva il modello full-history e lo rende esplicito negli atti di ammissione.

- L’autorizzazione umana ordinaria non richiede ACL temporali per membro o ricostruzione dei periodi storici di accesso; selezione del Context e presentazione rimangono distinte dall’accessibilità.
- Le informazioni già divulgate non possono essere rese non conosciute tramite una successiva rimozione. Cambiare questo confine dopo l’uso reale inciderebbe su autorizzazione, aspettative e trattamento della storia.
- Il modello autorevole e la provenance restano quelli approvati; non vengono selezionati schema, query, retrieval o meccanismi di revoca delle sessioni.

## Raffinamenti e chiusura di B2

| Fonte precedente | Effetto della registrazione |
| --- | --- |
| MVP §2.3: One Space, One Shared Context | **PRECISATO:** membership umana attiva comprende la storia condivisa conservata, anche anteriore all’ingresso; nessuna memoria privata nascosta o ACL storica individuale viene introdotta. |
| V0.2 §§7, 9, 11 e 13: membership, letture, Context assembly e accesso | **REFINED:** le future implementazioni applicano il confine approvato senza cutoff di ingresso per i membri umani; l’ammissione esplicita e le esclusioni restano vincolanti. Schema, trasporto e tecnologie rimangono scelte implementative. |
| MVP §§14 e 17; v0.2 stato corrente di B2 | **B2 SUFFICIENTEMENTE RISOLTA PER LA PIANIFICAZIONE IMPLEMENTATIVA DELL’MVP:** ADR-0006–ADR-0009 e la policy operativa del MVP §14.1 chiudono il perimetro approvato. Le precedenti indicazioni di B2 aperta descrivono lo stato delle rispettive registrazioni storiche. |

Le regole operative complete, incluse ammissioni, rimozioni, atti pendenti e delega limitata agli inviti, sono nel MVP §14.1. Non vengono duplicate qui. L’assenza di successione automatica e recovery eccezionale e il rinvio di chiusura/archiviazione/cancellazione restano espliciti nella policy.

## Non-goal e limiti

Non sono approvati ACL storici, cutoff configurabili, visibilità per sottogruppi, condivisione retroattiva selettiva, revoca retroattiva delle informazioni divulgate o sistemi di redazione retroattiva. Non sono definite retention, chiusura/archiviazione/cancellazione del Workspace o nuove autorizzazioni verso sistemi esterni.

ADR-0001–ADR-0008 e la proposta v0.1 rimangono invariati. La chiusura di B2 non ratifica lo schema illustrativo o l’intera architettura v0.2 e non autorizza codice, schema, migrazioni, dipendenze o bootstrap implementativo. La readiness review richiesta dopo la registrazione è sola analisi.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione verbatim della sezione A; policy B, punti 1–8, nel MVP §14.1; B2 sufficientemente risolta per la pianificazione implementativa, riferimenti minimi e ADR precedenti invariati, nessuna implementazione. |
