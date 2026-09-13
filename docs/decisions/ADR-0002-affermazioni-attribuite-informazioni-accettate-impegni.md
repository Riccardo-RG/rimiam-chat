# ADR-0002 — Affermazioni attribuite, informazioni accettate e impegni

## Stato e perimetro

- **Decisione:** Decisione 2.
- **Identificativo del registro:** ADR-0002.
- **Stato:** APPROVED DECISION.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione del testo approvato:** 1; i 12 punti dell’EXACT DECISION TEXT con il solo punto 4 sostituito prima dell’approvazione.
- **Approvata da:** utente, mediante approvazione formale esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, la stessa conversazione identificata nella provenance di ADR-0001.
- **Relazione:** integra [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), che resta invariato; non ne supersede alcun punto.
- **Tipo:** decisione di prodotto con vincoli architetturali; non approva un’implementazione.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

Il testo normativo completo è conservato soltanto nella sezione seguente. Contesto, provenance e supersessioni documentano la decisione senza aggiungere regole.

## Testo esatto approvato

**1. Distinzioni fondamentali.** MIRIAM distingue tra affermazioni attribuite a una fonte, informazioni descrittive accettate come riferimento di lavoro e atti che stabiliscono o modificano Constraint, Commitment o Decision. La registrazione di un’affermazione non implica l’accettazione del suo contenuto; l’accettazione di un’informazione non implica consenso collettivo, authority o autorizzazione ad agire.

**2. Terminologia.** Il concetto di prodotto è “Accepted Information / Informazione accettata”, anziché “Canonical Fact”. L’accettazione indica l’adozione di un contenuto preciso mediante il processo previsto, non una garanzia di verità. Stime, approssimazioni, condizioni e origine inferenziale rimangono visibili dopo l’accettazione. Il carattere canonico identifica la versione corrente dello stato, non la certezza del contenuto.

**3. Ingestion automatica.** MIRIAM può registrare automaticamente affermazioni rilevanti con attribuzione e riferimenti verificabili alle fonti, senza adottarne automaticamente il contenuto. Può produrre Evidence, interpretazioni e candidati, mantenendoli distinguibili dalle informazioni accettate e dagli impegni efficaci. Nell’MVP, confidence AI, ripetizione, assenza di obiezioni e autorevolezza apparente della fonte non promuovono autonomamente affermazioni sostanziali a informazioni accettate.

**4. Accettazione editoriale.** Il prodotto concede ai membri del Workspace abilitati a contribuire una capability di base per accettare esplicitamente un’informazione descrittiva precisa come riferimento di lavoro. Questa capability è una facoltà editoriale del prodotto: non costituisce decision authority, non deriva da un mandato di ADR-0001 e non richiede di stabilirne uno per esercitarla. Non consente di rappresentare altri membri, non equivale a consenso collettivo e non permette di creare o modificare Constraint, Commitment, Decision, mandati o autorizzazioni operative. Ogni accettazione rimane attribuita alla persona che l’ha effettuata; il sistema rende consultabili chi ha accettato, quale contenuto e versione, su quali fonti e quando. La semplice affermazione del contenuto non costituisce da sola un atto di accettazione editoriale. Un comando già inequivocabile può costituire tale atto senza una seconda conferma rituale. La capability si esercita nel rispetto delle altre regole della presente decisione, incluse quelle sulla distinzione tra descrizione ed effetti, sulla gestione dei conflitti e sulle correzioni versionate; non consente di aggirarle qualificando come descrittiva una modifica normativa.

**5. Constraint, Commitment e Decision.** Un Constraint prescritto limita le possibilità ammesse; un Commitment esprime un impegno assunto; una Decision registra una scelta che modifica lo stato condiviso. Una decisione può stabilire un vincolo o un impegno senza richiedere duplicazioni dello stesso atto. La loro efficacia e modifica richiedono atti espliciti e l’authority pertinente secondo ADR-0001. Un’inferenza di MIRIAM può proporli, ma non renderli efficaci.

**6. Descrizione ed effetti.** La formulazione descrittiva o l’etichetta “informazione” non possono aggirare le regole degli impegni. L’accettazione o correzione di informazioni non modifica automaticamente decisioni, vincoli, mandati, impegni, Artifacts o autorizzazioni operative. Disponibilità economica e limite di spesa rimangono concetti distinti. Se una frase può indicare sia un dato sia la modifica di un impegno, MIRIAM chiarisce il significato necessario prima di effettuare la transizione interessata.

**7. Fonti esterne e obblighi preesistenti.** Documenti, web search e altri risultati esterni entrano inizialmente come fonti ed Evidence, con riferimenti, data e versione ove applicabile. La loro acquisizione non costituisce accettazione epistemica né autorizzazione operativa. Il rilevamento di un possibile obbligo o vincolo esterno preesistente è distinto dall’atto che lo ha costituito: MIRIAM ne conserva l’evidenza e l’eventuale incertezza senza crearlo, ignorarlo o attribuirgli legittimità per inferenza.

**8. Contraddizioni e dissenso.** Una nuova affermazione, fonte o inferenza incompatibile non sostituisce automaticamente un’informazione accettata. MIRIAM conserva i valori e le rispettive fonti, segnala il conflitto quando rilevante e distingue la versione corrente adottata dal dissenso ancora aperto. Una correzione esplicita produce una nuova versione motivata; non cancella le contestazioni altrui né le dichiara risolte per effetto della sola sostituzione. La maggiore recenza, il numero delle fonti e la confidence AI non determinano automaticamente un vincitore.

**9. Contraddizioni con impegni.** Un’informazione che contraddice una Decision, un Constraint o un Commitment ne può mettere in discussione le premesse o mostrare una possibile violazione, ma non lo modifica o revoca automaticamente. La modifica normativa richiede l’authority pertinente e un atto esplicito. La presenza di dissenso rimane visibile senza diventare automaticamente un veto o un trasferimento di poteri; restano applicabili le regole di ADR-0001 sulle contestazioni della rappresentanza.

**10. Provenance e versioni.** Affermazioni, candidati, accettazioni e modifiche conservano collegamenti alle fonti e alle versioni pertinenti, attribuzione, data, contenuto preciso e motivazione ove necessaria. Le correzioni aggiungono storia e non riscrivono gli eventi precedenti. Le accettazioni si riferiscono a contenuti e versioni identificabili; una proposta superata da modifiche pertinenti non può sovrascrivere silenziosamente lo stato corrente. L’accettazione di un’inferenza conserva sia l’origine MIRIAM sia il successivo atto umano.

**11. Incertezza e comportamento di MIRIAM.** Quando classificazione, riferimento o conseguenze non sono chiari, il contenuto rimane attribuito o candidato. MIRIAM può continuare ricerca, confronto e preparazione usando ipotesi dichiarate, senza presentarle come informazioni accettate o impegni. Chiede il minimo chiarimento quando necessario per adottare il contenuto o procedere al passaggio interessato; non richiede conferme per ogni messaggio né ripete atti già inequivocabili.

**12. Confine deterministico e perimetro MVP.** Il server applica regole esplicite sulle operazioni consentite, sull’identità e versione dei contenuti e sull’authority necessaria alle conseguenze. Una classificazione AI non può conferire permessi o permettere a un aggiornamento informativo di modificare stato normativo. Le proiezioni usate da MIRIAM conservano le distinzioni fra attribuzione, informazione accettata, ipotesi, dissenso e impegno efficace. Non sono richiesti un motore epistemico generale, punteggi di verità o ruoli editoriali generici. ADR-0001 rimane invariato.

## Provenance dell’approvazione

La fonte primaria è la sequenza di messaggi dell’utente in questa conversazione:

1. Richiesta di analizzare esclusivamente la Decisione 2 rispetto a MVP, AGENTS, ADR-0001 e proposta v0.2.
2. Presentazione dell’Opzione 1 (accettazione editoriale esplicita distinta dall’authority sugli impegni) e dell’EXACT DECISION TEXT in 12 punti, ancora proposto.
3. Richiesta di mantenere Opzione 1 e “Accepted Information”, precisando il solo punto 4: capability editoriale di base concessa dal prodotto ai membri abilitati a contribuire, indipendente dai mandati di ADR-0001.
4. Verifica di coerenza e presentazione del punto 4 sostitutivo; gli altri 11 punti restano invariati.
5. Approvazione formale dell’intera Decisione 2 con il punto 4 sostitutivo riportato integralmente dall’utente; autorizzazione al solo aggiornamento documentale.

Passaggi dell’atto di approvazione:

> Approvo formalmente la Decisione 2 — Affermazioni attribuite, informazioni accettate e impegni.

> Approvo l’EXACT DECISION TEXT proposto da 12 punti, sostituendo esclusivamente il punto 4 originale con questa versione:

> Tratta quindi l’intera Decisione 2, con questo punto 4 sostitutivo, come APPROVED DECISION.

Il punto 4 definitivo è conservato nella sezione normativa, senza duplicarlo qui. L’utente ha richiesto di preservare ADR-0001, indicare le formulazioni superseded/refined, evitare duplicazioni documentali e fermarsi senza implementazione o altre decisioni. L’approvazione deriva da questo atto, non dalla precedente raccomandazione dell’assistente o dalle diciture storiche della proposta architetturale.

## Contesto e motivazione

Il prodotto deve evitare che una dichiarazione diventi automaticamente una verità condivisa o un impegno. “Informazione accettata” identifica un riferimento descrittivo adottato esplicitamente, senza garantire verità o consenso collettivo. La capability editoriale di base permette di curare tale riferimento senza costituire mandati per ogni dato; gli effetti normativi restano soggetti all’authority pertinente.

L’alternativa discussa, con mandati anche per accettare informazioni descrittive, non è adottata. Avrebbe aggiunto configurazione e attese alla manutenzione ordinaria del Context senza certificare la correttezza dei dati. Restano essenziali attribuzione dell’accettazione, qualificazioni, dissenso visibile, storia e separazione dagli effetti operativi. Gli esempi di persone e importi della discussione sono illustrativi, non configurazioni obbligatorie.

## Relazione con ADR-0001

ADR-0001 disciplina prima authority, Goal iniziale, rappresentanza e mandati; nessuno dei suoi 12 punti viene riaperto o modificato. La capability editoriale di ADR-0002, punto 4, è concessa dal prodotto e non è un mandato o una decision authority. I punti 5, 9 e 12 mantengono il riferimento ad ADR-0001 per impegni, conseguenze e contestazioni della rappresentanza.

Le precedenti annotazioni «Decisione 2 non affrontata» in ADR-0001, nella sua voce del Decision Log e nella nota architetturale datata 2026-09-08 descrivono il perimetro di quella registrazione storica. Non descrivono lo stato successivo all’approvazione qui registrata.

## Supersessioni e raffinamenti espliciti

| Fonte precedente | Formulazione o assunzione | Effetto approvato |
| --- | --- | --- |
| MVP §3.1 | «Informazioni ad alta confidence e basso rischio possono essere aggiunte automaticamente» | **SUPERSEDED** nella misura in cui permetteva di adottare autonomamente affermazioni sostanziali come informazioni accettate. Restano possibili registrazioni attribuite, Evidence e candidati secondo il punto 3; l’accettazione editoriale segue il punto 4. Selettività, micro-feedback e correzioni non sono aboliti. |
| MVP §§2, 2.3, 6.1, 16 e 20 | “Facts / Information”, «ciò che il gruppo sa», “Shared truth” | **REFINED:** il concetto di prodotto è Accepted Information; “canonico” indica lo stato corrente, non verità garantita o consenso collettivo. Le frasi guida conservate hanno questo significato, senza introdurre un nuovo modello di memoria o cambiare la proiezione Current State. |
| MVP §§3.4–3.5 | «Shared Context è ciò che il gruppo accetta come stato corrente»; consenso epistemico; «ciò che il gruppo considera vero» | **REFINED:** per le informazioni descrittive l’adozione segue la capability editoriale attribuita del punto 4, non una rappresentanza del gruppo. Comprendere una fonte resta distinto dall’accettarne il contenuto e dall’autorizzarne gli effetti; vale anche per possibili obblighi esterni preesistenti. |
| MVP §§3.3, 3.6 e 4 | Correzione «alla fonte», supersessione e decisione come transizione | **REFINED:** una correzione aggiunge versioni della comprensione, non riscrive eventi sorgente, non cancella dissenso e non modifica automaticamente impegni o Artifacts. La distinzione fra descrizione ed effetti e le regole dei punti 5–10 precisano gli invarianti precedenti. |
| MVP §7.3 | Collaboration Policy e “confirmation threshold” | **REFINED:** preset e soglie non possono aggirare le distinzioni e gli atti espliciti richiesti da ADR-0002. La restante Collaboration Policy non viene ridefinita. |
| V0.2 §§6–7 e 21/F02 | “canonical truth”, tipo illustrativo `fact`, accettazione canonica descritta tramite authority e `authority_source` | **REFINED:** distinguere registrazione attribuita, informazione accettata e impegno efficace; la capability editoriale non è decision authority né richiede un mandato. L’accettazione non prova verità o accordo. Nomi tecnici, tabelle e rappresentazione della base di accettazione restano proposte, non vengono selezionati da questo ADR. |
| V0.2 §9 | Baseline “System Authority” per confermare informazioni a basso impatto; quattro gate proposti | **REFINED:** la regola approvata è la capability di prodotto del punto 4 per informazioni descrittive, con un atto esplicito di accettazione. Non basta una dichiarazione o un’etichetta AI; le conseguenze normative richiedono separatamente authority. **SUPERSEDED** ogni lettura che richieda un mandato ADR-0001 per l’accettazione editoriale o la renda efficace tramite confidence. I quattro gate non sono approvati da questo atto. |
| V0.2 §§9–10, 12 e 15 | Conferme, correzioni, proiezioni ed esempio di attribuzione chiamata “Fact” | **REFINED:** applicare i punti 3–12, preservando riferimenti/versioni, natura inferenziale e dissenso. Registrare che qualcuno ha proposto una discussione non prova il contenuto o un impegno; l’esempio storico non stabilisce la semantica delle informazioni accettate. Algoritmi e fixture restano illustrativi. |
| Proposta conversazionale, punto 4 originale | Facoltà del membro descritta senza precisare esplicitamente l’origine della capability | **SOSTITUITO PRIMA DELL’APPROVAZIONE:** il solo testo vincolante è il punto 4 definitivo sopra riportato; gli altri 11 punti non cambiano. |

Il corpo originario della v0.2 e la v0.1 storica sono conservati. Le formulazioni precedenti incompatibili non prevalgono su questo ADR; le altre decisioni mantengono il proprio stato. Il DOCX originario resta fonte storica della specifica iniziale.

## Limiti e verifica documentale

La decisione approva esclusivamente i 12 punti sopra riportati. Non approva schema persistente, enum, quattro gate, stack, algoritmi o dettagli UX della proposta v0.2. Il loro successivo allineamento tecnico non viene progettato in questa registrazione. Non si affrontano altre decisioni o questioni aperte e non è autorizzata implementazione.

Non sono emerse contraddizioni sostanziali con ADR-0001 o fra i 12 punti approvati. Le formulazioni storiche incompatibili sono delimitate nella tabella; le sintesi canoniche rinviano a questo testo completo.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione iniziale su approvazione formale dell’utente: 12 punti, con il solo punto 4 sostitutivo; aggiornamento dei riferimenti canonici e delle supersessioni, ADR-0001 invariato, nessuna implementazione. |

