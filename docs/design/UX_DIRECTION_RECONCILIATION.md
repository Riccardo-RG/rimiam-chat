# RIMIAM — UX direction reconciliation

**2026-09-13 · revisione 2 · base codice `127232d` · decisioni UX riconciliate, nessuna autorizzazione BUILD.**

Provenance: direzione iniziale dell’utente `bc7bc45e-30ad-4942-b087-d2c55eccf139/pasted-text.txt`; chiarimenti **definitivi dell’utente** `63499109-479b-4a40-a621-4032a35764da/pasted-text.txt`. Questa revisione incorpora i cinque punti chiusi: sub-context interno come raffinamento di Workstream; label di accesso senza nuovi poteri; descrizione introduttiva distinta dal Goal; Activity osservabile/verificabile; esclusione della CTA “Non rilevante”. Sostituisce le precedenti alternative aperte di questo documento, senza modificare ADR, specifica, codice o [audit osservativo](CURRENT_UX_AUDIT.md).

**Esito:** il modello è sufficientemente solido per preparare il brief Claude Design. Home → Conversation + Activity + Lens è compatibile; il sub-context può estendere Workstream senza un nuovo confine di Workspace. Restano gap di UI, applicazione/API e lifecycle persistente, non una necessità di ridecidere privacy o authority. Le label non autorizzano un nuovo pacchetto Guest. Readiness del brief non significa funzionalità già implementate.

Metodo: riuso dell’audit e verifica mirata di comandi/contratti Workstream, accesso, creazione, interpretazione e ADR pertinenti. **DECIDED** = decisione dell’utente; **OBSERVED** = repository/canone verificato; **IMPLEMENTATION GUIDANCE** = conseguenza tecnica o raccomandazione entro quei vincoli, non nuova semantica approvata. Nessun browser, test applicativo, provider o dispositivo utilizzato; limiti live invariati in [STATUS](../development/STATUS.md).

## 1. Direzioni consolidate e compatibilità

Classificazioni aggiornate: **ALREADY SUPPORTED**, **UI CHANGE**, **APPLICATION/API CHANGE**, **DOMAIN EXTENSION**. Le ultime due precisano la precedente categoria DOMAIN/API CHANGE: distinguono un percorso applicativo mancante da nuova semantica persistente. Le ambiguità risolte non rimangono blocker; eventuali interpretazioni incompatibili sono vincoli esclusi, non alternative del brief.

| #   | Direzione definitiva                                                                              | Compatibilità e gap residuo                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Home semplice per entrare/creare/invitare; niente chat AI globale                                 | **ALREADY SUPPORTED.** Inviti sempre riferiti a uno Workspace preciso; portare l’ingresso alla Home è **UI CHANGE**.                                                                                                                                                  |
| 2   | Nome, descrizione introduttiva libera, inviti opzionali; ingresso immediato                       | **APPLICATION/API CHANGE + UI CHANGE.** La creazione oggi riceve solo il nome. Descrizione attribuita, inviti e continuità del percorso vanno collegati; nessuna trasformazione automatica in Goal.                                                                   |
| 3   | Welcome breve di RIMIAM, poi spazio alle persone                                                  | **APPLICATION/API CHANGE.** Coerente con GTM, ma non prodotto da `createWorkspace`. Serve presenza durevole senza duplicazione da retry/reload, rispettando ciò che è già stato raccontato e la disponibilità reale dei servizi.                                      |
| 4   | Modifiche importanti richiedibili naturalmente in Conversation                                    | **APPLICATION/API CHANGE.** I comandi governati esistono; manca il collegamento completo richiesta → oggetto/versione → atto autorizzato → esito. Nessuna nuova authority.                                                                                            |
| 5   | Presenza autonoma discreta, interventi selettivi                                                  | **ALREADY SUPPORTED nei vincoli canonici**, esposizione **UI CHANGE**. Default su chiamata e opt-in proattivo restano validi. Activity osservabile non crea nuove eccezioni al preset; consegna di un lavoro richiesto e nuovo intervento spontaneo restano distinti. |
| 6   | Activity discreta e sempre accessibile, circa due pillole, storyboard, dettaglio, Chiedi a RIMIAM | **APPLICATION/API CHANGE + UI CHANGE.** Proiezione solo di eventi verificabili, ipotesi qualificate e oggetti/versioni reali. Non pensieri interni, telemetria grezza o seconda verità. Circa due è esposizione, non limite alla storia o al lavoro.                  |
| 7   | Una Lens: Goal / Context / Work / Outputs                                                         | **UI CHANGE.** Raggruppamenti, non quattro nuovi domini o una dashboard. Conservare percorsi verso domande, storia, fonti e operazioni pendenti.                                                                                                                      |
| 8   | Goal leggibile, non dominante; modifica conversazionale                                           | **UI CHANGE** per collocazione; gap #4 per il percorso naturale. Identità/versioni, adesioni e Sub-goal esistono e mantengono le regole approvate.                                                                                                                    |
| 9   | Context con accettazione e qualificazioni distinguibili                                           | **UI CHANGE**, gap #4 per correzioni naturali. Accettato non significa certo; nessuna CTA “Non rilevante” nel primo brief né nuova semantica di dismiss/soppressione.                                                                                                 |
| 10  | Work di persone e RIMIAM con responsabilità e stati comprensibili                                 | **UI CHANGE.** Accostare Task e Active Work senza fondere lifecycle, responsabilità o ownership. Nessuna board obbligatoria.                                                                                                                                          |
| 11  | Outputs come risultati persistenti                                                                | **UI CHANGE.** Contributions, bozze e Artifact adottati restano distinguibili. Un report può diventare Artifact; non ogni risposta/contributo lo è già. Upload PDF resta Source.                                                                                      |
| 12  | Sources contestuali, non macro-area primaria                                                      | **UI CHANGE.** Ispezionare anche fonti appena caricate, inutilizzate, fallite o non analizzate: non dipendere da un Artifact già derivato.                                                                                                                            |
| 13  | Calendar/Email con superfici proprie e legami al modello centrale                                 | **ALREADY SUPPORTED** nei confini, **UI CHANGE** per accesso/composizione. Osservazioni private non alimentano automaticamente Conversation, Activity o Context condivisi.                                                                                            |
| 14  | People secondario; Owner/Member/Guest come label dello stato reale                                | **UI CHANGE.** Nessun nuovo ruolo/potere nel backend. Proiezione fedele delle relazioni; niente etichetta forzata o “cambia ruolo” che inventi una transizione. Un nuovo pacchetto Guest non è approvato.                                                             |
| 15  | Sub-context = filone interno; Active → Resolved → Archived; riapribile                            | **DOMAIN EXTENSION limitata a Workstream + APPLICATION/API CHANGE + UI CHANGE.** Stessi membri/visibilità/accesso/authority del Workspace; lifecycle e ritorno per riferimenti/sintesi, senza adozione automatica. Non un nuovo Workspace.                            |
| 16  | Web: unico ingresso Lens, affiancabile alla Conversation                                          | **UI CHANGE.** `WorkspaceLayer` è riutilizzabile; sostituire cinque ingressi/categorie senza perdere Home e percorsi operativi. Activity distinta dalla Lens.                                                                                                         |
| 17  | Mobile: Lens adattiva, ritorno rapido e memoria nella sessione                                    | **UI CHANGE.** Stato locale account/Workspace per percorso e posizione; rivalidare dati/permessi. Nessuna persistenza canonica della navigazione o replica del desktop.                                                                                               |
| —   | CTA per atti leggeri; Conversation preferita per modifiche semantiche                             | **ALREADY SUPPORTED come euristica.** Effetti e authority governano ogni atto, non il tipo di controllo; conferme pertinenti e recovery restano accessibili.                                                                                                          |

## 2. Gap materiali e confini da preservare

### 2.1 Descrizione introduttiva → Conversation → eventuale Goal

**DECIDED:** si raccolgono nome, breve descrizione libera e inviti opzionali. “Stiamo organizzando un viaggio in Giappone” è contesto introduttivo della persona, non Goal canonico, adesione degli invitati o informazione automaticamente accettata.

**OBSERVED:** [createWorkspace](../../src/server/commands.ts) e [contratto v1](../../src/contracts/v1.ts) ricevono nome/command ID e stabiliscono membership + relazione ordinaria di bootstrap. `goal.establish`, `goal.adhere` e `invitation.create` sono atti distinti. La creazione non genera welcome o descrizione.

Percorso da rendere possibile:

1. Conservare descrizione e autore come materiale introduttivo attribuito, utilizzabile nella stessa Conversation; entrare nello spazio senza un wizard Goal/authority.
2. RIMIAM accoglie brevemente e usa ciò che è già stato scritto, senza richiedere di ripeterlo o simulare risultati. Un messaggio introduttivo deterministico è possibile; non è obbligatoria una chiamata al modello.
3. Il Goal può essere riconosciuto/proposto nella Conversation e stabilito mediante l’atto esplicito pertinente di [ADR-0001](../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md). Nessuna conversione silenziosa description → Goal; nessuna adesione per conto degli altri.

**IMPLEMENTATION GUIDANCE:** riusare Source/messaggio attribuito ove sufficiente, senza creare un nuovo dominio “descrizione”. Il percorso deve resistere a errori/riprese e non duplicare testo o welcome. Workspace creato, invito pendente ed email consegnata sono esiti distinti; un problema di invito non annulla la creazione né significa che l’invitato sia già entrato. Restano destinatario preciso e conseguenza full-history. Il welcome iniziale dello spazio non va ripubblicato a ogni reload o ingresso di un membro; successiva assistenza contestuale non è un nuovo onboarding obbligatorio.

### 2.2 Conversation → mutation: percorso mancante, authority già definita

**OBSERVED:** [interpretation](../../src/server/interpretation.ts) produce proposte informative, risposta, organizzazione semantica, `workIntent` e `workControl`. Il [prompt](../../src/server/miriam-prompt.ts) vieta adozione, cambi Goal, assegnazioni ed effetti esterni diretti. [work-suggestions](../../src/server/work-suggestions.ts) collega già una proposta di controllo a fonte, versione, atto autenticato e risultato; è un precedente limitato, non un dispatcher universale di azioni. [project commands](../../src/contracts/project.ts) supporta proposta/revoca/sostituzione e approvazioni pertinenti.

Per “Quel vincolo non vale più” il dominio può già rappresentare la revoca, ma bisogna distinguere:

1. quale vincolo/versione e quale effetto si intende, oppure se si sta soltanto contestando una premessa;
2. una proposta da un atto efficace, identificando le persone rappresentate e la base di authority;
3. contenuto mostrato/autorizzato e stato corrente al Commit Point;
4. esito confermato, proposta ancora pendente, conflitto o esito da verificare, senza annunciare successo prematuramente.

**IMPLEMENTATION GUIDANCE:** riusare i comandi specifici e le loro ricevute; aggiungere soltanto i collegamenti mancanti fra richiesta, riferimenti, proposta ed effetto. Non affidare l’esecuzione a testo generato o alla sola classificazione del modello. Il nuovo percorso deve conservare anche il messaggio originario: le attuali fonti generate dai comandi non sostituiscono automaticamente la provenance della richiesta conversazionale.

“Passare dalla Conversation” può iniziare un’operazione e mantenerne comprensibili motivi/esiti; non obbliga a completare ogni approvazione digitando in chat. Anteprima/atto autenticato della capability rimangono validi, anche se raggiunti dalla conversazione. Un atto già preciso non richiede una seconda conferma soltanto perché conversazionale; quando riferimento/effetti sono ambigui serve il minimo chiarimento. In assenza del modello devono restare disponibili ispezione, controlli diretti necessari e recupero: togliere tutti i form prima di questo percorso renderebbe il prodotto meno capace.

### 2.3 Activity: observable/verifiable only

**DECIDED:** Activity rappresenta soltanto eventi osservabili/verificabili: avvio, completamento, risultato disponibile, informazione emersa, ipotesi qualificata, attenzione necessaria o attesa/Needs Input. Non espone chain of thought, pensieri interni, avanzamenti simulati o reasoning non verificabile. È una proiezione trasparente, non una seconda fonte di verità.

**OBSERVED:** [attention](../../src/contracts/attention.ts) espone attenzioni e cambiamenti tipo/data/revisione; [Active Work](../../src/contracts/active-work.ts) espone eventi con identità, contratto, fonte e autore. Candidati/fonti conservano comprensioni qualificate. Manca un contratto Activity unificato e un riferimento Activity in `message.send`. SSE, queue e `workspace_change` non costituiscono da soli una narrazione di prodotto.

Vincoli per proiezione e interaction design:

- **Verificabile non significa vero:** “ipotesi emersa” attesta l’esistenza della proposta e delle sue basi, non la correttezza dell’ipotesi. “Decisione cambiata” richiede una transizione governata effettiva; una richiesta di modifica non basta.
- **Riferimenti:** dettaglio collegato agli oggetti/versioni quando esistono; per uno stato transitorio, evidenza reale e nessuna identità storica fittizia. Distinguere evento passato e stato attuale, senza riscrivere come adottato ciò che era proposto. Riusare storia/provenance; nessun nuovo ledger o archivio di pensieri.
- **Privacy:** pillole condivise soltanto da materiale condiviso autorizzato. Email/calendari privati, altri Workspace, diagnostica e contenuti delle chiamate senza richiesta di analisi non entrano nella traccia. Una preferenza di attenzione personale non cambia i permessi.
- **Chiedi a RIMIAM:** riferimento verificabile all’oggetto/versione pertinente, non il solo testo “Budget emerso”. Rivalidare accesso e contesto; non scambiare il click per adozione/authority. Recuperare Minimum Sufficient Context, non tutto lo storyboard in ogni prompt.
- **Discrezione senza occultamento:** Activity sempre accessibile non significa inventare due eventi quando non ce ne sono. Due pillole non limitano numero/storia degli Active Work o nascondono definitivamente Needs Input. Contratto, controllo e storia rimangono consultabili secondo [ADR-0014 §12](../decisions/ADR-0014-active-work-specialist-contribution.md).
- **Intervento:** default discreto e opt-in proattivo di MVP §7.3 restano vincoli; il chiarimento non autorizza eccezioni nuove. Evento osservato, esito di un incarico richiesto e intervento spontaneo non sono la stessa cosa. Timing/ranking richiedono valutazione comportamentale, non keyword o avanzamento cosmetico.

Gap: proiezione comune, collegamento a Conversation e presentazione nativa/Web. Il primo brief non promette uno storico indipendente delle esatte parole generate per le pillole: la storia verificabile è quella di eventi/oggetti sottostanti. Un’eventuale futura esigenza di conservare anche quelle formulazioni non è necessaria per questo modello.

### 2.4 Context, Work, Outputs e Sources: aggregare senza fondere

**OBSERVED:** [ADR-0002](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) distingue due dimensioni: **accettazione** e **qualificazione del contenuto**. Anche un’informazione accettata può essere una stima, inferenza o contestata. Non sono sufficienti due colonne “certo” e “incerto”; un candidato molto convincente resta non accettato. Decisioni/vincoli efficaci hanno inoltre una validità normativa diversa dalla confidence.

Il raggruppamento Context è compatibile; va conservata questa distinzione anche nel microtesto Activity e nei recap. L’audit segnala filtri/qualificazioni native incompleti: ricomporre le stesse righe senza correggerne i dati riprodurrebbe l’ambiguità.

**DECIDED — esclusione dal primo brief:** nessuna CTA “Non rilevante”, nessun equivalente che introduca hide personale, scarto condiviso o soppressione del retrieval. Correggere, ridimensionare o chiedere l’esclusione passa dalla Conversation, chiarendo bersaglio ed effetti. La frase non crea un comando universale di cancellazione: si applicano le transizioni supportate, provenance e authority; una nuova semantica di esclusione non ancora supportata va chiarita, non eseguita implicitamente.

Accettare/correggere informazioni descrittive resta la capability editoriale dei contributori: non richiede un mandato di progetto o il consenso di tutti. Usare la Conversation non può introdurre questi requisiti né rendere obbligatoria una mediazione AI per esercitarla.

Work può accostare Task e Active Work, ma [ADR-0013](../decisions/ADR-0013-task-responsabilita-follow-up.md) e ADR-0014 vietano di dedurre responsabilità dal suggerimento, proprietà dal richiedente, soddisfacimento di obblighi dal completamento. Una stessa label “terminato” non deve cancellare queste differenze.

Outputs può presentare Contributions e Artifacts conservando qualificazioni, draft, versione adottata e attualità. [artifact.from_contribution](../../src/server/artifact-document.ts) è già un passaggio esplicito verso una bozza, non adozione. “Report prodotto → Artifact” è corretto come possibile risultato finale; **non come conversione automatica di ogni risposta o Contribution**. Nessuna nuova tassonomia di output è necessaria per questo raggruppamento.

Sources contestuali sono compatibili, ma upload, trascrizione, errori, retry e materiale non ancora utilizzato devono avere un percorso raggiungibile anche senza Context/Artifact derivato. File originali e citazioni non spariscono con la macro-area. L’analisi post-call resta separatamente richiesta sotto [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md).

### 2.5 Owner / Member / Guest: label derivate, non permessi

**DECIDED:** Owner descrive maggiori responsabilità amministrative correnti; Member la partecipazione standard; Guest capability operative più limitate. Sono label UX, non tre ruoli rigidi, una gerarchia obbligatoria o una nuova fonte di authority. Owner non significa creator assoluto; Guest non significa visibilità storica parziale.

**OBSERVED:** [access contract](../../src/contracts/access.ts) rappresenta stewardship, delega inviti, condizioni nominative, protezione e disponibilità; il [guard](../../src/server/workspace-state.ts) distingue membership, contribuzione ed eleggibilità. Il backend non definisce un pacchetto Guest. `contributes` è un dato tecnico, non un consenso a inventare quali operazioni un Guest possa esercitare o chi possa limitarle.

**IMPLEMENTATION GUIDANCE:** calcolare la presentazione dalle relazioni valide, non salvare una label per attribuire poteri. Mostrare controlli e termini in base alle capability/condizioni, rivalidati server-side. Owner può essere plurale, assente o insufficiente a descrivere accordi protetti; nessun passaggio richiede di nominare un unico proprietario. Un invitation delegate non diventa Owner solo perché può invitare. Quando la label non è fedele, ometterla o descrivere la relazione effettiva: non forzare ogni persona in una delle tre caselle.

Guest si mostra soltanto se esistono realmente limitazioni operative rappresentate e autorizzate; altrimenti non promettere inviti Guest o un selettore capace di crearli. Il primo brief non contiene una matrice nuova di permessi. Nuovi pacchetti di limitazioni/concessioni richiederebbero una specificazione separata, non una decisione di Claude.

Le CTA amministrative sono appropriate ma non necessariamente a basso impatto: invito/rimozione mantengono storia divulgata, protezioni e assensi pertinenti. “Cambia ruolo” può solo presentare transizioni realmente supportate; accesso ≠ project authority ≠ chiusura/archiviazione/cancellazione del Workspace. Questa lettura applica ADR-0006–0009 senza modificarli.

### 2.6 Sub-context: estensione dell’attuale Workstream

**DECIDED:** un filone focalizzato **interno allo stesso Workspace**, con stessi membri, visibilità, confine di accesso e authority applicabili. Nessun ACL, privacy distinta, Context canonico separato o authority propria. Può essere creato dall’utente o proposto da RIMIAM; non viene attivata silenziosamente nuova struttura visibile.

**OBSERVED:** [Workstream](../../src/server/attention.ts) ha identità, versioni, autore/origine e collegamenti alle fonti nella stessa Conversation. I comandi editoriali verificano contribuzione corrente e versioni. [Schema 017](../../migrations/017_attention_workstreams.sql) e [contratto](../../src/contracts/attention.ts) non hanno ancora il lifecycle richiesto. [Workspace links](../../src/server/workspace-links.ts) collega spazi distinti: non serve a realizzare questo sub-context.

**Compatibilità verificata:** ADR-0003 §6 consente filoni semantici senza spostare/duplicare eventi o effetti normativi; ADR-0009 preserva accesso full-history; ADR-0004 governa selezione sufficiente, non visibilità. Il raffinamento è compatibile con tutti e tre: si estende Workstream, senza introdurre un nuovo confine di dominio o una gerarchia di Workspace.

| Stato/atto | Significato da implementare                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active     | Filone nella navigazione attiva; fonti/messaggi appartengono sempre allo stesso Workspace. Non una stanza privata né un workflow obbligatorio.                                                            |
| Resolved   | Esce dalla navigazione attiva e resta nello storico. Elementi pertinenti possono riemergere nella superficie principale come riferimenti o sintesi qualificate; erano già nel medesimo confine condiviso. |
| Archived   | Filone conservato nello storico; non cancellazione di contenuti, non chiusura/archiviazione dell’intero Workspace.                                                                                        |
| Riapertura | Riprende il medesimo filone con identità e storia preservate; niente rinnovo automatico di adesioni/mandati o riavvio di lavori fermati.                                                                  |

Non si “fonde” un Context figlio nel parent: c’è già un solo Shared Context. Il rientro non accetta informazioni, cambia decisioni, completa Task/Goal, soddisfa commitments o adotta Contributions. I riferimenti conservano versioni, qualificazioni e dissenso. Minimum Sufficient Context seleziona materiale pertinente al filone, includendo contesto ulteriore necessario entro il medesimo accesso; non è eredità parziale o perdita di storia.

**IMPLEMENTATION GUIDANCE:** evoluzione minima dello stato/versioning Workstream, comandi lifecycle, letture storico/attivo, riferimento di focus nella Conversation e proiezioni nei tre client. Riusare la capability editoriale Workstream per organizzare il filone; non ricavare poteri dalla label Owner, dal creator o dal richiedente. Gli atti non devono modificare indirettamente gli oggetti governati o i controlli Active Work. Le migrazioni future dovranno preservare identità/fonti esistenti: nessuno schema viene implementato qui.

Il codice oggi può creare Workstream da organizzazione AI. Va distinto tale raggruppamento semantico dall’attivazione di un sub-context nella navigazione: la proposta AI non deve trasformarsi in un nuovo filone attivo senza l’atto consapevole dell’utente. Non è necessario vietare ogni associazione semantica automatica ammessa da ADR-0003, né introdurre un workflow engine per ottenere questa distinzione.

## 3. Implicazioni Web / iOS / Android

| Ambito               | Web                                                                                                                                                                         | iOS                                                                                                                                                                                                   | Android                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell/Lens           | Riutilizzare [WorkspaceLayer](../../src/client/workspace-layer.tsx); sostituire cinque ingressi/pannello stringa in [page](../../src/app/page.tsx) con la gerarchia scelta. | [MiriamApp](../../mobile/ios/Miriam/MiriamApp.swift) ha sheet con NavigationStack locale; non mantiene un path esplicito dopo dismiss. Lens adattiva richiede gestione nativa di apertura/path/focus. | [MainActivity](../../mobile/android/app/src/main/java/it/miriam/nativeapp/MainActivity.kt) usa destinazioni che sostituiscono la chat; bottom sheet attuale è un menu. La colonna larga è navigazione, non inspector. Va adattata la composizione, non il backend. |
| Memoria della Lens   | Il pannello smontato perde stato locale.                                                                                                                                    | Il nuovo sheet non garantisce recupero del punto precedente.                                                                                                                                          | `remember`/ritorno anticipato non realizzano la continuità richiesta.                                                                                                                                                                                              |
| Comportamento comune | Riferimenti a oggetti/versioni, stati/qualifiche e operazioni devono essere identici.                                                                                       | Layout, gesture, tastiera e accessibilità restano SwiftUI.                                                                                                                                            | Layout, Back, gesture e tastiera restano Compose.                                                                                                                                                                                                                  |

**IMPLEMENTATION GUIDANCE — memoria UI:** conservare nella sessione account/Workspace percorso, selezione e posizione appropriati; separare il draft da un’approvazione. Chiudere la Lens può mantenere il punto, ma riaprirla deve rivalidare accesso/versione. Logout, cambio account, perdita di accesso o oggetto rimosso non possono restaurare contenuti/azioni non più validi. Non serve sincronizzare la Lens nel database del Workspace né conservarla fra dispositivi. La politica richiesta non definisce persistenza permanente dopo riavvio: può ripartire dalla root.

I tre client devono inoltre correggere, nel successivo lavoro autorizzato, le omissioni già osservate di qualificazioni/storia, filoni e accessi alle fonti; un identico contratto non basta a garantire parità. Ricerca, upload, voce, chiamate/consenso, account e recupero non sono esclusi dal redesign perché non rientrano nelle quattro categorie: vanno mantenuti raggiungibili. Il controllo di una chiamata/registrazione non può dipendere dal modello o dal giro dello storyboard.

## 4. Decisioni chiuse e gap residui

**Chiusi:** confine/lifecycle del sub-context; label senza poteri propri; descrizione non-Goal; Activity soltanto osservabile/verificabile; rimozione della CTA “Non rilevante”. Non vengono riproposti come domande. Authority, accettazione editoriale, privacy e Commit Points rimangono decisioni già approvate.

| Tipo di lavoro futuro                             | Gap concreto                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Solo UI change**                                | Home e ingresso snelli; Lens/Activity distinti; raggruppamenti; memoria locale della Lens; label fedeli; accesso contestuale a fonti e capability; parità di qualificazioni/storia già segnalata nell’audit. |
| **Application/API change**                        | Conservare descrizione/ingresso e welcome; inviti nel percorso; proiezione Activity e riferimenti in Conversation; richieste naturali collegate ai comandi governati; letture/controlli del filone.          |
| **Dominio aggiuntivo limitato**                   | Lifecycle persistente/versionato del Workstream, sua creazione consapevole e riapertura. Non un nuovo Workspace/Context/ACL, non nuove relazioni di authority.                                               |
| **Nessun lavoro autorizzato in questa revisione** | Codice, migrazioni, provider, test applicativi, mockup e redesign. Questa tabella descrive gap, non avvia BUILD.                                                                                             |

Restano scelte implementative e di interaction design non bloccanti: ranking/durata/esposizione delle entry, microcopy, adattamento degli sheet, posizione/scroll da ripristinare, dettagli dei contratti e delle migrazioni. Le limitazioni Guest non presenti, eccezioni nuove alla discrezione e una soppressione universale del Context sono **fuori dal primo brief**, non funzioni da far inventare a Claude.

## 5. Adattamenti architetturali necessari e non necessari

**Nessuna riscrittura del backend né migrazione di stack è necessaria prima del design.** UI e API possono evolvere riusando comandi, ricevute, provenance, sync e recovery. Il lifecycle Workstream richiederà una piccola evoluzione persistente, non una nuova architettura. Non occorre implementarla prima di preparare il brief, purché questo distingua comportamento deciso da codice esistente.

Nel successivo BUILD autorizzato, isolare la composizione dai controller/payload dove necessario nei tre client; non anticipare un nuovo framework frontend. Activity è una proiezione, Lens uno strumento di lettura/navigazione. SSE/polling, Graphile, storage e PostgreSQL restano infrastruttura, non semantiche del prodotto. Nessun event sourcing aggiuntivo, policy DSL, sistema generico di agent/workflow o gerarchia obbligatoria Goal → filone → Task.

Calendar/Email conservano superfici operative e confini di [ADR-0011](../decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md) e [ADR-0012](../decisions/ADR-0012-workspace-email-privacy-bozze-invio.md): osservazioni private, disclosure, proposte e azioni esatte self-authorized sono distinte. Una pillola condivisa non eredita permessi della mailbox; connessione OAuth ≠ disclosure; “Chiedi a RIMIAM” ≠ autorizzazione all’effetto. Voce/chiamate restano nei limiti ADR-0015, con consensi e controllo direttamente accessibili.

Il brief può quindi essere scritto senza un nuovo ADR per il modello visuale. Questa revisione conserva la provenance delle decisioni UX; non modifica ADR esistenti né finge che il nuovo lifecycle sia già implementato.

## 6. Tre passaggi critici finali

1. **Complessità non necessaria?** Eliminati dal percorso attuale parent/child Workspace, ACL, eredità, merge di Context, archivio di pensieri e dismiss ambiguo. Il sub-context estende Workstream; Activity e Lens non sono nuovi sistemi di verità. Resta soltanto la complessità richiesta per lifecycle e collegamenti conversazionali affidabili.
2. **Label che mentono?** Owner non promette proprietà assoluta, Guest non promette privacy selettiva, “accettato” non significa certo, “risolto” non significa obbligo soddisfatto, “completato” non significa adottato. Se il dato non supporta una label, non mostrarla come fatto. Anche “informazione emersa” deve conservare origine/qualifica.
3. **Rischio dashboard/moduli tradizionali?** Le quattro categorie sono accessi progressivi, non quattro pannelli permanenti. Work non è una board; Outputs non è file manager; Activity non è menu di creazione Task/Goal/Artifact; il sub-context non è un canale privato. Preservare Conversation come base, senza rendere ogni controllo essenziale dipendente dal modello. Nessuna palette, schermata o visual style deciso qui.

Controllato anche il rischio conversation-first: richieste naturali non richiedono di digitare ID o ripetere consensi inequivocabili; pause, autorizzazioni esatte, privacy e recovery restano operabili con i controlli pertinenti. Nessuna contraddizione residua con gli ADR è stata individuata nel perimetro così circoscritto.

## 7. Files to share next

Pacchetto minimo per costruire il brief con ChatGPT:

- [Questa reconciliation v2](UX_DIRECTION_RECONCILIATION.md): direzione decisa, gap e vincoli; riferimento principale aggiornato.
- [CURRENT_UX_AUDIT](CURRENT_UX_AUDIT.md): fotografia del codice, invariata. Le sue vecchie domande descrivono lo stato prima di queste decisioni; non riaprirle.
- [MVP_SPEC_v0.1](../product/MVP_SPEC_v0.1.md), §§2–3, 6–7, 9–12, 14.1, 16: fonte canonica per significati e invarianti; questa revisione registra il raffinamento UX specifico.
- [MVP_GTM_PRODUCT_DISCOVERY](../product/MVP_GTM_PRODUCT_DISCOVERY.md), §§5–8: welcome, discrezione e superficie compatta. L’esclusione di parent/sub-context con eredità non esclude il filone interno deciso qui.

Solo se serve il testo normativo del tema in discussione: [ADR-0002](../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) per qualificazioni; [ADR-0003](../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md)/[ADR-0004](../decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md) per filoni/selezione; [ADR-0006](../decisions/ADR-0006-accesso-workspace-capability-relazioni-authority.md)/[ADR-0007](../decisions/ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md)/[ADR-0008](../decisions/ADR-0008-governance-accesso-protetta-condizioni-congiunte-rinuncia.md)/[ADR-0009](../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md) per relazioni; [ADR-0014](../decisions/ADR-0014-active-work-specialist-contribution.md) per presenza/controllo del lavoro.

Per una verifica tecnica mirata: contratti [attention](../../src/contracts/attention.ts)/[access](../../src/contracts/access.ts), [interpretation](../../src/server/interpretation.ts) e [work-suggestions](../../src/server/work-suggestions.ts). Le entry frontend e WorkspaceLayer già collegate in §3 servono per portare le proposte nel codice, non tutte insieme nell’attention del brief. [CODEMAP](../development/CODEMAP.md) resta la guida di Codex.

## 8. File da togliere dall’attention

- Le tre grandi entry frontend possono uscire dall’attention di **questo passaggio di decisione prodotto**, dato che audit e riconciliazione ne riportano l’evidenza. Riprenderle per il confronto di interaction design; non sono obsolete.
- [PRODUCT_DESIGN](../development/PRODUCT_DESIGN.md) è rationale storico del BUILD, non il nuovo brief. Non caricarlo come seconda direzione vincolante.
- [Proposta architetturale v0.1](../architecture/ARCHITECTURE_PROPOSAL_v0.1.md), [v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md), [draft MVP v0.2](../product/MVP_SPEC_v0.2_DRAFT.md), vecchi gate BUILD e suite complete non aggiungono decisioni UX correnti.
- [STATUS](../development/STATUS.md) resta il checkpoint di limiti/attivazione; non occorre reinserirlo in ogni discussione di label. ADR-0011/0012/0015 rientrano quando si disegnano Calendar/Email/audio, non tutti insieme per definire Home.
- Migrazioni, worker, provider adapter, OpenAPI completo, log, lockfile e segreti non servono nel contesto di Claude Design. Codex può consultarli per verificare un vincolo concreto.

Togliere dall’attention **non significa cancellare file**. Questa reconciliation è l’unico file aggiornato; non sostituisce l’audit descrittivo e non modifica gli ADR.

## Ready for Claude Design?

### READY

**Sì: il modello è pronto per costruire il brief e poi esplorare UX/interaction design.** Home separata; creazione leggera con descrizione non-Goal; Conversation primaria; Activity osservabile distinta dalla Lens; Goal/Context/Work/Outputs progressivi; fonti contestuali; Calendar/Email e People secondari; sub-context come filone interno con lifecycle; label derivate dallo stato reale; Lens platform-native con continuità di sessione.

Il brief deve marcare i gap di §4 come adattamenti futuri richiesti, non come funzionalità già presenti. Non è un via libera al BUILD, all’attivazione provider o al visual design in questa task.

### DO NOT LET CLAUDE DECIDE

- Accesso/visibilità del sub-context: medesimo Workspace, nessun ACL, privacy o authority propria; niente chat privata o Workspace figlio.
- Effetti di Resolved/Archived/riapertura: storia e identità conservate, nessuna adozione, completamento normativo o cancellazione automatica.
- Permessi derivati da Owner/Member/Guest: nessun owner assoluto, nuova matrice Guest o restrizione di storia. Label soltanto se fedeli, senza forzarle.
- Description → Goal: non automatico; formalizzazione e adesioni restano atti distinti.
- Activity: solo eventi verificabili e ipotesi qualificate; nessun pensiero interno, progress fittizio o nuova eccezione alla discrezione.
- Accepted Information ≠ certezza; Contribution/Artifact draft ≠ adozione; Completed ≠ attualmente valido.
- Mutazioni, consensi, disclosure e Commit Points: stessi confini server, versioni, provenance e recovery delle capability; non eliminare controlli necessari per ottenere una superficie calma.
- CTA “Non rilevante”: **esclusa completamente dal primo brief**, anche come dismiss equivalente con effetti sul Context/retrieval.
- IA coerente cross-platform non significa layout identico: SwiftUI e Compose non copiano il desktop.

### STILL OPEN

**Nessuna questione fondazionale bloccante per il brief/design visuale entro questi vincoli.** Restano dettagli non bloccanti di interaction design e implementazione: microcopy non normativa, ranking/esposizione Activity, gesture/detent/focus, ripristino della Lens, DTO e migrazione del lifecycle Workstream. Non richiedono di riaprire le cinque decisioni.

Se in futuro si desiderano vere nuove limitazioni Guest, privacy differente, auto-adozione o nuove eccezioni d’intervento, occorrerà una decisione separata. Non sono questioni da completare implicitamente nel primo brief.
