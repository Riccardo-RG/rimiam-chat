# ALLINAGENT — MVP Product Specification & Decision Log

**Versione 0.1 · 8 settembre 2026**

Fonte originaria: `Allinagent_MVP_Product_Decision_Log_v0.1.docx`. Il DOCX rimane la fonte storica della versione iniziale; questa specifica canonica incorpora gli aggiornamenti approvati indicati di seguito.

**Revisione documentale 1 · 8 settembre 2026:** incorporata esclusivamente la [Decisione 1 — Prima authority, Goal iniziale e setup progressivo (ADR-0001)](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), stato **APPROVED DECISION**, su approvazione formale dell’utente in questa conversazione Codex. Il record conserva il testo esatto approvato, inclusa la correzione del punto 2, provenance, motivazione e supersessioni. Il percorso della specifica resta stabile; le altre decisioni non sono modificate da questa revisione.

**Revisione documentale 2 · 9 settembre 2026:** incorporata la [Decisione 2 — Affermazioni attribuite, informazioni accettate e impegni (ADR-0002)](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md), **APPROVED DECISION**. L’ADR contiene i 12 punti approvati, con il solo punto 4 sostitutivo, provenance, motivazione e supersessioni. ADR-0001 resta invariato; questa revisione non approva altre decisioni o implementazioni.

**Revisione documentale 3 · 9 settembre 2026:** incorporata la [Decisione 3 — Lifecycle del Goal, continuità e relazioni (ADR-0003)](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md), **APPROVED DECISION**. Testo completo e provenance nell’ADR: 12 punti con il solo punto 2 sostitutivo. ADR-0001 e ADR-0002 restano invariati; nessun’altra decisione o implementazione è approvata da questo atto.

Documento consolidato delle decisioni di prodotto prese durante la fase di discovery. Definisce la tesi dell'MVP, il modello del workspace, il comportamento di Miriam, la governance del Context, l'authority, l'Active Work e il modello multi-actor.

> “Trasformiamo informazioni sparse in una comprensione condivisa che aiuta persone e AI a raggiungere un obiettivo comune.”

## Stato del documento

**Allineamento documentale · 13 settembre 2026:** scope approvato fino ad ADR-0015; foundation implementativa locale chiusa. Le registrazioni datate sotto conservano il perimetro dei rispettivi atti, non indicano lavoro ancora da autorizzare o costruire. Stato e prove correnti: [STATUS](../development/STATUS.md); posizionamento e ipotesi commerciali: [GTM / Product Discovery](MVP_GTM_PRODUCT_DISCOVERY.md). Attivazione dei servizi, verifiche live e su dispositivi, Claude Design e rilascio restano fasi successive: foundation chiusa non significa MVP già validato con utenti reali.

- MVP concept: definito.
- MVP scope: definito, inclusi messaggi vocali, dialogo vocale con RIMIAM e chiamate audio umane entro [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md).
- Decisioni di prodotto fondamentali: consolidate nella specifica e negli ADR approvati; il testo completo delle decisioni resta negli ADR.
- Decisione 1: approvata il 2026-09-08; integrata nei §§2.1, 9 e 17, con testo normativo integrale in ADR-0001.
- Decisione 2: approvata il 2026-09-09; semantica del Context e governance informativa allineate, con testo normativo integrale in ADR-0002 e riferimento nel §17.
- Decisione 3: approvata il 2026-09-09; lifecycle del Goal e relazioni allineati, con testo normativo integrale in ADR-0003 e riferimento nel §17.
- Modello di persistenza autorevole (B1): approvato il 2026-09-09 in [ADR-0005](../decisions/ADR-0005-postgresql-stato-canonico-storia-provenance.md); riferimento nel §17.
- B2 — accesso al Workspace: sufficientemente risolta per la pianificazione implementativa dell’MVP il 2026-09-09. Fondazioni ADR-0006–ADR-0009 e policy operativa approvata nel §14.1; sintesi nel §14 e record nel §17. Nessuna implementazione autorizzata da questa registrazione.
- Direzione client approvata: mobile primario iOS/Android nativo e client web Next.js sul backend comune, secondo [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md). Configurazione e verifiche esterne: [guida al deploy](../development/DEPLOY_EXTERNAL_SERVICES.md).
- Naming corrente di prodotto: RIMIAM; MIRIAM resta nei percorsi e package del repository. Allinagent è il nome storico di questa specifica; “Contex” è stato abbandonato. L’intelligenza nativa è Miriam.

## 1. Executive Summary

Allinagent è un workspace collaborativo AI-native, goal-oriented, nel quale più persone lavorano insieme con Miriam, un'intelligenza AI nativa dello spazio. La conversazione rimane la superficie primaria, ma il sistema trasforma continuamente l'attività del gruppo in uno Shared State persistente, verificabile, correggibile e azionabile.

> Goal → Conversation → Understanding → Shared Context → Decisions → Artifacts / Tasks → Actions → nuovo State → progresso verso il Goal

L'MVP non è inteso come il minor numero possibile di funzionalità. È la prima versione end-to-end capace di rappresentare fedelmente la tesi del prodotto. Lo scope può essere ampio, ma l'ordine di costruzione deve essere stretto, verticale e continuamente testabile.

### 1.1 Ipotesi MVP

> “L’MVP deve dimostrare che un gruppo può partire da una normale conversazione e avanzare verso un obiettivo senza dover organizzare manualmente informazioni e contesto né spostarsi continuamente tra applicazioni e servizi diversi. La piattaforma comprende ciò che accade, mantiene aggiornato lo stato condiviso e mette l’AI a disposizione del gruppo per cercare informazioni, utilizzare servizi e compiere azioni direttamente all’interno dell’esperienza.”

I due pilastri sono: continuità del contesto + continuità dell'azione.

### 1.2 Scenario narrativo principale

Due o più persone vogliono avviare un'attività insieme: per esempio un cocktail bar, un e-commerce, una palestra, un ristorante, un brand o una startup. Lo scenario di riferimento per sviluppo e test è: due amici vogliono aprire un cocktail bar a Perugia.

Oggi userebbero chat, motori di ricerca, Drive, note, calendario e ChatGPT. Nell'MVP hanno un unico spazio che comprende cosa stanno costruendo e li aiuta a farlo avanzare.

### 1.3 Principio di sviluppo

> Scope ampio e fedele alla visione. Ordine di costruzione stretto, verticale e continuamente testabile.

Primo vertical slice raccomandato nella discovery iniziale (non backlog corrente): due utenti creano uno spazio, definiscono un Goal, conversano, Miriam comprende incrementalmente, propone candidati per Decision/Constraint/Open Question e aggiorna lo Shared Context attraverso gli atti pertinenti, con provenance. Entrambi vedono l'aggiornamento in tempo reale e uno corregge Miriam in linguaggio naturale producendo uno stato corretto e versionato, entro ADR-0001–0002.

## 2. Modello fondamentale del prodotto

> Il Goal dice dove stiamo andando. La Conversation racconta come ci stiamo arrivando. Il Context rappresenta ciò che il gruppo sa. Gli Artifacts rappresentano ciò che il gruppo sta costruendo.

Miriam ragiona attraverso tutti questi livelli e aiuta il gruppo a ridurre la distanza tra Current State e Goal.

**Criterio trasversale di adattabilità — richiesto dall’utente il 2026-09-09.** Il modello fondamentale deve adattarsi a gruppi umani legittimi, Goal, relazioni e modi di collaborare differenti e non prevedibili, senza ricavare le semantiche del dominio da tipi sociali o organizzativi predefiniti. Gli scenari sono stress test, non categorie di prodotto. Il criterio vale per tutti i primitivi e le future review architetturali, oltre al solo accesso.

Preferire **primitivi universali + composizione adattiva + progressive disclosure**. La combinazione e la rilevanza di Context, decisioni, impegni, attività, Workstream, Artifacts e attori emergono dalla collaborazione; Goal → Workstreams → Tasks → execution non è un workflow obbligatorio. Lo stesso Workspace deve poter evolvere senza sostituire il modello fondamentale. Le modifiche con effetti normativi seguono atti e transizioni esplicitamente autorizzati; presentazione, enfasi, assistenza e organizzazione possono adattarsi entro gli invarianti approvati. Consenso, authority e permessi non cambiano significato per inferenza sulle relazioni sociali; restano preservati attribuzione, provenance, identità/versioni del Goal, commitments, constraints, autorizzazione deterministica e sicurezza.

Le review distinguono rigidità fondamentali, bias di terminologia/UX, dettagli implementativi rinviabili e bisogni futuri ipotetici. Questo criterio non richiede ontologie, entity system o grafi generici, RBAC/permission matrix, policy DSL, workflow/governance engine o modelli per tipo di Workspace. Sono ammesse evoluzione dello schema e migrazioni additive quando necessarie, senza anticipare capability future. ADR-0001–ADR-0006 restano invariati; questo inserimento non approva B2, esiti esplorativi dell’audit o implementazioni.

### 2.1 Goal-based Workspace

Nell’MVP uno spazio collaborativo ha al massimo un Goal principale corrente, esplicito e persistente, senza escludere Goal precedenti, proposte e Sub-goal. Il Goal guida rilevanza, Context Engine e comportamento di Miriam, ma non è un blocco rigido che impedisce di iniziare a conversare.

> Il Goal non è una descrizione del progetto. È la North Star rispetto alla quale Miriam interpreta il Context, misura il progresso e decide dove può essere utile.

Il Goal è vivo e versionato. Miriam può comprendere che sta cambiando, ma non può modificarlo silenziosamente. Il completamento importante del Goal richiede conferma del gruppo.

**REFINED — Lifecycle, Decisione 3 approvata.** La scelta sostanziale fra nuova versione e nuova identità appartiene all’atto esplicito autorizzato sul Goal. Non trasferisce adesioni né modifica impegni collegati senza la loro authority specifica; una semplice parafrasi non richiede tale procedura. Identità, versioni, adesioni e conclusione seguono [ADR-0003, punti 1–3, 7–8 e 12](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md#testo-esatto-approvato).

**Goal iniziale e adesioni — Decisione 1 approvata.** Una persona può stabilire il Goal iniziale del Workspace come espressione esplicita del proprio intento, senza una precedente delega. Il Goal diventa condiviso fra le persone che aderiscono esplicitamente allo stesso Goal identificato e alla sua versione corrente rilevante. L’adesione non richiede identità letterale della formulazione, ma deve riferirsi inequivocabilmente a quel Goal e al contenuto accettato. Le adesioni sono attribuite, versionate e consultabili; non viene attribuito consenso a chi non lo ha espresso.

Miriam può interpretare espressioni naturali come “sì, facciamolo” come possibile adesione quando il riferimento è inequivocabile; l’efficacia rimane riconducibile a un atto esplicito della persona e a una specifica identità/versione del Goal. Partecipazione al Workspace, adesione al Goal e authority decisionale sono indipendenti: aderire non costituisce una delega né un’approvazione generale delle decisioni future. Testo esatto vincolante: [ADR-0001, punti 2 e 3](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md#testo-esatto-approvato).

### 2.2 Conversation

La Conversation è la home e la timeline viva del progetto. Contiene messaggi umani, interventi di Miriam, decisioni, ricerche, creazione o aggiornamento di Artifacts, eventi, Tasks e cambiamenti significativi dello stato. Context e Artifacts sono layer/view dello stesso workspace, non tre tab equivalenti da project manager.

### 2.3 Shared Context

One Space, One Shared Context. Nell'MVP non esiste una memoria personale nascosta per ciascun membro dentro lo spazio condiviso. Un 1:1 con Miriam è un altro spazio con un proprio Context.

Categorie di default:

- Goal
- Decisions
- Accepted Information / Informazioni accettate
- Constraints
- Tasks
- Open Questions
- Notes
- Custom Context / X

Ogni elemento conserva, dove applicabile: provenance/source, autore, timestamp, stato, confidence/evidence e versione.

**Semantica approvata — ADR-0002:** affermazione attribuita, informazione accettata e impegno efficace sono distinti. “Canonico” indica la versione corrente, non verità garantita o consenso collettivo; stime e inferenze mantengono le proprie qualificazioni. Le espressioni «ciò che il gruppo sa» e “Shared truth” vanno lette entro questi limiti. Testo vincolante e raffinamenti: [ADR-0002](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md).

### 2.4 Context Engine incrementale

Il sistema non rilegge continuamente l'intera cronologia. Processa nuovi eventi incrementalmente, aggiorna lo stato strutturato e fornisce agli agenti solo il Context rilevante. L'architettura deve preferire logica deterministica e modelli economici per estrazione/classificazione, riservando modelli più potenti ai casi che lo richiedono.

**Context Efficiency / Minimum Sufficient Context — APPROVED, 2026-09-09.** Per ogni inferenza, operazione AI o Specialist Actor, l’efficienza è subordinata a qualità, continuità del Workspace e invarianti approvati. Se il contesto è insufficiente, ambiguo o materialmente rischioso, MIRIAM deve poter recuperare altro contesto pertinente entro accesso e authority applicabili. I budget operativi sono euristiche subordinate alla sufficienza. Testo completo e provenance: [ADR-0004](../decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md).

> Conversation / interactions → Context Engine → structured Shared State → humans + AI/tools/agents → actions → state updates

### 2.5 Input MVP

- Messaggi di testo
- File e documenti
- Immagini
- Messaggi vocali

**SUPERSEDED per l’audio — 2026-09-13:** [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md) include messaggi vocali, conversazione vocale con RIMIAM e chiamate audio umane con registrazione/trascrizione consensuale e analisi soltanto su richiesta separata. Le videochiamate restano fuori MVP. Fonti grezze, Context e atti governati rimangono distinti.

## 3. Context Governance, Evidence e fiducia

### 3.1 Hybrid Context Ingestion

Non tutto ciò che viene detto entra nel Context. **La precedente promozione automatica basata su alta confidence e basso rischio è superseded nei limiti di ADR-0002, punto 3:** Miriam può registrare attribuzioni verificabili e produrre Evidence e candidati, senza adottarne automaticamente il contenuto. Restano micro-feedback e possibilità di modifica/undo.

L’accettazione di un’informazione descrittiva richiede un atto esplicito attribuito. È una capability di base del prodotto per i membri abilitati a contribuire, non decision authority e non un mandato ADR-0001; non rappresenta altri membri né consenso collettivo. Un comando inequivocabile può già costituire l’atto, senza conferma rituale. Regole complete e gestione dell’incertezza: [ADR-0002, punti 3–4 e 11](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md#testo-esatto-approvato).

### 3.2 Adaptive Context Processing

Quando la conversazione è chiaramente off-goal, il sistema riduce drasticamente l'elaborazione strutturata e mantiene solo un monitoraggio economico sufficiente a riconoscere il ritorno al Goal o l'emergere di un nuovo intento.

> Il Context Engine protegge il contesto, non si limita ad accumularlo.

### 3.3 Consistency Monitoring

Miriam rileva contraddizioni, informazioni obsolete, ambiguità e conflitti tra messaggi, file, decisioni, date, numeri e vincoli. Non sceglie silenziosamente tra valori incompatibili: conserva provenance, segnala il conflitto quando rilevante e permette di supersedere senza cancellare la storia.

La versione corrente adottata resta distinta dal dissenso aperto: sostituire un’informazione non risolve le contestazioni altrui né revoca un impegno. Si applicano i punti 8–10 di ADR-0002.

### 3.4 Evidence Model

> Source → Evidence → Shared Context → Artifacts → Actions

Una Source può essere una pagina esterna, un documento caricato, un'API o un servizio. L'Evidence è un'affermazione derivata dalla fonte con provenance, data, affidabilità e freshness. Per le informazioni descrittive, l’adozione nello stato corrente segue l’accettazione editoriale del §3.1, senza implicare consenso collettivo o certezza del contenuto.

> Evidence ≠ Truth ≠ Artifact Change ≠ External Action

Le fonti esterne richiedono due consensi logicamente distinti quando devono propagarsi: consenso epistemico per entrare nello Shared Context; consenso operativo per modificare Artifacts sulla base del nuovo Context. Un Artifact può essere marcato potentially outdated senza essere modificato.

Il consenso epistemico sulle informazioni descrittive è l’accettazione editoriale prevista da ADR-0002; non conferisce autorizzazioni operative. Per fonti esterne e possibili obblighi preesistenti si applica il punto 7 dell’ADR.

### 3.5 Semantic File Ingestion

> Aver letto un file ≠ accettare ciò che il file dice come verità del progetto.

File → Understanding → Context Candidates / Evidence → Shared State. Miriam legge e comprende automaticamente i file, ma distingue ciò che il documento afferma dalle informazioni accettate come riferimento di lavoro. La quantità di output è proporzionale alla rilevanza, non alla dimensione del file.

L’ingestion rispetta disclosure e consensi applicabili. **Eccezione esplicita per le chiamate umane:** registrazione e trascrizione autorizzate non attivano analisi o normale retrieval del Context; l’analisi post-call richiede una richiesta separata secondo ADR-0015. In seguito si recuperano fonti pertinenti, senza inserire l’intera trascrizione in ogni inferenza (ADR-0004).

### 3.6 Trust & Correction

> Correggere Miriam significa correggere la comprensione dello spazio, non soltanto il suo ultimo messaggio.

Una correzione aggiorna in modo versionato la comprensione dello spazio, preservando eventi sorgente e dissenso; può evidenziare conseguenze senza applicare automaticamente modifiche a impegni, Artifacts o autorizzazioni operative. Gli stati importanti sono understandable, inspectable, correctable e reversible. L’utente può chiedere perché un’informazione è accettata o un impegno è efficace. Regole complete: ADR-0002, punti 6 e 8–10.

## 4. Decisioni, disaccordo e progresso

### 4.1 Decision as State Transition

> Una decisione non è una nota nel Context: è una transizione dello Shared State che chiude alcune possibilità, ne invalida altre e ne apre di nuove.

Una decisione conserva outcome, evidence/rationale, provenance, conseguenze, version history e ciò che ha reso possibile. Miriam distingue cosa cambia certamente, cosa probabilmente viene invalidato e cosa diventa ora possibile.

### 4.2 Disagreement Awareness & Decision Debt

Miriam può rappresentare posizioni divergenti e stato unresolved/contested senza intervenire immediatamente. Distingue conflitto fattuale, trade-off, preferenza e priorità/processo. Cerca di rimuovere ciò che impedisce al gruppo di decidere, non di eliminare il disaccordo.

> Capire subito. Intervenire solo quando utile. Decidere mai al posto del gruppo.

Una decisione aperta che non blocca nulla può rimanere in sospeso. Diventa Decision Debt quando inizia a condizionare lo stato futuro. Miriam non confonde silenzio, stanchezza o assenza di opposizione con consenso.

### 4.3 Opportunity Awareness & Transition Moments

Miriam mantiene consapevolezza di Opportunity, Next useful step, Blocker e Risk rispetto al Goal. Il silenzio è una decisione valida. Nei passaggi salienti può mostrare un Transition Moment con una conseguenza o next step concretamente azionabile, senza richiedere un nuovo prompt.

> La CTA non suggerisce cosa chiedere a Miriam: continua un ragionamento che Miriam e il gruppo hanno già costruito insieme.

## 5. Artifacts e Tasks

### 5.1 Artifacts

> Un Artifact è una rappresentazione viva di una parte dello Shared Context: persistente, condivisa, purpose-oriented e modificabile collaborativamente.

Nell'MVP esiste un concetto flessibile di Artifact, capace di contenere testo strutturato, sezioni, checklist, tabelle semplici, immagini e fonti. Può rappresentare business plan, checklist, confronto, report o piano.

Conversation ↔ Context ↔ Artifacts è bidirezionale. Un cambiamento nel Context può rendere un Artifact outdated; una modifica dell'Artifact può entrare in conflitto con il Context e richiedere di chiarire se si tratta di una nuova decisione.

> L'intelligenza può essere proattiva. La distruzione deve essere conservativa.

Context e Artifacts sono versionati. Operazioni distruttive o ad alto impatto richiedono conferma e recovery/history.

### 5.2 Tasks

**REFINED — [ADR-0013](../decisions/ADR-0013-task-responsabilita-follow-up.md), approvato e registrato il 2026-09-10.** Task, responsabilità accettata e Commitment sono distinti; la precedente formulazione sul riconoscimento/formalizzazione degli impegni non implica che un Task debba derivare da un Commitment. Accettazione personale, modifiche materiali, rinuncia e assenza di effetti normativi automatici seguono l’ADR.

Campi MVP: cosa, assignee, due date opzionale, status, provenance, link opzionale a Goal/Sub-goal. Nessun sistema avanzato di sprint/story point/dependency/Kanban.

### 5.3 Context-aware Follow-up

Miriam segue gli impegni in modo contestuale usando deadline, importanza, Goal, stato del Task, conversazione corrente e Collaboration Policy. Il follow-up non è un reminder meccanico: può chiedere se qualcosa è avvenuto e aggiornare Task/Context/Event sulla base della risposta.

**REFINED — ADR-0013:** follow-up e reminder non conferiscono responsabilità o authority. Gli aggiornamenti conseguenziali restano soggetti agli atti e ai controlli della capability interessata; la risposta o il reminder non li autorizzano automaticamente.

## 6. Awareness e Semantic Collaboration Layer

### 6.1 Current State

Shared Context è lo stato canonico completo. Current State è una proiezione compatta e dinamica di ciò che merita attenzione adesso rispetto al Goal. Non è un nuovo database e non è una dashboard da mantenere.

Può mostrare focus corrente, blocker, decisioni aperte, lavoro attivo, milestone emergenti, Artifacts rilevanti e ultimo cambiamento significativo.

> Shared truth, personalized attention.

Il Current State principale è condiviso; la personalizzazione riguarda l'attenzione: cambiamenti da quando l'utente era presente, domande rivolte a lui, Task personali.

> Past → Catch-up. Present → Current State. Future → Transition Moments.

### 6.2 Re-entry / Catch-up

> Non riassumiamo ciò che l'utente non ha letto. Gli mostriamo ciò che è cambiato nel progetto da quando era allineato l'ultima volta.

Catch-up = State user knew → relevant changes → Current State, con provenance per rispondere a domande come 'perché?', 'cosa è cambiato da lunedì?', 'perché abbiamo scartato A?'.

### 6.3 Semantic Collaboration Layer

> Gli utenti non devono decidere dove appartiene il lavoro. Devono soltanto fare il lavoro. Miriam mantiene la struttura coerente con il significato di ciò che stanno facendo.

La Conversation può rimanere linearmente fluida mentre Miriam mantiene Workstreams semantici emergenti. Un singolo evento può appartenere a più Workstream senza duplicazione o spostamento fisico.

Lifecycle indicativo: Signal → Emerging → Active → Structured → Dormant / Resolved.

Un Workstream rappresenta un filone di lavoro; un Sub-goal rappresenta un risultato intermedio verificabile. Una semantic view può mostrare messaggi, Context, Evidence, Tasks e Artifacts rilevanti per un Workstream senza creare una chat separata.

**REFINED:** identità/versioni del Sub-goal, riferimento al Goal/versione e distinzione dalle attività seguono [ADR-0003, punti 5–6](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md#testo-esatto-approvato). I collegamenti semantici non producono effetti normativi.

> Single event, multiple semantic memberships.

> Soft boundaries, connected knowledge.

> Rich internal structure, calm external surface.

Miriam valuta Cost of Entanglement e Cost of Fragmentation. La struttura visibile emerge solo quando crea coordination value.

> Il gruppo può permettersi di essere disordinato nella conversazione senza diventare disordinato nel lavoro.

### 6.4 Intent-Aware Conversation & Goal Routing

Miriam comprende continuamente cosa il gruppo sta cercando di ottenere e come il nuovo intento si collega al precedente. Distingue continuazione, focus temporaneo, Sub-goal, nuovo Goal collegato, Goal replacement e Goal completion.

La struttura può emergere retroattivamente: Miriam può riconoscere dopo diversi messaggi che è nato un filone autonomo e collegare retroattivamente messaggi e Context pertinenti.

> Intent before structure. Structure only when it creates coordination value. Structure can emerge retroactively. Context follows intent, selectively. Structure is reversible; history is not lost.

I Goal successivi mantengono Goal Lineage. Quando nasce un nuovo Goal, Miriam propone un Context Handoff selettivo: non parte vuoto e non copia indiscriminatamente tutto.

**REFINED:** “Goal derivato” indica un’origine documentata, non una categoria persistente distinta; un risultato subordinato è un Sub-goal. Lineage e Handoff preservano riferimenti e storia senza trasferire automaticamente adesioni, mandati o validità del Context. Regole complete su relazioni, stato preesistente e lavoro in corso: [ADR-0003, punti 4–11](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md#testo-esatto-approvato).

## 7. Miriam: identità, presenza e collaborazione

### 7.1 Identità

> Miriam ha un'identità stabile, ma uno stile collaborativo adattabile.

Default: leggermente umana, naturale e presente, ma inequivocabilmente AI. Non simula emozioni, sonno, presenza umana o altre caratteristiche fittizie.

### 7.2 Presence & Adaptive Attention

Miriam è un membro AI permanente dello spazio, ma la sua presenza è proporzionale al valore che può creare. Essere sempre presente non significa parlare sempre.

Tre livelli di presenza: Observe → signal discreetly → intervene conversationally. Attenzione dinamica: low, normal, high. Gli utenti possono chiedere esplicitamente maggiore attenzione.

> Il valore dell'intervento deve superare il costo dell'interruzione.

### 7.3 Collaboration Policy

Miriam parte da un baseline progettato e può essere educata conversazionalmente dal gruppo. Preset semplici: Discreto, Collaborativo, Proattivo. Le regole persistenti possono riguardare Intervention, Context Authority, confirmation threshold, criticality, initiative e stile.

Default corrente, coerente con il GTM: intervento conversazionale quando Miriam è chiamata esplicitamente; partecipazione proattiva mediante opt-in esplicito. La preferenza non crea authority e non autorizza analisi delle chiamate. Essere presente nel Workspace non significa partecipare live alle chiamate umane (§2.5, ADR-0015).

Preset e soglie rispettano i confini di accettazione e gli atti espliciti richiesti da ADR-0002; non possono aggirarli.

> Comprensione ≠ comportamento ≠ autorità.

> Miriam nasce pronta a collaborare, ma impara come quel gruppo vuole collaborare con lei.

Progressive discoverability: Miriam rende gradualmente evidente che può essere educata, offrendo piccoli suggerimenti contestuali anziché un pannello di configurazione iniziale.

### 7.4 Progressive Permission & Behavioral Learning

> First value, then configuration.

Comportamenti più invasivi o consequenziali - push, reminder fuori app, eventi, servizi esterni, azioni verso terzi, modifiche distruttive - non vengono preconfigurati. Miriam fa emergere la scelta quando diventa rilevante e apprende dalla risposta.

Il setup facoltativo dell’authority approvato nel §9 non costituisce un’abilitazione automatica di questi comportamenti.

## 8. Multi-user Collaborative Intelligence

Miriam è il collaborative intelligence layer del gruppo: mantiene coerenza tra Intent, Shared State, Alignment, Decisions e Actions, contribuendo con judgment proprio senza appropriarsi dell'autorità degli esseri umani.

### 8.1 Alignment & Decision Readiness

Miriam mantiene implicitamente un Alignment State: settled, proposed, contested, unclear, blocked, superseded. Non cerca massimo consenso: cerca il minimo allineamento necessario per permettere progresso coerente.

> Informed Progress over Agreement.

> Safe Parallelism before Forced Convergence.

Prima di decisioni importanti valuta Decision Readiness attraverso Alignment, Evidence, Constraints, Consequences e Reversibility. Maggiore è la conseguenza, maggiore è il dovere di challenge.

> Autonomy proportional to consequences. Challenge proportional to consequences.

> Challenge once, respect informed override.

Miriam può avere una valutazione forte e comunicarla, ma la distingue dallo Shared State. Se il gruppo sceglie consapevolmente diversamente e non viola System Boundaries, Miriam rispetta l'override.

### 8.2 Project Tensions

Il Context rappresenta tensioni, trade-off e blocker del progetto, non giudizi sulle persone. Alcune tensioni strategiche possono persistere nel tempo, come qualità vs costo o crescita vs rischio, e aiutare Miriam a interpretare decisioni successive.

> Record project tensions, never personal judgments.

### 8.3 Shared-space loyalty

Dentro uno spazio condiviso Miriam serve il progetto condiviso e non favorisce arbitrariamente chi parla per ultimo o più forte. Lo spazio è un shared epistemic environment: non crea memorie segrete su opinioni individuali. Le riflessioni private appartengono a uno spazio 1:1 separato.

## 9. Progressive & Scoped Authority

**Aggiornamento approvato il 2026-09-08:** [Decisione 1 / ADR-0001](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md). Il divieto assoluto precedente di configurare authority all’onboarding è superseduto; restano esclusi setup obbligatorio e authority implicita.

> Gli utenti non amministrano un permission system per poter iniziare a collaborare. Miriam può facilitare accordi espliciti attraverso poche domande pertinenti, anche all’inizio, senza imporre una configurazione completa.

Il setup dell’authority è facoltativo e progressivo: può avvenire alla creazione del Workspace, all’ingresso di nuovi membri, quando cambia significativamente la composizione del gruppo e durante il lavoro. L’authority necessaria viene verificata al Commit Point: il momento in cui un’attività passa da esplorazione reversibile a modifica significativa dello Shared State, impegno per altre persone o azione esterna. Saltare il setup non concede authority e non impedisce di conversare, comprendere, analizzare o preparare il lavoro.

> Check authority at the Commit Point. Ask only when authority is unresolved.

Prima del Commit Point Miriam privilegia ricerca, analisi, scenari, draft e preview. Se l’authority è già stabilita procede secondo Action Policy e riutilizza il mandato entro i suoi limiti; se è ambigua chiede il minimo chiarimento; se è assente preserva optionality. Il chiarimento necessario per procedere al commitment è distinto dalla facilitazione facoltativa degli accordi: non occorre ristabilire authority valida per il solo fatto che Miriam offra un setup.

### 9.1 Fonti di authority

- Shared Authority: deriva da consenso/decisione del gruppo.
- Resource Authority: deriva dal controllo legittimo di una risorsa personale o esterna.
- Delegated Authority: il gruppo delega esplicitamente uno scope a una persona/actor.
- System Authority: limiti e capacità non negoziabili della piattaforma.

L'authority è scoped, non assoluta: Actor × Scope × Capability × Consequence. Una delega sul branding non implica automaticamente authority sul budget.

> Observed responsibility ≠ Delegated authority.

> Understanding ≠ responsibility ≠ authority ≠ execution.

Anche concedere o modificare authority richiede authority appropriata; nessuno può autoattribuirsi unilateralmente il diritto di impegnare il gruppo.

### 9.2 Prima authority e mandati verificabili

Ogni persona può esprimere il proprio intento e prestare consenso alla rappresentanza della propria posizione entro un perimetro esplicito. Questa facoltà non deriva da creator, owner, admin o membership e non permette di rappresentare altri o disporre di risorse non autorizzate.

Il primo mandato nasce da atti espliciti delle persone legittimate a conferirlo. Per rappresentare una persona occorre il suo consenso esplicito oppure una authority già valida che copra tale rappresentanza. Ogni mandato identifica persone rappresentate, chi può decidere o deve approvare, ambito, capacità e limiti, con provenance degli atti che lo stabiliscono. Il destinatario accetta il mandato.

Nell’MVP sono supportati mandati individuali circoscritti e approvazioni congiunte nominative, senza ruoli generici o un motore generale di policy. Non è richiesta l’approvazione di tutti i membri per ogni decisione: servono i consensi e i poteri pertinenti al perimetro effettivo. Persone non rappresentate, limiti comuni applicabili, ambiti incerti, regole incompatibili e authority mancante non possono essere superati tramite permessi impliciti.

Miriam può proporre formulazioni e individuare bisogni di chiarimento, ma non rende efficace una authority mediante inferenza. Il server verifica atti espliciti riferiti a contenuti precisi e applica soltanto mandati rappresentabili nelle forme supportate. Ruolo tecnico, membership, comportamento osservato, dichiarazioni unilaterali e silenzio non sostituiscono tali atti. Un atto già inequivocabile non richiede una seconda conferma rituale.

### 9.3 Nuovi membri, modifiche e contestazioni

L’ingresso non implica adesione al Goal, rappresentanza o authority. Gli accordi preesistenti restano validi entro il perimetro originario. I cambiamenti del gruppo possono richiedere chiarimenti sugli accordi interessati, ma non trasferiscono poteri, non estendono deleghe e non riducono automaticamente i consensi richiesti.

Ogni modifica ai mandati richiede authority appropriata ed è attribuita, versionata e collegata alle proprie fonti. Il potere di decidere in un ambito non comprende automaticamente quello di modificare i mandati. Una contestazione della propria rappresentanza sospende i nuovi usi del mandato per proprio conto fino a chiarimento o conferma esplicita, senza cancellare la storia o invalidare automaticamente le decisioni precedenti.

Gli accordi emersi successivamente nella conversazione seguono le stesse regole di quelli raccolti nel setup. Il [testo esatto dei 12 punti approvati in ADR-0001](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md#testo-esatto-approvato) costituisce il riferimento normativo per questa integrazione; la loro approvazione non approva schema, stack o altre scelte delle proposte architetturali.

## 10. Action Policy

> Autonomy proportional to consequences.

- Read / analyze / research: autonomo.
- Prepare / propose: Miriam può creare draft, report, proposed events, checklist e scenari.
- Execute con conseguenze esterne o rilevanti: richiede authority/approvazione esplicita secondo le regole dello spazio.

Il sistema preferisce azioni reversibili quando l'authority è incerta. Comprendere che il gruppo desidera un'azione non equivale ad avere il permesso di eseguirla.

“Autonomo” presuppone accesso e disclosure già validi e le condizioni della capability: non supera il requisito di richiesta separata per l’analisi post-call (ADR-0015).

## 11. Context-Aware Active Work

**APPROVED — 2026-09-10:** [ADR-0014 v2](../decisions/ADR-0014-active-work-specialist-contribution.md) precisa iniziativa autonoma senza sovrapposizioni inutili, controllo operativo condiviso, conflitti e lifecycle. Il controllo non modifica gli oggetti governati né amplia authority; `Completed` non significa adozione o validità corrente. L’approvazione non avvia BUILD.

> Quando Miriam riceve un incarico, non genera semplicemente una risposta: apre un'attività contestuale che vive nello stesso stato del progetto e rimane coerente con la sua evoluzione.

Gli incarichi non istantanei possono diventare Active Work collegati a Goal, Workstream e Shared State. Ogni Active Work mantiene un Work Contract persistente, versionato e consultabile: objective, scope, relevant inputs, assumptions, authority boundaries ed expected output.

Il Work Contract viene inferito dalla conversazione; Miriam chiede solo le informazioni materialmente mancanti.

### 11.1 State awareness

> Active Work is state-aware, not snapshot-bound.

Durante il lavoro Miriam monitora solo cambiamenti semanticamente rilevanti. Può adottare il nuovo stato, rivalutare una parte del lavoro, chiedere chiarimento o invalidare l'attività. Le assunzioni esplicitamente fissate nel Work Contract possono essere anchored e non cambiano silenziosamente.

> Context awareness does not mean silent goal drift.

### 11.2 Parallelism, steering e staleness

Più Active Work possono procedere contemporaneamente per Workstream diversi e condividere aggiornamenti rilevanti attraverso lo Shared State. L'utente può interrompere, restringere o reindirizzare il lavoro conversazionalmente. Risultati resi obsoleti da cambiamenti successivi vengono marcati Potentially Outdated.

Stati UX principali: Working, Needs Input, Ready for Review, Waiting for Approval, Potentially Outdated, Completed, Stopped. Nessuna percentuale artificiale.

> Work proceeds up to the authority boundary.

La Conversation mostra solo Meaningful Work Events: finding importante, input necessario, approval, risultato pronto o invalidazione significativa. Non mostra telemetria tecnica.

## 12. Multi-Actor Workspace & Specialist Agents

**Raffinamento approvato:** [ADR-0014](../decisions/ADR-0014-active-work-specialist-contribution.md) distingue continuità del lavoro, passi esecutivi e Contributions persistenti non adottate. Le approvazioni mostrate come eventi restano della capability governata, con i suoi confini e Commit Points.

> Multi-actor workspace, not multi-bot chat.

Il workspace può contenere Humans, Miriam e Specialist Actors. Gli specialisti possono avere una presenza conversazionale quando utile, ma il loro valore fondamentale è contribuire capabilities al workspace. Miriam non è un semplice main agent: è la manifestazione conversazionale dell'intelligenza collaborativa dello spazio.

### 12.1 Actor model

Concettualmente un Actor possiede Identity, Capabilities, Context Scope, Authority Scope, Accountability/Provenance e Trust Boundary. Humans e AI non sono semanticamente equivalenti: gli agenti possono esercitare authority delegata o di sistema, ma non originano autonomamente legittima authority umana.

### 12.2 Capability Contract & Context Projection

Ogni specialist actor opera tramite un Capability Contract che definisce cosa può leggere, produrre e fare, quali azioni richiedono approval e quali trust boundary si applicano.

> Minimum Necessary Context.

Il significato di “minimum”, la sufficienza e l’ampliamento del contesto seguono il principio trasversale [ADR-0004](../decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md).

Gli agenti non ricevono necessariamente l'intero Shared Context, ma una Context Projection minima e sufficiente che conserva semantica epistemica: attribuzione, informazione accettata, ipotesi, dissenso, impegno efficace, proposta, evidence incerta, valore storico e provenance (ADR-0002, punto 12).

Un agente può richiedere più Context ma non appropriarsene autonomamente; allo stesso modo può richiedere maggiore authority senza acquisirla.

### 12.3 Contributions & governance

> Agent output ≠ Shared Truth.

Gli agenti producono Contributions: Finding, Evidence, Recommendation, Candidate Context, Artifact Draft, Proposed Task, Proposed Action o Question. Le Contributions passano attraverso la governance del workspace prima di diventare Shared State, Artifact change o Action.

### 12.4 Miriam e specialisti

> Specialist knows the domain; Miriam knows the project.

Miriam può criticare o contestualizzare un output specialistico rispetto ai vincoli del progetto. Gli agenti possono collaborare nello state layer, ma il prodotto evita agent-debate theatre nella Conversation.

> Results over Routing.

L'utente può invocare esplicitamente uno specialista, ma normalmente deve poter esprimere solo l'obiettivo e lasciare al sistema la scelta delle capability. Se Miriam delega un incarico che ha preso in carico, mantiene responsabilità per la continuità del risultato.

> Delegation does not transfer responsibility.

> Agents are replaceable; workspace memory is durable.

Context, history e decisioni appartengono al workspace, non agli agenti temporaneamente utilizzati.

## 13. Capability operative incluse nell'MVP

- Native web research.
- Calendario condiviso/basic calendar essenziale.
- Generazione e aggiornamento di documenti/Artifacts basati sullo Shared Context.
- Ingestion di testo, file/documenti, immagini e messaggi vocali.
- Dialogo vocale con RIMIAM nello stesso Context della Conversation e chiamate audio tra partecipanti umani, entro ADR-0015 (§2.5); nessuna RIMIAM live nelle chiamate umane.
- Workspace Email: lettura privata, disclosure, bozze e invio esatto autorizzato secondo ADR-0012.
- Task recognition, assignment e context-aware follow-up.
- Context-aware Active Work.
- Supporto concettuale a specialist actors; l'MVP non richiede un marketplace pubblico.

Non è previsto un full browser nell'MVP. L’elenco sopra comprende il perimetro operativo attuale; le singole capability mantengono i propri confini di accesso, consenso e Commit Point. Implementazione locale e attivazione reale restano distinte, come riportato in STATUS.

**Calendar — raffinamento approvato 2026-09-10:** [ADR-0011](../decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md) distingue vista dello stato temporale canonico, osservazioni esterne riservate e azioni esterne autorizzate. Identità collegate, overlap e divergenza non consentono propagazioni automatiche. Perimetro BUILD e limiti implementati nel [checkpoint Calendar](../development/CALENDAR.md).

**Workspace Email — modello approvato 2026-09-10:** [ADR-0012](../decisions/ADR-0012-workspace-email-privacy-bozze-invio.md) distingue mailbox verificata, osservazioni private, disclosure esplicita, bozze versionate e invio esatto self-authorized con Commit Point e riconciliazione. Disclosure non implica accettazione; esito incerto non consente reinvio cieco. Perimetro e limiti: [Email BUILD](../development/EMAIL.md).

## 14. Privacy, sicurezza e compliance

La natura del prodotto implica conversazioni private, memoria persistente, file, account esterni e tool capaci di agire. L'architettura deve considerare fin dall'inizio data isolation, permissions, audit, consent, responsibility for actions, moderazione/abuso e GDPR. Questi aspetti non possono essere aggiunti soltanto dopo il PMF.

**Accesso al Workspace — fondazione APPROVED:** relazioni esplicite, attribuite e versionate distinguono capability operative e authority per modificarle; protezione e revocabilità appartengono alla relazione. Membership, idoneità dell’account e authority di progetto restano distinte. Lo stesso Workspace può evolvere senza governance derivata da categorie sociali o privilegi permanenti del creator. Testo completo e limiti: [ADR-0006](../decisions/ADR-0006-accesso-workspace-capability-relazioni-authority.md). Le regole operative sono ora definite nel §14.1; nessun ruolo universale, motore generico o implementazione è approvato da questa fondazione.

**Bootstrap — APPROVED, 2026-09-09:** [ADR-0007](../decisions/ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md) stabilisce una relazione iniziale ordinaria, senza override del creator. Uscita volontaria e rinuncia alla propria governance non richiedono un successore. Il Workspace può restare attivo senza governance esercitabile; si bloccano soltanto le operazioni prive dell’authority necessaria. Nessuna promozione automatica; successione pendente distinta da quella efficace. Chiusura, archiviazione e cancellazione richiedono authority separata e policy ancora irrisolta.

**Governance protetta — APPROVED, 2026-09-09:** [ADR-0008](../decisions/ADR-0008-governance-accesso-protetta-condizioni-congiunte-rinuncia.md) applica le condizioni correnti anche ai bypass tramite membership o capability. Le partecipazioni protette sono individuali: rinunciare alla propria non riscrive le condizioni altrui. Un percorso congiunto può diventare non esercitabile senza ridursi ai rimasti o conservare authority all’ex titolare. La delega operativa revocabile non conferisce protezione tra pari; i dettagli B2 restanti non sono approvati da questo atto.

**Visibilità storica — APPROVED, 2026-09-09:** [ADR-0009](../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md) rende esplicito che membership umana attiva e riammissione comprendono la storia condivisa conservata, senza cutoff individuali. L’attore autorizzante è informato e il destinatario accetta; restano distinte authority, adesioni, impegni e autorizzazioni esterne. La policy seguente completa B2 senza introdurre ACL storici.

### 14.1 Policy operativa B2 approvata

**Stato e data:** APPROVED MVP PRODUCT POLICY · 2026-09-09 (Europe/Rome). B2 è sufficientemente risolta per la pianificazione implementativa dell’MVP.

**Provenance:** approvazione esplicita dell’utente nell’allegato `6ee1429d-0b56-4379-af8a-64fc0e4e26e6/pasted-text.txt`, conversazione Codex `01a082d6-6a10-7d30-8e76-71c7928fcb96`: sezione B della risposta precedente, punti 1–8, esattamente come proposti. Registrazione versione 1 a cura di Codex. La sezione A approvata nello stesso atto è conservata in [ADR-0009](../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md).

**Motivazione:** completare il minimo operativo di accesso per il primo MVP, applicando ADR-0006–ADR-0009 senza nuove astrazioni di governance. Il testo completo della policy è conservato soltanto qui, nella lingua originale:

1. **Participation.** Ordinary membership permits normal Workspace participation and the editorial capability established by ADR-0002. It confers no access-governance or project authority.
2. **Supported access operations.** MVP stewardship relationships explicitly grant individual ordinary-invitation management, removal of unprotected ordinary members, and offering/restricting/revoking invitation-only delegations within applicable conditions. These powers derive from valid relationships, not labels or creator provenance. Protected-governance changes remain governed by ADR-0008.
3. **Admission.** Invitations are intended-recipient-specific, explicitly accepted, expiring, revocable and single-use. Admission presents the approved full-history consequence and becomes effective only through a valid authenticated acceptance.
4. **Removal and departure.** Removal requires current removal authority and compliance with every affected relationship’s conditions; membership removal cannot bypass protection. Voluntary leave and personal relinquishment follow ADR-0007–0008. Subsequent access ends while history, provenance and applicable obligations remain.
5. **Re-entry.** A former member requires a new valid admission. Full-history visibility follows the foundational decision; ended governance relationships do not revive.
6. **Pending acts.** Invitations and relationship acts are revalidated against current authority, eligibility and validity when they become effective. An invitation cannot take effect using invitation authority that has ended or been revoked. Temporary ineligibility prevents effectiveness while it applies. Completed valid admissions and grants are not automatically undone merely because their original authorizer later leaves.
7. **Bounded delegation.** Delegation is invitation-handling only, explicitly accepted, with restriction/revocation reserved to current stewards individually authorized by the governing arrangement under the accepted terms. It grants no protected participation, governance-modification power or onward delegation.
8. **Limits and deferrals.** No automatic succession or exceptional governance recovery is provided. Workspace closure/archive/delete remains deferred. Technical durations, token mechanisms, locking, indexes, endpoints and equivalent implementation details may be selected during coding within these rules and the approved ADRs.

Questa approvazione chiude B2 per la pianificazione implementativa, non approva l’intera proposta architetturale né autorizza implementazione. ADR-0001–ADR-0008 restano invariati; le precedenti esclusioni nelle voci storiche del Decision Log conservano il perimetro dei rispettivi atti.

## 15. Esplicitamente fuori dall'MVP

- Videochiamate native e partecipazione live di RIMIAM alle chiamate umane. La precedente esclusione anche dell’audio è superseded nel solo perimetro approvato in [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md).
- Marketplace pubblico completo di agenti/plugin/capability.
- SDK/protocollo ecosystem definitivo per agenti terzi.
- Governance enterprise avanzata e RBAC sofisticato.
- Personal/cross-space memory dentro gli spazi condivisi.
- Full browser come esperienza primaria.
- Sistemi avanzati di project management: sprint, story points, dependency graph/Kanban complesso.
- Tipi Artifact specializzati completi come spreadsheet/presentation/diagram/code engine separati.

## 16. Principi UX consolidati

- Conversation first: la chat rimane la home.
- Goal-oriented, non dashboard-oriented.
- La struttura emerge dal significato del lavoro, non da contenitori amministrati manualmente.
- Rich internal structure, calm external surface.
- Progressive disclosure: mostrare complessità solo quando porta valore.
- Provenance e 'Perché?' devono rendere le inferenze importanti ispezionabili.
- Le correzioni devono essere naturali, versionate e reversibili.
- Miriam può essere proattiva; la distruzione è conservativa.
- First value, then configuration.
- Results over Routing: capability-first, non agent-first.
- Shared truth, personalized attention.

## 17. Decision Log consolidato

Le sezioni precedenti costituiscono la specifica consolidata. Questa sezione elenca le decisioni principali in forma compatta per tracciabilità.

### MVP Hypothesis

**Contesto:** Dimostrare continuità di contesto e azione da una normale conversazione di gruppo.

**Alternative considerate:** Chat/AI assistant tradizionale; MVP minimale per feature.

**Decisione presa:** Prima versione end-to-end fedele alla tesi del prodotto.

**Motivazione:** La differenziazione dipende dallo Shared State e dalla capacità di agire, non dalla sola presenza AI.

**Rischi / assunzioni:** Scope ampio può aumentare tempi/costi.

**Da rivalutare quando:** Dopo uso reale dei primi gruppi.

### Goal-based Chat

**Contesto:** Serve un riferimento persistente per rilevanza e progresso.

**Alternative considerate:** Chat generica senza obiettivo; project form rigido.

**Decisione presa:** Ogni spazio ha un Goal esplicito ma non bloccante.

**Motivazione:** Orienta Context Engine e Miriam senza imporre project management.

**Rischi / assunzioni:** Goal troppo rigido può limitare conversazione.

**Da rivalutare quando:** Quando emergono casi d'uso non goal-oriented.

### One Space, One Shared Context

**Contesto:** Evitare memorie nascoste e modelli mentali complessi nell'MVP.

**Alternative considerate:** Personal Context; shared + private memory nello stesso spazio.

**Decisione presa:** Un solo Shared Context per spazio; 1:1 separato.

**Motivazione:** Semplifica fiducia e governance.

**Rischi / assunzioni:** Può limitare personalizzazione.

**Da rivalutare quando:** Quando utenti chiedono memoria privata/cross-space.

### Semantic Collaboration Layer

**Contesto:** Una conversazione reale intreccia più filoni e un evento può appartenere a più temi.

**Alternative considerate:** Thread manuali; auto-thread; sub-goal come struttura primaria.

**Decisione presa:** Workstreams semantici emergenti e semantic views; soft boundaries.

**Motivazione:** Riduce lavoro organizzativo umano e preserva conoscenza connessa.

**Rischi / assunzioni:** Classificazione eccessiva o UI instabile.

**Da rivalutare quando:** Con workspace lunghi e multi-stream reali.

### Multi-user Collaborative Intelligence

**Contesto:** Miriam deve coordinare gruppi senza diventare leader o arbitro.

**Alternative considerate:** Bot reattivo; leader AI; facilitatore solo su conflitto.

**Decisione presa:** Miriam mantiene Intent/Alignment/Readiness/Authority e usa judgment senza appropriarsi dell'autorità.

**Motivazione:** Permette progresso informato e challenge proporzionale alle conseguenze.

**Rischi / assunzioni:** Rischio di eccessiva assertività o eccessiva passività.

**Da rivalutare quando:** Dopo test su decisioni reali ad alta conseguenza.

### Progressive & Scoped Authority

**Contesto:** Permessi preventivi creano burocrazia; azioni consequenziali richiedono confini.

**Alternative considerate:** RBAC all'onboarding; authority implicita all'ultimo speaker.

**Decisione presa, raffinata dalla Decisione 1 il 2026-09-08:** Authority scoped, verificata al Commit Point e riutilizzata entro i mandati validi. Miriam può facilitare anche un setup facoltativo iniziale o contestuale ai cambiamenti del gruppo, senza governance obbligatoria o authority implicita.

**Provenance del raffinamento:** approvazione formale dell’utente; [ADR-0001](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md) conserva il testo approvato e la formulazione precedente superseduta.

**Motivazione:** First value, then configuration; preserva optionality.

**Rischi / assunzioni:** Ambiguità nei casi di delega/consenso.

**Da rivalutare quando:** Quando servono ruoli enterprise formali.

### Context-Aware Active Work

**Contesto:** Lavori AI lunghi possono diventare obsoleti mentre lo stato cambia.

**Alternative considerate:** Risposta singola; job queue tecnica.

**Decisione presa:** Active Work state-aware con Work Contract, steering e authority boundary; semantiche raffinate da [ADR-0014 v2 approvato](../decisions/ADR-0014-active-work-specialist-contribution.md).

**Motivazione:** Il lavoro AI vive nello stesso stato del progetto.

**Rischi / assunzioni:** Moving target e costi di rivalutazione.

**Da rivalutare quando:** Dopo task lunghi/paralleli con utenti reali.

### Multi-Actor Workspace

**Contesto:** Altri agenti devono poter contribuire senza trasformare la chat in bot theatre.

**Alternative considerate:** Multi-bot chat; Miriam come unico agente onnipotente.

**Decisione presa:** Specialist Actors con Capability Contract e Context Projection; Miriam mantiene coherence. Continuità e Contributions seguono [ADR-0014](../decisions/ADR-0014-active-work-specialist-contribution.md).

**Motivazione:** Capability-first, sostituibilità degli agenti e memoria durevole del workspace.

**Rischi / assunzioni:** Permission/trust complexity futura.

**Da rivalutare quando:** Quando si aprirà a veri agenti terzi.

### Decisione 1 — Prima authority, Goal iniziale e setup progressivo

**Stato:** APPROVED DECISION.

**Data:** 2026-09-08 (Europe/Rome).

**Fonte dell’approvazione:** atto formale esplicito dell’utente in questa conversazione Codex, riferito all’intero REVISED EXACT DECISION TEXT con il solo punto 2 corretto prima dell’approvazione.

**Record e testo normativo:** [ADR-0001 — Prima authority, Goal iniziale e setup progressivo](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), 12 punti integrali con provenance, motivazione e supersessioni.

**Decisione presa:** Goal iniziale come intento personale senza delega precedente; condivisione mediante adesioni esplicite a identità/versione e contenuto del Goal; partecipazione, adesione e authority indipendenti; setup facoltativo e progressivo; mandati verificabili, individuali circoscritti o con approvazioni congiunte nominative; modifiche e contestazioni governate e versionate.

**Motivazione:** rendere esplicita l’origine della prima authority e facilitare gli accordi senza onboarding burocratico, poteri da membership o consenso inferito; mantenere le adesioni verificabili senza vincolarle alla formulazione letterale del Goal.

**Supersessioni:** sostituito il divieto assoluto di setup all’onboarding del §9; raffinati Goal iniziale e prima authority; superati soltanto i passaggi incompatibili delle proposte precedenti, identificati nell’ADR. La formula provvisoria «stessa formulazione» non è stata approvata. Le altre decisioni restano invariate; stack e architettura non sono approvati da questo atto.

**Limiti:** rappresentazione tecnica e dettagli UX restano da definire entro la decisione approvata; nessuna implementazione avviata e Decisione 2 non affrontata.

### Decisione 2 — Affermazioni attribuite, informazioni accettate e impegni

**Stato e data:** APPROVED DECISION · 2026-09-09 (Europe/Rome).

**Record normativo e provenance:** [ADR-0002](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md), 12 punti approvati formalmente dall’utente con il solo punto 4 sostitutivo sulla capability editoriale di base del prodotto.

**Sintesi:** attribuzione, Accepted Information e impegno efficace distinti; accettazione descrittiva esplicita e attribuita, senza mandato o decision authority; effetti normativi secondo ADR-0001, che rimane invariato. Motivazione e formulazioni superseded/refined sono registrate nell’ADR; nessuna implementazione o altra decisione è approvata da questo atto.

### Decisione 3 — Lifecycle del Goal, continuità e relazioni

**Stato e data:** APPROVED DECISION · 2026-09-09 (Europe/Rome).

**Record normativo e provenance:** [ADR-0003](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md), 12 punti approvati formalmente dall’utente con il solo punto 2 sostitutivo sull’authority della classificazione e sugli effetti collegati.

**Sintesi:** identità stabile dell’iniziativa con versioni; nuove identità per risultati autonomi o sostituzioni; lineage, Sub-goal e Workstream distinti. Un solo Goal principale corrente, preservando storia, adesioni e obblighi nei rispettivi perimetri. Supersessioni/refinement nell’ADR; ADR-0001 e ADR-0002 invariati, nessuna implementazione avviata.

### B1 — Modello di persistenza autorevole

**APPROVED DECISION · 2026-09-09 (Europe/Rome).** PostgreSQL conserva lo stato canonico corrente direttamente interrogabile e la storia con provenance; i comandi applicativi validati rispettano l’atomicità di dominio. Full event sourcing escluso come fondazione dell’MVP. Testo approvato, provenance, conseguenze e limiti: [ADR-0005](../decisions/ADR-0005-postgresql-stato-canonico-storia-provenance.md). Schema e layout illustrativi non sono ratificati; ADR-0001–0004 invariati, nessun bootstrap o implementazione autorizzati.

### Fondazione delle relazioni di accesso al Workspace

**APPROVED DECISION · 2026-09-09 (Europe/Rome).** Testo esatto, provenance e perimetro: [ADR-0006](../decisions/ADR-0006-accesso-workspace-capability-relazioni-authority.md); sintesi canonica nel §14. B2 resta da risolvere, ADR-0001–ADR-0005 invariati, nessuna implementazione autorizzata.

### B2 — Fondazione del bootstrap dell’accesso

**APPROVED DECISION · 2026-09-09 (Europe/Rome).** Testo verbatim, provenance, motivazione e limiti: [ADR-0007](../decisions/ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md); sintesi canonica nel §14. Risolto soltanto il bootstrap e i confini dell’uscita/rinuncia: restante B2 non approvata, policy di chiusura/archiviazione/cancellazione separata e irrisolta, ADR-0001–ADR-0006 invariati, nessuna implementazione autorizzata.

### B2 — Governance dell’accesso protetta

**APPROVED DECISION · 2026-09-09 (Europe/Rome).** Testo verbatim, provenance e limiti: [ADR-0008](../decisions/ADR-0008-governance-accesso-protetta-condizioni-congiunte-rinuncia.md); sintesi canonica nel §14. Risolti protezione, condizioni congiunte, rinuncia personale e distinzione dalla delega operativa; ADR-0001–ADR-0007 invariati. La restante B2 richiede una closure review, non approvata da questa registrazione; nessuna implementazione autorizzata.

### B2 — Visibilità storica e chiusura della policy operativa

**APPROVED · 2026-09-09 (Europe/Rome).** Fondazione della visibilità storica in [ADR-0009](../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md); policy operativa integrale, punti 1–8, nel [§14.1](#141-policy-operativa-b2-approvata). Fonte: approvazione esplicita dell’utente delle sezioni A e B della proposta, allegato `6ee1429d-0b56-4379-af8a-64fc0e4e26e6/pasted-text.txt`.

**B2 è sufficientemente risolta per la pianificazione implementativa dell’MVP.** Le esclusioni nelle voci precedenti descrivono le registrazioni storiche, non lo stato attuale. ADR-0001–ADR-0008 invariati; nessuna implementazione o approvazione integrale della v0.2 deriva da questo atto.

### Client nativi e backend comune

**APPROVED · 2026-09-10.** Swift/SwiftUI per iOS, Kotlin/Compose per Android, Next.js per il web; TypeScript/Node e PostgreSQL mantengono il dominio autorevole sul server. Contratto e comportamento comuni, senza KMP per ora. Provenance, motivazione e limiti: [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md).

### Calendar — stato temporale, osservazioni e azioni

**APPROVED · 2026-09-10.** Modello richiesto dal brief Calendar BUILD, registrato in [ADR-0011](../decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md); sintesi nel §13. Non approva un provider né autorizza WIRE o Workspace Email.

### Voce e chiamate — consenso e fonti

**APPROVED, 2026-09-13:** [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md) registra l’estensione audio di §§2.5/15 e la regola completa del consenso personale a registrazione, trascrizione e storia condivisa. Analisi post-call separatamente richiesta; nessuna adozione o authority implicita.

## 18. Ordine di costruzione raccomandato

L’elenco seguente conserva l’ordine raccomandato nella discovery iniziale, non il backlog attuale. Lo scope si è esteso attraverso le approvazioni successive, inclusa ADR-0015. Il [checkpoint corrente](../development/STATUS.md) registra la foundation locale chiusa e la sequenza successiva: attivazione provider → verifica reale cross-client e comportamentale → Claude Design. Il principio di implementazione per vertical slice utilizzabili resta valido.

1. Workspace multi-user + Goal + Conversation realtime.
2. Context Engine incrementale + Shared Context strutturato + provenance/versioning + Correction Loop.
3. Miriam baseline + Context updates + Adaptive Attention/Collaboration Policy essenziale.
4. Current State + Catch-up + Decision State Transitions + disagreement/Decision Debt.
5. Semantic Collaboration Layer + Workstreams/semantic views.
6. Artifacts + Tasks + Context-aware Follow-up.
7. Web research + Evidence Governance + freshness.
8. Basic calendar + Action Policy + Commit Points + Progressive Authority.
9. Context-Aware Active Work e parallel work.
10. Specialist Actors / multi-actor support controllato.
11. Polish end-to-end, security/privacy hardening, cost/latency tuning e test con piccoli gruppi reali.

## 19. Criterio di successo dell'MVP

L'MVP è riuscito se un piccolo gruppo può usare il prodotto per far avanzare un progetto reale e percepire che la conversazione non è più soltanto comunicazione: diventa il punto in cui il progetto comprende, ricorda, costruisce e agisce.

> Il gruppo parla e lavora normalmente. Il sistema mantiene il significato, lo stato e la continuità.

Il test più importante non è quante feature Miriam possiede, ma se il gruppo deve ancora ricostruire manualmente cosa è stato deciso, dove sono le informazioni, cosa è cambiato, cosa blocca il Goal e quale strumento usare per compiere il passo successivo.

### 19.1 Direzione futura: valutazioni comportamentali

**Non normativa · 2026-09-10.** Registrata su richiesta dell’utente nella chiusura del BUILD Active Work. Esplicita come valutare in futuro la qualità collaborativa già descritta nei §§7 e 11; non amplia lo scope MVP, non approva un’architettura e non autorizza BUILD o WIRE.

Valutazioni comportamentali riproducibili potrebbero affiancare le verifiche strutturali per misurare utilità e tempestività degli interventi, giudizio contestuale, autonomia proporzionata, qualità delle domande, iniziativa Active Work, utilità dei risultati e capacità di non intervenire quando opportuno. Scenari e condizioni ripetibili non implicano risposte del modello identiche. Lo scopo è valutare quanto Miriam collabori bene, oltre alla validità del suo comportamento.

L’enforcement deterministico di authority, sicurezza, isolamento, provenance, versioning e Commit Points resta autorevole e non può essere sostituito da valutazioni probabilistiche. **Controlli deterministici + valutazione model-based calibrata + revisione umana** sono una strategia candidata, non una scelta approvata. Il feedback reale degli utenti potrebbe diventare uno scenario di regressione comportamentale, verificando una modifica proposta sia sul caso segnalato sia rispetto a regressioni negli altri scenari.

Questa direzione non implica supervisione runtime di ogni risposta da parte di un secondo modello, né autorizza auto-modifica o deployment automatico. Un eventuale ciclo `feedback → evaluation → diagnosis → candidate change → regression → approval` conserva authority, provenance, governance, confini di accesso/privacy e Commit Points applicabili.

## 20. Frasi guida del prodotto

> “Trasformiamo informazioni sparse in una comprensione condivisa che aiuta persone e AI a raggiungere un obiettivo comune.”

> “Il Goal dice dove stiamo andando. La Conversation racconta come ci stiamo arrivando. Il Context rappresenta ciò che il gruppo sa. Gli Artifacts rappresentano ciò che il gruppo sta costruendo.”

> “Il gruppo può permettersi di essere disordinato nella conversazione senza diventare disordinato nel lavoro.”

> “Gli utenti non devono decidere dove appartiene il lavoro. Devono soltanto fare il lavoro.”

> “Miriam può avere un'opinione senza avere autorità.”

> “Miriam non aspetta semplicemente di rispondere: lavora dentro lo stesso stato vivo in cui lavora il gruppo.”

> “Agents are replaceable; workspace memory is durable.”


### Workspace Email — privacy, bozze e invio autorizzato

**APPROVED · 2026-09-10.** Modello richiesto dal brief `937d13d3-a684-4e7f-88c2-5cba858f859a/pasted-text.txt`, registrato in [ADR-0012](../decisions/ADR-0012-workspace-email-privacy-bozze-invio.md); sintesi nel §13. Nessun provider o WIRE approvato/attivato.
