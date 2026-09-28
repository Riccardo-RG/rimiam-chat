# Allinagent repository instructions

## Source of truth

Read [docs/product/MVP_SPEC_v0.1.md](docs/product/MVP_SPEC_v0.1.md) before product or domain changes. It is the canonical product source of truth. If implementation convenience conflicts with a product invariant, preserve the invariant and surface the conflict.

For initial Goal, first authority and progressive authority setup, also read the exact approved [Decision 1 / ADR-0001](docs/decisions/ADR-0001-prima-authority-goal-iniziale-setup-progressivo.md), approved on 2026-09-08 and incorporated into the specification. Its scoped supersessions are explicit in the ADR. This product approval does not approve the remaining architecture proposals or authorize implementation.

For attributed statements, Accepted Information and commitments, read [Decision 2 / ADR-0002](docs/decisions/ADR-0002-affermazioni-attribuite-informazioni-accettate-impegni.md), approved on 2026-09-09. Editorial acceptance is a base product capability for contributing members, not decision authority or an ADR-0001 mandate; it cannot create or modify commitments or operational permissions.

Preserve the specification's distinctions between confirmed decisions, recommendations, open questions and future scope. Build order does not itself authorize implementation. The user’s 2026-09-09 BUILD brief authorizes progressive MVP development with the v0.2 draft as intended evolution, preserving approved semantics; see [reconciliation](docs/product/MVP_V0.2_RECONCILIATION.md), [continuation checkpoint](docs/development/STATUS.md) and README for actual scope. Service activation and cloud deployment remain separate.

## Product identity

Allinagent is an AI-native collaborative workspace. It is not primarily a chatbot, generic AI assistant, project-management app or multi-bot chat application. Conversation is the main human interface while the workspace maintains persistent, structured, inspectable and actionable shared state. Miriam is the native collaborative intelligence of the workspace.

## Core product invariants

1. One collaborative workspace has one canonical Shared Context. In the MVP, private conversations with Miriam belong in a separate space with its own Context; there is no hidden per-member memory inside a shared space.
2. Raw conversation/events are historical source material and must not be silently rewritten by derived or canonical state.
3. Shared Context is persistent, versioned, inspectable and correctable.
4. Important inferred state must retain provenance, including its sources and relevant history.
5. Understanding does not imply agreement, authority or permission to act. Silence and absence of opposition are not consent.
6. Evidence does not automatically become Shared Context truth. Accepting evidence and authorizing resulting Artifact changes or external actions are distinct governance steps.
7. Context processing must be incremental; do not repeatedly reinterpret the entire conversation as the normal processing path.
8. Semantic organization must not require physically moving or duplicating historical conversation events. One event may belong to multiple Workstreams.
9. Context, history and decisions belong to the workspace, not to Miriam or another agent. Agents are replaceable; workspace memory is durable.
10. AI provider/model choices must not become domain concepts.
11. Consequential actions must respect scoped authority boundaries and Commit Points. When authority is already established, follow the Action Policy; ask only when authority is unresolved. Observed responsibility is not delegated authority.
12. Destructive changes must be conservative and recoverable/versioned where applicable; destructive or high-impact operations require confirmation and recovery/history as specified.
13. Security, workspace isolation and authorization are foundational requirements, including when advanced enterprise governance is outside MVP scope.
14. At most one primary Goal is current per Workspace; preserve past identities. Follow [ADR-0003](docs/decisions/ADR-0003-lifecycle-goal-continuita-relazioni.md): substantial same/new-identity classification belongs to the authorized Goal-change act; it neither transfers consent nor overrides authority over existing constraints or commitments.
15. Apply [Minimum Sufficient Context / ADR-0004](docs/decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md) to all AI work: quality, continuity and approved invariants precede token/cost/latency efficiency; allow additional relevant context within access/authority bounds when needed. Numerical budgets are heuristics, not universal product caps.
16. Follow [ADR-0005](docs/decisions/ADR-0005-postgresql-stato-canonico-storia-provenance.md): PostgreSQL owns directly queryable current domain state and immutable source/version/provenance history; validate application commands and commit domain-atomic changes transactionally. Full event sourcing is not the MVP foundation; exact schema remains an implementation choice constrained by approved semantics.
17. Follow [ADR-0006](docs/decisions/ADR-0006-accesso-workspace-capability-relazioni-authority.md): access operations and authority to change access relationships are distinct; preserve relationship-specific protections, provenance and separate account eligibility/project authority. No permanent creator privilege or governance from group labels.
18. Follow [ADR-0007](docs/decisions/ADR-0007-bootstrap-accesso-uscita-volontaria-continuita-workspace.md): creation establishes a normal access relationship, not a creator override. Allow voluntary exit/relinquishment without a successor; missing governance blocks only operations requiring unavailable authority. No automatic succession or Workspace closure/archive/delete; pending succession cannot activate after its sole authorizing basis ends.
19. Follow [ADR-0008](docs/decisions/ADR-0008-governance-accesso-protetta-condizioni-congiunte-rinuncia.md): validate access changes against pre-transition conditions and all affected protections, including membership/capability bypasses. Self-withdrawal does not rewrite others’ terms; ended participation can leave joint authorization unavailable, never reduced or exercisable by a former holder. Operational delegation grants no peer protection or onward delegation.
20. Follow [ADR-0009](docs/decisions/ADR-0009-visibilita-storica-membri-confine-condiviso-workspace.md): eligible active human membership includes retained shared history without join-time cutoffs, as an explicit admission consequence; re-entry revives no ended governance. Apply the approved [B2 product policy](docs/product/MVP_SPEC_v0.1.md#141-policy-operativa-b2-approvata). B2 is sufficiently resolved for MVP implementation planning; this does not authorize implementation.

Keep these domain distinctions explicit: Conversation vs Shared Context; raw events vs derived/canonical state; Evidence vs Truth; Understanding vs Authority; Workstream vs Sub-goal; Miriam vs Specialist Actors; Shared Context vs Current State; Contribution vs Shared State; Active Work vs a simple chat response. Current State is a projection of Shared Context. Contributions pass through workspace governance. Active Work follows [ADR-0014](docs/decisions/ADR-0014-active-work-specialist-contribution.md): shared steering never enlarges authority; preserve relevant state, anchored assumptions and unresolved restrictions. Semantic approval alone does not authorize BUILD.

Approved client direction: [ADR-0010](docs/decisions/ADR-0010-client-nativi-backend-comune.md). Keep SwiftUI, Compose and Next.js clients behind the same versioned server contract; no client owns canonical state or authority.

Calendar follows [ADR-0011](docs/decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md): temporal state, private observations and authorized external effects are separate; preserve identity/provenance and unknown outcomes, with no automatic propagation or inferred representation.

Email follows [ADR-0012](docs/decisions/ADR-0012-workspace-email-privacy-bozze-invio.md): private mailbox access, explicit disclosure, versioned drafts and exact self-authorized sends are separate; preserve uncertain outcomes and never resend blindly.

Tasks/follow-up follow [ADR-0013](docs/decisions/ADR-0013-task-responsabilita-follow-up.md): explicit version-bound responsibility is distinct from work, commitments and authority; material changes need fresh acceptance or valid pertinent authority, and reminders/closure never imply normative effects.

Voice/calls follow [ADR-0015](docs/decisions/ADR-0015-voce-chiamate-consenso-registrazione.md): recording requires every captured participant’s explicit personal consent to audio, transcription and shared-history retention; withdrawal fences subsequent capture. RIMIAM is absent from human calls; post-call analysis requires a separate request and never implies adoption or authority.

## Engineering principles

These are defaults, not a final architecture decision:

- Prefer the simplest architecture that preserves product invariants, with a modular monolith initially. Avoid premature microservices and disposable demo architecture.
- Do not introduce a generic multi-agent framework before it is needed, or full event sourcing without clear justification.
- Build vertically in usable, testable slices. Future requirements should influence boundaries, not inflate current scope.
- Account registration/session/invitation/recovery UX is BUILD work; external provider delivery/credentials are WIRE. Authentication does not grant Workspace membership, Goal adherence or authority.
- Treat AI model output as untrusted structured input; validate it before it changes domain state or triggers actions.
- Write model-facing prompts and agent operating instructions in English. This does not change user-facing language: preserve requested response languages, original source text, examples and exact protocol values. Product documentation and approved ADR wording are not subject to this language rule.
- Make asynchronous processing idempotent wherever retries are possible.
- Use migrations for persistent schema changes. Avoid opaque JSON blobs for stable domain concepts.
- Enforce workspace authorization server-side.
- Testing practice (user instruction, 2026-09-09, refined 2026-09-10): use the smallest relevant checks while coding, then targeted regressions per coherent increment. Run broad suites, full E2E, fresh-database and restart/persistence checks at meaningful milestones, session end and before release; comprehensive verification before deploy. Fix a targeted failure and rerun its smallest relevant check before broadening. Increase verification for changes to authority, security, isolation, canonical state, migrations, provenance/versioning, Commit Points, concurrency, idempotency or recovery. Use deterministic external-provider doubles and record real-service verification as pending without blocking independent work.

## Context-efficient engineering

Optimize useful engineering progress per unit of context, not the absolute minimum number of tokens. Eliminate repeated cognitive work, never work required for correctness.

- Start from AGENTS, [STATUS](docs/development/STATUS.md), [CODEMAP](docs/development/CODEMAP.md), and the relevant canonical documentation. Reuse already-read, unchanged context instead of reconstructing the repository each cycle. Checkpoints and maps are navigation aids: verify relevant paths/state when needed; they do not replace canonical requirements or current code.
- Search paths, symbols, references, imports/callers and tests before reading files. Keep reading local to the capability, following concrete dependencies, reusable patterns and potentially affected cross-cutting invariants. Expand when uncertainty or correctness requires it. Prefer sufficient excerpts and check summaries over complete files/logs/diffs, without hiding failures or necessary evidence.
- Maintain a compact CODEMAP of verified main entry points and a topic-to-ADR index as navigation needs or boundaries change; link to code and decisions instead of duplicating them. Do not build an exhaustive inventory or reread all mapped topics on each task.
- Prefer deterministic repository/runtime evidence over equivalent speculative reasoning; observed implementation does not override approved requirements. Reuse verified infrastructure and patterns after checking their applicability, without restudying entire capabilities or generalizing prematurely.
- Keep STATUS compact: state → invariants → verification → limits → next. Preserve necessary verification evidence, unresolved issues and recovery references, linking to details instead of copying them.
- Within the authorized scope, perform broader analysis, refactoring or verification when correctness requires it. When cost is high and value uncertain, try a targeted alternative first or surface the trade-off. The decision discipline below still excludes speculative engineering, unrelated refactors and premature abstractions.

Operating sequence: `checkpoint → deterministic search → targeted reading → implementation → targeted verification → milestone verification`, subject to task scope and the testing practice above.

## ChatGPT ↔ User ↔ Codex collaboration

The user, ChatGPT and Codex develop this project collaboratively. ChatGPT provides continuity from product discovery through intent, reasoning, decision history and open questions. Codex verifies current implementation, tests, runtime behavior and technical constraints directly. The repository and canonical documentation are the shared, verifiable source of truth; conversational recollection does not override them.

- User-relayed prompts may originate with ChatGPT. Assess them critically as engineering input while respecting the user's instructions and authorization. Briefly flag material redundancy, ambiguity, weak assumptions or conflicts with canonical documentation or implementation reality, and propose the smallest useful improvement; do not silently reinterpret approved decisions.
- Resolve implementation details from repository/runtime evidence. Escalate through the user only for genuinely unresolved product/foundational decisions, meaningful unsettled architectural trade-offs or problems with the direction/input. When useful, supply a concise question or feedback for the user to relay to ChatGPT; its review is optional, not a required handoff.
- Treat ADRs and AGENTS as persistent context: retrieve applicable rules rather than assuming they are loaded. Prompts should focus on the delta, objective and new constraints. Reference existing information, state what is new, and record durable decisions under the discipline below with their actual approval status. Do not ask the user or ChatGPT to restate facts Codex can determine directly.

Default loop: `ChatGPT/product reasoning → concise delta to Codex → implementation + verification → compact checkpoint → ChatGPT review when useful`.

## Decision discipline

- Inspect the repository and read relevant documentation before substantial changes. Preserve unrelated files and existing user changes.
- Make the smallest coherent change that delivers the requested outcome.
- Make reasonable, reversible decisions independently. Surface difficult-to-reverse decisions for review. Avoid decision records for routine reversible choices; retain operational instructions, material rationale and known limitations needed to maintain or recover the system.
- Review all foundational primitives against the [MVP adaptability criterion](docs/product/MVP_SPEC_v0.1.md#2-modello-fondamentale-del-prodotto): avoid group-type semantics and mandatory workflows; preserve approved invariants, distinguish structural rigidity from UX bias, and defer speculative abstractions.
- Avoid unnecessary clarification when an answer can safely be deferred.
- Do not opportunistically build future features or turn illustrative examples into new requirements.
- Keep complete approved decisions in ADRs; keep AGENTS compact and operational, and prefer concise summaries and ADR references elsewhere over duplicating normative text.

## Definition of done

A coding task is complete only when:

- The requested behavior works and relevant tests pass.
- Repository-required lint, typecheck and formatting checks pass.
- Migrations are valid when applicable.
- Affected security boundaries have been considered.
- Relevant documentation is updated and known limitations are clearly stated.

Do not claim completion while required checks are failing. Report checks that could not be run and why; do not present them as passing.
