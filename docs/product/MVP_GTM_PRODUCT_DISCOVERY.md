# RIMIAM GTM / Product Discovery Canon (MVP-aligned)

Last editorial update: 2026-10-07 (current delivery references; approved scope remains through ADR-0015, with no new product or commercial approval).

## Scope and intent

This document is the canonical place for product-discovery direction, GTM assumptions and commercialization-facing choices. It references approved product/architecture boundaries in ADRs and `MVP_SPEC_v0.1.md`; it does not independently approve new domain semantics or turn beta hypotheses into validated outcomes.

Repository naming used here remains **MIRIAM** for paths and packages; user-facing product naming is **RIMIAM**.

Current delivery status: the local MVP foundation is closed, including voice/calling. This is not a claim of live-provider availability, release readiness or validated product-market fit. [STATUS](../development/STATUS.md) owns implementation/verification evidence; [DEPLOY_EXTERNAL_SERVICES](../development/DEPLOY_EXTERNAL_SERVICES.md) owns provisioning and live checks. Follow STATUS for the current sequence: the Web redesign is implemented, native presentation alignment is temporarily deferred during Web testing, and an additional Claude Design pass is not a prerequisite. GTM promises must distinguish implemented capability from activated and validated experience.

## DECIDED GTM DIRECTION

### 1) RIMIAM positioning

RIMIAM is a shared conversational workspace where people can talk, build, research, and decide together while having a third-party collaborative intelligence present in the same shared space.

- Keep this as the explicit external positioning.
- Do **not** reframe it as:
  - task manager only,
  - AI chatbot wrapper,
  - document manager-first tool,
  - social network,
  - dashboard of integrations.
- Group size and sector are configuration of use, not domain type.

**Canonical mapping:** `MVP §1`, `MVP §2`, `ADR-0014`.

### 2) Initial GTM wedge

Primary beta wedge: two real people in one active, unstructured project.

- shared Goal, repeated interaction, and conversational continuity are the primary value test.
- startup/founder vocabulary must not harden into domain model.
- no fixed “creator-only” setup rituals in the first-run path.

**Canonical mapping:** `ADR-0001`, `ADR-0003`, `ADR-0006/7/9`, `MVP §1`.

### 3) Activation loop (group value loop)

Expected loop: invite → converse → shared continuity → pause → return → continue. The strongest quality signal is group return and continuity quality.

- The interface should privilege natural conversation and continuity more than feature-first action panels.

**Canonical mapping:** `MVP §2`, `ADR-0014`.

### 4) Recap behavior

After meaningful interaction windows, Miriam can prepare a concise recap within the explicit participation preference and applicable source permissions. It may include summary, open questions, emerging sub-goals, and follow-up suggestions.

- Separate “human said/decided” from “Miriam inferred/recommended”.
- Scale detail to the relevance and confidence of the conversation segment.
- Human call recordings are an explicit exception to automatic recap: recording/transcription consent does not authorize analysis. A separate post-call request is required; neither recap cadence nor proactive mode can bypass it. See section 11 and ADR-0015.

**Canonical mapping:** `ADR-0002`, `ADR-0014`, `ADR-0015`, `MVP §2.3/3`.

### 5) One compact work surface

Conversation is the home surface. Meaningful background/initiative visibility uses a compact activity surface (pill/stack/panel), not a verbose internal telemetry stream.

- Mobile-first behavior and dismissible/noise thresholds are adjustable product controls.

**Canonical mapping:** `ADR-0014`, `MVP §2.2`, `MVP §16`, `MVP §19.1`.

### 6) Participation and intervention preference

RIMIAM should be visibly present but calm by default.

- default mode: intervene when explicitly called,
- optional more collaborative mode: explicit opt-in for proactive participation,
- do not infer consent from silence.

**Canonical mapping:** `ADR-0014`, `MVP §10`, `MVP §2.2`.

### 7) Guided conversational onboarding

New workspace activation should be lightweight and human-first.

- brief, contextual welcome message,
- explicit explanation of Miriam as shared continuity helper,
- avoid governance-heavy onboarding before relevance.

**Canonical mapping:** `ADR-0001`, `MVP §2.1/2.2`.

### 8) Home / first-run

Home must teach the model: shared workspace, collaboration, Miriam as participant, and continuity mechanics.

- should be product-explanatory, not a dashboard listing.

**Canonical mapping:** `MVP §2.2`, `MVP §6`.

### 9) Invitation and growth mechanics

Preferred for beta: private invitation link + email.

- no social graph or contact import by default,
- no anonymous public room behavior.

**Canonical mapping:** `ADR-0006` `ADR-0007` `MVP §12`.

### 10) Web/native distribution

Mobile is the primary client: native iOS and Android. Web also delivers core value without forcing native installation; it is not the product's primary architecture or a prerequisite for using the native clients.

- Conversation voice, RIMIAM voice dialogue and human audio calls belong to the scope on all three clients, with common server semantics. They are not native-only upsells.
- Native integration supports device interaction and in-call lifecycle. Outbound push and incoming calls to a terminated app remain outside the current MVP; do not advertise them as implemented.

**Canonical mapping:** [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md), [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md).

### 11) Voice and human calls — approved scope

The approved experience has three distinct modes: voice messages in Conversation; voice dialogue with RIMIAM using the same Workspace Context; and human-to-human Workspace audio calls. RIMIAM does not join or speak live in human calls.

Any authenticated call participant may request recording. Capture requires every captured participant's explicit personal consent covering recording, transcription, shared-source retention and ADR-0009 history visibility. New arrivals and withdrawal follow the approved capture safeguards; withdrawal does not automatically erase previously authorized material. The complete rule remains in [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md).

Product flow: human call → authorized recording/transcript → separately requested RIMIAM analysis → recap/candidates → existing governed adoption/action boundaries. Raw material remains distinct from operational Context, selected under Minimum Sufficient Context. A transcript or recap does not establish Accepted Information, responsibility, commitments or permission to act.

This adds no pricing, entitlement or retention/deletion policy. Live quality, consent UX and cross-device reliability remain validation work, not proven GTM claims. Implemented boundary and limits: [VOICE_CALLS](../development/VOICE_CALLS.md).

## PRODUCT / UX IMPLICATIONS

### Decided product behavior (within the approved scope)

These are experience criteria, not authorization for another BUILD. Current implementation and pending acceptance remain in STATUS.

- Conversation-centric homepage and workspace.
- compact activity status surface and progressive capability disclosure.
- preference-gated proactive initiative.
- continuation-first UX (returning to prior state is key).
- no social-feed abstractions or group-admin-like defaults.

### Compatible implementation choices

- keep existing domain model and capability boundaries.
- keep Home/composition layered so capabilities stay hidden until contextually relevant.
- preserve transparent provenance and approval trail for all state transitions.

### Conflicts to monitor against existing approvals

- richer voice interactions must remain additive and deterministic authority-safe.
- recap quality improvements must not create automatic state adoption.
- activity surfacing must not expose private model internals.

## DEVELOPMENT IMPLICATIONS

### Required from now on

1. Keep ADR/proxy semantic boundaries as hard constraints when implementing activity/continuity UX.
2. Route governed state changes and consequential actions through their existing capability/governance and Commit Points; presenting work or a recap does not itself adopt state.
3. Preserve server-side enforcement of authority/isolation before any UI affordance expansion.
4. Prefer configuration-driven defaults for participation mode, recap cadence, and activity hints.

### Non-goals for current architecture

- no social network model,
- no recommendation engine as default product core,
- no enterprise-grade billing workflow before core continuation quality.

## BETA HYPOTHESES (to validate with real groups)

### Operational hypotheses

- second-session retention,
- co-founder pair engagement,
- natural return without manual re-synthesis,
- intervention timing quality,
- low-friction recap usefulness.

### Product hypotheses

- compact activity surface perceived as useful,
- guided start increases perceived clarity,
- simple invitation loop is enough for first real cohorts.

### Measurement strategy (lightweight)

No invasive analytics by default. Track product-signals from existing logs/tests and manual observations:

- repeat session rates,
- return after inactivity,
- unresolved-control conflict recovery,
- intervention appropriateness (not noise-heavy).

For voice/calling, observe whether people understand who is speaking, when recording is active, what becomes shared history and why analysis is a separate request. Validate useful voice dialogue and post-call analysis only with configured real providers and explicit consents. These are beta observations; no new analytics/evaluation architecture is approved. Behavioral evaluation remains the non-normative direction in [MVP §19.1](MVP_SPEC_v0.1.md#191-direzione-futura-valutazioni-comportamentali).

## LATER / OPTIONAL IDEAS (not for MVP, non-founding)

- premium usage/entitlement model,
- social discovery/contact graph,
- advanced campaign/CRM/recommendation surfaces,
- broad automation suites,
- advanced analytics dashboards,
- enterprise account complexity.

These remain strategic experiments.

## OPEN QUESTIONS (not yet foundational decisions)

1. Future deletion/lifecycle policies beyond the approved retention and prospective withdrawal rule. Voice messages, RIMIAM voice dialogue and human audio calls themselves are already approved in ADR-0015; they are no longer open scope questions.
2. Whether a general session-level digest is auto-on or user controlled. This cannot alter the separately requested post-call analysis rule.
3. How many configurable workspace/nested-context primitives are needed before beta risk of confusion rises.
4. Concrete commercial pricing anchors and entitlements after first provider-behavior validation.

These remaining questions do not reopen ADR-0015 or block the closed foundation. No further domain or commercial decision is approved here.

## FOUNDATIONAL VS IMPLEMENTATION RECONCILIATION MAP

For each discovery line above, classify it for execution planning:

### Already represented in existing canon (no new decision needed)

- Conversation-first collaborative posture and non-chatbot identity: `MVP_SPEC v0.1`, `ADR-0014`, `ADR-0001`.
- No silent authority from silence/activity, no social/network model, no project-owner semantics: `ADR-0001`, `ADR-0006`, `ADR-0007`, `ADR-0014`.
- Compact shared context and explicit acceptance/approval/authority boundaries: `MVP_SPEC v0.1`, `ADR-0002`, `ADR-0014`, `ADR-0013`.
- Server-side authority/security baseline and workspace isolation: `AGENTS`, `MVP_SPEC v0.1`, `ADR-0006`..`0009`.
- Voice modes, personal recording consent, shared history and separately requested post-call analysis: `ADR-0015`, `MVP §2.5/3.5/13/15`.

### Compatible refinements (implementable under current approvals)

- Product loop as recurring group continuity (invite + converse + return): already aligned with the MVP continuity model; mostly UX/priority ordering.
- Compact activity surface (pill/stack + status updates): direct implementation choice in the conversation shell, constrained by `ADR-0014`.
- Guided lightweight onboarding as natural conversation: compatible with current startup semantics; avoid exposing governance too early.
- Single conversational home with capability sections disclosed progressively: compatible with `MVP_SPEC v0.1` and `ADR-0010`.
- Home/first-run education (mobile-primary, useful web access without mandatory installation): compatible with ADR-0010, without assigning different governance or voice scope to the clients.
- Private invite + email invite without social graph/public room: compatible with existing access model; implementation detail.

### Implementation-only choices (keep configurable)

- Participation mode, recap timing/cadence, activity-threshold tuning, and presence surfaces may be tuned within approved defaults and explicit opt-ins. Configuration cannot grant consent, authority or automatic call analysis.
- Related-space navigation is implemented without inheritance. Context disclosure, refresh and authority semantics for any future child projection require explicit review before implementation; they are not ordinary configuration.
- Audio capture, playback and presentation reuse the approved voice/source boundaries. Device TTS and transport choices are implementation details; personal recording consent and the separate analysis request are product invariants under ADR-0015, not configuration switches.
- Recap format/content and digest defaults are tuning choices, not product invariants, if aligned with provenance and separation of inference vs adoption.

### GTM-only hypotheses / non-founding assumptions

- Premium value proposition, pricing anchors, and first-beta cohort composition.
- Exact commercial limits (`minutes`, `search`, storage) and usage quotas (must remain config-driven).
- Which beta signals are primary for launch-time decisions.
- Strong claims about initial segment success until a small real cohort is observed.

### Potentially conflicting/new foundational questions (for future explicit review only)

- Different deletion/lifecycle semantics, video or RIMIAM live participation in human calls would require separate scope/review. The voice/calling scope approved in ADR-0015 needs no renewed foundational approval.
- Parent/sub-context semantics and selective inheritance rules remain unapproved. Minimal navigation links are supported only between currently accessible Workspaces; they do not copy Context, grant access or establish a parent/child domain relationship.
- External production provider readiness in beta (AI, transcription, search, Calendar/Email, account/invitation delivery, calling/storage): activation and verification work in the deployment guide, not an unresolved domain decision.

## Why this does not require immediate new ADRs

This alignment applies existing approvals and preserves the distinction between product direction, implementation and beta hypotheses. ADR-0015 already records the voice/consent foundation; no additional ADR is needed to repeat it. New foundational semantics require their own approval, while provider activation and final design do not reopen the approved model.

## Link map

- [MVP canonical spec](MVP_SPEC_v0.1.md).
- [Historical draft reconciliation](MVP_V0.2_RECONCILIATION.md).
- Decision set: `../decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md`, `../decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md`, `../decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md`, `../decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md`, `../decisions/ADR-0014-active-work-specialist-contribution.md`.
- Client strategy: `../decisions/ADR-0010-client-nativi-backend-comune.md`.
- Active Work: `../development/ACTIVE_WORK.md` and `../development/ACTIVE_WORK_GATE.md`.
- [Voice/calling decision](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md), [current checkpoint](../development/STATUS.md), [activation/deployment guide](../development/DEPLOY_EXTERNAL_SERVICES.md).
