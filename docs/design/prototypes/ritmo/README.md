# RIMIAM — Ritmo / design study 01

**2026-09-13 · studio iniziale; direzione UX approvata per integrazione il 2026-09-14.** L’utente ha approvato Ritmo come esperienza target nell’obiettivo di completamento del prodotto, poi ha richiesto una UI più distintiva: tipografia e struttura decise, grigi neutri, Light/Dark e adattamenti realmente nativi. L’approvazione riguarda la direzione, non la veridicità dei dati illustrativi né nuove regole di dominio. Gli ADR restano invariati; implementazione e verifiche effettive sono in [STATUS](../../../development/STATUS.md).

[Apri il prototipo](index.html). HTML/CSS/JavaScript autonomi, senza dipendenze, richieste di rete o dati reali. Può essere aperto come file oppure servito esclusivamente da questa directory:

```sh
python3 -m http.server 4317 --bind 127.0.0.1 --directory docs/design/prototypes/ritmo
```

**Aggiornamento scenario, 2026-09-14:** su richiesta dell’utente, Riccardo e Giulia stanno costruendo la startup RIMIAM e preparando la prima beta. Conversazioni, importi, disponibilità alle interviste e decisioni mostrate restano interamente illustrativi: non descrivono dati o approvazioni reali del progetto.

**Raffinamento Android:** l’anteprima usa una superficie applicativa senza cornice hardware/iPhone, con toolbar, tipografia e sheet distinti. Questo artefatto resta una rappresentazione HTML; il prodotto Android è implementato separatamente in Compose, con system back e adattamento allo spazio effettivo.

## Tesi

La Conversation occupa lo spazio principale. Una presenza Activity sintetica rende visibile il lavoro significativo; il dettaglio contiene perimetro, ipotesi, fonti e storia. Un solo ingresso «Lo spazio» apre la Lens. Fonti e risultati si raggiungono anche dal punto in cui emergono nel dialogo.

Linguaggio visivo: carta chiara, verde profondo, superfici salvia, titoli serif e testo funzionale sans. Nessuna dashboard iniziale, percentuale di avanzamento inventata, avatar umano per RIMIAM o feed di pensieri. «Ritmo» è il nome della direzione, non un rebranding del prodotto.

## Percorso breve

1. **Riprendere il filo:** leggi la Conversation e apri la fonte della stima dei servizi. «Confronta i due scenari» avvia la scena di lavoro; la pillola apre il Work Contract.
2. **Un risultato da leggere:** la scena carica un esempio scritto di Contribution. Apri il confronto, le sue fonti e «Parliamone con RIMIAM», che prepara un messaggio con riferimento al risultato.
3. **Due indicazioni diverse:** apri il chiarimento. Chiudi il dettaglio per cambiare persona dal selettore esterno. Entrambi hanno controllo operativo; ciascuno può ritirare soltanto la propria indicazione. Pausa/ripresa non risolvono un conflitto pendente.
4. **Lo spazio:** apri Context e la correzione attribuita, oppure il filone «Il lancio della beta». Focalizzazione, risoluzione, archivio e riapertura sono interazioni locali illustrative.
5. **Entrare nello spazio:** prova creazione con o senza introduzione. Nessun Goal o membro aggiuntivo viene dedotto; il nuovo spazio non eredita i dati della scena della startup RIMIAM.

Il selettore **iOS / Android / Web** cambia la proposta di contenitore, non la semantica. iOS/Android sono rappresentazioni HTML, **non nuovi client nativi implementati**. Web usa la larghezza disponibile e consente di affiancare la Lens. Il dettaglio torna a drawer su larghezze ridotte.

## Confini e stato reale

- Risposte, fonti, adesioni ed eventi di esempio sono scritti per il design e dichiarati illustrativi. Non dimostrano qualità del modello o acceptance multiutente. Nessun modello o servizio viene invocato.
- Tutte le interazioni restano nella memoria della pagina e si azzerano al reload o al cambio scena. Non sono comandi del prodotto, autenticazione, persistenza o autorizzazioni server.
- Contributi e affermazioni non vengono adottati. Non sono implementati nuovi atti di governance. La scelta tra soli costi dei servizi/costi e tempo di supporto riguarda soltanto il Work Contract esemplificativo, non gli obblighi del progetto.
- Voice, chiamate, Email, Calendar e inviti mostrano soltanto ingressi/confini illustrativi; non simulano un invio, consenso, connessione o registrazione riusciti.
- I gesti nativi, Dynamic Type/TalkBack/VoiceOver, input da tastiera mobile, restoration completa, microfoni, provider, recovery reale e performance restano da verificare nel percorso di integrazione autorizzato.
- Le etichette Goal/Context/Work/Outputs sono tradotte in navigazione leggibile; nessun nuovo modello persistente. Nessuna modifica a codice applicativo, contratti, migrazioni, ADR o dipendenze.

Fonti: [handoff](../../CLAUDE_DESIGN_HANDOFF.md), [reconciliation](../../UX_DIRECTION_RECONCILIATION.md), [MVP](../../../product/MVP_SPEC_v0.1.md). Le scene esplorano la presentazione entro quei confini, non approvano nuove regole.

## Verifica di questo artefatto

Controlli mirati di sintassi JavaScript, ESLint, Prettier, riferimenti locali e scenari di stato in Node. Nessuna suite del prodotto, E2E o test nel browser per questo artefatto. La successiva integrazione autorizzata nei client reali e le relative verifiche sono registrate in [STATUS](../../../development/STATUS.md); questo prototipo resta uno studio illustrativo, non il checkpoint applicativo.
