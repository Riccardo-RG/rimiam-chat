# ADR-0010 — Client nativi e backend autorevole comune

## Stato e provenance

- **Stato:** APPROVED DECISION — architetturale, FOUNDATIONAL / COSTLY TO CHANGE.
- **Data:** 2026-09-10 (Europe/Rome). **Versione:** 1.
- **Approvata da:** utente; registrata da Codex su richiesta esplicita.
- **Fonte primaria:** brief `0216c55a-6338-4e83-879d-75eaab6bac04/pasted-text.txt`, conversazione `01a082d6-6a10-7d30-8e76-71c7928fcb96`, sezione «Direzione approvata».
- **Relazioni:** integra [la specifica canonica](../product/MVP_SPEC_v0.1.md) e [ADR-0005](ADR-0005-postgresql-stato-canonico-storia-provenance.md). ADR-0001–0009 rimangono invariati.

## Direzione approvata

Testo del brief, conservato senza estendere il perimetro dell’approvazione:

> * iOS: Swift + SwiftUI
> * Android: Kotlin + Jetpack Compose
> * Web: Next.js
> * backend autorevole comune: TypeScript/Node + PostgreSQL
> * niente KMP per ora
> * i client condividono contratto e comportamento, non necessariamente implementazione
> * canonical state, authority, provenance, Context Engine, Commit Points, Specialists e integrazioni restano server-side

## Contesto e motivazione

Il mobile è il client primario. Qualità tecnica, integrazione nativa e durata precedono velocità iniziale e massima condivisione del codice. L’implementazione esistente contiene servizi Node/PostgreSQL riutilizzabili e una UI web Next.js: renderli accessibili attraverso un contratto pubblico comune preserva quel lavoro senza rendere Next.js il confine implicito del prodotto.

SwiftUI e Compose usano progetti e toolchain standard delle rispettive piattaforme. React Native e un livello cross-platform non fanno parte di questa direzione; KMP potrà essere rivalutato con un beneficio concreto, non per condividere codice fine a sé stesso.

## Conseguenze e limiti

- UI, networking, session storage e lifecycle sono responsabilità dei client; accesso, authority e transizioni canoniche sono verificati sul server. Cache e bozze locali non sono stato autorevole.
- Contratti pubblici, errori, compatibilità delle versioni, recupero dei comandi e sync devono essere verificabili indipendentemente da Next.js. I client nativi non indeboliscono le protezioni cookie/origin/CSRF web.
- Si mantengono comandi transazionali, SQL, storia e invarianti esistenti. Il backend resta un monolite modulare con worker, senza microservizi o riscrittura architetturale.
- Due UI native comportano implementazioni e verifiche distinte. Il vantaggio è il controllo diretto dell’integrazione e del comportamento sulle due piattaforme; migrare successivamente le UI avrebbe un costo significativo.
- Il brief autorizza il BUILD progressivo: boundary multi-client, primo slice nativo verificato, poi Calendar e Workspace Email. Non autorizza account, costi, servizi cloud o effetti esterni sensibili.
- Questo ADR non ratifica altri dettagli della proposta v0.2, non introduce nuovi poteri, non definisce un modello offline autorevole e non approva provider, deployment o nuove policy di Calendar/Email. Dettagli reversibili del trasporto sono documentati nel contratto implementato.

## Raffinamento della proposta

**V0.2 §§3–4 e 17–18 — REFINED:** Next.js è il client web e può ospitare un adattatore HTTP; il backend autorevole e il contratto comune sono indipendenti dal suo lifecycle/build. La proposta rimane storica/provvisoria per le scelte non approvate. Non viene creata una nuova versione architetturale.
