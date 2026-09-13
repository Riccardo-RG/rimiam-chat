# ADR-0003 — Lifecycle del Goal, continuità e relazioni

## Stato e perimetro

- **Decisione:** Decisione 3.
- **Identificativo del registro:** ADR-0003.
- **Stato:** APPROVED DECISION.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione del testo approvato:** 1; i 12 punti dell’EXACT DECISION TEXT con il solo punto 2 sostituito prima dell’approvazione.
- **Approvata da:** utente, mediante approvazione formale esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, la stessa conversazione identificata negli ADR precedenti.
- **Relazioni:** integra [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md) e [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md), che rimangono invariati; non ne supersede alcun punto.
- **Tipo:** decisione di prodotto con vincoli architetturali; non approva un’implementazione.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

Il testo normativo completo è conservato nella sezione seguente; provenance, motivazione e supersessioni ne documentano l’approvazione senza aggiungere regole.

## Testo esatto approvato

**1. Goal principale e storia.** Nell’MVP un Workspace ha al massimo un Goal principale corrente, senza impedire l’esistenza di Goal precedenti, proposte e Sub-goal. Il cambio del Goal principale non crea automaticamente un nuovo Workspace e non cancella il Shared Context. Identità, versioni e storia dei Goal precedenti rimangono consultabili.

**2. Continuità dell’identità.** Un Goal mantiene la propria identità quando continua la stessa iniziativa verso lo stesso risultato principale, anche attraverso modifiche sostanziali adottate esplicitamente. Nasce una nuova identità quando viene stabilito un risultato autonomo, un obiettivo più ampio rispetto al quale il precedente diventa soltanto una parte, oppure una nuova iniziativa che sostituisce la precedente. MIRIAM può analizzare il cambiamento e proporre una nuova versione della stessa identità oppure un nuovo Goal, spiegando motivazione e conseguenze; non può decidere autonomamente questa classificazione quando il cambiamento è sostanziale. La scelta è parte dell’atto esplicito con cui viene adottato il cambiamento ed è effettuata da chi possiede l’authority pertinente per modificare o sostituire quel Goal secondo ADR-0001, entro il perimetro effettivo della transizione. Scegliere “stesso Goal” non trasferisce automaticamente adesioni, mandati, commitments, constraints o altri effetti al contenuto modificato; scegliere “nuovo Goal” non consente di eludere obblighi, constraints o commitments ancora applicabili. Gli elementi preesistenti conservano validità entro il proprio perimetro e secondo le regole pertinenti. L’authority per modificare o sostituire il Goal non comprende automaticamente quella per modificare tali elementi: ogni modifica necessaria richiede la relativa authority specifica e un atto esplicito. Se l’adozione del nuovo contenuto richiede necessariamente una modifica non ancora autorizzata a tali elementi, il cambiamento resta proposto finché questa viene autorizzata oppure il cambiamento viene riformulato in modo compatibile. Una semplice parafrasi che rappresenta lo stesso contenuto e la stessa versione rilevante, senza modificarli, non richiede una scelta tra identità, una procedura di authority o una conferma rituale.

**3. Formulazioni e versioni.** L’identità e il contenuto accettato del Goal non dipendono dalla formulazione linguistica esatta. Una semplice parafrasi può rappresentare lo stesso Goal e la stessa versione rilevante, senza sostituire silenziosamente il contenuto approvato, che rimane consultabile. Quando viene adottata una modifica del contenuto d’intento, si crea una nuova versione o una nuova identità secondo il punto 2. Le modifiche conservano autore, data, fonte, motivazione e riferimento al contenuto precedente. Una modifica sostanziale non può essere resa innocua qualificandola come riformulazione.

**4. Sostituzione e lineage.** La sostituzione identifica esplicitamente il Goal principale precedente, la sua versione e il nuovo Goal che ne prende il posto. Il lineage conserva l’origine di un Goal da un Goal/versione precedente e il significato della relazione. “Goal derivato” non è una categoria persistente distinta: è un Goal con origine documentata, oppure un Sub-goal quando il risultato è subordinato a un altro. Origine e sostituzione non trasferiscono automaticamente adesioni, mandati, impegni o validità del Context.

**5. Sub-goal.** Un Sub-goal rappresenta un risultato intermedio verificabile che contribuisce a un Goal principale. Ha identità e contenuto versionato propri e un riferimento esplicito al Goal e alla versione rispetto ai quali è stato definito. Un Goal precedente può assumere il ruolo di Sub-goal mediante un atto esplicito, conservando identità e storia del ruolo precedente; eventuali modifiche del suo contenuto sono versionate. L’adesione al Goal principale non crea automaticamente adesioni, assegnazioni o impegni personali relativi al Sub-goal.

**6. Workstream e attività.** Un Workstream organizza semanticamente un filone di conversazione e lavoro; non stabilisce da solo un risultato, una decisione o un impegno. Un Sub-goal esprime un risultato da raggiungere; un Task descrive un’attività concreta. Possono essere collegati senza duplicarsi. MIRIAM può proporre e organizzare collegamenti semantici, anche retroattivi, senza spostare o duplicare gli eventi storici né attribuire effetti normativi a tale organizzazione.

**7. Atti espliciti e authority.** MIRIAM può riconoscere segnali di evoluzione, proporre revisioni, nuovi Goal, Sub-goal, relazioni e conseguenze. Non può renderli efficaci come cambiamenti dell’intento condiviso mediante inferenza. L’adozione o modifica del Goal condiviso e delle relative scelte consequenziali richiede un atto esplicito e l’authority pertinente secondo ADR-0001. Un atto già inequivocabile non richiede conferma rituale. La capability editoriale di ADR-0002 non autorizza cambiamenti del Goal o altri effetti normativi.

**8. Adesioni.** Le adesioni restano attribuite al contenuto, all’identità e alla versione rilevante cui si riferiscono secondo ADR-0001. Una nuova versione con contenuto d’intento modificato o una nuova identità non eredita automaticamente le adesioni precedenti. L’atto di cambiamento può esprimere anche l’adesione personale di chi lo compie quando questa è inequivocabile; non implica quella degli altri. Una parafrasi del medesimo contenuto non richiede nuova adesione. La mancata adesione al nuovo contenuto non equivale a opposizione e non revoca automaticamente mandati o impegni preesistenti.

**9. Stato preesistente e conseguenze.** Decisioni, commitments, constraints, accepted information, Artifacts, Task, Sub-goal, Workstream e Contributions conservano identità, storia, scope e riferimenti originari. Il cambio del Goal non li cancella, modifica, estende o riaccetta automaticamente. MIRIAM distingue pertinenza rispetto al nuovo Goal e validità nel perimetro originario. Le incompatibilità con vincoli applicabili e gli altri effetti che richiedono authority devono essere chiariti o autorizzati prima delle transizioni che ne dipendono. Un nuovo Goal non costituisce un mezzo per eludere obblighi precedenti.

**10. Handoff e lavoro in corso.** MIRIAM propone un Context Handoff selettivo basato su riferimenti alle informazioni e versioni esistenti, distinguendo ciò che può essere riutilizzato, ciò che richiede verifica e ciò che resta storico. Il riuso non modifica da solo accettazioni o autorizzazioni. Artifacts e risultati prodotti sul Goal precedente conservano i propri presupposti; quelli potenzialmente superati sono segnalati. Il lavoro può continuare entro i propri limiti, ma l’applicazione dei risultati al nuovo stato richiede la verifica della pertinenza e delle autorizzazioni necessarie.

**11. Incertezza e controlli.** Quando continuità, significato o conseguenze non sono chiari, MIRIAM mantiene il Goal corrente e presenta una proposta o il minimo chiarimento necessario. Ricerca, confronto e preparazione possono continuare con ipotesi dichiarate. Il server verifica identità, versioni, atto esplicito e authority richiesta alla transizione; non ricava permessi dalla classificazione AI. Un cambiamento basato su una versione superata non può sovrascrivere silenziosamente lo stato corrente. Non sono richiesti un’ontologia generale o un motore di equivalenza semantica.

**12. Conclusione e conservazione.** Sostituire un Goal non significa averlo raggiunto. Il completamento o l’abbandono sono atti distinti, espliciti e attribuiti, soggetti all’authority pertinente e alla conferma richiesta dalla specifica. Il completamento di Task o Sub-goal può costituire evidenza, ma non determina da solo il completamento del Goal principale. Questi passaggi conservano storia e obblighi ancora applicabili. ADR-0001 e ADR-0002 rimangono invariati.

## Provenance dell’approvazione

La fonte primaria è la sequenza esplicita di messaggi dell’utente in questa conversazione:

1. Richiesta di affrontare soltanto il lifecycle del Goal, distinguendo revisione, sostituzione, derivazione, Sub-goal e Workstream, preservando ADR-0001 e ADR-0002.
2. Presentazione di due opzioni e dell’EXACT DECISION TEXT in 12 punti per l’Opzione 1, ancora proposto.
3. Richiesta di rivedere il solo punto 2: classificazione stessa/nuova identità parte dell’atto autorizzato di cambiamento; authority specifica sugli elementi collegati; nessuna procedura per una semplice parafrasi.
4. Presentazione del punto 2 sostitutivo e verifica che gli altri 11 punti non richiedessero modifiche.
5. Approvazione formale dell’intero testo con il punto 2 definitivo riportato integralmente dall’utente e autorizzazione al solo aggiornamento documentale.

Passaggi dell’atto di approvazione:

> Approvo formalmente la decisione — Lifecycle del Goal, continuità e relazioni.

> Approvo l’intero EXACT DECISION TEXT proposto da 12 punti, sostituendo esclusivamente il punto 2 originale con questa versione:

> Tratta quindi l’intera decisione, con questo punto 2 sostitutivo, come APPROVED DECISION.

Il punto 2 definitivo è riportato nella sezione normativa, senza duplicarlo qui. L’utente ha richiesto di mantenere ADR-0001 e ADR-0002 invariati, registrare sinteticamente supersessioni e raffinamenti e fermarsi senza implementazione o altre decisioni.

## Motivazione e relazioni

L’Opzione 1 preserva l’identità di un’iniziativa durante la sua evoluzione, distinguendola dalle versioni dell’intento adottato. L’alternativa di creare un nuovo Goal per ogni modifica sostanziale non è adottata: frammenterebbe affinamenti ordinari e moltiplicherebbe le successioni.

Il punto 2 definitivo rende esplicito chi decide la classificazione e impedisce di usare l’identità per trasferire consenso o aggirare obblighi. ADR-0001 continua a disciplinare authority, rappresentanza e adesioni; ADR-0002 mantiene la separazione fra attribuzioni, informazioni accettate e impegni. Nessuno dei due viene modificato. Le loro precedenti esclusioni del lifecycle descrivono il perimetro delle rispettive registrazioni storiche, non lo stato successivo a questo ADR.

Gli esempi della discussione illustrano i criteri approvati; non impongono classificazioni automatiche per parole, città o importi.

## Supersessioni e raffinamenti espliciti

| Fonte precedente | Contenuto precedente | Effetto approvato |
| --- | --- | --- |
| MVP §2.1 e voce Goal-based Chat del §17 | Un Goal esplicito, persistente, vivo e versionato; completamento importante da confermare | **REFINED:** al massimo un Goal principale corrente, conservando identità precedenti e Sub-goal; distinti contenuto, formulazioni, versioni, sostituzione e conclusione. Adesioni e authority seguono i punti 2–3, 7–8 e 12, senza modificare ADR-0001. |
| MVP §§6.3–6.4 | Workstream vs Sub-goal, riconoscimento del nuovo intento, Goal Lineage e Handoff selettivo | **REFINED:** Sub-goal con identità/versioni e riferimento al Goal/versione; “derivato” esprime origine, non una categoria distinta. La classificazione sostanziale è parte dell’atto autorizzato, mentre l’organizzazione semantica non produce effetti normativi. |
| MVP §§5, 11 e 12, nel caso di cambio del Goal | Artifact e lavoro sensibili al Context, assunzioni ancorate e Contributions governate | **REFINED:** i punti 9–10 distinguono pertinenza e validità originaria, riuso selettivo e applicazione autorizzata. Nessun trasferimento, riscrittura o cancellazione automatica dello stato preesistente; il restante comportamento di questi sistemi non viene ridefinito. |
| V0.2 §7, §19 (Sub-goals / Goal Lineage), §21/C05 | Unicità di un elemento/identità Goal per Workspace; relazioni rinviate a un’evoluzione successiva | **SUPERSEDED come limite del modello di prodotto:** l’unicità riguarda il Goal principale corrente, non tutte le identità storiche o subordinate. **REFINED:** la futura rappresentazione deve rispettare i punti 1–5. Non sono approvati o modificati schema, vincoli SQL o la specifica soluzione tecnica C05. |
| V0.2 §§6–7, 9–10 e 15–16 | Versioni del Context, percorso dedicato per il cambio Goal, authority e controlli delle correzioni | **REFINED:** applicare la classificazione autorizzata del punto 2, preservare versioni e adesioni e verificare l’authority specifica sugli effetti collegati. Una parafrasi senza modifica del contenuto non è una transizione sostanziale da autorizzare. Gate, algoritmi e fixture restano proposte tecniche. |
| Proposta conversazionale, punto 2 originale | Scelta esplicita e motivata fra revisione e nuova identità, senza l’attuale precisazione sull’authority della classificazione | **SOSTITUITO PRIMA DELL’APPROVAZIONE:** il testo vincolante è il solo punto 2 definitivo sopra riportato; gli altri 11 punti restano identici. |

Nei soli passaggi incompatibili identificati sopra prevale questo ADR. La v0.1 storica, il corpo precedente della v0.2 e le note dei primi due ADR sono conservati; le diciture storiche di approvazione architetturale non approvano altre scelte. Il DOCX originario rimane fonte storica della specifica iniziale.

## Limiti della registrazione

Non sono emerse contraddizioni sostanziali con ADR-0001, ADR-0002 o fra i 12 punti approvati. Rimane da allineare la rappresentazione tecnica del Goal nella v0.2: questo ADR non seleziona schema, migrazioni, gate, algoritmi o dettagli UX e non affronta altre decisioni aperte.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione dei 12 punti su approvazione formale dell’utente, con il solo punto 2 sostitutivo; aggiornamenti canonici circoscritti, ADR-0001 e ADR-0002 invariati, nessuna implementazione. |

