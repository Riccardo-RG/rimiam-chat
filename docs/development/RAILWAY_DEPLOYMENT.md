# Railway deployment preparation

Updated **2026-11-27**. Use the [release runbook](RELEASE_RUNBOOK.md) for recovery/activation and the [external-service manifest](DEPLOY_EXTERNAL_SERVICES.md) for optional capabilities.

## Current setup

The hosted Web client and its worker share PostgreSQL. The manual guide covers preparing a reviewed commit for a Web-only upload. [Web beta](https://rimiam-chat-web-production.up.railway.app/) · [Manual release guide](DEPLOY_WEB_MANUALE.md)

| Date in 2026 | Scope and verification |
| --- | --- |
| 26 November | Web and worker deployed from [e58b07d](https://github.com/Riccardo-RG/rimiam-chat/commit/e58b07d2650cb7112015c1ff493dba7d7c4e9639). The pre-migration backup restored successfully in isolation. Production reached `076_library_copy_visibility.sql` with zero missing initial visibility events. The worker reported ready queues. Web health returned 200 and anonymous workspace and personal listings returned 401. The served release ID was `9ac7c22f-642c-4ffe-bb0f-38a20e56c267`. Mobile distribution is separate. |
| 21 November | Web and worker ran through migration 075. The worker reported queue readiness. The signed-in Home showed conversations, personal tools and the daily agenda in order. Public health returned 200 and private lists returned 401 to anonymous requests. The release endpoint served its identifier with caching disabled. A database archive passed a complete read. An isolated restore and physical iPhone acceptance remain open. Native builds were tested locally. [Physical iPhone guide](PROVA_IPHONE.md) |
| 20 November | The Studio Web release passed responsive login and registration checks. Profile controls shipped through migration 063, followed by Google identity and calendar integration through 072. The Google handoff requested identity scopes for sign-in. Calendar access was in external testing. Completing consent and reading a real private event remained pending, as did Microsoft registration. A later Web release updated touch controls, the Home calendar entry and assistant settings. The Safari toolbar evidence uses synthetic accounts on a simulator. [Responsive checks](../design/reviews/2026-11-20-studio/README.md) · [Published login](../design/reviews/2026-11-20-mobile-check/railway-login.jpg) · [Safari toolbar](../design/reviews/2026-11-20-mobile-check/safari-13-pro-toolbar.webp) · [Google setup](GOOGLE_INTEGRATIONS.md#self-hosting-with-google) |
| 19 November | Web and worker shipped the agenda, direct conversation and personal utility contracts through migration 062. Pre- and post-migration workspace and message counts matched. Signed-in Home, protected API routes, health and worker readiness were checked. |
| 18 November | Two test accounts verified sign-in, invitation, shared history after reload and a real assistant response. Subsequent releases added in-app invitations, grouped chat messages, a more compact composer and explicit assistant requests. In the hosted client, both `/file` and `/documenti` opened the document collection. Local Chromium and WebKit tests exercised sending and selected-message replies using a deterministic provider. Real-device push delivery remained open. [Device acceptance](CI.md) |

## Supported configuration path

Use the dashboard settings below. Railway's current [IaC documentation](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code) says new services cannot use legacy `railway.toml` / `railway.json`, and legacy support ends **2026-12-01**. Therefore this preparation adds neither file. The replacement requires `railway/iac` and CLI tooling; installing that SDK is unnecessary for this three-service deployment and is not part of this checkpoint. No new application dependency or platform abstraction is introduced.

## Deployment specification

Create one project/environment for the initial private beta, after the account owner approves billing and the concrete release. Reuse its generated HTTPS domain for staging; do not duplicate three always-running services merely to get a second environment. Keep the current Render host/DNS until Railway acceptance and a separately authorized cutover.

| Setting            | Web                                                      | Worker                                     | PostgreSQL                                      |
| ------------------ | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Suggested name     | `rimiam-chat-web`                                        | `rimiam-chat-worker`                       | `Postgres`                                      |
| Source             | Exact authorized Web release snapshot                    | Same snapshot                              | Railway PostgreSQL template                     |
| Build              | Root `Dockerfile`; root context; no custom build command | Same                                       | Provider template                               |
| Start command      | `/app/scripts/render-web.sh`                             | `/app/scripts/render-worker.sh`            | Template default                                |
| Region             | Pick a region close to users                            | Same as Web                                | Same as Web and worker, including the volume    |
| Replicas           | 1                                                        | 1                                          | Single node for this beta                       |
| Serverless/sleep   | **Off**                                                  | **Off**                                    | **Off**                                         |
| Public networking  | Generated HTTPS domain                                   | None                                       | None; private connection only                   |
| Healthcheck        | `/api/health`, timeout 300 seconds                       | No HTTP healthcheck: no HTTP server exists | Template default                                |
| Restart            | Always                                                   | Always                                     | Template default; verify restart behavior       |
| Persistent storage | None                                                     | None                                       | Template's persistent volume, scheduled backups |

The [existing image](../../Dockerfile) includes Node 24, Python PDF/DOCX extraction and FFmpeg. Its historically named [Web](../../scripts/render-web.sh) and [worker](../../scripts/render-worker.sh) scripts are host-independent. Both apply checksum-protected migrations under the existing [PostgreSQL advisory lock](../../src/migrate.ts) before starting; do not add another migration command. This is not an automatic rollback strategy.

Railway [detects the root Dockerfile](https://docs.railway.com/builds/dockerfiles) and supports [overriding its start command](https://docs.railway.com/deployments/start-command). Build there from the approved source so the host builds for its own architecture. Do not upload an ARM-only Mac image: Railway's [platform support clarification](https://station.railway.com/questions/service-isn-t-starting-no-long-just-st-aae9dba1) identifies AMD64. A separately prepared image must include `linux/amd64`; actual remote build/runtime compatibility remains a deployment check.

Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` on Web and worker to allow shutdown before forced termination; this is an operational starting value, not proof that every in-flight job finishes. Durable recovery remains authoritative. See [deployment lifecycle](https://docs.railway.com/deployments/reference). Leave autodeploy/PR environments off until a concrete publication/release workflow is authorized. Do not connect an older `main` deployment by accident or upload the dirty development directory; publish only the reviewed Web snapshot, excluding personal files, secrets and unrelated native changes.

## Initial environment: external effects disabled

Apply these to **both Web and worker before their first start**. Names match [.env.example](../../.env.example); credentials belong only in Railway's secret variables.

| Variable                               | Initial value / source                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | `${{Postgres.DATABASE_URL}}`, the template's private connection; never its public URL                 |
| `BETTER_AUTH_URL`                      | Exact generated Web HTTPS origin, without a path; same value on both services                         |
| `BETTER_AUTH_SECRET`                   | Same securely generated secret on both; preserve the original when restoring existing encrypted state |
| `LOCAL_MAIL`                           | `false`                                                                                               |
| `MAIL_PROVIDER`                        | `unconfigured`                                                                                        |
| `AI_MODE`                              | `unconfigured`                                                                                        |
| `AI_MAX_INVOCATIONS_PER_MINUTE`        | `0`                                                                                                   |
| `AI_MAX_INVOCATIONS_PER_DAY`           | `0`                                                                                                   |
| `AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY` | `0`                                                                                                   |
| `RESEARCH_PROVIDER`                    | `unconfigured`                                                                                        |
| `TRANSCRIPTION_PROVIDER`               | `unconfigured`                                                                                        |
| `WEB_PUSH_ENABLED`                     | `false`                                                                                               |
| `APP_REVISION`                         | Exact deployed commit SHA, once selected                                                              |

The Dockerfile sets `NODE_ENV=production`, Python path and telemetry configuration; the Web script listens on Railway's injected `PORT` at `0.0.0.0`. No standalone API process, Redis or additional queue service is required for this Web deployment.

Initially **omit all provider credentials**, including OpenAI/Anthropic, Resend, Brave, Google sign-in/Calendar/Gmail, LiveKit/storage and VAPID keys. Do not copy the whole local `.env` or old Render environment. Zero AI admission limits are dispatch guards, not dollar budgets or context limits. Starting a worker can still recover domain work and change its operational state: unconfigured providers are **not** a general read-only/dry-run mode. In particular, do not start it against restored data before the runbook's queue/unknown-outcome review.

Without provider activation, this stage validates hosting, database connectivity and application startup only. Fresh users cannot complete email verification; Emme must report unavailable/Needs Input instead of fabricating a response. Do not bypass verification to make staging appear functional.

## Data, persistence and backup boundary

- **Fresh Railway database ≠ recovered Render data.** A new database contains no previous accounts, Workspaces, history or queue. The local development database is not a verified replacement for the missing Render database. A fresh beta is a separate explicitly approved start; it must never be presented as migration/recovery of earlier conversations.
- For recovery, establish a usable authorized Render backup and the original encryption secret first. Restore into an isolated target, compare identities/history/checksums, run the [read-only preflight](../../scripts/release-preflight.ts), then authorize migrations and startup. Never combine histories by copying arbitrary rows or run a new worker against the old remote database merely to test connectivity.
- Use the maintained [PostgreSQL template](https://docs.railway.com/databases/postgresql), with a persistent volume and private `DATABASE_URL`. Local verification used PostgreSQL **18.3**; prefer the maintained 18.x template if offered and verify its actual version before migration. A different major requires a targeted compatibility check. Do not replace the template's image/mount/start settings with an improvised database maintenance setup.
- Place all services and the database volume in the [same region](https://docs.railway.com/deployments/regions) before retaining data. Verify the mounted database directory and volume capacity through the template rather than guessing a PostgreSQL-version-specific mount path. Monitor capacity: original documents/voice messages and domain history use PostgreSQL. Core chat does not need a separate object store; call recordings later do.
- Enable daily and weekly [volume backups](https://docs.railway.com/volumes/backups), plus a pre-migration backup, within the approved budget. Current retention is six days for daily snapshots and 27 days for weekly snapshots. Perform a restore rehearsal before claiming recovery readiness. Railway snapshots restore within the same project/environment; keep a protected logical export for provider-independent recovery. Do not destroy the original database/volume after a successful import or assume a container/image rollback reverses database changes.

## Staged activation and acceptance

For the initial CLI upload, run from the verified snapshot's `source` directory with a `RAILWAY_TOKEN` scoped to this environment. Check the snapshot against its manifest and confirm the target IDs in the dashboard before each upload. Do not place the token in shell history, logs or repository files.

```sh
railway up --detach --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" --service "$WEB_SERVICE_ID"
# After the Web deployment is healthy:
railway up --detach --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" --service "$WORKER_SERVICE_ID"
```

For personal utilities and chat reminders, coordinate Web and worker rollout. Quiesce the old worker and writes during migration, apply 042–044 in order, and start the matching binaries before enabling traffic. An old binary cannot safely schedule the new occurrences. Check one due reminder in a group and another in Personal with two accounts, including which opted-in devices receive a notice.

Confirm the new Web origin returns 200 from `/api/health` and 401 for an unauthenticated Workspace request. Check the worker deployment reaches queue readiness before enabling providers. An assigned hostname alone does not establish a running deployment.

1. **Owner/account gate:** account terms, plan, region, spend alert/hard-limit choice and exact release authorization. Then create/configure the three services, keeping application startup blocked until variables and the fresh-versus-restored data choice are settled. No provider is enabled by this document.
2. **Infrastructure stage:** approve startup; verify the deployed source revision, database version, migrations through the last file in the release, Web health, worker logs/recovery and absence of unexpected effects. `/api/health` checks PostgreSQL but does not prove the worker or AI works. Railway [healthchecks](https://docs.railway.com/deployments/healthchecks) gate deployment only, not continuing availability. Check database-backed continuity after one controlled restart.
3. **Minimum useful chat, separate activation:** configure Resend (`MAIL_PROVIDER=resend`, `MAIL_FROM`, `RESEND_API_KEY`, verified sender) for real signup/recovery/invitations. Configure OpenAI (`AI_MODE=openai`, `AI_MODEL`, `OPENAI_API_KEY`) and the trial safeguards below, then redeploy both. Review backlog first and verify credentials privately. Keep additional providers disabled unless their capabilities are part of the trial.
4. **Two-user acceptance:** real email verification and invitation, common Workspace, persistent Conversation/reconnect, one useful real Emme response and a bounded shared-control Active Work. Record actual errors, usage and recoverability separately from deterministic/local evidence. Push and every optional integration require their own activation and live checks in the [service manifest](DEPLOY_EXTERNAL_SERVICES.md).
5. **Cutover:** after acceptance, authorize the intended application hostname/DNS and update `BETTER_AUTH_URL`, OAuth callbacks and related origin-dependent settings together. Keep the old host/data recoverable and avoid two active workers operating on the same preserved database. Do not move the landing page or make the repository public implicitly.

## Cost and observability

On 18 November 2026 the hosted worker’s admission limits changed without a schema migration. Operators can configure the per-minute, deployment-wide and per-workspace limits independently. Limits count admitted provider calls across capabilities. A chat turn can use several calls, and the provider prices the tokens used.

When using `AI_MODEL=gpt-4.1-mini`, set the public `AI_USAGE_RATES_JSON` tariff below on Web and worker so the [on-demand report](BETA_FEEDBACK.md) can estimate priced shared Conversation and Active Work calls. Update the model key and rates together when changing models. The [model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini) was checked on 2026-11-18. OpenAI lists [14 January 2027](https://developers.openai.com/api/docs/deprecations) for this snapshot's retirement, so plan to change the configured model before that date.

```json
[
  {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "inputPerMillionUsd": 0.4,
    "cachedInputPerMillionUsd": 0.1,
    "outputPerMillionUsd": 1.6,
    "verifiedOn": "2026-11-18"
  }
]
```

Review subscription charges, compute, storage, backups and network usage before enabling a hosted beta. Estimate the baseline from observed idle usage and repeat the measurement under a representative workload. Provider charges are accounted for separately. [Railway plans and usage pricing](https://docs.railway.com/pricing/plans)

Review the consequences of a spending alert and a hard limit before enabling either. Reaching a Railway compute hard limit takes workloads offline. External providers manage their own budgets. Keep the worker always running for timers, recovery and scheduled follow-ups. [Railway cost control](https://docs.railway.com/pricing/cost-control) · [Serverless behavior](https://docs.railway.com/deployments/serverless)

Inspect service CPU/RAM/restarts, database volume growth, deployment/worker errors and aggregate queue/unknown outcomes; use the existing preflight/runbook rather than logging messages, transcripts, tokens or reset links. Review usage after the first acceptance session and after a day of idle operation. Automated observability monitors may require a higher plan; they are not assumed included. The initial remote build, two-account smoke check, OpenAI response and email delivery are recorded above. Backup restore, worker restart/recovery under load, real-device notifications and broader user acceptance remain open.
