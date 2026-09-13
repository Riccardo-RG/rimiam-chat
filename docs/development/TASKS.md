# Tasks + Follow-up BUILD

2026-09-10. Approved semantics: [ADR-0013](../decisions/ADR-0013-task-responsabilita-follow-up.md). Navigation: [CODEMAP](CODEMAP.md). This records the bounded implementation, not additional authority.

## Implemented boundary

- Shared Task identity with materialized current version, immutable snapshots/references and separate personal acceptance records. No mandatory Goal, Workstream or Commitment. Contributing members can record/maintain unassigned work; a suggested person is never an assignee.
- One effective responsible person per Task in this slice. Only their own exact-version acceptance establishes responsibility. Normal status management belongs to that person while eligible; creators/admins get no override. Unassigned work remains collaboratively maintainable. Relinquishment clears responsibility; it does not erase history or linked obligations.
- All content revisions are conservatively treated as material. Unassigned content can be revised; assigned content requires an immutable proposal and fresh acceptance by the current responsible person. The adopted proposal ID and accepted version are retained. Any intervening Task version makes a proposal stale. No delegated management or multi-responsible workflow is implemented.
- Operational states: open, in_progress, completed, cancelled. Closure/reopening is versioned and has no effect on linked normative records. A departed/ineligible responsible person remains historically identified but cannot manage work; no automatic reassignment. Re-entry does not silently revive a prior membership-bound acceptance; personal relinquishment remains available after valid re-entry.
- Exact links support Goal, adopted project act, Accepted Information, Artifact, immutable source/message, Open Question and Task versions. Immutable sources/messages/project acts use version 1 as the reference discriminator, not a newly invented lifecycle. AI candidate provenance stays linked to the existing candidate and its sources. Suggestions remain non-authoritative until an explicit human command records work.
- Follow-ups are shared, attributable records with personal ownership; only the initiating person modifies/closes their own follow-up. They can exist without a Task. They do not assign work or create external authority. Scheduling follows explicit time and exact optional reference; Task deadlines remain on Task versions.

## Contract and recovery

[Schemas](../../src/contracts/tasks.ts), [commands](../../src/server/tasks-commands.ts), [reads/history](../../src/server/tasks-queries.ts), [worker](../../src/server/tasks-worker.ts). Additive migrations **011–012**; 012 adds exact proposal-adoption provenance because 011 was already applied. Earlier checksums are unchanged.

- All mutations use the existing authenticated transactional command/receipt boundary. Workspace locks serialize relevant mutations; account/session/member checks, exact Task/follow-up versions and acceptance protect canonical changes. References are validated against a finite server-owned set of existing entities.
- Public `GET /api/v1/workspaces/{id}/tasks` pages combined Task/follow-up identities; `before` continues without a join-time/history cutoff. `tasks-history?id=…&kind=task|followup&before=…` pages immutable versions. OpenAPI describes both reads and all commands.
- Graphile stores durable ID/version jobs. A short transaction checks current version, status, owner eligibility/membership continuity and referenced state before recording one in-app outcome. A unique receipt prevents duplicate delivery. Obsolete jobs do nothing; invalid current references/access produce a preserved suppressed outcome requiring explicit review. No push/email/SMS or external effects occur.
- Startup/periodic recovery re-enqueues due versions lacking a receipt. Future jobs persist in Graphile. A revised version schedules independently; old receipts remain historical. Previously delivered reminders are not retrospectively erased when their references become stale.
- [Work retrieval](../../src/server/tasks-context.ts) adds selectively relevant current work to interpretation and can retrieve matching retained versions through `needsMore`. Initial selection is explicitly non-exhaustive; historical retrieval has no recency cutoff. Qualifications, actors, versions, responsibility and exact references remain attached. No background AI loop is introduced.

## Clients and verification

Next.js, SwiftUI and Compose expose create/edit/propose, explicit personal acceptance/relinquishment, completion/cancellation, essential provenance/history, personal follow-up creation/revision/closure, reminders and paging. Existing exact-command journals/session guards are reused. Native clients re-fetch after foreground/restart; web refreshes the open panel. These surfaces use the common API.

Tests: [domain/authority/scheduling](../../tests/tasks.test.ts), [browser](../../tests/e2e/tasks.spec.ts), [Swift model](../../mobile/ios/MiriamTests/TasksTests.swift), [Swift UI](../../mobile/ios/MiriamUITests/TasksScreenTests.swift), [Compose UI](../../mobile/android/app/src/androidTest/java/it/miriam/nativeapp/TasksTest.kt). The [native harness](../../tests/run-native-server.ts) now uses the real worker registry via [native-worker](../../tests/native-worker.ts); only external provider ports are doubled. Latest verification evidence belongs in [STATUS](STATUS.md).

## Limits

No reusable mandates, delegated assignment, multiple simultaneous responsible people, autonomous consequential actions, recurrence/workflow engine or real notification channels. References are fully supported in the contract; the minimum UI preserves/displays them and creates Task-linked follow-ups, but does not yet provide a general cross-entity link picker. History is inspectable but minimally presented; deeper pages are available through the public contract. No new AI provider/model or real-service verification was activated. Larger-scale query/index/UX improvements remain reversible follow-up work, not new product decisions.
