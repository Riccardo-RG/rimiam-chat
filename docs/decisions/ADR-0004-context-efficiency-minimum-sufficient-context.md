# ADR-0004 — Context Efficiency / Minimum Sufficient Context

## Stato e provenance

- **Stato:** APPROVED — principio trasversale architetturale e di prodotto.
- **Data di approvazione e registrazione:** 2026-09-09 (Europe/Rome).
- **Versione:** 1.
- **Approvato da:** utente, mediante approvazione formale e testo completo fornito nella conversazione Codex sul progetto MIRIAM.
- **Registrato da:** Codex, su richiesta dell’utente.
- **Conversazione sorgente:** `01a082d6-6a10-7d30-8e76-71c7928fcb96`, già identificata negli ADR precedenti.
- **Relazioni:** coerente con [ADR-0001](ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), [ADR-0002](ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md) e [ADR-0003](ADR-0003-lifecycle-goal-continuita-relazioni.md), che restano invariati.

L’approvazione segue la verifica delle coperture e lacune documentali, senza progettazione tecnica. Atto esplicito dell’utente:

> Approvo formalmente il principio trasversale **Context Efficiency / Minimum Sufficient Context**.

L’utente ha fornito il testo normativo seguente e autorizzato esclusivamente la sua registrazione con sintesi e riferimenti mirati; nessuna strategia tecnica o budget specifico è approvato.

## Testo esatto approvato

**Context Efficiency / Minimum Sufficient Context**

MIRIAM deve cercare di utilizzare, per ogni inferenza, operazione AI o Specialist Actor, il contesto più piccolo ragionevolmente sufficiente per svolgere correttamente il task, evitando duplicazioni, informazioni irrilevanti e consumo inutile di token, costo e latenza.

“Minimum” non significa il minor numero possibile di token. Significa il minimo contesto che preserva una qualità e una sicurezza adeguate al task.

L’ordine di priorità è:

1. correttezza e qualità del risultato;
2. continuità e comprensione del Workspace;
3. rispetto di provenance, identity/versioning, authority, adesioni, constraints, commitments, decisions e degli altri invarianti approvati;
4. efficienza di context/token usage, costo e latenza.

L’efficienza non può giustificare l’omissione di informazioni necessarie né degradare materialmente la qualità o aumentare il rischio di errore.

Quando il contesto inizialmente selezionato risulta insufficiente, ambiguo o introduce un rischio materiale di errore, MIRIAM deve poter recuperare ulteriore contesto pertinente, entro i confini di accesso e authority applicabili.

La selezione, sintesi o compressione del contesto non deve cancellare provenance, qualificazioni epistemiche, versioni rilevanti, dissenso o presupposti necessari per interpretare correttamente l’informazione.

Budget come numero di messaggi, versioni o token possono essere utilizzati come euristiche/configurazioni operative, ma non devono essere trattati come tetti universali che prevalgono sulla sufficienza del contesto. In particolare, i valori illustrativi presenti nella proposta architetturale v0.2, inclusi 12 messaggi, 20 versioni e 8.000 token, non costituiscono limiti di prodotto approvati.

Questo principio non approva una specifica strategia tecnica di retrieval, caching, summarization, compression, model routing o prompt construction. Tali scelte verranno definite successivamente.

## Motivazione e raffinamenti

Il principio rende esplicita la priorità della sufficienza rispetto all’efficienza, già implicita nel Context incrementale e nella Context Projection del [MVP, §§2.4 e 12.2](../product/MVP_SPEC_v0.1.md). Vale per tutte le operazioni AI, senza trasformare la minimizzazione dei token in un obiettivo che comprometta qualità, continuità o invarianti.

**REFINED — proposta v0.2, §9:** i budget illustrativi restano euristiche configurabili subordinate alla sufficienza, non limiti di prodotto approvati. La condizione di arresto `Needs Input` per il solo superamento del budget, richiamata anche nel §20, non prevale sulla possibilità di recuperare altro contesto pertinente entro accesso e authority applicabili. Il testo precedente è conservato e qualificato da una nota nel [§9 della proposta](../architecture/ARCHITECTURE_PROPOSAL_v0.2.md#minimum-relevant-context).

Non sono emerse contraddizioni sostanziali con i tre ADR precedenti. Questo record non seleziona schema, retrieval architecture, caching, summarization, compression, model routing, prompt construction o budget; non avvia implementazione.

