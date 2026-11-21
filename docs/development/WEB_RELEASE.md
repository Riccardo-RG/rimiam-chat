# Web release checkpoint

## Current continuation

The Web assistant is presented as **Emme**. For current participation behavior and compatibility with earlier names, see the [product specification](../product/MVP_SPEC_v0.1.md) and the [Conversation entry points](CODEMAP.md).

The user resumed the full Web Release & Portfolio objective on **2026-11-17**: “lavora ininterrottamente fino a fare tutto nel miglior modo possibile”, after the documented recommendation to close backend/security gaps, restore a real two-user Web demo and prepare a professional public repository. Local backend, packaging, controlled dependency updates, Web Push and publication preparation now continue alongside Web. Native clients remain untouched. The user selected **MIT** and delegated the verified dependency update decision. Paid activation, deployment, GitHub publication/visibility and real-user acceptance still require their applicable authorization/evidence; no such outcome is implied by local implementation.

Remaining acceptance sequence:

1. Repair reproduced session/source/packaging gaps, apply compatible security patches and operational AI admission guards; targeted regressions plus a coherent release milestone.
2. Deliver optional Web Push through real server/browser boundaries; test transport doubles separately from pending physical-device/closed-app verification.
3. Prepare English README/contributing/security/case-study and MIT licensing; distinguish ordinary branch history from local Codex snapshot refs in the publication scan.
4. Inspect authorized remote configuration/queues before activation, then demonstrate real account/invitation/Conversation/AI/Task/Active Work flows with two users. No release completion claim until actual evidence exists.

## First checkpoint scope and authority (historical)

User-authorized on **2026-11-17**, following the read-only release audit. The first session is time-boxed to **09:54–13:54 UTC (10:54–14:54 Europe/Rome)**. The user's subsequent instruction narrows this checkpoint to **Web frontend only**. This supersedes the initial plan to start with backend/security/packaging repairs in this session.

Preserve existing domain semantics and server contracts. Do not edit or test native clients. Do not modify backend code, migrations, dependencies, credentials or remote services. No Render restart, paid model calls, deployment, push, PR or repository visibility change is authorized by this checkpoint. Pre-existing native/document changes and personal/untracked files remain untouched.

Canonical requirements: [MVP](../product/MVP_SPEC_v0.1.md), especially §§2.2, 7, 11 and 16; approved decisions remain in [ADRs](../decisions/). [CODEMAP](CODEMAP.md) identifies current boundaries. The attached broader Web Release & Portfolio brief remains the direction, not evidence of completed work or permission to widen this session.

## First increment

Improve the existing Conversation-first Web experience and restore meaningful frontend verification, using current API contracts. No new visual identity or generic component framework.

| Work                           | Existing boundary                      | Acceptance                                                                                                                 | Verification                                                                                  |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Assess UI UX Pro Max           | Existing Next/React/CSS implementation | Useful guidance selected without installing unrelated tools                                                                | [Focused skill review](UI_UX_SKILL_REVIEW.md)                                                 |
| Account/recovery/create forms  | Existing auth and workspace commands   | Errors identify the field, successful recovery is announced, drafts and uncertain outcomes survive                         | Targeted client tests; keyboard/browser checks when local runtime is available                |
| Workspace loading/reconnection | Existing snapshot and SSE reads        | Honest initial/loading/reconnecting/error states; retry preserves drafts; old Workspace responses cannot update a new view | Deterministic state/transport tests and bounded Web checks                                    |
| Task / Active Work reading     | Existing versioned views and commands  | Late pre-command or previous-page reads cannot replace newer state or errors                                               | Hold actual local GET responses across a command; verify responsibility/phase remains current |
| Web composition                | Existing capability views              | Secondary capability code loads on demand where safe; no lost drafts or altered governed transitions                       | Typecheck, targeted regression and production build                                           |
| E2E alignment                  | Existing isolated browser harness      | Selectors describe current accessible UI; meaningful assertions remain; mobile browser navigation works                    | Focused E2E, then one coherent milestone verification                                         |
| Continuation evidence          | STATUS and this checkpoint             | Distinguish local code, test doubles, real backend/browser checks and unperformed external/device acceptance               | Link/scope/format checks                                                                      |

## Working practice

- Search references first and reuse the audit; do not repeat a repository-wide review.
- Keep one owner per file group. Parallelize independent Web work only.
- Use the smallest meaningful tests during changes. Run typecheck/lint/format and coherent milestone checks once changes settle; rerun only affected failures.
- Do not replace current contracts with invented payloads. Test fixtures are explicitly simulated evidence, never production fallbacks.
- Do not turn network failure into confirmed command failure: preserve receipts, pending commands, attribution, versions, and scope fences.
- Record blockers without abandoning independent frontend work. A status request does not authorize publication.

## Deferred dependencies from the audit

Backend dependency updates, session revalidation, Docker PDF/DOCX packaging, AI admission limits, unbounded snapshot/history reads and historical Active Work reassessment remain outside this FE-only checkpoint. Web Push requires server-side subscriptions, delivery, current-access checks and an approved notification scope; do not ship a frontend-only simulation or ask for notification permission before delivery works.

Render worker/database availability and API credentials must be rechecked under separate activation authorization. The old recorded expiry dates have passed; availability is unknown. A healthy Web page alone does not establish worker health. Full iPhone/Android browser push acceptance, native parity, live-provider quality and public release remain unverified.

## Evidence and next

**First FE increment implemented and locally verified, 2026-11-17.** Branch: `codex/web-release-2026-11-17`, based on `0a76190`; changes remain uncommitted. This is a bounded checkpoint, not completion of the broader release/portfolio brief.

- Account forms identify invalid fields; password recovery restores accessible focus. Signup retains its form and verification notice while Better Auth rechecks an anonymous session. Creation preserves drafts when local journal storage fails.
- Home/invitation reads distinguish loading, failure and actual emptiness. Aborted/obsolete reads cannot reset a newer Workspace selection or reopen an accepted invitation.
- Snapshot/SSE synchronization coalesces reads, exposes offline/reconnecting/unavailable states and revalidates lost access. Terminal streams restart only through explicit retry or an online event. Reads never replay commands or imply worker health.
- Task/Active Work polls and post-command reads share request ordering and scope fences. Old successes **and failures** cannot overwrite newer state; no domain version/authority rule or polling interval changed.
- Re-selecting the same Workspace preserves the draft. Responsive navigation and detail layers restore keyboard focus. Sources, Artifacts, Calendar and Email load on demand; source/provenance controls open the original message or the existing authenticated reference inspector instead of targeting hidden content behind a dialog. Render failures offer recovery without assuming submitted commands failed.

### Verification

- `npx vitest run tests/account-access.test.ts tests/workspace-create-client.test.ts tests/client-api.test.ts tests/workspace-sync.test.ts`: **58 passed**, four files. Includes deterministic network/EventSource doubles and server-schema Unicode limit checks.
- **12 distinct targeted Chromium scenarios passed across incremental runs**, not a full-suite pass: account admission/recovery; anonymous session recheck; lost-command receipt/reload; local storage failure/recovery; responsive shell/drafts/focus; two-person Goal/Context; Artifact provenance/adoption; two availability/revocation cases; Sources/research; Active Work; Tasks/follow-up. The final runs exercised controlled delayed **real** responses for session and poll races. Only the external-provider ports use test doubles; transport faults are injected explicitly. Real auth/commands/PostgreSQL operate against isolated `miriam_e2e`, using the existing migration/harness. No development/production schema migration was introduced or applied.
- `npx tsc --noEmit --incremental false`, `npx eslint .`, `npm run format:check`, standard `npm run build`, targeted documentation links and `git diff --check`: passed. The final build includes TypeScript checking. Two pre-existing dynamic media-filesystem tracing warnings and the host npm `python` configuration warning remain.
- Browser checks initially required renewed permission because automatic approval review enforced the earlier no-browser instruction. The user explicitly authorized targeted Web tests; execution then proceeded. Initial failures exposed selector drift, the offline/OPEN-stream bug, the signup/session race and the backend limitation below; applicable regressions were corrected and rerun. Do not describe the first run as passing.
- Final protected baseline hash comparison: **335 files unchanged**, including native clients, server/contracts, migrations, ADRs, dependencies/configuration and the user's pre-existing architecture edit; HEAD unchanged and nothing staged. **206 local documentation links resolve.** A final focused read-only review of synchronization and Task/Active Work read ordering found no additional material issue in the touched frontend paths. No native build/test, live model, paid API, Render action or GitHub operation ran. Browser coverage is desktop/tablet/phone **Web viewports**, not native or physical-device acceptance. No Safari/Firefox or real-provider behavioral claim.

### Reproduced backend limitation — fixed during continuation

The first FE checkpoint reproduced `artifact.draft → 404 SOURCE_NOT_FOUND` when a question referenced the AI-authored welcome message: question admission used `source_identity`, while compilation used the human/external `workspace_source` projection. The continuation adds an [explicit reference projection](../../src/server/reference-sources.ts) for guided/rich Artifacts and reference inspection. It retains AI authorship, qualification and exact historical identity without adding model output to ordinary evidence retrieval. Original source/history and adoption rules are unchanged. Two new real-DB regressions plus Artifact regression passed (**13 tests** together with admission checks); no migration is needed for this source fix.

### Continuation evidence

- Session revocation during body parsing reproduced HTTP 200 for three mutations. Capturing one authenticated session and revalidating inside the transaction now passes **7 dedicated + 11 API regression tests**; creation/invitation lock waits, expiry and call-token issuance are covered. Trusted internal commands retain their existing boundary.
- Controlled same-major security updates and the added Web Push/test dependencies reached **zero npm audit findings**. Approved MIT licensing and publication documents are present; this is an advisory scan, not proof of absence of security defects.
- The Docker runtime now includes the document extractor and uses an allowlisted build context. Actual compiled PDF/DOCX extraction passed in a non-root/read-only/network-disabled container. [CI and image evidence](CI.md); final image rebuild remains pending later changes.
- [AI invocation guards](AI_LIMITS.md) cover real model/media boundaries, preserving unknown dispatch reservations and sufficient context. Source/admission/Artifact targeted run: **13 passed**. Migrations were applied only to isolated test/verification databases; fresh and upgrade evidence follows below.

Subsequent critical review found private email composition lacked a Workspace admission scope. This is fixed without exposing private activity in shared usage diagnostics (040); **26 targeted tests passed** for admission, Active Work and image adapters. Fresh **001–040** and seeded **037→040** verification preserved all **151 pre-existing public tables** by row hashes (23 populated), old migration timestamps/checksums and two authenticated sessions. Both reruns were no-ops and disposable verification databases were removed. This does not prove production backup recovery.

A read-only Render inspection on 17 November 2026 showed the historical Web service at commit `0a76190`. Database and worker availability, historical data recovery and the validity of credentials were unverified. The subsequent Railway beta uses a separate database. [Deployment record](RAILWAY_DEPLOYMENT.md#current-setup).

### Final local release milestone · 2026-11-17

- `npm run check`: **417 tests across 53 files passed**, with TypeScript, ESLint and formatting passing first. Duration approximately five minutes; the non-interactive runner reported results at the end. No repeated broad run was needed.
- Five targeted Chromium flows passed together: account/session recheck, two-person admission/Goal/Context, lost-command recovery, question/reference/brief adoption, and optional notification error/retry/logout behavior. The last flow verifies that merely opening settings neither asks notification permission nor installs a service worker. Real local auth/PostgreSQL/application commands; provider doubles and deliberate transport failures are test evidence only.
- Final [Web Push](WEB_PUSH.md) regressions: **20 passed** after independent review corrected stale-session cross-Workspace opt-ins, device-cap bypass/exhaustion and unavailable-provider revocation controls. Actual service-worker code runs against fake IndexedDB; vendor delivery and closed-app physical-device behavior remain unverified.
- Final deployable Docker image `rimiam-web-release-check:20261117` built successfully, including the final session-retirement correction. The compiled runtime parsed synthetic PDF/DOCX with provenance qualification and verified FFmpeg in a non-root, read-only, network-disabled container. The two known Next dynamic-filesystem tracing warnings remain. No hosting deployment occurred.
- MIT, README, contributing/security guidance, a factual technical case study and CI are prepared locally. CI has not run on GitHub; immutable action-SHA pinning remains pending a permitted remote reference check. Final npm audit has zero advisory findings. Pattern screening found no high-confidence secrets in 99 release-owned text files; two PNG icons were excluded. Ordinary branch/tag history was screened separately; local Codex snapshot refs are not publication refs and must not be mirrored.
- **145 protected baseline files unchanged**, including native clients, ADRs, old migrations and pre-existing architecture/legal material. HEAD remains `0a76190`; nothing staged, committed or pushed. The release-owned manifest contains 101 changed/new paths, excluding unrelated/personal files. Documentation review resolved 312 local links and seven anchors across 13 release documents; native-call push wording was qualified to avoid contradicting optional Web Push.
- Read-only preflight initially found isolated test DB **40/40** and development DB **35/40**. The remaining local readiness step then upgraded development **035→040** using the migration-only entry point, after a private backup was successfully restored and upgraded on a disposable copy. All **153 pre-existing public/Graphile tables** retained original row hashes (31 populated); the first 35 migration checksums/timestamps were unchanged. Post-upgrade preflight exited 0 with **40/40**. That restore test used a temporary local backup. Production recovery needs a separately verified backup. The restore database was removed. No ordinary Web/worker or provider was started. Follow [RELEASE_RUNBOOK](RELEASE_RUNBOOK.md) before starting either a local real-provider environment or the hosted worker: pending domain work can resume independently of queue counts.

**Next:** establish what can be recovered from the historical Render installation, verify backups and review pending work and credentials before preparing a concrete authorized deployment. The local branch is ready for a scoped Draft PR review; whole-repository merge/publication and live acceptance are not complete. No remote availability, real-provider quality, physical-device behavior or public-release readiness is claimed.
