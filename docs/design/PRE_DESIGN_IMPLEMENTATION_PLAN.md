# RIMIAM — Pre-design implementation plan

**2026-09-13 · B1–B3 IMPLEMENTED / VERIFIED · READY FOR CLAUDE DESIGN.**

**Lettura storica dal 2026-09-14:** la successiva autorizzazione a integrare Ritmo supera il rinvio “AFTER CLAUDE” e il prossimo passo qui descritti. Implementazione e verifiche correnti sono in [STATUS](../development/STATUS.md); le sezioni seguenti conservano lo stato effettivo del checkpoint del 13 settembre.

Il piano iniziale, richiesto nel brief `eb66db51-86dc-45ad-8072-893e4385166c`, è stato eseguito su autorizzazione esplicita `a1b07e63-26ad-4ff6-b059-da7f53f6d25e/pasted-text.txt`. Questo aggiornamento sostituisce lo stato proposto del piano; non approva altro BUILD o nuove semantiche. Base iniziale: `127232d`. [Audit](CURRENT_UX_AUDIT.md) e [reconciliation v2](UX_DIRECTION_RECONCILIATION.md) rimangono fotografie della fase precedente; il presente documento e [STATUS](../development/STATUS.md) descrivono il delta implementato.

## Critical check prima del BUILD

Nessuna nuova decisione fondazionale necessaria per B1–B3. ADR-0001–0015 invariati. Riutilizzati sorgenti/messaggi, ricevute, transazioni, guard Workspace, versioning Workstream e boundary comune. Nessun modello descrizione separato, role engine, nuova privacy o framework di azioni/agent.

Due precisazioni applicative: “Reopened” è l’atto che riporta ad Active la stessa identità; l’organizzazione AI resta proposta fino ad attivazione esplicita. Un cambiamento editoriale di titolo/descrizione non attiva né riapre un filone. La capability di contribuzione già usata da Workstream governa questi atti non normativi, senza authority sulle decisioni del progetto.

## BEFORE CLAUDE — completato

| ID                                 | Implementato                                                                                                                                                                                                                                                                                                                                                                                                                                       | Boundary verificati                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 — Qualificazioni/provenance** | Proiezione deterministica degli usi di un candidato in versioni informative, domande e proposte normative, comprese correzioni/storia. Nativi mostrano origine attribuita/inferita, qualificazioni e fonti, con riferimenti a versioni correnti/storiche. Atti superseduti non sono presentati come attualmente efficaci. Storia Active Work espone attore, ipotesi, origine/fonti e versioni già disponibili; Contributions restano non adottate. | [queries](../../src/server/queries.ts), [snapshot contract](../../src/contracts/web-snapshot.ts), [Web](../../src/app/page.tsx), [iOS](../../mobile/ios/Miriam/WorkspaceDetail.swift), [Android](../../mobile/android/app/src/main/java/it/miriam/nativeapp/WorkspaceDetailScreen.kt). Nessun nuovo gate di accettazione o stato epistemico persistente. |
| **B2 — Descrizione/welcome**       | `workspace.create` accetta descrizione opzionale, conserva un messaggio umano introduttivo e un welcome deterministico nella transazione di creazione/ricevuta. Origine, autore, sequenza e riferimento restano consultabili. Replay identico non duplica; diverso payload riutilizzando la chiave è rifiutato. Vecchi payload/journal solo nome compatibili. Nessuna inferenza, Goal, adesione o accettazione implicita.                          | [commands](../../src/server/commands.ts), [v1](../../src/contracts/v1.ts), [sync](../../src/server/sync.ts), journal Web/iOS/Android. Il messaggio umano entra nella selezione ordinaria delle fonti, senza obbligare a includerlo integralmente per sempre.                                                                                             |
| **B3 — Lifecycle Workstream**      | `workstream.transition`: activate, resolve, archive, reopen, con versione attesa, contribuzione corrente e ricevuta. Stato corrente interrogabile e storia immutabile. Riapertura conserva identità/fonti; nessun effetto su Goal, Task, Commitment o Active Work. Risultati AI tardivi non ampliano/riaprono filoni conclusi.                                                                                                                     | [attention commands](../../src/server/attention.ts), [contratto](../../src/contracts/attention.ts), [migrazione 030](../../migrations/030_workspace_introduction_workstream_lifecycle.sql). I client separano minimamente gli attivi da proposte/conclusi mediante filtro; nessun nuovo pannello o percorso lifecycle definitivo.                        |

### Persistenza e compatibilità

Migrazione additiva **030**, senza modificare 001–029. Nei Workspace preesistenti non viene fabbricato un welcome retroattivo. Workstream creati esplicitamente da una persona risultano attivi; raggruppamenti creati dall’AI rimangono proposti, anche se successivamente rinominati da una persona. Il lifecycle delle versioni anteriori resta non registrato (`null`): nessuna riscrittura né attribuzione retroattiva di consenso.

Nuovo codice/DTO richiede schema 030; applicare la migrazione prima di avviare il runtime aggiornato. Il database locale di sviluppo è stato aggiornato dopo backup: **7 Workspace / 18 messaggi conservati**. Database di verifica separati. Nessuna dipendenza, credenziale, provider, architettura proposta o ADR modificato.

## VERIFIED — evidenza eseguita

- Test mirati per B1/B2/B3: descrizione attribuita, nessun Goal/authority/AI implicito, receipt/retry concorrenti, ammissione, reload/catch-up, immutabilità; accettazione di ipotesi qualificate e correzioni; lifecycle condiviso, stale/concorrenza, cessata eligibility, isolamento, attivazione esplicita e organizzazione AI tardiva.
- Regressione del milestone: **89 casi in 10 file** interessati. Primo passaggio: 88 passati, un’asserzione precedente attendeva zero messaggi dopo upload; adeguata alla presenza del welcome e ripetuto soltanto il file pertinente: **11/11 passati**. Nessun fallimento irrisolto. Non rieseguite suite estranee né browser/E2E.
- **iOS:** build simulatore arm64 e **4/4 BoundaryTests passati** con API locale e Keychain. Include journal con descrizione, replay, lifecycle, decode della provenance/versioni informative. Per Keychain serve firma ad hoc locale del simulatore; un tentativo senza firma non è una prova valida dello storage. Nessuna firma/distribuzione per dispositivi reali.
- **Android:** compilazione e lint passati; **4 casi boundary passati** fra passaggio base e ripetizione mirata del nuovo caso. Il nuovo test preserva le qualificazioni composte da fonte + inferenza; i limiti auth sono rimasti invariati anche durante retry ravvicinati. API locale e Keystore reali, non servizi esterni.
- Typecheck, ESLint, formatting, backend standalone e build Next passati. Controlli statici/contrattuali dei tre frontend, non acceptance visuale.
- Fresh **001–030**, upgrade **029→030** con dati storici e successivi checksum rerun passati. Hash dei messaggi/versioni Workstream originali invariati; nessuna attivazione AI o welcome retroattivo. Verificata la lettura con connessioni/client ricreati; non introdotto nuovo worker/scheduler da riavviare.

Evidenza locale: `/tmp/miriam-pre-design-migration-results.json`, `/tmp/miriam-pre-design-*.log`; backup e conteggi sviluppo in `/tmp/miriam-pre-design-20260913/`. Non committare backup o dati di test. Comandi ripetibili: test Vitest specificati in [STATUS](../development/STATUS.md), boundary nativi in [MULTICLIENT](../development/MULTICLIENT.md).

## AFTER CLAUDE — intenzionalmente non implementato

- **W1/W2/W3:** nuova Home, navigazione e Lens; composizione responsive/nativa, restoration locale di percorso/posizione, form definitivo descrizione + inviti. I form attuali restano solo nome: **API/journal pronti non significano nuova UX già realizzata**.
- **P1/W2:** proiezione Activity comune, storyboard/pillola definitiva e collegamento “Chiedi a RIMIAM” a oggetto/versione. Nessun feed di pensieri o ledger aggiuntivo.
- **P2/W4:** percorsi delle mutazioni conversazionali e focus del filone collegato a retrieval sufficiente, nel contesto delle interazioni scelte. Nessun dispatcher generico o Context figlio.
- **W4/W5:** controlli/presentazione finale di lifecycle e sub-context, gerarchia Goal/Context/Work/Outputs, Sources contestuali, collocazione Email/Calendar/People. Il contratto lifecycle è pronto, non una conversazione focalizzata completa.

Non introdotti Owner/Member/Guest come nuovi poteri, CTA “Non rilevante”, nuovi pannelli, refactor speculativi, billing o nuove integrazioni. **OPTIONAL PREP P1–P4** rimane soltanto esempi/riferimenti utili al brief; nessuna nuova architettura frontend.

## Passaggio critico finale e limiti

Le modifiche non ampliano authority, membership o visibilità. Stato di accettazione deriva dai record governati, non da confidence o label. Welcome non impersona una persona e non è una falsa risposta del modello. Resolved/Archived non hanno effetti normativi e un semplice rename non aggira l’attivazione. La migrazione non inventa storia. Minimum Sufficient Context e i Commit Points esistenti restano applicabili.

Non emerse contraddizioni fondazionali. La UX corrente resta provvisoria; gesti, leggibilità e utilità reale non sono stati validati in browser o con utenti. Provider/servizi, firma/distribuzione mobile e prove fisiche restano checkpoint separati. L’audit e la reconciliation precedenti non sono stati riscritti per farli apparire successivi all’implementazione.

## Prossimo passo unico

Usare [CLAUDE_DESIGN_HANDOFF](CLAUDE_DESIGN_HANDOFF.md) per ottenere almeno tre direzioni realmente distinte, ciascuna studiata per Web, iOS e Android. Nessun design iniziato in questo lotto. Integrare proiezioni/percorso naturale e nuova composizione soltanto dopo la scelta; verificare i comportamenti dipendenti dai provider prima di congelare l’esperienza.
