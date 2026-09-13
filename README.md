# RIMIAM (repository name: MIRIAM) — progressive MVP build

A locally runnable collaborative Workspace with governed Shared Context, conversational AI adapters, versioned sources/Artifacts, Tasks/follow-up, Calendar/Email and shared Active Work with unadopted Specialist Contributions. The repository-local pre-design checkpoint is recorded in [functional coverage and evidence](docs/development/PRE_DESIGN_COMPLETENESS.md). Real-service and human acceptance, final design and release/distribution remain separate: this is **not a release-ready product**. [MVP v0.1](docs/product/MVP_SPEC_v0.1.md), its [reconciliation](docs/product/MVP_V0.2_RECONCILIATION.md) and approved ADRs remain authoritative; [GTM/product discovery](docs/product/MVP_GTM_PRODUCT_DISCOVERY.md) retains its stated approval boundaries.

Start future sessions with the [development checkpoint](docs/development/STATUS.md). External activation requirements are in the [deployment/services guide](docs/development/DEPLOY_EXTERNAL_SERVICES.md).

## Native clients and common API

[ADR-0010](docs/decisions/ADR-0010-client-nativi-backend-comune.md) records the SwiftUI / Compose / Next.js direction. All three clients expose the common MVP capabilities through server-owned commands; see [multi-client setup, contract and verification](docs/development/MULTICLIENT.md). Start `npm run api` alongside web/worker to use native clients against the same accounts and Workspaces. No physical-device distribution or cloud deployment is claimed.

## Run locally

Use Node **24.20.0**, npm and PostgreSQL 18.3. The existing Compose file is the convenient local PostgreSQL option; the application connects through `DATABASE_URL`, not through a Docker-specific domain API.

```sh
npm ci
npm run setup:env
npm run db:up
npm run db:migrate
npm run dev
```

In a second terminal:

```sh
npm run worker
```

Open **http://127.0.0.1:3000**, consistently using this hostname for cookies/origin validation. PostgreSQL binds to `127.0.0.1:54329`; its named volume preserves local data. `setup:env` never overwrites an existing `.env`. All `.env*` files except `.env.example` are ignored.

Register a test account with a password of at least 12 characters. In local development, verification links appear at `/local-mail`, in the **same browser session**. They are not sent to Gmail or any other mailbox. The local inbox requires `LOCAL_MAIL=true`, loopback and non-production mode; it is outside Workspace visibility. A second browser profile/private session supports a second account. Invitations can also target someone who has not registered yet: the link survives registration/verification and still requires explicit acceptance. **Password dimenticata?** and **Reinvia verifica email** complete the local account flow; recovery links appear in the same local inbox. Resetting a password revokes existing sessions and never restores ended membership or authority.

Stop web/worker with Ctrl-C and use `docker compose stop` to stop PostgreSQL without removing its volume.

### Local document parsers

For PDF/DOCX, use Python 3.13 (the verified local version) and install the pinned open-source parsers in a project-local environment:

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-documents.txt
```

Set `DOCUMENT_PYTHON_PATH` in your ignored `.env` to the absolute path of `.venv/bin/python`. No Codex-specific runtime is required. [Rich inputs](docs/development/RICH_INPUTS.md) documents supported formats, explicit media disclosure and limitations.

### Real adapters and unconfigured services

Normal runtime never uses deterministic AI/search fixtures. Existing `.env` files containing `AI_MODE=fixture` now behave as **unconfigured**; no configuration secret is changed automatically. Conversation, membership, sources and manually recorded questions work without AI. Interpretation-dependent features require activation:

- `AI_MODE=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL`, or `AI_MODE=ollama`, `OLLAMA_MODEL` and a trusted `OLLAMA_BASE_URL`: real structured Conversation, analysis and drafting.
- `RESEARCH_PROVIDER=brave`, `BRAVE_SEARCH_API_KEY`: real web search.
- Outside the local inbox: `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, `LOCAL_MAIL=false` and HTTPS `BETTER_AUTH_URL`: real verification, password recovery and explicitly requested invitation delivery. The worker must run; separate purpose-specific outboxes preserve exact payloads and unknown outcomes.
- Google Calendar/Gmail require the OAuth configuration and explicit consent in the [Google guide](docs/development/GOOGLE_INTEGRATIONS.md); image/voice adapters require the separate configuration in [rich inputs](docs/development/RICH_INPUTS.md).

Restart relevant processes after changing configuration. Existing failed/stale interpretations have explicit retry controls; a research request can be retried only while its original access/context remains applicable. Otherwise make a fresh request. See the manifest before activating any live provider. No external service was activated during this build.

## What to try

1. Create a Workspace, establish a Goal as personal intent and explicitly adhere. These are separate acts.
2. Invite the second person by exact email; they can register and verify after opening the invitation. Acknowledge retained full-history visibility, then copy the link or explicitly select invitation email. Missing mail configuration remains visible; provider submission is not proof of inbox delivery. Explicit membership acceptance gives no implicit Goal adherence or project authority.
3. Send group messages, or use **Chiedi a Miriam**/an explicit `@Miriam` address. Default participation is only when called; proactive collaboration is opt-in. With AI configured, inspect proposals and qualifications before accepting a descriptive reference. Corrections preserve earlier sources/versions/history.
4. In **Documenti e ricerca web**, upload supported text, PDF/DOCX, images or recorded voice. Download originals, inspect provenance or select a new source version; image/audio model processing requires explicit disclosure. Uploading alone accepts no claim or obligation. Device-voice playback of Miriam's text is optional and requires an installed voice.
5. Under **Domande aperte**, record a precise question referencing an existing message/document. AI can also propose questions; a member explicitly records them. Link an already accepted information version as a working answer or reopen with a reason.
6. Select an open question for a web query, or search independently. Review the exact outgoing query and disclosure checkbox. Without a key, the request visibly awaits configuration. With Brave activated, results retain URL/provider/time and enter interpretation as unaccepted evidence. Only result excerpts are read, not full pages.
7. With AI configured, propose an explicit commitment and name only the people it represents. Each approves the exact content for themselves. Membership/access stewardship never approves for someone else.
8. In **Brief e Artifacts**, choose a question and one or more existing Accepted Information versions, optionally select source versions, and add notes. The app compiles the actual references into a non-operative draft; this is not AI synthesis. Inspect the body, qualifications and history. Nominate only the people represented by adoption; each approves that exact version for themselves. A later draft preserves the previously adopted version until fresh valid approvals. Stale source/context/access conditions block adoption. Revisions with a changed represented set are not yet supported; no permission is inferred.
9. Open **Calendario** on web or the native app. Create a personal internal appointment, explicitly representing only yourself. This works without a provider. External proposal/authorization/observation flows are BUILD-tested with doubles; real connections remain WIRE. See [Calendar behavior and limits](docs/development/CALENDAR.md).
10. Open **Workspace Email** on web or a native client. Create a private internal draft without connecting any mailbox. Explicit source disclosure, exact authorized sends and unknown-outcome recovery are tested with doubles; real mailbox connection remains WIRE. Miriam text suggestions need the existing AI configuration. See [Email behavior and limits](docs/development/EMAIL.md).
11. Open **Lavoro e follow-up** on web, SwiftUI or Compose. Record unassigned work, explicitly accept responsibility, propose material changes, and schedule an in-app follow-up. No provider is required. See [Tasks behavior and limits](docs/development/TASKS.md).
12. Write **Analizza: tema** in the Conversation. Inspect and control the persistent work on any client; results remain unadopted. A configured analysis provider is required for real output; otherwise Miriam reports Needs Input. See [bounded Active Work](docs/development/ACTIVE_WORK.md).
13. Test voluntary exit: retained history/project obligations remain, while access ends. Re-entry needs a new valid invitation and does not revive ended governance.
14. In People, link another Workspace you can contribute to. Links are versioned navigation for people with current access to both endpoints; they copy no Context, membership or authority.

## Test efficiently

PostgreSQL must be running. Initialize the separate domain-test database once, then use targeted feedback:

```sh
npm run test:setup
npm test -- tests/sources-research.test.ts
npm test -- tests/artifacts.test.ts
npm test -- tests/account-delivery.test.ts
npm test -- tests/account-recovery.test.ts
npm test -- tests/calendar.test.ts
npm run typecheck
```

Use targeted regressions per coherent increment. At milestones/session end/release, run broad checks:

```sh
npm run check
npm run test:e2e
npm run build
```

For a specific browser capability:

```sh
npm run test:e2e -- tests/e2e/sources.spec.ts
```

`test:e2e` creates/migrates **miriam_e2e**, launches isolated web/worker processes on **3100**, uses `.next-e2e`, and stops its services afterward. Its deterministic interpreter/search adapters are injected **only by the test worker**. It never attaches that worker to the development database. Domain tests use `miriam_test`. Real-auth recovery tests deliberately honor rate-limit retry headers; this targeted security suite can take about two minutes. Test accounts/data remain in those isolated databases for diagnosis; snapshots/traces go to ignored `test-results/` and `playwright-report/`. Browser installation, if missing: `npx playwright install chromium`.

If an execution sandbox blocks the `tsx` launcher’s IPC, the equivalent command is `node --env-file=.env --import tsx scripts/migrate.ts` (or the other script path). This does not require a different dependency.

## Structure and durable boundaries

- `src/app`: authenticated HTTP routes and UI; `src/client`: snapshot types, API and source/question/Artifact/account components.
- `src/server/commands.ts`: validated, idempotent application commands. `workspace-state.ts`: eligibility, membership, short commit locks and revision notifications. No model/network call runs under a Workspace transaction.
- `sources.ts`: original document bytes, validation and versions. `research.ts`: application-owned work/attempt lifecycle and stale/cancellation fences. `research-provider.ts`: replaceable search port and real Brave adapter.
- `questions.ts`: explicit question/working-answer transitions. `interpretation.ts`: application-owned context construction, structured AI validation and candidate publication.
- `artifacts.ts`: typed immutable brief versions, selected dependencies, review and attributable adoption receipts; separate current-draft/current-adoption pointers.
- `email-*.ts`: private mailbox reads/disclosure, versioned drafts/composition, exact self-authorized send and reconciliation; [Email guide](docs/development/EMAIL.md).
- `calendar-*.ts`: typed temporal state, private observations, exact-action commands/approvals, Commit Point execution and recovery; [Calendar guide](docs/development/CALENDAR.md).
- `account-delivery.ts`: durable account-mail queue, encrypted bearer links, lease/attempt guards and bounded transport retries. `verification-mail.ts`: fixed-purpose verification/reset transport; no Workspace mailbox or project authority.
- `migrations`: additive SQL, checksum-checked by the runner. Current state and immutable source/version/history are directly queryable in PostgreSQL. Composite Workspace references prevent cross-tenant links.
- `tests`: real PostgreSQL domain checks, deterministic HTTP transport tests and two-member browser paths. No credentials or live providers required.

The source identity registry preserves existing message IDs and adds document/web identities. It is a source-reference mechanism, **not a generic domain `context_item`**. Source content remains in its typed record. `workspace_source` is a read view; queues, SSE and inference diagnostics are not the system of record.

Research stores the exact request, requester, Goal/question versions, context/access/member versions, attempts, results and lifecycle history. Duplicate delivery cannot republish a completed attempt. After cancellation or ended membership, an old result cannot revive authority. Stale-context results may remain historical, without automatic interpretation. Crashed research becomes visibly failed; explicit retry may repeat a read request/provider charge, so no exactly-once external-service claim is made. Interpretation retries use generation fences and do not rewrite previous candidates.

Context includes anchored current state, relevant source provenance, disagreement, questions and selectively retrieved old text. No fixed message/version/token cutoff defines correctness. An exhausted expansion budget yields `MORE_CONTEXT_REQUIRED`, not an accepted insufficient answer. Conversation paging is presentation, not a Context retention boundary.

## Before release

Connect the required services with explicit disclosure/consent, verify actual model usefulness and external outcomes, perform manual multi-user acceptance, then complete and validate the final visual/device experience. Hosting/TLS, runtime privileges, restore/monitoring and signed distribution depend on the selected deployment target. No cloud deployment, purchase or external account setup has occurred. Keep the local development stack/inbox private. [STATUS](docs/development/STATUS.md) records exact coverage, verification and remaining limits; advanced nested Context inheritance, video calls, outbound push and billing are not included by implication. [Voice messages, RIMIAM voice dialogue and human audio calls](docs/development/VOICE_CALLS.md) are included under ADR-0015; live provider/device verification remains pending.
