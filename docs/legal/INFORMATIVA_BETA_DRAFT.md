# RIMIAM — bozza informativa e condizioni per una beta chiusa

**Stato: BOZZA NON PUBBLICABILE — 29 settembre 2026.** Preparata su richiesta dell'utente; non è un'approvazione legale, una modifica agli ADR o una configurazione dell'app. Presuppone una beta testuale con pochi adulti in Italia/UE. Identità del gestore, contatto, basi giuridiche, conservazione, accordi con i fornitori e trasferimenti devono essere completati e verificati prima dell'uso. Le restrizioni proposte qui non sono ancora tutte applicate dal software.

Non esiste un'informativa che esoneri il gestore da qualsiasi responsabilità. Essere una persona fisica, offrire il servizio gratuitamente o chiamarlo «beta» non elimina di per sé gli obblighi applicabili. Questa bozza propone di escludere per ora i dati particolari: **non abilita una beta per dati sanitari o altre categorie particolari**, né presenta questa esclusione come già approvata dal titolare.

## A. Informativa agli utenti — testo da completare

### 1. Chi gestisce i dati e come contattarlo

Il titolare del trattamento per la gestione di questa beta è **[NOME E COGNOME COMPLETI]**, persona fisica, contattabile a **[EMAIL PRIVACY MONITORATA]**, **[RECAPITO APPROPRIATO]**. RIMIAM è il nome del progetto, non l'indicazione di una società costituita.

Questa attribuzione riguarda i trattamenti decisi dal gestore per offrire la beta. Se lo spazio viene utilizzato per dati di clienti, dipendenti o altre persone nell'ambito di attività professionali, i ruoli e gli eventuali accordi necessari devono essere valutati separatamente prima di tale uso.

### 2. Quali dati sono trattati

- Dati dell'account e di autenticazione: nome, email, credenziali protette, verifiche, sessioni e relativi metadati tecnici, inclusi indirizzo IP e user agent ove registrati.
- Contenuti condivisi volontariamente: messaggi, informazioni sul progetto, fonti testuali, risultati e stato del Workspace, con autori, date, versioni e riferimenti alle fonti.
- Elaborazioni AI: porzioni di contesto selezionate, istruzioni inviate al modello, risposte e proposte generate, riferimenti e dati diagnostici. Alcune registrazioni tecniche persistenti contengono anche il testo del contesto e degli output, non soltanto contatori anonimi.
- Inviti, email tecniche, atti di accesso e consenso pertinenti, segnalazioni di problemi e feedback inviati volontariamente.

I dati provengono dagli interessati, dagli altri partecipanti che li condividono e dalle elaborazioni del servizio. Una deduzione AI può essere inesatta e non equivale a un fatto accettato. L'inserimento di dati personali di terzi richiede una valutazione distinta, anche dell'informativa dovuta a tali persone: l'accettazione dell'utente che scrive non vale come consenso degli altri.

### 3. Finalità e basi giuridiche

**Tabella di lavoro da validare, non elenco di basi già adottate.** Non è sufficiente inserire una finalità nelle condizioni per renderne il trattamento necessario al contratto.

| Finalità                                                                                                                               | Base proposta / completamento necessario                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registrare e autenticare gli utenti ammessi, fornire il Workspace e la collaborazione AI richiesta, inviare verifiche e inviti tecnici | Art. 6(1)(b) GDPR, limitatamente ai trattamenti effettivamente necessari al servizio richiesto e alle condizioni della beta da adottare. Verificare necessità e perimetro dell'elaborazione AI anche in sottofondo. |
| Proteggere account e servizio, prevenire abusi, diagnosticare guasti strettamente necessari                                            | Art. 6(1)(f), previo bilanciamento documentato: sicurezza e continuità del servizio, con dati e conservazione proporzionati. Non autorizza la lettura generalizzata delle conversazioni per migliorare il prodotto. |
| Ricevere feedback facoltativi e trasformarli eventualmente in casi di valutazione del prodotto                                         | **[DEFINIRE DATI, DESTINATARI, CONSERVAZIONE E BASE PRIMA DELL'USO]**. Il riuso identificabile di conversazioni o report in altri strumenti AI non è automaticamente coperto dalla normale erogazione del servizio. |
| Adempiere a specifici obblighi di legge                                                                                                | Art. 6(1)(c), solo per obblighi realmente applicabili, da identificare.                                                                                                                                             |

I dati indispensabili all'account e al funzionamento richiesto sono necessari per accedere alla beta; gli altri contenuti e i feedback sono facoltativi. La presa visione dell'informativa non costituisce un consenso generale a qualsiasi trattamento. Dove si farà affidamento sul consenso, questo dovrà essere specifico, documentabile e revocabile con facilità, senza condizionare il servizio a trattamenti non necessari.

### 4. Come funziona la collaborazione AI

I messaggi testuali inviati possono attivare automaticamente una lettura AI anche senza menzionare RIMIAM e anche quando RIMIAM decide di non rispondere. Viene selezionato contesto pertinente dello stesso Workspace, che può includere storia precedente, stato condiviso e fonti autorizzate.

Il servizio utilizza attualmente OpenAI per queste elaborazioni. L'API non usa i dati per addestramento per impostazione predefinita, salvo adesione esplicita a programmi di condivisione. **Questo non significa assenza di conservazione presso il fornitore.** La configurazione rilevata usa Responses con archiviazione predefinita attiva (`store:true`); tempi e condizioni del fornitore vanno verificati e riportati nella versione finale, comprese le registrazioni antiabuso. Una futura disattivazione dell'archiviazione delle risposte non equivale da sola a «zero retention».

Il servizio non è una chat cifrata end-to-end rispetto al gestore e al fornitore AI: i sistemi devono poter elaborare i contenuti. L'accesso tecnico umano necessario a manutenzione e assistenza deve essere limitato e disciplinato, non confuso con la membership nel Workspace. Non è stata verificata una residenza esclusivamente europea di tutti i trattamenti.

Le risposte AI sono assistenza e proposte; non costituiscono automaticamente decisioni, impegni o autorizzazioni. Questa beta non è destinata a decisioni esclusivamente automatizzate con effetti giuridici o analogamente significativi sulle persone.

### 5. Chi vede i contenuti e quali fornitori intervengono

I membri attivi e idonei del Workspace possono vedere la sua storia condivisa conservata, **anche precedente al loro ingresso**. Un nuovo Workspace tiene separata la storia dagli altri spazi; non crea una conversazione privata tra alcuni membri dello stesso spazio. Uscire interrompe l'accesso successivo, ma non ritira copie già viste o conservate da altri e non equivale a cancellazione.

I fornitori attualmente configurati sono:

| Fornitore | Funzione e dati pertinenti                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render    | Hosting, worker e PostgreSQL: account, contenuti e registrazioni del servizio. La configurazione documentata colloca l'infrastruttura applicativa a Francoforte; ciò non certifica l'intera catena di trattamento come esclusivamente UE. |
| OpenAI    | Elaborazione AI del contesto selezionato e generazione di risposte/proposte.                                                                                                                                                              |
| Resend    | Email tecniche di verifica, recupero account e invito: destinatario, contenuto tecnico e collegamenti.                                                                                                                                    |

**[COMPLETARE]** Denominazioni contrattuali, ruoli dei fornitori, accordi ex art. 28 ove applicabili, subfornitori rilevanti, eventuali destinazioni extra SEE e garanzie concretamente applicate, con modalità per ottenerne copia. Non dichiarare che accordi o garanzie sono stati verificati finché non lo sono.

Voce, registrazioni di chiamate, mailbox e calendari esterni non rientrano nella beta testuale qui proposta. La loro eventuale attivazione richiede prima un aggiornamento coerente delle informazioni e delle misure pertinenti. Un consenso alla registrazione non sostituisce gli altri presupposti privacy né autorizza automaticamente analisi o azioni.

### 6. Conservazione e richieste di cancellazione

**[DA DEFINIRE E RENDERE OPERATIVO PRIMA DELLA PUBBLICAZIONE]** Specificare durata o criteri concreti distinti per account/sessioni, storia condivisa e risultati derivati, input/output diagnostici AI, feedback, consegna email, backup e copie presso fornitori. Definire anche cosa accade alla fine della beta e come si applicano eventuali obblighi di conservazione.

Il software conserva storia e provenance per continuità del progetto; queste esigenze non giustificano una conservazione indefinita né prevalgono automaticamente sui diritti previsti dalla legge. Una richiesta deve poter essere valutata e attuata sui dati pertinenti, sulle derivazioni e sui fornitori coinvolti, preservando solo ciò per cui esista un fondamento valido. Non è attualmente verificata una procedura completa di cancellazione/export privacy.

### 7. Diritti e contatti

Puoi scrivere a **[EMAIL PRIVACY]** per esercitare, quando applicabili, accesso, rettifica, cancellazione, limitazione, portabilità e opposizione. Puoi revocare un consenso per i trattamenti che si fondano su di esso; la revoca non pregiudica la liceità del trattamento precedente. L'uscita dal Workspace è distinta dall'esercizio di questi diritti.

Il titolare verifica l'identità con modalità proporzionate e risponde senza ingiustificato ritardo, normalmente entro un mese; eventuali proroghe ammesse e relative ragioni vanno comunicate nei termini di legge. Puoi proporre reclamo al [Garante per la protezione dei dati personali](https://www.garanteprivacy.it/) o all'autorità competente. Nessuna accettazione della beta comporta rinuncia a questi diritti.

### 8. Cookie e modifiche

Il codice esaminato utilizza sessioni di autenticazione e una preferenza locale di aspetto. **[VERIFICARE IL SITO LIVE]** Elencare strumenti, durate e fornitori effettivi prima di dichiarare l'assenza di tracciamento non necessario; eventuali nuovi strumenti richiedono una valutazione preventiva.

La versione finale recherà numero e data. Cambiamenti sostanziali a finalità, destinatari o funzionalità saranno comunicati prima dei nuovi trattamenti e richiederanno gli eventuali atti necessari. Una modifica dell'informativa non crea da sola una nuova base giuridica.

## B. Condizioni minime della beta — proposta separata dall'informativa

1. Partecipazione riservata agli adulti espressamente ammessi dal gestore; account personale e credenziali non condivisibili. L'ammissione alla beta non concede automaticamente il potere di invitare altri nel Workspace o di rappresentarli.
2. Servizio sperimentale: risposte inesatte, indisponibilità e modifiche sono possibili. Verificare gli output e conservare altrove i documenti importanti; non utilizzare la beta come unico archivio o come base esclusiva per decisioni critiche.
3. **Perimetro prudenziale proposto:** non inserire dati relativi a salute, vita sessuale/orientamento sessuale, opinioni politiche, religione, appartenenza sindacale, origine razziale/etnica, dati genetici o biometrici per identificazione univoca, dati giudiziari, dati di minori, password o segreti di accesso. Non caricare dati o documenti di terzi se non si dispone di un presupposto valido per condividerli e farli elaborare. Informazioni aziendali riservate e categorie particolari GDPR non sono sinonimi, ma entrambe richiedono attenzione ai destinatari e agli obblighi di riservatezza.
4. Non esportare o divulgare fuori dal gruppo contenuti altrui senza un presupposto appropriato. La possibilità tecnica di leggere o esportare non attribuisce diritti ulteriori sul contenuto.
5. Se inserisci per errore materiale non ammesso, segnala tempestivamente l'accaduto al contatto privacy, indicando soltanto il riferimento al messaggio. Il gestore deve poter limitare ulteriori elaborazioni e gestire l'incidente; questa istruzione **non è un'esenzione da responsabilità** e non sostituisce le misure tecniche necessarie.
6. **Clausola sui limiti:** «La natura sperimentale del servizio non limita i diritti inderogabili degli utenti né esclude o limita responsabilità nei casi in cui ciò sia vietato dalla legge, inclusi dolo, colpa grave e obblighi applicabili di protezione dei dati. Nessuna clausola trasferisce integralmente agli utenti gli obblighi propri del gestore.» Eventuali ulteriori limitazioni contrattuali richiedono revisione legale.

Separare nell'onboarding la presa visione dell'informativa dall'accettazione delle condizioni della beta; mantenere distinta l'accettazione già prevista della visibilità storica del Workspace. Non introdurre una casella obbligatoria «acconsento a tutto e rinuncio a ogni pretesa».

## C. Prima di usare questa bozza

- Completare identità, contatto e perimetro effettivo con un professionista privacy; verificare basi giuridiche e contratti/trasferimenti dei fornitori. Per categorie particolari: individuare sia la base art. 6 sia una condizione art. 9 applicabile e le ulteriori garanzie necessarie, valutando il rischio e l'eventuale DPIA. Il consenso di un amico non copre i dati di altre persone.
- Rendere la beta realmente chiusa mediante controllo server-side comune a web e API native, prima di creare account/inviare email. Valutare separatamente account e sessioni già esistenti: il blocco delle nuove registrazioni non li revoca. Non cambiare implicitamente membership o governance già valide.
- Rendere operative conservazione, gestione dei diritti e degli incidenti, backup/ripristino e limiti d'accesso tecnico. Esaminare la necessità dell'archiviazione Responses e dei contenuti diagnostici senza promettere «zero retention» o cancellazioni non disponibili.
- Fornire l'informativa prima della raccolta; registrare le versioni delle condizioni effettivamente accettate. Una firma non colma le lacune sopra indicate.

**Questa bozza non modifica impostazioni, non restringe la registrazione, non cancella dati e non è stata pubblicata nell'app.** Non certifica la conformità della beta e non dichiara riaperti o modificati gli ADR approvati; evidenzia prerequisiti privacy distinti dalla chiusura delle foundation implementative.

### Riferimenti verificati il 29 settembre 2026

- [GDPR, artt. 4, 5–7, 9–10, 12–22, 25, 28, 32–35, 44 ss. e 82](https://eur-lex.europa.eu/eli/reg/2016/679).
- [Commissione europea: basi giuridiche, consenso e dati particolari](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en).
- [Garante: guida all'applicazione del GDPR](https://www.garanteprivacy.it/documents/10160/0/Guida%2Ball%2Bapplicazione%2Bdel%2BRegolamento%2BUE%2B2016%2B679.pdf).
- [EDPB: ruoli e obblighi di titolari e responsabili](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en).
- [Codice civile, art. 1229 — fonte MEF](https://def.finanze.it/DocTribFrontend/getAttoNormativoDetail.do?ACTION=getArticolo&codiceOrdinamento=0000000000012290000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000&id=%7B9E93F1BE-06AE-4F24-8E9D-B838F7E0C2E6%7D).
- [OpenAI: uso e conservazione dei dati API](https://developers.openai.com/api/docs/guides/your-data).
- Evidenza del progetto: [ADR-0009](../decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md), [MVP §14](../product/MVP_SPEC_v0.1.md#14-privacy-sicurezza-e-compliance), [servizi configurati](../development/DEPLOY_EXTERNAL_SERVICES.md), [autenticazione](../../src/server/auth.ts), [comandi e inviti](../../src/server/commands.ts), [elaborazioni persistenti](../../src/server/interpretation.ts).
