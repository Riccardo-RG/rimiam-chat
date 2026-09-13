# MIRIAM — MVP Specification v0.2 (Draft for Codex Review)

**Status:** Draft product specification for reconciliation with the repository  
**Date:** 2026-09-09  
**Supersedes:** `MVP_SPEC_v0.1.md` only after repository review and explicit adoption  

## 0. Purpose of this revision

MVP v0.2 clarifies a product-scope point that must not remain ambiguous during implementation:

**The MIRIAM MVP is not only a collaborative conversation and Shared Context demonstrator. It must implement the real end-to-end product loop, including governed use of Specialist Actors / Tools and a bounded set of external integrations sufficient for MIRIAM to turn shared understanding into useful action.**

The objective is to build the actual product incrementally on durable foundations. Local development is the first execution environment, not a disposable prototype. External credentials and production deployment may be wired later, but the product architecture and integration boundaries required by the MVP must be implemented as real product code.

This document intentionally preserves the approved semantics represented by ADR-0001 through ADR-0009. It does not override those ADRs. Where this draft appears to conflict with an approved ADR, the ADR governs until a new explicit decision is made.

---

## 1. Product thesis

MIRIAM is an AI-native collaborative workspace in which a group of people pursues a shared Goal while preserving continuity of context and continuity of action.

The core loop is:

**Conversation / Sources → Context Engine → Shared Context → Miriam + Humans + Specialist Actors / Tools → governed actions → results → updated Shared Context**

MIRIAM is not a chatbot with integrations attached and is not a conventional project-management system with an AI assistant added on top.

The product must allow people to collaborate naturally while MIRIAM maintains enough structured, attributable and authorized understanding to help the group progress toward its Goal.

---

## 2. Product principles

### 2.1 Conversation is the natural surface

People should be able to collaborate primarily through natural conversation and ordinary shared material. Structure should emerge when useful rather than requiring users to maintain a rigid project schema manually.

### 2.2 Goal is the north star

A Workspace may have at most one current primary Goal, with versions, historical Goals and Sub-goals as defined by ADR-0003. Goal identity, Goal adherence and authority remain distinct.

### 2.3 Shared Context is canonical collaborative state

MIRIAM maintains structured shared state derived from attributable sources and explicit acts. Current canonical state must be directly queryable and historical versions/provenance preserved.

### 2.4 Understanding is not authority

The product must preserve:

**understanding ≠ alignment ≠ authority ≠ action**

Miriam and Specialist Actors may interpret, recommend and propose. They do not silently create human agreement, authority, commitments or consequential canonical state.

### 2.5 Universal primitives, adaptive composition

MIRIAM must not be architected around predefined social or business Workspace types.

Use universal internal primitives that can compose differently as a group evolves. The same Workspace should be able to evolve from informal to structured, small to larger, peer-based to delegated/hierarchical, temporary to long-lived, and simple to complex without replacing its fundamental model.

Do not assume collaboration always follows `Goal → Workstreams → Tasks`.

### 2.6 Calm surface, rigorous internals

The internal model may preserve rich semantics, provenance, authority and history. The normal product surface should expose only what users need at the moment through progressive disclosure.

---

## 3. MVP outcome

The MVP is complete only when a small real group can use MIRIAM to:

1. create and join a shared Workspace;
2. establish and evolve a Goal;
3. converse naturally and share supported source material;
4. have Miriam interpret new activity using relevant authorized context;
5. maintain structured Shared Context with provenance and version history;
6. distinguish proposals from authoritative state;
7. surface unresolved questions, decisions, constraints, commitments, tasks and other relevant state without forcing manual project administration;
8. invoke appropriate Specialist Actors / Tools for supported capabilities;
9. authorize or confirm consequential external actions at the appropriate Commit Point;
10. execute supported external actions through real integration boundaries;
11. ingest action results back into the Workspace with provenance;
12. continue collaboration from the updated shared state.

The MVP must therefore demonstrate both:

**continuity of context** and **continuity of action**.

---

## 4. Workspace and human participation

The Workspace is the durable shared boundary for the group.

The MVP must support the approved access and participation semantics in ADR-0001 and ADR-0006 through ADR-0009, including:

- authenticated human identities;
- explicit membership;
- attributable and versioned access relationships;
- initial bootstrap access relationship;
- invitations and intended-recipient admission;
- explicit disclosure that admission grants access to retained shared Workspace history;
- explicit acceptance of membership on those terms;
- full retained shared-history visibility for active members as defined by ADR-0009;
- voluntary departure;
- authorized removal;
- re-entry through a new valid admission;
- no automatic revival of ended governance relationships;
- protected access-governance relationships and named joint conditions where adopted;
- bounded invitation delegation where supported;
- no automatic succession or creator override.

Membership does not imply Goal adherence, access-governance authority or project authority.

---

## 5. Goal and Goal continuity

Implement Goal semantics according to ADR-0001 and ADR-0003.

The MVP must support:

- initial Goal creation from explicit human intent;
- stable Goal identity with versioned intent;
- explicit Goal adherence by members;
- substantial Goal evolution with preserved history;
- creation of a new Goal identity when the main autonomous outcome changes according to ADR-0003;
- lineage between related Goals where appropriate;
- Sub-goals as verifiable intermediate outcomes when useful;
- no automatic transfer of adherence, mandates, commitments or constraints across Goal identity/version boundaries beyond what the approved semantics permit.

Miriam may propose Goal clarification or evolution but may not autonomously decide a substantial Goal change.

---

## 6. Conversation and source activity

The MVP must provide a durable shared Conversation experience.

At minimum:

- authenticated human messages;
- attributable timestamps and identities;
- durable ordering;
- realtime committed updates;
- preservation across restart/reconnect;
- meaningful Miriam contributions when appropriate;
- source references usable by provenance;
- corrections without destructive rewriting of original source history.

Conversation is not itself canonical Shared Context. It is a primary source from which Shared Context can be interpreted and updated.

---

## 7. Supported source material

The MVP must support source material beyond plain conversational text where needed to make MIRIAM genuinely useful.

At minimum the product architecture and user flow must support:

- conversational messages;
- files/documents uploaded or attached to the Workspace;
- outputs returned by supported Specialist Actors / Tools;
- relevant external-system records returned through approved integrations;
- explicit human structured commands/edits.

Files and external records remain sources. Their contents do not automatically become Accepted Information or authoritative decisions merely because they were imported.

Every source type must preserve attributable provenance sufficient to understand where derived Shared Context came from.

The exact storage provider may be wired later, but file/source identity and lifecycle boundaries used by the MVP must be real and provider-independent.

---

## 8. Shared Context semantic model

The Shared Context is the current accepted collaborative state, not a single opaque AI summary.

The MVP must support the primitives needed for real collaboration, including where applicable:

- Goal;
- Accepted Information;
- Open Question;
- Decision;
- Constraint;
- Commitment;
- Task;
- Sub-goal;
- Workstream when a semantic stream of work genuinely emerges;
- Artifact references where a living output is needed;
- relationships among relevant items;
- lifecycle/current status appropriate to each supported primitive;
- provenance and version history.

Do not force every Workspace to use every primitive.

Do not turn these into a generic arbitrary ontology or knowledge graph.

### 8.1 Attributed Statements and Accepted Information

Follow ADR-0002.

An Attributed Statement records that a source asserted something.

Accepted Information records information explicitly adopted as a working reference.

Ordinary contributing members may accept descriptive information within the editorial capability defined by ADR-0002. This does not create decision authority or permission to bind others.

### 8.2 Normative state

Decisions, Constraints and Commitments can change what people or the Workspace may/must do. They therefore require the relevant approved authority at the Commit Point.

AI confidence, evidence quantity, membership and silence do not substitute for authority.

### 8.3 Open Questions

Miriam should be able to preserve unresolved questions as first-class collaborative state when useful, including their provenance, current status and eventual resolution/supersession.

### 8.4 Tasks

Tasks represent concrete activities, not the universal structure of collaboration.

A Task may emerge from conversation, a Decision, a Commitment, a Specialist result or an explicit human request. Creating or assigning a Task must not silently create a human Commitment where one has not been authorized/accepted.

### 8.5 Workstreams

A Workstream is a semantic stream of related activity, not necessarily a separate chat/channel.

Miriam may propose Workstreams when they help organize parallel work. The MVP must not require them for simple collaboration.

### 8.6 Artifacts

Artifacts are living representations or outputs of work, such as a plan, comparison, brief, checklist, draft or research result.

The MVP needs only the minimum Artifact behavior necessary for supported end-to-end flows. Do not build a generic document platform.

---

## 9. Provenance, correction and history

Every meaningful canonical state change must remain inspectable.

The MVP must preserve:

- original sources;
- interpretation/proposal provenance;
- human acts used for acceptance/authorization;
- immutable historical versions;
- current canonical version;
- correction/supersession relationships;
- actor attribution;
- authority basis where relevant.

Corrections append new state/version history. They do not silently rewrite prior history.

Contradiction, dissent and correction must remain representable without falsely presenting earlier information as though it never existed.

---

## 10. Miriam

Miriam is a native participant and Workspace steward.

Miriam's responsibilities in the MVP include:

- interpreting new Workspace activity;
- maintaining awareness of the Goal and relevant Shared Context;
- identifying information that may matter to the group;
- identifying unresolved questions;
- identifying possible Decisions, Constraints, Commitments and Tasks;
- proposing corrections or state updates;
- noticing relevant contradictions or stale assumptions where feasible;
- helping users understand current state;
- determining when an available Specialist capability could help progress the Goal;
- proposing or initiating permitted Specialist work;
- requesting human clarification/approval when required;
- incorporating returned results into conversation/proposals/Shared Context with provenance.

Miriam does not own canonical truth merely because it generated an interpretation.

---

## 11. Context Engine

The Context Engine converts authorized Workspace history and current state into the context needed for a particular inference, Specialist task or action decision.

Follow ADR-0004.

Priority order:

1. correctness and quality;
2. Workspace continuity and comprehension;
3. provenance, authority, identity, versioning, constraints, commitments, decisions and invariants;
4. token/cost/latency efficiency.

Use the smallest reasonably sufficient authorized context.

The Context Engine should be able to select relevant portions of:

- current Goal and relevant versions;
- recent conversation;
- Accepted Information;
- Decisions;
- Constraints;
- Commitments;
- Tasks/Open Questions;
- relevant Workstreams/Sub-goals;
- relevant Artifact/source references;
- relevant prior Specialist results;
- provenance/history needed to understand current meaning;
- authority/capability information needed for the requested operation.

If the initial projection is insufficient, retrieve more authorized context.

Do not make arbitrary token/message limits correctness boundaries.

Do not send entire Workspace history by default merely because it is authorized.

PostgreSQL-first retrieval is acceptable. Vector/graph infrastructure is not an MVP requirement unless measured evidence later demonstrates a need.

---

## 12. AI provider boundary

MIRIAM must own a provider-independent AI boundary.

The provider may reason or generate structured output, but MIRIAM owns:

- context assembly;
- validation;
- actor identity;
- capability boundaries;
- authority checks;
- Commit Points;
- provenance;
- canonical state transitions;
- external-action authorization;
- retry/idempotency semantics.

Provider output is untrusted input.

Automated tests may use deterministic doubles. Production-path code must be capable of using a real configured provider without replacing domain logic.

A missing API key is an activation/configuration dependency, not a reason to replace the real product path with hardcoded demonstration behavior.

---

## 13. Specialist Actors and Tools

Specialist Actors are part of the MVP product loop.

A Specialist Actor is a bounded capability that performs work on behalf of the Workspace under MIRIAM's orchestration and the applicable authority rules.

A Specialist Actor may be implemented through an AI model, deterministic service, external API, application integration or combination thereof.

### 13.1 Required properties

Every Specialist invocation must have:

- stable invocation/work identity;
- Workspace scope;
- actor/capability identity;
- explicit task/request;
- bounded authorized context projection;
- relevant assumptions/constraints;
- provenance to the request/source state;
- lifecycle/status;
- retry/idempotency behavior where appropriate;
- result provenance;
- protection against stale execution/results;
- a governed path from result to Shared Context/action.

Specialists do not inherit human authority.

### 13.2 Workspace-owned continuity

Specialist results become Workspace-owned source/history according to their semantics. Replacing a provider or specialist implementation must not erase Workspace memory or make historical results unintelligible.

### 13.3 No generic agent framework requirement

The MVP should implement the smallest real orchestration model required for its supported Specialists.

Do not introduce an arbitrary multi-agent framework, universal agent graph or autonomous society of agents.

---

## 14. External actions and Commit Points

MIRIAM's MVP must include the ability to move from understanding to supported external action.

The lifecycle is:

**need/opportunity detected → proposed action → authority/approval validation → Commit Point → tool execution → result → provenance → Shared Context update**

### 14.1 Action classes

The implementation should distinguish at least:

- read/research operations that retrieve external information;
- draft/preparation operations that create a proposed output without external side effect;
- reversible or low-consequence external writes;
- consequential external writes requiring explicit authority/confirmation.

Do not infer permission from the fact that an integration is connected.

### 14.2 Commit Point

Authority must be validated as late as reasonably possible before the consequential external effect.

Queued or previously approved work must not retain authority that is no longer valid at execution time where current authority is required.

### 14.3 Results

Tool results must be treated as attributable external source material, not automatically canonical truth.

Miriam may summarize/interpret results and propose resulting state changes.

---

## 15. MVP integration capability set

The MVP must contain a **bounded but real** set of external capabilities sufficient to validate the full MIRIAM loop. It is not required to integrate every provider or every SaaS product.

The required capability categories are:

### 15.1 Web / external information retrieval

MIRIAM must be able to obtain current external information when a Goal requires information not contained in the Workspace.

The implementation must preserve source references/provenance and distinguish retrieved information from accepted Workspace information.

### 15.2 Files / documents

Users must be able to provide relevant files/documents to the Workspace and have Miriam use authorized relevant content as source context.

The MVP should support the minimum practical set of common document types required for real testing; exact formats/provider storage choices are implementation decisions.

### 15.3 Calendar capability

The MVP must include a real calendar integration boundary capable of supporting at least:

- reading relevant authorized calendar availability/events;
- preparing/proposing a calendar action;
- creating/updating the supported calendar event only after the applicable authorization/confirmation.

Do not assume calendar access creates project authority.

### 15.4 Email capability

The MVP must include a real email integration boundary capable of supporting at least:

- retrieving/searching authorized relevant email when explicitly useful to the Workspace;
- drafting an email from Workspace context;
- sending only through an explicit governed external-action path.

Miriam must not silently send messages merely because it can draft them.

### 15.5 Additional integrations

Additional integrations may be implemented when required by another approved MVP flow, but the MVP must not become an exhaustive connector catalogue.

Provider choice should remain replaceable behind MIRIAM-owned capability boundaries where reasonably practical.

---

## 16. Integration activation vs implementation

Implementation of an MVP integration and activation of an external provider are separate milestones.

During the BUILD phase, Codex should implement the real application boundary, domain flow, adapters/contracts, configuration validation, failure handling and deterministic tests even when credentials are unavailable.

Missing credentials must be recorded as activation requirements rather than causing the rest of MVP development to stop.

At the end of BUILD, the repository must provide an **External Services Activation Manifest** containing for every integration:

- capability name;
- selected/default provider or supported provider options;
- whether it is required for core runtime, required for a specific MVP capability, or optional;
- account the operator must create/own;
- credentials/secrets required;
- OAuth application configuration if applicable;
- scopes/permissions required;
- callback/redirect configuration;
- environment variables/secrets expected by the application;
- local-development setup;
- hosted-production setup;
- expected cost category/free-tier considerations where known;
- data/security considerations requiring operator review;
- exact verification test after activation.

No secret values belong in source control.

---

## 17. Active Work

The MVP should represent asynchronous work that matters to users separately from low-level inference jobs.

At minimum, user-relevant Specialist/tool work should expose enough lifecycle to answer:

- what is Miriam doing?;
- why is it doing it?;
- which Goal/question/task does it relate to?;
- what context/constraints govern it?;
- is it waiting for approval, running, completed, failed, stale or cancelled?;
- what result did it produce?;
- what changed because of the result?

Do not expose internal queue mechanics as product semantics.

The exact Active Work model should remain as small as the supported MVP flows allow.

---

## 18. Authority and progressive autonomy

Authority remains progressive and scoped.

The MVP must preserve approved individual mandates and named joint approvals rather than introducing generic RBAC or a policy DSL.

Miriam should be able to do more autonomously only when the consequence and granted authority justify it.

Human-in-the-loop requirements should be proportional to consequences.

Connection of a tool/account is not itself blanket authorization to use it for any purpose.

The system must preserve an inspectable basis for consequential actions.

---

## 19. Realtime, concurrency and stale work

The MVP must support collaborative realtime behavior using the simplest robust mechanism compatible with the current architecture.

Canonical writes must remain transactional.

Long-running AI/Specialist/external calls must not hold database transactions open.

Before committing an inference-derived state change or consequential action, validate the relevant current state/versions/authority so stale work cannot silently overwrite newer collaboration.

Retries must be idempotent where external APIs permit it; where an external provider cannot guarantee idempotency, MIRIAM must make duplicate-risk explicit and minimize it through provider-specific safeguards.

---

## 20. PostgreSQL canonical state

ADR-0005 governs persistence.

PostgreSQL is the authoritative domain system of record for the MVP.

Current canonical state must be directly queryable.

Preserve source/version/provenance/relevant transition history immutably.

AI output, queues, caches, vector indexes and external providers do not become the authoritative domain store.

External provider identifiers needed to correlate actions/results should be stored as integration references with Workspace provenance, not used as replacements for MIRIAM domain identities.

---

## 21. Security and privacy baseline

Security/privacy are foundational rather than a post-MVP cosmetic phase.

The MVP must include at least:

- server-side authentication boundaries;
- Workspace isolation;
- least-privilege access to external integrations;
- encrypted transport in hosted operation;
- secrets outside source control;
- safe rendering/handling of untrusted source/model/tool content;
- no model access to raw credentials;
- prompt/tool output unable to bypass domain authorization;
- audit/provenance for consequential external actions;
- bounded request/AI/tool usage controls appropriate for the beta;
- provider/data-retention implications documented before real private data is used.

Do not claim legal/compliance guarantees that have not been established.

---

## 22. User experience requirements

The MVP UI must be usable as a real collaborative product even if visual polish remains incomplete.

A user should be able to understand:

- the current Goal;
- the Conversation;
- what Miriam is contributing;
- what Miriam believes has emerged;
- what is proposed versus accepted/authoritative;
- relevant current Decisions, Constraints, Commitments, Tasks and Open Questions;
- relevant Active Work;
- when Miriam wants to use an external capability;
- what approval is required before an external action;
- what an external action produced;
- provenance/history when the user asks why;
- corrections and superseded state.

Avoid presenting the full internal ontology/governance machinery by default.

---

## 23. MVP end-to-end acceptance scenarios

The final MVP must be verified through coherent scenarios, not only isolated tables/endpoints.

### Scenario A — Shared understanding

Two users join a Workspace, establish/adopt a Goal, converse, Miriam identifies relevant information and an Open Question, a member accepts descriptive information, and provenance is inspectable.

### Scenario B — Consequential collaborative state

Conversation produces a proposed Decision/Constraint/Commitment. MIRIAM does not silently canonicalize it. The required authorized act occurs, canonical state changes, and the authority/provenance basis is inspectable.

### Scenario C — Correction

A previously accepted interpretation is corrected. Current state advances to a new version while prior source/version/history remain inspectable.

### Scenario D — Specialist research

A Goal/Open Question requires information outside the Workspace. Miriam proposes/initiates an authorized research capability, passes minimum sufficient context, receives attributable results, presents them to users and updates Shared Context only through the appropriate acceptance semantics.

### Scenario E — File-informed collaboration

A user provides a document. Miriam uses relevant authorized content, cites/provides provenance to the file/source, and does not automatically treat every document assertion as accepted truth.

### Scenario F — Calendar action

Workspace context establishes a legitimate need for scheduling. Miriam obtains permitted calendar information, proposes an event/action, obtains required confirmation, executes through the integration, records the result and reflects it back into Workspace state.

### Scenario G — Email action

Miriam uses Workspace context to prepare an email, clearly distinguishes draft from send, requires the applicable explicit action/authority, sends through the configured integration, and records attributable outcome/provenance.

### Scenario H — Stale/invalid action protection

A proposed or queued action becomes stale because relevant state/authority changes. MIRIAM blocks or revalidates rather than executing under obsolete assumptions.

### Scenario I — Multi-user continuity

Users disconnect/reconnect, services restart, and current state/history remain consistent. Realtime delivery catches up from durable state rather than becoming the source of truth.

---

## 24. Build, Wire, Verify, Deploy

MVP development follows four distinct phases.

### Phase 1 — BUILD

Implement the entire approved MVP in the real codebase on durable foundations.

External integrations may use deterministic doubles for automated testing while credentials are unavailable, but their production-path boundaries and adapters must be real.

Do not stop the entire BUILD phase merely because an external credential is missing. Record the dependency and continue with other implementable work.

### Phase 2 — WIRE

After BUILD reaches the implementation gate, configure the real external services using the External Services Activation Manifest.

This is when the operator provides required accounts, API keys, OAuth applications, secrets, billing authorization and other external configuration.

### Phase 3 — VERIFY

Run real-provider integration tests and manual product acceptance using the actual configured services.

Fix integration defects without changing approved product semantics merely to accommodate provider quirks.

### Phase 4 — DEPLOY

Move the same product foundations to hosted infrastructure and installable/web clients for the Private Online Beta.

Deployment is not a rewrite of the MVP.

---

## 25. Local implementation gate before online beta

Before hosted deployment/distribution, the implementation should reach a consistent local gate where everything not inherently dependent on external activation is implemented and tested.

At this gate Codex must report:

### MVP coverage

For every meaningful requirement:

- implemented and locally verified;
- implemented but awaiting external activation;
- partially implemented, with exact missing behavior;
- explicitly deferred by this specification/ADR;
- blocked by a genuine unresolved decision.

### External Services Activation Manifest

Provide the complete manifest described in §16.

### Verification

Include:

- formatting/lint/typecheck/build;
- unit/domain tests;
- PostgreSQL integration tests;
- multi-user E2E;
- Workspace isolation;
- authority/Commit Point tests;
- provenance/versioning/correction;
- idempotency/stale-work tests;
- Specialist/tool orchestration tests;
- external integration contract tests using deterministic doubles/sandboxes where available;
- fresh database migration/startup;
- restart/reconnect persistence.

Do not label an external capability "real-provider verified" until it has actually been activated and exercised against the provider.

---

## 26. Private Online Beta target

After BUILD/WIRE/VERIFY, MIRIAM should be deployable as a private beta that the initial users can use without the developer computer being online.

The target includes:

- hosted MIRIAM application/backend;
- hosted PostgreSQL;
- real authentication suitable for the beta;
- configured real AI provider;
- configured required external integrations;
- secure secret management;
- persistent/reliable background work;
- installable primary client and/or client strategy chosen for the actual target devices;
- web access where appropriate;
- deployment/update procedure;
- basic operational logging/health/recovery appropriate to a private beta.

Hosting/vendor selection is an implementation/deployment decision unless it changes product semantics or creates an expensive lock-in requiring explicit review.

---

## 27. Explicit non-goals / deferred generalization

The MVP does **not** require:

- integrations with every productivity/SaaS service;
- a public integration marketplace;
- a generic no-code workflow builder;
- generic RBAC;
- a general policy/governance DSL;
- arbitrary delegation graphs;
- a universal agent framework;
- autonomous unbounded multi-agent behavior;
- full event sourcing;
- microservices by default;
- Kafka or distributed event infrastructure without measured need;
- CRDTs without measured need;
- a vector database by default;
- a knowledge graph by default;
- historical per-member ACL cutoffs;
- private subgroup/channel architecture;
- automatic governance succession;
- exceptional governance recovery;
- a full office/document suite;
- production architecture optimized prematurely for massive scale.

These exclusions do not remove the concrete Specialist/tool/external-action capabilities explicitly included in this MVP.

---

## 28. Development rule for Codex

Codex should treat this specification and approved ADRs as requirements for the actual product.

Implementation should proceed autonomously in vertical increments.

Do not stop for routine engineering choices or missing external credentials when other MVP work can continue.

Stop only when:

1. a genuine product/domain decision is missing and blocks correct implementation;
2. approved requirements materially conflict;
3. proceeding requires an expensive-to-reverse foundational choice not covered by approved decisions;
4. an external action itself requires the operator's personal authorization and cannot be deferred while other work continues;
5. continuing would require disproportionate context/token cost with uncertain value.

When credentials/services are missing, implement to the real boundary, test with deterministic substitutes, add the dependency to the Activation Manifest, and continue.

---

## 29. Definition of done for MVP v0.2

MVP v0.2 is not done because individual primitives exist in the database.

It is done when the implemented product demonstrates a coherent, durable and governed loop:

**people + Goal + Conversation/Sources  
→ Miriam understanding  
→ Shared Context  
→ unresolved work/opportunity  
→ Specialist/Tool capability  
→ appropriate human authority/Commit Point  
→ external action/result  
→ provenance  
→ updated Shared Context  
→ continued collaboration**

and does so while preserving the approved access, authority, Goal, information, history, provenance and Context Efficiency semantics.

The MVP is the first real version of MIRIAM, not a demonstration that will later be replaced.

---

## 30. Reconciliation note before adoption

This draft intentionally expands/clarifies the MVP scope to include concrete Specialist Actors, external actions, files, web retrieval, calendar and email capability categories.

Before replacing `MVP_SPEC_v0.1.md`, Codex must compare this draft against the current repository's complete v0.1 specification and ADR-0001 through ADR-0009 and report only:

- requirements preserved unchanged;
- requirements clarified;
- genuinely new requirements introduced by v0.2;
- conflicts, if any, with approved ADRs;
- any new foundational decision that should receive its own ADR rather than being hidden inside the MVP spec.

Do not silently weaken or delete an existing v0.1 requirement during reconciliation.
