# MIRIAM — multi-client contract and native slice

Implementation guide, **2026-09-12**. Approved direction: [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md). Product/domain semantics remain in the canonical MVP and ADRs; this document records the implemented transport, not new authority or product policy.

## Run against your local Workspace

Keep PostgreSQL and the existing web/worker running as described in [README](../../README.md). In another terminal, from the repository root:

```sh
npm run api
```

The standalone API binds to `127.0.0.1:3002` by default. It uses the same `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` as the web process. Do not point them at different databases or secrets for the same environment. Web routes continue using the same application services through a thin Next adapter; a separate API process is optional for web use and independent of Next for native use.

- **iOS:** open `mobile/ios/Miriam.xcodeproj`, select the shared `Miriam` scheme and an iOS 18+ simulator. Debug defaults to `http://127.0.0.1:3002`. Build with Xcode 26 / Swift 6.
- **Android:** open `mobile/android` in Android Studio, select a local SDK and JDK 17, then run `app` on an emulator. Debug defaults to `http://10.0.2.2:3002` (the Android emulator's host-loopback alias). Gradle wrapper 8.13, AGP 8.11.1, Kotlin/Compose compiler 2.2.10; minimum API 26, compile/target API 36. Dependencies are pinned in Gradle files.
- Register or sign in with an **eligible verified account**. All clients offer registration, resend verification, recovery requests and explicit invitation acceptance. Verification/reset links use the protected web flow; local development uses its session-bound inbox. There is no native verification bypass or Google social login. Google capability connections use the system-browser flow below.
- Select or create a Workspace, inspect the current Goal and qualified information, send messages, reopen the app and inspect updates. Native clients initially load the latest 50 messages; **Carica messaggi precedenti** pages backwards without a join-date cutoff. Foreground updates use HTTP change checks; the server also exposes SSE.
- An uncertain command remains in the device journal. Recovery checks receipts; **Riprova la stessa operazione** retains the exact ID/content. Removing a local reminder does not cancel a committed or in-flight operation.

Release clients require an HTTPS server URL. Debug exceptions permit only loopback/emulator hosts, not arbitrary HTTP services. These local URLs do not connect two physical phones over the internet. Physical iOS signing/TestFlight, Android release signing/distribution and a shared hosted HTTPS environment remain WIRE/VERIFY work; no Apple/Google account or cloud service has been created.

## Common HTTP boundary

Public DTOs and command schemas live in `src/contracts/`, independently of server implementation. Machine-readable OpenAPI 3.1 is available at **`GET /api/v1/openapi.json`**, derived from these schemas. `src/server/api.ts` handles standard Request/Response objects; `src/api.ts` supplies a bounded Node HTTP listener and `src/app/api/v1/[...path]/route.ts` is the Next adapter.

| Endpoint under `/api/v1` | Semantics |
| --- | --- |
| `POST /native/session` | Verified email/password sign-in, returning a signed session token and public user fields. |
| `GET /native/session` | Revalidate current session and account eligibility. |
| `DELETE /native/session` | Revoke this session, including when account eligibility is restricted. |
| `GET /workspaces` | Currently accessible Workspaces only. |
| `POST /workspaces` | Idempotent creation with stable `commandId` = new Workspace identity; transaction includes its receipt. |
| `GET /workspaces/{id}/state` | Compact, coherent current projection with revision and message high-water mark; not a replacement for full canonical history. |
| `GET /workspaces/{id}/history?through=…&before=…` | Most recent/older message pages; `nextBefore` advances backwards. |
| `GET /workspaces/{id}/messages?after=…&through=…` | Ascending incremental message pages within a captured high-water mark. |
| `GET /workspaces/{id}/changes?after=…` | Durable ordered revision hints, `nextAfter`, `headRevision`, `hasMore`. |
| `GET /workspaces/{id}/events` | SSE batches of the same change hints, resuming from `Last-Event-ID` or `after`. |
| `POST /workspaces/{id}/commands` | Validated commands through existing transactional services; public committed receipt. |
| `GET /workspaces/{id}/calendar?start=…&end=…&afterAction=…` | Canonical temporal view, shared exact-action proposals and own private observations; selectable windows/action paging. |
| `GET /workspaces/{id}/calendar-history?id=…&kind=…` | Shared version/provenance/approval history, excluding private observation contents and session/credential references. |
| `GET /workspaces/{id}/receipts/{commandId}` | The authenticated actor's committed receipt, still subject to current Workspace access. |

Responses include `X-Miriam-API-Version: 1`, private/no-store caching and structured failures `{error:{code,requestId,recovery}}`. Response fields can be added compatibly; clients ignore unknown fields. Incompatible changes require a new major route/version; do not silently change existing command meaning for installed clients. The compact projection keeps identities, relevant versions and epistemic qualifiers. Native capability views use common detail/history/source endpoints in the same handler; the table above lists transport entry points, not every route. Some web views retain legacy adapters to the same services. Public views exclude server diagnostics, credentials and unrelated private observations.

Command bodies are the existing public vocabulary, not a generic permission system. `expectedActorId`, supplied by the web journal and native commands, is an optional account-switch precondition; it never selects the authenticated actor or grants authority. Workspace authorization remains inside application commands and queries, independent of transport.

## Session security

Web Better Auth cookies, trusted Origin checks and explicit CSRF protections remain enabled. Native requests use a **separate cookie-less adapter** backed by the same accounts/session table and the installed Better Auth bearer plugin with `requireSignature: true`. Native entry points reject cookies, Origin and browser fetch metadata; raw database tokens and malformed signatures are rejected. Only the closed native email/password flow supplies a server-generated trusted Origin internally. It does not proxy arbitrary auth routes/callbacks. The ordinary web auth instance does not expose native bearer tokens.

Credentials are pinned to the selected API origin. Native HTTP clients do not follow redirects or share cookies. iOS uses Keychain `WhenUnlockedThisDeviceOnly`; Android uses AES-GCM with an Android Keystore key and an atomic encrypted file in no-backup storage. Passwords are never saved. Workspace state is memory-only; outgoing pending commands are separate, encrypted and bound to actor/server/Workspace. A pending local logout hides Workspace data and retains only what is needed to retry revocation; it does not falsely report a completed remote logout while offline.

Native transport does not confer membership, adherence, editorial acceptance, project authority or connection permissions. Every data request rechecks access; SSE rechecks session and membership for every batch. The direct Node listener replaces incoming IP-forwarding headers with the socket address. A hosted reverse proxy, trusted forwarding configuration, abuse controls and production TLS/cookie checks still require deployment verification.

## Recovery and synchronization

Persist the ID and exact command before sending. A response can be lost after commit. Look up the receipt first; a missing receipt is **unknown**, because the original transaction may still be in flight. An explicit retry uses the same ID/body and existing server preconditions. Changed payload under the same identity is rejected. A stale approval is not regenerated or updated automatically. Receipt access does not override departure/removal: an inaccessible Workspace remains inaccessible and the client cannot infer a failed command merely from denial.

Current state, source/history changes, queue insertion where required and command receipt retain their domain transaction boundaries. No additional schema or full event sourcing is introduced. Workspace creation writes a receipt. Invitation admission has its own explicit single-use endpoint and does not become a generic journal command; native clients preserve its actual server outcome and never infer Goal adherence from joining.

For sync, capture state and its message high-water mark, load the required message pages, and publish the state/revision together only after the pages succeed. Use the **last applied** revision for reconnect. SSE delivery is a hint, not acknowledgement by the client. A feed gap or ahead-of-server cursor requests a reset; do not silently advance past missing information. Native clients stop polling when backgrounded and resume on foreground, with bounded backoff on failure and generation checks that reject late responses after Workspace/session changes. No uninterrupted background execution, push delivery or offline authority is claimed.

The initial history window/page limits are presentation/transport choices, not retention, visibility or Context Engine correctness boundaries. Historical sources remain selectively retrievable by the existing server Context Engine. HTTP polling/SSE and Graphile remain infrastructure choices, not Goal or Active Work semantics.

## Verification

Node and worker compile without loading Next types or a Next build:

```sh
npm run build:backend
npm run start:api
# separate terminal if needed
npm run start:worker
```

TypeScript uses explicit `.ts` source imports, rewritten to `.js` for Node output; Next/Turbopack consumes the same TypeScript sources. No custom module loader is needed for compiled runtime.

Targeted server tests: `npm test -- tests/api-contract.test.ts`. Browser recovery: `npm run test:e2e -- tests/e2e/command-recovery.spec.ts`. At a milestone, run `npm run check`, `npm run build:backend`, `npm run build` and the full E2E suite.

For native integration tests, first build the backend, then in a terminal:

```sh
node --env-file=.env --import tsx tests/run-native-server.ts
```

This **test-only harness** creates/migrates `miriam_native`, seeds clearly fictional verified accounts and a shared Workspace through ordinary creation/invitation/acceptance commands, and starts the **compiled** standalone API on 3102. It does not import fixtures into normal runtime, run AI/provider calls or modify the development database. It preserves test data across restarts. Native test credentials are intentionally fictional and exist only in test source.

Run the Xcode scheme's tests on an iOS simulator. Run `./gradlew :app:connectedDebugAndroidTest :app:lintDebug` from `mobile/android`, with an Android emulator running. Native tests exercise actual networking and secure storage; UI tests cover sign-in/message/logout, iOS process termination/relaunch and Android foreground catch-up. `STATUS.md` records the actual checks and remaining limitations for the checkpoint.

## Calendar increment

[Calendar BUILD](CALENDAR.md) documents the common model and commands. All three clients expose internal personal appointments, exact external proposals, authorization/rejection, unknown outcomes, reconciliation, observations and divergence/overlap. An observation can prefill a linked personal correction, but saving explicitly is required and preserves the exact private-source reference. No observation alone changes canonical state.

Calendar commands use the existing secure journal and receipt recovery. Native authorization is bound to the actual authenticated server session, just as web authorization is bound to its cookie session. UI capabilities are affordances, never the server's authority check. Calendar responses are actor-private/no-store; late responses and Workspace changes retain the existing generation guards.

The native test harness starts the real job registry/recovery through `tests/native-worker.ts`, with deterministic Calendar/Email provider doubles. It does not activate a provider in normal runtime. Calendar UI tests cover internal creation and action recovery/reconciliation; exact evidence is in STATUS. All clients now expose shared Calendar history, actor-own commitment timing, explicit proposal realignment to current temporal versions and disconnect. Realignment preserves server rules that invalidate earlier exact-action authorizations.

## Remaining boundaries

- Web, SwiftUI and Compose expose account/invitation flows, Conversation/Context/provenance, access/project governance, Goals, questions, Artifacts, Tasks, Active Work, sources, attention/Workstreams, Calendar/Email and dual-access Workspace navigation. Current Ritmo hierarchy, exact Activity references, Workstream focus and Conversation-to-capability handoffs are tracked in [STATUS](STATUS.md). [Pre-design coverage](PRE_DESIGN_COMPLETENESS.md) preserves earlier functional evidence; neither record substitutes for full human or real-provider acceptance.
- Google OAuth uses a protected system-browser/server callback with server-only credentials; native clients refresh their connection state afterwards. [ADR-0015 voice/calls](VOICE_CALLS.md) adds Conversation voice/dialogue and human audio calls, including in-call native background handling. Universal/app-link return polish, push/incoming terminated-app calls and arbitrary uninterrupted background execution remain outside scope; durable work/follow-up runs server-side. Hosted callbacks, real providers and physical devices remain unverified.
- No offline canonical writes, persisted read-history cache or automatic replay of consequential approvals. Large state-projection pagination and precise entity-level invalidation can follow measured need; current conversation history is already paginated.
- Standard source projects and debug builds exist. This is not a signed store release, hosted deployment or proof of physical-device/distribution behavior.

Implementation references: [Better Auth bearer](https://better-auth.com/docs/plugins/bearer), [Apple Keychain](https://developer.apple.com/documentation/security/keychain-services), [AGP 8.11 compatibility](https://developer.android.com/build/releases/agp-8-11-0-release-notes), [Compose compiler setup](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler). Version choices are pinned engineering choices, not new product invariants.


## Workspace Email increment

[Email BUILD](EMAIL.md) supplies the common private DTOs/commands, compose/history/attachment endpoints and three client surfaces. Private Email polling is independent of shared revision hints; it stops with panel/background lifecycle and rejects late account/Workspace responses. Native command journals now use the capability-neutral `workspaceCommand` entry point. The test-only native harness runs Calendar and Email doubles; normal API/worker configuration never enables them. Exact envelope, disclosure, self-authorization, response-loss recovery and reconciliation remain server-owned. Detailed Email limits and actual checks are in EMAIL and STATUS.
