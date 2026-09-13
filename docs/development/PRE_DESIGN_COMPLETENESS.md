# Pre-design functional checkpoint

2026-09-12. Records the user's repository-local completion phase; no provider activation, service purchase, deployment, final visual redesign or new product decision. Canonical scope remains [MVP](../product/MVP_SPEC_v0.1.md), its [reconciliation](../product/MVP_V0.2_RECONCILIATION.md) and approved ADR-0001–0014. This is engineering evidence, not real-user or real-model acceptance.

## Capability coverage

| Boundary | Repository-local implementation | External or experiential verification remaining |
| --- | --- | --- |
| Accounts/access | Verified accounts, recovery, invitations/admission, protected relationships, voluntary exit and session-bound recovery. Explicit invitation email opt-in on all clients. | Hosted auth/TLS, verified sender, actual delivery and bounce handling. |
| Conversation/Context | Shared history, selective retrieval, qualified proposals, editorial acceptance/corrections, Goal versions/adherence, scoped project acts/mandates, questions, Workstreams, presence/catch-up. Default participation is only when called; collaborative initiative requires an explicit preference. | Actual model judgment, usefulness, latency/cost and two-user behavioral acceptance. |
| Work/Artifacts | Task responsibility and follow-up; shared Active Work controls, conflicts/restrictions, state-aware continuation and unadopted Contributions; flexible versioned Artifact drafting/adoption. Model control suggestions require explicit application. | Real analytical/drafting quality and natural conversational usability. |
| Calendar/Email | Internal temporal state, self commitment timing, private observations, explicit disclosure, exact version-bound proposals/authorization, uncertain-outcome reconciliation. Real Google OAuth/read/write adapters. | Google app/scopes/user consent; controlled real reads, sends/writes and reconciliation. |
| Sources/research | Original files/version/provenance, real PDF/DOCX parsing, Brave search, Anthropic image interpretation and OpenAI transcription adapters. | Search/media credentials and controlled live quality/privacy checks. |
| Voice | Local microphone recording with explicit upload/disclosure on web/iOS/Android; device-voice playback of exact Miriam text, stopped at lifecycle/access boundaries. | Real transcription; physical microphone/audio routing and installed-voice availability. No full-duplex calls. |
| Related Workspaces | Attributable, versioned navigation link; edit requires contribution in both spaces; visibility requires current access to the other endpoint. | No automatic Context inheritance, membership/authority sharing or child projection. Those semantics are not approved. |

Production has real adapters or explicit unavailable/Needs Input states. Deterministic providers remain isolated in tests; no mock result fills an unconfigured production capability. [External configuration](EXTERNAL_SERVICES.md) is the activation checklist.

## Changes that close this phase

- [Migration 023](../../migrations/023_invitation_delivery.sql), [delivery worker](../../src/server/invitation-delivery.ts), [fixed-purpose Resend transport](../../src/server/invitation-mail.ts): encrypted invitation links, frozen payload and idempotency key, current issuer/admission eligibility at dispatch, bounded retry/recovery and immutable transitions. Provider submission is **not** inbox delivery. Account mail and Workspace Email retain separate purposes and authority.
- [Migration 024](../../migrations/024_workspace_navigation.sql), [link commands/queries](../../src/server/workspace-links.ts): navigation only, with ordered dual-Workspace locks, optimistic versions and immutable attributed history. Linking never changes a Context or expands retrieval. Unlinking preserves history.
- Common functionality filled in across all clients: invitation delivery status/opt-in, linked navigation, source replacement versions, exact control-suggestion application, protected member removal, Calendar disconnect, own commitment timing and current-version proposal realignment/history. Revision invalidates earlier exact-action approvals as before.
- [Participation gate](../../src/server/participation.ts) and [explicit address helper](../../src/shared/miriam-address.ts): ordinary group messages remain group messages; an explicit Miriam action retains the visible address in the source. Current preference is checked again before publishing unsolicited output/starting autonomous work. Existing explicitly collaborative preferences remain valid.
- Recorded voice and optional local playback remain client presentation/source acquisition, not a new authority channel. [Rich inputs](RICH_INPUTS.md) now declares the existing parser packages portably; a Python 3.13 project virtualenv replaces the developer-specific runtime in `DOCUMENT_PYTHON_PATH`. Other `.env` contents are unchanged. No commercial SDK or JavaScript dependency was added.

## Verification evidence

- Broad server milestone: **224 cases / 25 files** executed. Initial result 222 passed, 2 failed in work-suggestions; the affected four-test file then passed after correcting assertions. The implementation retains the resume request as history while preserving Needs Input and the unresolved objection; a revoked session already returns the common authentication error. No production invariant was weakened. Earlier targeted fixture corrections drain older queued interpretation first and explicitly call Miriam under the quiet default.
- Targeted invitation, navigation, voice presentation, temporal projection, conversation/participation and autonomous-work checks pass. Local document tests use real PDF/DOCX parsers. Provider HTTP/model tests use deterministic injected doubles, not real services.
- TypeScript, ESLint, formatting, web production build and standalone backend compilation pass. Android compilation/lint and two boundary tests pass; iOS compilation and two boundary tests pass. The initial unsigned iOS artifact could not access Keychain; standard simulator signing resolved this without weakening storage. These checks establish transport/session/model coherence, not full UI or physical-device acceptance. No browser test was run in this phase, as requested.
- Fresh `miriam_predesign_verify_20260912` has migrations **001–024**; existing development database advanced **021 → 024** after backup. Checksum rerun passed. **36 historical migration/ADR hashes** are unchanged; **206 local links/anchors** are valid, with no conflict markers. No development data reset.
- Actual process recovery harness passes on its separate database: crash cannot override a human pause, new queued work runs after restart, explicit resume completes once, another restart does not duplicate, compiled authenticated API retrieves durable Work/Contribution state without Next.
- Session-local baseline, backups and build/test logs: `/tmp/miriam-pre-design-20260912/`. No Git repository exists; protected hashes and a change inventory replace a Git diff. Temporary evidence is not a committed artifact or backup strategy for deployment.
- Parser setup exposed a broken Homebrew Python 3.14 `pyexpat` linkage; the already-installed Python 3.13 works and now owns the project virtualenv. Seven media tests pass with that runtime. No system Python repair or unrelated installation was attempted.

## Cross-client and design handoff

Web, SwiftUI and Compose use the same server-owned capability rules. Presentation differs; command versions, actor/session binding, receipts, private/shared boundaries and current-state qualifiers do not. Entry points: [CODEMAP](CODEMAP.md), [multi-client boundary](MULTICLIENT.md), [design guide](PRODUCT_DESIGN.md).

Claude Design can replace layout, navigation composition, styling, typography, microcopy and interaction presentation. Keep API clients, command journals, native WorkspaceModels and server commands as the functional boundary. Preserve explicit disclosure/authorization, exact-content previews, conflicts, Needs Input/unknown outcomes, provenance, inspectable history and Contribution/adoption distinctions. Device speech and capture controllers are separable from their buttons.

## Honest completion limits

No additional local foundational decision was required for this bounded scope. Advanced child-context inheritance, native live calls, outbound push, generic agent frameworks and billing are not silently approved or counted as implemented. In-app follow-up is implemented; adding push would require an adapter and platform delivery work, not merely a key.

Real-service activation must be followed by controlled integration checks and manual multi-user behavioral acceptance; [the acceptance record](ACTIVE_WORK_ACCEPTANCE.md) remains incomplete. Final design needs responsive/accessibility/keyboard and physical-device checks. Hosted configuration, restore/monitoring, signing and distribution still require deployment work. Thus this checkpoint is not a claim that credentials alone prove the product works or that a store-ready release exists.
