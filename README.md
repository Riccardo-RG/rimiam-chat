# RIMIAM

<img src="public/brand/rimiam-mark.svg" alt="Logo RIMIAM" width="60" />

RIMIAM è un workspace collaborativo AI-native: persone e AI lavorano nello stesso spazio, a partire dalla conversazione, verso un obiettivo comune. Miriam è l’intelligenza nativa del workspace; aiuta a comprendere, cercare, preparare e portare avanti il lavoro mantenendo un contesto condiviso persistente, consultabile e correggibile.

Messaggi, fonti, informazioni accettate, decisioni e azioni restano distinti. Comprendere una richiesta non conferisce il permesso di agire; una proposta AI non diventa automaticamente una decisione del gruppo. Storia, versioni e provenienza appartengono al workspace.

**Stato al 7 ottobre 2026:** MVP implementato nel perimetro documentato, con sperimentazione Web in corso e infrastruttura Render attiva. OpenAI è configurato e ha completato inferenze reali; Resend è configurato, ma la consegna email resta da verificare. L’accettazione complessiva con utenti, provider e dispositivi è ancora aperta: il prodotto non è pronto per un rilascio generale. [Stato, prove e limiti correnti →](docs/development/STATUS.md)

## Come leggere il repository

**RIMIAM** è il nome corrente del prodotto. **Allinagent** è il nome storico della discovery; **MIRIAM** rimane nei percorsi e negli identificatori tecnici. Questi nomi non indicano prodotti diversi.

La [specifica canonica](docs/product/MVP_SPEC_v0.1.md) mantiene il nome storico `MVP_SPEC_v0.1.md` per preservare riferimenti e continuità: incorpora le decisioni approvate successive, fino ad ADR-0015. **“v0.1” non è la versione corrente dell’app né una specifica abbandonata.** La [v0.2_DRAFT](docs/product/MVP_SPEC_v0.2_DRAFT.md) è una bozza conservata come evoluzione proposta; il suo numero non la rende una sostituzione approvata. La [riconciliazione](docs/product/MVP_V0.2_RECONCILIATION.md) spiega come è stata usata nel BUILD.

| Per trovare…                                                  | Leggere…                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Modello del prodotto e confini approvati                      | [Specifica canonica](docs/product/MVP_SPEC_v0.1.md) e [decisioni ADR](docs/decisions/)                          |
| Cosa funziona, cosa è stato verificato e cosa manca           | [STATUS](docs/development/STATUS.md)                                                                            |
| Punti d’ingresso nel codice e riferimenti per tema            | [CODEMAP](docs/development/CODEMAP.md)                                                                          |
| Metodo di lavoro nel repository                               | [AGENTS.md](AGENTS.md)                                                                                          |
| Configurazione, attivazioni, recupero e verifiche dei servizi | [Guida al deploy e ai servizi esterni](docs/development/DEPLOY_EXTERNAL_SERVICES.md)                            |
| Posizionamento e ipotesi commerciali                          | [Product Discovery / GTM](docs/product/MVP_GTM_PRODUCT_DISCOVERY.md), nei suoi espliciti limiti di approvazione |

Le date e i limiti degli atti storici ne conservano la provenienza. Per lo stato implementativo attuale fa fede STATUS; le proposte architetturali e le bozze non sostituiscono le decisioni approvate.

## Cosa comprende

- **Collaborazione e contesto:** account e inviti, Conversation, Goal e adesioni, informazioni accettate, domande aperte, decisioni, mandati e accesso protetto. Filoni di lavoro, attività e riepiloghi rendono consultabile lo stato senza spostare la storia.
- **Fonti e risultati:** documenti versionati, immagini e audio, ricerca web con provenienza e Artifacts con revisione e adozione esplicita. [Formati e limiti degli input](docs/development/RICH_INPUTS.md).
- **Lavoro persistente:** [Tasks e follow-up](docs/development/TASKS.md), [Active Work](docs/development/ACTIVE_WORK.md) controllabile dal gruppo e contributi specialistici che restano da adottare.
- **Calendario ed email:** appuntamenti interni e bozze utilizzabili senza collegare account esterni; [Calendar](docs/development/CALENDAR.md) e [Workspace Email](docs/development/EMAIL.md) separano osservazioni private, condivisione e azioni autorizzate.
- **Voce e chiamate audio:** messaggi vocali, dialogo con Miriam e chiamate fra persone. Nelle chiamate fra persone, registrazione e trascrizione richiedono il consenso personale di tutti i partecipanti catturati; l’analisi post-call richiede una richiesta separata. [Implementazione e verifiche ancora necessarie](docs/development/VOICE_CALLS.md).
- **Assistenza nell’app e feedback beta:** [aiuto contestuale](docs/development/PRODUCT_ASSISTANCE.md) e [feedback con consumi consultabili su richiesta](docs/development/BETA_FEEDBACK.md), separati dal Context del progetto.

La presenza di una capability nel codice non implica che il relativo servizio esterno sia attivo o validato dal vivo.

## Stack e client

Il backend è un monolite modulare **TypeScript / Node.js**, con **PostgreSQL** per stato corrente, storia, versioni e provenienza. **Graphile Worker** esegue il lavoro asincrono; **Better Auth** gestisce l’autenticazione. Comandi validati e transazioni applicano sul server isolamento, autorizzazioni e passaggi con conseguenze. L’output dei modelli è input non fidato.

| Client  | Tecnologia       | Stato                                                                                      |
| ------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Web     | Next.js / React  | Superficie attualmente in test; redesign del 7 ottobre 2026                                |
| iOS     | Swift / SwiftUI  | Implementazione presente; allineamento alle ultime modifiche Web e pubblicazione differiti |
| Android | Kotlin / Compose | Implementazione presente; allineamento alle ultime modifiche Web e pubblicazione differiti |

I client condividono il backend e il contratto server versionato; nessun client possiede lo stato canonico o l’autorità. La fase corrente modifica soltanto il frontend Web: non implica parità visiva o di rilascio con i nativi. [Setup e verifiche multi-client](docs/development/MULTICLIENT.md).

## Avvio locale

Servono **Node.js 24.x**, npm e PostgreSQL. Il percorso locale verificato usa Node **24.20.0** e PostgreSQL **18.3**; [Docker Compose](compose.yaml) fornisce il database. Eseguire dalla radice del repository, con Docker avviato:

```sh
npm ci
npm run setup:env
npm run db:up
npm run db:migrate
npm run dev
```

In un secondo terminale, dalla stessa directory:

```sh
npm run worker
```

Aprire [http://127.0.0.1:3000](http://127.0.0.1:3000), usando sempre questo hostname per cookie e controlli di origine. Il worker è necessario per le elaborazioni asincrone. Per i client nativi, avviare anche `npm run api` sulla porta locale **3002**.

`setup:env` crea `.env` da [.env.example](.env.example), genera il segreto di autenticazione e preserva un file già esistente. I file `.env*`, salvo l’esempio, sono esclusi da Git. PostgreSQL ascolta su `127.0.0.1:54329`; il volume nominato conserva i dati. Le migrazioni in [migrations/](migrations/) sono applicate dal runner con controllo dei checksum: rieseguire `npm run db:migrate` dopo aggiornamenti che ne aggiungono.

Per fermare l’ambiente, usare Ctrl-C nei terminali applicativi e `docker compose stop` per il database, conservandone il volume.

### Primo giro con due persone

1. Registrare un account con password di almeno **12 caratteri**. Aprire [/local-mail](http://127.0.0.1:3000/local-mail) nella **stessa sessione del browser** per il link di verifica. Con la configurazione locale le email restano qui: non vengono consegnate a caselle esterne. Il viewer richiede `LOCAL_MAIL=true`, loopback e ambiente non production.
2. Creare un Workspace, conversare e, quando utile, stabilire il Goal iniziale come proprio intento. L’adesione al Goal è un atto distinto dalla partecipazione allo spazio.
3. Invitare un secondo account per email esatta, usando un altro profilo del browser o una sessione privata. Il destinatario può registrarsi dal link; l’ingresso richiede accettazione esplicita della visibilità della storia condivisa conservata. Non concede automaticamente adesioni o autorità di progetto.
4. Con un modello configurato, chiamare Miriam esplicitamente e verificare proposte, fonti e correzioni. L’intervento proattivo richiede opt-in. Senza AI si possono comunque usare conversazione, fonti e operazioni manuali disponibili.

**Password dimenticata** e **Reinvia verifica email** usano la stessa inbox locale. Il reset revoca le sessioni esistenti; non ripristina membership o autorità terminate.

<a id="local-document-parsers"></a>

### PDF e DOCX

Per l’estrazione locale, il runtime verificato è Python 3.13:

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-documents.txt
```

Impostare `DOCUMENT_PYTHON_PATH` in `.env` al percorso assoluto di `.venv/bin/python`, quindi riavviare i processi interessati. I parser sono fissati in [requirements-documents.txt](requirements-documents.txt); non serve un runtime Codex.

## AI e servizi esterni

Un nuovo ambiente locale parte con AI, ricerca e trascrizione **non configurate**. Gli adapter deterministici esistono solo nei test; `AI_MODE=fixture` non produce risposte simulate nel runtime normale.

Per l’adapter OpenAI, configurare sul server `AI_MODE=openai`, `OPENAI_API_KEY` e `AI_MODEL` con un modello compatibile con output strutturato e, se usate, immagini. Anthropic e Ollama sono alternative supportate; il cambio di provider non modifica i concetti di dominio e non esiste fallback automatico fra provider.

Ricerca Brave, trascrizione, Google Calendar/Gmail, chiamate LiveKit e storage delle registrazioni hanno configurazioni e consensi separati. Il login Google è distinto dall’accesso Gmail/Calendar. Resend consegna le email di account e gli inviti richiesti: non implementa Workspace Email.

Seguire la [guida ai servizi esterni](docs/development/DEPLOY_EXTERNAL_SERVICES.md) per variabili, autorizzazioni, controlli reali e recupero; poi riavviare i processi interessati. I retry espliciti rivalidano le condizioni applicabili; un esito esterno incerto non autorizza a ripetere alla cieca un invio o un’azione.

## Verifiche di sviluppo

Con PostgreSQL avviato, inizializzare o aggiornare il database di test e scegliere i controlli pertinenti alla modifica:

```sh
npm run test:setup
npm test -- tests/sources-research.test.ts
npm run typecheck
```

Alle milestone, a fine sessione e prima del rilascio, secondo [AGENTS.md](AGENTS.md):

```sh
npm run check
npm run test:e2e
npm run build
npm run build:backend
```

`check` comprende TypeScript, lint, formattazione e test. Per un percorso browser mirato usare, ad esempio, `npm run test:e2e -- tests/e2e/sources.spec.ts`. Se Chromium manca, installarlo con `npx playwright install chromium`.

I test di dominio usano **miriam_test**. L’harness E2E crea e migra **miriam_e2e**, avvia web e worker isolati sulla porta **3100**, usa `.next-e2e` e ferma i processi al termine. I double dei provider non vengono collegati al database di sviluppo. I dati dei test restano disponibili per diagnosi; report e trace sono esclusi da Git. I test di recupero account rispettano i limiti di frequenza e possono richiedere circa due minuti.

Se una sandbox blocca l’IPC del launcher `tsx`, il comando equivalente per le migrazioni è `node --env-file=.env --import tsx scripts/migrate.ts`. Per build e verifiche native seguire la [guida multi-client](docs/development/MULTICLIENT.md).

## Deployment e limiti della beta

[render.yaml](render.yaml), [Dockerfile](Dockerfile) e gli script di avvio descrivono il deployment esistente. La [guida operativa](docs/development/DEPLOY_EXTERNAL_SERVICES.md) conserva attivazioni, prove live, scadenze, manutenzione delle credenziali e recupero; STATUS registra la distinzione fra modifica locale, pubblicazione e accettazione effettiva.

Restano da completare le verifiche reali multiutente, la qualità collaborativa complessiva, la consegna email, l’attivazione degli altri provider, backup/restore e monitoraggio, accettazione visiva e su dispositivi, firma e distribuzione native. Le regole d’uso beta pubblicate non sostituiscono l’informativa privacy e le policy di conservazione/cancellazione ancora da completare. Le eventuali bozze legali locali non sono documentazione pubblicata o approvata.

Videochiamate, push fuori app, billing, marketplace pubblico di agenti e memoria personale nascosta negli spazi condivisi non sono inclusi. Scope e futuro del prodotto restano quelli della specifica e delle decisioni approvate.
