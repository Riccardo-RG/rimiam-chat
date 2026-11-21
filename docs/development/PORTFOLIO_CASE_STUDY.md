# RIMIAM — technical case study

Working case study, **17 November 2026**. This document identifies engineering decisions demonstrated by the repository and a reproducible demonstration outline. It does not assert production scale, user adoption, measured business impact or completion of live acceptance. Current evidence and remaining work belong in [STATUS](STATUS.md) and [WEB_RELEASE](WEB_RELEASE.md).

## Product problem

A group conversation contains claims, intentions, corrections and possible actions. Treating every utterance as agreed project state makes an AI assistant unreliable: a suggestion can become an assignment, a source can become an unquestioned fact, or one person's request can appear to bind others.

RIMIAM explores a shared workspace where Conversation remains the main interface while structured state is persistent, inspectable and governed. Its conversational assistant, Emme, can use relevant shared context. The engineering problem is to let it contribute useful work without giving model output authority over people or rewriting the history it interprets.

## Selected implementation evidence

| Decision or challenge                     | Code to inspect                                                                                                                                                                               | What the implementation demonstrates                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Current state with durable provenance     | [Commands](../../src/server/commands.ts), [transactions](../../src/server/db.ts), [migrations](../../migrations/)                                                                             | Validated transactional writes, stable references and historical records instead of reconstructing state through model replay |
| Authorization is contextual               | [Workspace guards](../../src/server/workspace-state.ts), [access commands](../../src/server/access-commands.ts), [project commands](../../src/server/project-commands.ts)                     | Separation of membership, access governance, project authority and version-specific changes                                   |
| A lost response is not a failed command   | [Browser command journal](../../src/client/command-journal.ts), [recovery UI](../../src/client/pending-commands.tsx), [sync/receipts](../../src/server/sync.ts)                               | Idempotent recovery and explicit uncertainty rather than blind user retries                                                   |
| Collaboration under changing state        | [Active Work worker](../../src/server/active-work-worker.ts), [control commands](../../src/server/active-work-commands.ts), [context selection](../../src/server/active-work-context.ts)      | Shared steering, version/permission fences and Contributions separated from adoption                                          |
| Replaceable, untrusted AI                 | [Structured model boundary](../../src/server/structured-llm.ts), [Conversation context](../../src/server/conversation-context.ts), [Specialist port](../../src/server/analysis-specialist.ts) | Provider selection outside domain semantics, structured validation and selective authorized context                           |
| A resilient Conversation-first Web client | [Page composition](../../src/app/page.tsx), [snapshot/SSE lifecycle](../../src/client/workspace-sync.ts), [detail layer](../../src/client/workspace-layer.tsx)                                | Request ordering, cancellation, explicit connection states, retained drafts and focus management                              |

The rationale is recorded in [approved ADRs](../decisions/); [CODEMAP](CODEMAP.md) links each topic. The implementation is a modular monolith with PostgreSQL and Graphile Worker, not a generic agent framework or a distributed microservice system.

## Verification approach

Domain tests use real local PostgreSQL. Focused browser scenarios use real authentication and application commands, with deterministic doubles at external-provider boundaries and deliberate response loss/delay for recovery cases. This separates reproducible structural correctness from live model behavior.

The November Web checkpoint verified account/session transitions, two-person collaboration, stale-read protection, lost-command recovery, source navigation and responsive keyboard behavior. Its recorded counts and exact limits are in [WEB_RELEASE](WEB_RELEASE.md). That evidence does not establish production availability, provider quality, physical-device behavior or the correctness of every feature.

Deterministic authority/privacy checks remain authoritative. Reproducible behavioral evaluations and human review can later assess usefulness, timing and restraint without replacing those boundaries. No behavioral score or measured productivity improvement is claimed here.

## A focused demonstration

Use fictional data and two separate accounts. A suitable scenario is two people developing a new product:

1. Create a Workspace, invite the second person and make the shared-history admission explicit.
2. Discuss an objective and a budget claim. Inspect its attribution; accept information or adopt a governed decision through the corresponding distinct operation.
3. Ask Emme for bounded analysis with a real model. Inspect the Work Contract, sources and resulting Contribution before adopting anything.
4. Have the other member steer or pause the same Active Work. Show that requesting it did not create exclusive ownership.
5. Create a Task, request another person's responsibility and show their explicit acceptance.
6. Reload or reconnect, then inspect the same durable work and history.

Record a short video and a small set of screenshots only after the real flow has passed acceptance. Do not present a test-double result, design prototype or staged fixture as a live model outcome. Optional Calendar, Email and calling integrations need not distract from this core demonstration.

## Professional narrative and limits

The repository provides concrete material for discussing React/TypeScript state management, transactional application design, AI integration, provenance, authorization, asynchronous recovery and testing. It also exposes practical trade-offs: a broad product domain, provider-dependent acceptance, large composition/query surfaces and the cost of maintaining multiple clients.

Development uses an AI-assisted workflow with explicit product decisions and repository-based verification, documented in [AGENTS](../../AGENTS.md). A portfolio account should explain that workflow and the author's actual decisions, reviews and validation work. It should not imply unaided authorship, team responsibilities or operational results that have not been established.

Before linking a public demo or repository from a CV, attach the reviewed release commit, its verification evidence, a reproducible setup, the public license and a current list of limitations. Complete the publication/privacy checks and live two-user acceptance. Keep any future performance measurements or feedback outcomes tied to their method, date and sample; there are no fabricated metrics to fill in.
