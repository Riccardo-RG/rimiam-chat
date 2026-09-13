# ADR-0006 — Accesso al Workspace: capability, relazioni e authority di modifica

## Stato e provenance

- **Decisione:** fondazione del modello di accesso al Workspace; vincolo per la successiva risoluzione di B2, non approvazione di B2.
- **Stato:** APPROVED DECISION — architetturale e di prodotto, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvata da:** utente, mediante approvazione esplicita nella conversazione Codex sul progetto MIRIAM.
- **Registrata da:** Codex, su richiesta dell’utente.
- **Fonte primaria:** messaggio «I explicitly APPROVE the following foundational decision for MIRIAM», fornito nell’allegato `1504c6ec-15ce-49ca-bda8-86f4dcd37c93/pasted-text.txt`; contiene il testo approvato, i chiarimenti e i limiti della registrazione.
- **Relazioni:** preserva ADR-0001–ADR-0005, collegati nella sezione dedicata sotto; nessuno viene riaperto o modificato.
- **Documenti collegati:** [specifica canonica](../product/MVP_SPEC_v0.1.md), [proposta architetturale v0.2](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md).

L’approvazione segue lo stress test dell’adattabilità del modello di accesso. Deriva dall’atto esplicito dell’utente, non dalla precedente raccomandazione dell’assistente. Prima di questa registrazione, B2 risulta discusso soltanto in conversazione, senza un record dedicato nel repository. Questo ADR non ne incorpora né approva la policy concreta.

## Testo esatto approvato

Testo fornito dall’utente, conservato nella lingua originale:

> Workspace access is modeled through explicit, attributable and versioned relationships that distinguish:
>
> (a) the operational access capabilities an actor may exercise;
> from
> (b) the authority that permits granting, modifying or revoking those capabilities.
>
> Protection, revocability and applicable change conditions belong to the relevant access relationship.
>
> These relationships may evolve through explicitly authorized acts without deriving their semantics from the social category of the group, creator status, organizational titles or implicit hierarchy.
>
> The architecture must therefore be able to support different and evolving collaboration structures — including protected peer stewardship and bounded revocable delegation — within the same universal Workspace model.
>
> This is an architectural foundation, NOT authorization to build a generic RBAC system, permission matrix, policy DSL, governance engine or arbitrary delegation framework.
>
> The MVP must implement only the minimum concrete access relationships and capabilities required by approved product behavior.

## Chiarimenti e perimetro richiesti nell’atto di approvazione

1. **Access Administrator.** Non è un ruolo universale che definisce l’identità dell’attore e incorpora inseparabilmente tutti i poteri di accesso e le protezioni di governance. Un’eventuale etichetta UX non sostituisce la semantica delle relazioni effettive.
2. **Dimensioni distinte.** Il modello distingue almeno concettualmente membership del Workspace, capability operative di accesso, authority per modificare le relazioni di capability, protezione/revocabilità/condizioni di modifica delle relazioni e idoneità dell’account sotto il profilo della sicurezza. Poter esercitare una capability non conferisce automaticamente il potere di concederla, modificarla o revocarla. Lo stato di account/sessioni resta distinto dalle relazioni di governance del Workspace.
3. **Operazioni simili, relazioni diverse.** Due attori possono compiere operazioni di accesso simili pur partecipando, per esempio, uno a una stewardship condivisa protetta e l’altro a una delega circoscritta revocabile. Questi esempi non sono tipi di Workspace, ruoli obbligatori o astrazioni di schema già approvate.
4. **Adattabilità.** Il modello deve poter rappresentare gruppi legittimi differenti e la loro evoluzione. Etichette come company, couple, family, friends, founders, team o study group, titoli organizzativi e gerarchie implicite non determinano permessi o condizioni di governance. Nessun tipo sociale predefinito di Workspace seleziona la semantica dell’accesso.
5. **Evoluzione esplicita.** Lo stesso Workspace può passare da collaborazione informale a strutturata e da gestione tra pari ad accordi delegati mediante transizioni esplicitamente autorizzate, senza sostituire il modello fondamentale del dominio. Le modifiche a capability e authority sono attribuite e versionate, preservando fonti, condizioni precedenti e provenance; non riscrivono la storia. Miriam non inventa authority e il silenzio non vale come consenso. Una transizione non supportata o priva dell’authority richiesta può restare bloccata.
6. **Creator e bootstrap.** La creazione è provenance storica/di bootstrap. Le eventuali capability iniziali non lasciano un privilegio permanente residuo del creator dopo l’evoluzione delle relazioni applicabili. L’esatta transizione di bootstrap e i suoi poteri restano da stabilire in B2.
7. **Separazione dal progetto.** Membership e adesione al Goal non equivalgono ad authority decisionale; amministrazione dell’accesso e authority di progetto sono distinte. Una capability o relazione di governance dell’accesso non crea, trasferisce, soddisfa o revoca automaticamente authority sul Goal, mandati, commitments, constraints, decisions o approvazioni congiunte nominative. Adesioni ed effetti preesistenti mantengono le regole di ADR-0001–ADR-0003.
8. **Minimo MVP.** L’ADR non richiede RBAC generico, permission matrix, permessi arbitrari, policy DSL, motore di governance, voto configurabile, grafi di delega, gerarchie organizzative, governance per tipo di Workspace o capability future anticipate. L’MVP realizzerà soltanto il minimo concreto richiesto dai comportamenti di prodotto approvati; nessuna rappresentazione tecnica o schema è selezionato da questo atto.
9. **B2 resta aperto.** Operazioni esatte, forme di relazione supportate, bootstrap, regole della stewardship tra pari, limiti della delega, inviti, rimozioni e casi limite del lifecycle devono ancora essere risolti in B2. Non vengono ratificate le precedenti proposte su unanimità, nomina, revoca, ultimo amministratore, successione o effetti della chiusura dell’account. La distinzione fra sicurezza e governance non autorizza a ricavare nuovi poteri da una sospensione o da un recupero dell’account.
10. **Primitivi universali e progressive disclosure.** La semantica interna resta rigorosa e verificabile; l’esperienza espone soltanto la complessità pertinente. Un gruppo semplice non deve comprendere terminologia di governance o configurare strutture formali prima di ricevere valore. Semplificare l’interfaccia non elimina gli atti espliciti necessari né abilita transizioni non autorizzate.

## Relazioni con le fondazioni approvate

| Record invariato | Vincolo preservato |
| --- | --- |
| [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md) | Authority di progetto scoped e progressiva; membership e adesione non conferiscono mandati; rappresentanza e modifiche richiedono authority pertinente. Nessuna inferenza o silenzio sostituisce gli atti espliciti. Le relazioni di accesso non sostituiscono questi mandati. |
| [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) | Attribuzioni, Accepted Information ed effetti normativi restano distinti. La capability editoriale di base non crea o modifica autorizzazioni operative; non diventa una delega di accesso e non richiede un nuovo mandato per effetto di questo ADR. |
| [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md) | Identità/versioni del Goal, adesioni, lineage e impegni conservano la propria semantica. Cambiare la struttura dell’accesso non riscrive questi elementi; un cambio del Goal non fornisce automaticamente authority sull’accesso. |
| [ADR-0004](ADR-0004-context-efficiency-minimum-sufficient-context.md) | Minimum Sufficient Context resta subordinato a qualità, continuità e invarianti, entro accesso e authority applicabili. Nessuna nuova strategia di retrieval o proiezione è approvata. |
| [ADR-0005](ADR-0005-postgresql-stato-canonico-storia-provenance.md) | PostgreSQL conserva stato corrente interrogabile e storia/provenance immutabili. Le transizioni seguono comandi validati e atomicità di dominio; non sono approvati schema, tabelle, un nuovo motore di autorizzazione o full event sourcing. |

## Motivazione e conseguenze

Un unico ruolo che unisce operazioni, potere di nomina e protezione tra pari impone una specifica struttura anche quando il gruppo vuole soltanto delegare un’attività di accesso. La distinzione approvata permette di mantenere lo stesso Workspace mentre cambiano le relazioni, senza dedurne i poteri dalle categorie sociali.

- Il server deve poter verificare sia l’operazione consentita sia la base che autorizza a modificare una relazione; un’etichetta di ruolo o un’interpretazione AI non bastano.
- Relazioni con effetti diversi richiedono condizioni e provenance distinguibili, anche quando la superficie UX è semplice. La disciplina aggiuntiva non richiede un motore generale di policy.
- L’adattabilità non garantisce l’esecuzione di qualsiasi accordo o la risoluzione dei conflitti umani: transizioni non rappresentabili o non autorizzate possono restare bloccate.
- Cambiare in seguito il significato di protezione o revocabilità sarebbe costoso sul piano dei dati e delle aspettative dei partecipanti. Le migrazioni devono preservare identità, riferimenti storici e significato degli atti precedenti; una nuova impostazione non riscrive retroattivamente gli accordi.

## Raffinamenti e limiti documentali

| Fonte precedente | Allineamento |
| --- | --- |
| V0.2 §7: `workspace_member.access_role` (`owner`/`member`) | **REFINED:** conservato come schema storico illustrativo; non costituisce un modello completo approvato delle relazioni di accesso. Non può incorporare indistintamente tutti i poteri e le protezioni in un ruolo universale. Nessuno schema sostitutivo è approvato qui. |
| V0.2 §§9, 13 e 20: owner, inviti, bootstrap e separazione dal progetto | **REFINED:** le letture basate su un owner permanente o su poteri universali del ruolo non sono valide. Resta la separazione dall’authority di progetto; condizioni operative e bootstrap concreti dipendono ancora da B2. I riferimenti a ownership dei dati o ruoli tecnici PostgreSQL non sono titoli di governance umana. |
| V0.2 §§21–22: direzione «broadly approved» e assenza di blocking questions | **STATO STORICO:** non approva B2 o l’intera proposta. ADR-0006 approva soltanto questa fondazione; le scelte concrete di B2 restano aperte. |

L’assunzione conversazionale che tutti i gestori dell’accesso debbano essere amministratori protetti identici non è una decisione approvata e non può fungere da fondazione universale. Le relative clausole B2 non vengono registrate da questo ADR. La v0.1 resta materiale storico invariato; i passaggi precedenti della v0.2 sono conservati con annotazioni circoscritte.

L’aggiornamento autorizzato riguarda soltanto questo ADR e i riferimenti minimi in AGENTS, MVP e v0.2. ADR-0001–ADR-0005 restano invariati. Nessun bootstrap, codice, schema, migrazione o altra implementazione è autorizzato o avviato; B2 non è approvato.

## Registro

| Data | Stato | Operazione |
| --- | --- | --- |
| 2026-09-09 | APPROVED DECISION | Registrazione del testo esplicito e del suo perimetro; aggiornamenti documentali minimi, ADR-0001–ADR-0005 invariati, B2 aperto, nessuna implementazione. |
