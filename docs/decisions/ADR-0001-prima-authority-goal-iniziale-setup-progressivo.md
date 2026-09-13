# ADR-0001 — Prima authority, Goal iniziale e setup progressivo

## Stato e perimetro

- **Decisione:** Decisione 1.
- **Identificativo del registro:** ADR-0001.
- **Stato:** APPROVED DECISION.
- **Data di approvazione:** 2026-09-08 (Europe/Rome).
- **Data di registrazione:** 2026-09-08 (Europe/Rome).
- **Versione del testo approvato:** 1; include la correzione del punto 2 richiesta prima dell’approvazione.
- **Approvata da:** utente, mediante approvazione formale esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente, senza estendere il perimetro dell’approvazione.
- **Conversazione Codex sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96` (identificativo restituito dall’app per questa conversazione).
- **Tipo:** decisione di prodotto con vincoli per l’architettura; non approva una specifica implementazione.
- **Specifica canonica aggiornata:** [MVP_SPEC_v0.1.md](../product/MVP_SPEC_v0.1.md), §§2.1, 9 e 17.
- **Proposta corrente interessata:** [ARCHITECTURE_PROPOSAL_v0.2.md](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md), con nota di allineamento limitata a questa decisione.

Il testo normativo approvato è riportato integralmente nella sezione seguente. Le sezioni di contesto, motivazione, provenance e confronto documentano la decisione; non aggiungono regole al testo approvato.

## Testo esatto approvato

**1. Origine dell’authority.** Ogni persona può esprimere il proprio intento e prestare consenso alla rappresentanza della propria posizione entro un perimetro esplicito. Questa facoltà non deriva da creator, owner, admin o membership e non conferisce il diritto di rappresentare altri o disporre di risorse non autorizzate.

**2. Goal iniziale.** Una persona può stabilire il Goal iniziale del Workspace come espressione esplicita del proprio intento, senza una precedente delega. Il Goal diventa condiviso fra le persone che aderiscono esplicitamente allo stesso Goal identificato e alla sua versione corrente rilevante. L’adesione non richiede di ripetere o approvare letteralmente la stessa formulazione testuale: deve però essere inequivocabilmente riferita a quel Goal e al contenuto che la persona sta accettando. Le adesioni sono attribuite, versionate e consultabili; non viene attribuito consenso a chi non lo ha espresso. Miriam può interpretare espressioni naturali come “sì, facciamolo” come possibile adesione quando il riferimento è inequivocabile, ma l’efficacia dell’adesione deve rimanere riconducibile a un atto esplicito della persona e a una specifica identità/versione del Goal.

**3. Dimensioni indipendenti.** Partecipazione al Workspace, adesione al Goal e authority decisionale sono distinte. Nessuna implica automaticamente le altre. Aderire al Goal non costituisce una delega né un’approvazione generale delle decisioni future.

**4. Setup progressivo.** Miriam può facilitare la definizione esplicita degli accordi alla creazione del Workspace, all’ingresso di nuovi membri, quando cambia significativamente la composizione del gruppo e durante il lavoro. Propone poche domande pertinenti e non richiede di definire tutta la governance inizialmente.

**5. Facoltatività e Commit Point.** Il setup non è un prerequisito per conversare, comprendere, analizzare o preparare il lavoro. Saltarlo non concede authority. Quando un commitment richiede authority non ancora stabilita, Miriam chiede soltanto il chiarimento necessario. Un mandato valido già esistente viene riutilizzato entro i suoi limiti.

**6. Costituzione dei mandati.** Il primo mandato nasce da atti espliciti delle persone legittimate a conferirlo. Per rappresentare una persona occorre il suo consenso esplicito oppure una authority già valida che copra tale rappresentanza. Una dichiarazione unilaterale, il ruolo tecnico, la membership, il comportamento osservato e il silenzio non sono basi sufficienti.

**7. Contenuto verificabile.** Ogni mandato identifica le persone rappresentate, chi può decidere o deve approvare, l’ambito, la capacità e i limiti applicabili, con provenance degli atti che lo stabiliscono. Il destinatario accetta il mandato. Nell’MVP sono supportati mandati individuali circoscritti e approvazioni congiunte nominative; non sono richiesti ruoli generici o un motore generale di policy.

**8. Confini.** Non è richiesta l’approvazione di tutti i membri per ogni decisione. Sono richiesti i consensi e i poteri pertinenti al perimetro effettivo della decisione. Un mandato non può vincolare persone non rappresentate né superare limiti comuni applicabili. Ambiti incerti, regole incompatibili o authority mancante non diventano permessi impliciti.

**9. Ruolo di Miriam e del server.** Miriam può individuare un bisogno di chiarimento e proporre la formulazione degli accordi. Non può rendere efficace una authority mediante inferenza. Il server verifica atti espliciti riferiti a contenuti precisi e applica soltanto mandati rappresentabili nelle forme supportate. Un atto già inequivocabile non richiede una seconda conferma rituale.

**10. Nuovi membri e cambiamenti del gruppo.** L’ingresso non implica adesione al Goal, rappresentanza o authority. Gli accordi preesistenti restano validi entro il perimetro originario. I cambiamenti del gruppo possono richiedere chiarimenti sugli accordi interessati, ma non trasferiscono poteri, non estendono deleghe e non riducono automaticamente i consensi richiesti.

**11. Modifiche e contestazioni.** Ogni modifica ai mandati richiede authority appropriata ed è attribuita, versionata e collegata alle proprie fonti. Il potere di decidere in un ambito non comprende automaticamente quello di modificare i mandati. Una contestazione della propria rappresentanza sospende i nuovi usi del mandato per proprio conto fino a chiarimento o conferma esplicita, senza cancellare la storia o invalidare automaticamente le decisioni precedenti.

**12. Continuità.** Gli accordi emersi successivamente nella conversazione seguono le stesse regole di quelli raccolti nel setup. Questa decisione consente chiarimenti iniziali facoltativi e sostituisce il divieto assoluto di configurare authority all’onboarding, preservando il principio di progressività e l’assenza di configurazione obbligatoria.

## Provenance dell’approvazione

La fonte primaria è la sequenza esplicita di messaggi dell’utente in questa conversazione Codex:

1. Richiesta di valutare la sola «Prima authority e Goal iniziale», senza implementazione.
2. Proposta dell’utente di introdurre un setup guidato e progressivo alla creazione, all’ingresso di membri e ai cambiamenti del gruppo.
3. Presentazione del `REVISED EXACT DECISION TEXT` in 12 punti, ancora in stato proposto.
4. Correzione dell’utente del solo punto 2: adesione riferita a identità/versione del Goal, senza dipendenza dalla formulazione linguistica letterale. Gli altri 11 punti restano invariati.
5. Approvazione formale dell’intero testo così corretto e autorizzazione al solo aggiornamento documentale.

Passaggio dell’atto di approvazione dell’utente:

> Approvo formalmente la **Decisione 1 — Prima authority, Goal iniziale e setup progressivo**, includendo la versione corretta del punto **2. Goal iniziale** appena verificata.
>
> Considera quindi l’intero `REVISED EXACT DECISION TEXT`, con questa correzione, come **APPROVED DECISION**.

L’utente ha inoltre richiesto di aggiornare la documentazione canonica e il Decision Log / ADR, conservare provenance, data, stato e motivazione, documentare i principi superseduti e fermarsi senza modificare altre decisioni, iniziare implementazione o passare alla Decisione 2.

L’autorità di questo record deriva da tale atto esplicito, non dalle raccomandazioni di Codex né dalla dicitura storica «architecture direction broadly approved» nelle proposte architetturali.

## Contesto e motivazione

Il modello precedente proteggeva la distinzione tra membership e authority, ma lasciava poco esplicita l’origine del primo mandato e trattava rigidamente l’assenza di authority all’avvio. Occorreva permettere a una persona di esprimere il proprio Goal senza una precedente delega, distinguendo tale atto dalla rappresentanza di altre persone.

La scelta approvata conserva l’origine esplicita e circoscritta dei mandati e permette a Miriam di aiutare il gruppo a chiarirli anche prima di incontrare un blocco, senza rendere il setup obbligatorio. Partecipazione, adesione al Goal e authority rimangono indipendenti.

La correzione del punto 2 preserva l’identità del Goal rispetto alle variazioni linguistiche, mantenendo ogni adesione riconducibile alla persona e al contenuto identificato/versionato che ha accettato. L’approvazione non seleziona una particolare rappresentazione persistente di tali riferimenti.

### Alternative discusse

- **Mandati soltanto al bisogno:** base dell’Opzione 1, raffinata consentendo anche setup iniziale e verifiche contestuali facoltative.
- **Accordo iniziale obbligatorio su Goal e primo mandato:** non adottato come prerequisito del Goal condiviso; avrebbe anticipato la configurazione anche senza un bisogno concreto.
- **Authority da ruoli tecnici, membership, silenzio o comportamento osservato:** esclusa dagli invarianti di prodotto e dal testo approvato.
- **Adesione vincolata alla stessa formulazione testuale:** sostituita prima dell’approvazione con il riferimento esplicito a identità/versione del Goal.

Queste alternative sono registrate come contesto della scelta; non costituiscono ulteriori decisioni approvate.

## Supersessioni e raffinamenti espliciti

| Fonte precedente | Formulazione o assunzione precedente | Effetto della Decisione 1 |
| --- | --- | --- |
| MVP §9 e voce Progressive & Scoped Authority del §17; formulazione ripresa dal DOCX originario | «L’authority non viene configurata preventivamente all’onboarding»; emersione presentata soltanto quando il lavoro la rende necessaria/al Commit Point | **Superseduto il divieto assoluto.** È ammesso un setup facoltativo alla creazione, ai cambiamenti del gruppo e durante il lavoro. Rimane obbligatoria la verifica dell’authority necessaria al Commit Point; rimane esclusa la configurazione obbligatoria. |
| MVP §2.1 e voce Goal-based Chat del §17 | Goal esplicito, persistente e non bloccante, senza una regola dettagliata per la prima adesione | **Raffinato.** Il Goal iniziale può esprimere l’intento personale senza delega; la condivisione deriva da adesioni esplicite riferite a identità/versione e contenuto, attribuite, versionate e consultabili. Le altre regole sul Goal non vengono modificate. |
| Bozza conversazionale del punto 2 del REVISED EXACT DECISION TEXT | Adesione alla «stessa formulazione» | **Sostituita prima dell’approvazione.** Non è mai diventata una decisione approvata; il testo approvato è esclusivamente il punto 2 corretto qui riportato. |
| Architettura v0.2 §§7, 9 e 15 | Il Goal iniziale resta candidato in attesa di un precedente processo legittimo di accettazione | **Superata per il Goal come intento personale.** Non serve una delega precedente per stabilirlo. Rimane esclusa qualsiasi authority collettiva derivata soltanto dalla creazione o dalla membership. |
| Architettura v0.2 §§9, 16 e 19 | Chiarimenti sull’authority descritti come iniziati soltanto al tentativo di commitment | **Raffinato.** Il bisogno di authority al commit rimane vincolante; è inoltre ammessa la facilitazione facoltativa e contestuale prima di quel momento. |
| Architettura v0.2 §§7, 9, 13 e 21/F06 | Proposta di authority basis, quattro gate e rappresentazione orientata al singolo attore | **Vincolata al prodotto approvato, non approvata tecnicamente.** Il modello dovrà rispettare anche adesioni a identità/versione, approvazioni congiunte nominative, accettazione del mandato, contestazioni e modifiche versionate. Schema, gate e protocolli restano proposte da riesaminare. |
| Architettura v0.1 §9 | Unanimità provvisoria per transizioni consequenziali | Già superata come regola universale nella v0.2; la Decisione 1 conferma l’assenza di unanimità universale senza escludere approvazioni congiunte nominative nello scope pertinente. La v0.1 resta materiale storico invariato. |

La formula «Ask only when authority is unresolved» continua a regolare il chiarimento necessario per procedere a un commitment: non impone di ristabilire un mandato valido. Non costituisce un divieto di offrire il setup facoltativo approvato.

Il setup dell’authority non introduce abilitazioni automatiche dei comportamenti o dei servizi menzionati nel MVP §7.4. Le regole di Action Policy, Evidence Governance, sicurezza e gli altri invarianti non sono sostituiti.

## Limiti della registrazione e aspetti non decisi

- L’approvazione riguarda esclusivamente i 12 punti riportati e non l’intera architettura v0.2, il suo stack, lo schema, i quattro gate o i parametri operativi.
- Gli importi, i nomi, gli ambiti e le domande usati negli esempi della conversazione non diventano configurazioni o requisiti obbligatori.
- Non viene selezionata la rappresentazione tecnica di Goal, adesioni, mandati o approvazioni congiunte. La proposta v0.2 richiede successivo allineamento progettuale su questi aspetti.
- I dettagli delle interazioni UX e delle forme di scope verificabili restano da definire entro il testo approvato.
- Non si risolvono qui il lifecycle del Goal, Fact vs commitment o altre decisioni non approvate. La Decisione 2 non è affrontata.
- Non è autorizzato né avviato alcun lavoro di implementazione.

Non sono state rilevate contraddizioni sostanziali tra i 12 punti approvati. Le incompatibilità con formulazioni precedenti sono delimitate nella tabella di supersessione, senza scegliere nuove regole per gli aspetti ancora aperti.

## Registro della registrazione documentale

| Data | Stato | Operazione e fonte |
| --- | --- | --- |
| 2026-09-08 | APPROVED DECISION | Registrazione iniziale dei 12 punti su approvazione formale dell’utente, inclusa la correzione preventiva del punto 2; aggiornamento circoscritto della specifica e dei riferimenti documentali. |
