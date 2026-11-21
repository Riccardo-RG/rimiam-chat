# Web release and activation runbook

Use this with [STATUS](STATUS.md), [WEB_RELEASE](WEB_RELEASE.md) and the [external-service manifest](DEPLOY_EXTERNAL_SERVICES.md). Local code, a successful build, configured credentials and an accepted deployed flow are different evidence. This runbook authorizes no external operation.

## Current remote observation

On 17 November 2026 the historical Render Web service was visible. The inspection did not establish database or worker availability, retained backups or credential validity.

For a Render recovery, establish the recoverable database, backups and worker state first. The [Railway beta](RAILWAY_DEPLOYMENT.md#current-setup) uses a separate database and has its own deployment checks.

## 1. Prepare a reviewable release locally

- Select the exact commit/files for Web publication; exclude unrelated native edits, personal files, secrets, dumps and local tooling refs. Follow [SECURITY](../../SECURITY.md).
- Record relevant targeted tests, the milestone regression/build and the actual CI result. Current CI is [Web quality](../../.github/workflows/web-ci.yml); a workflow file alone is not a passing run.
- Verify migration upgrades/checksums and the actual runtime image, including document extraction. Keep provider doubles identified; they are not live-service evidence.

## 2. Collect read-only preflight evidence before restart

From the checkout with a local `.env`:

```sh
npm run release:preflight
# Inspect the isolated local test database instead:
npm run release:preflight -- --test-database
```

The [CLI](../../scripts/release-preflight.ts) opens a PostgreSQL **REPEATABLE READ, READ ONLY** transaction with connection/query/lock timeouts. It reads project migration checksums, aggregate Graphile queue states, aggregate domain pending/unknown/expired-lease states, and current undelivered follow-ups. Configuration output is presence/boolean only. It does not print connection strings, keys, recipients, IDs, payloads, provider error text or customer content; it does not import application startup, migrate, enqueue, retry, unlock or call providers.

Non-loopback database URLs are rejected unless `--allow-remote-read` is supplied. That flag acknowledges an **already authorized** remote inspection; it is not permission by itself. Use an approved read-only database account/connection, supply configuration securely outside Git, and run the same command with the flag. `--test-database` only selects local `miriam_test` and cannot be used against a remote database. Do not paste credentials into command history or reports.

Exit `0` means evidence was collected with matching known project migrations and available inspected relations; it **does not mean safe to activate**. Exit `2` indicates pending/mismatched/unknown migrations or unavailable inspected relations. Exit `1` means inspection did not complete. Better Auth/Graphile migration compatibility, provider credential validity/expiry, backup recovery and billing require separate checks.

## 3. Review what startup can resume

Graphile jobs are delivery infrastructure. The worker also recovers domain work at startup and periodically, so an empty queue does not prove there will be no work or charge.

| Surface                                       | Review before activation                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI, research, document/image/audio processing | Queued work, expired attempts, current configuration, explicit AI invocation limits and provider budget. Paused/stopped/restricted Active Work must stay protected.                    |
| Account and invitation mail                   | Queued/configuration-waiting deliveries, expiration and unknown outcomes. Startup can deliver previously requested valid messages.                                                     |
| Gmail/Calendar                                | Authorized actions, queued reads, expired execution leases and unknown external outcomes. Use each capability's reconciliation path; do not resend blindly.                            |
| Calls/recordings/transcription                | Open calls, active/starting/stopping/unknown captures and queued transcripts. Preserve personal consent and prospective capture fences; recording consent does not authorize analysis. |
| Follow-up and Web Push                        | Current due follow-ups, device/session opt-ins, queued delivery and expired leases. Push transport acceptance is not proof of a visible notification.                                  |

Review affected work through authorized application views and capability-specific operational procedures, keeping private details out of public logs. Do not delete jobs, erase domain history, reduce required approvals or mark unknown outcomes successful to clear a backlog. If the existing tooling cannot resolve an unknown state, keep it unresolved and investigate before enabling dependent effects.

## 4. Authorize and apply the concrete deployment

Before activation, establish the target environment, preserved database/storage, region, expected service cost and exact queued effect categories. Confirm a restorable backup, migration/rollback plan, current secrets and their expiry in the provider dashboards. Check current provider credentials and data retention directly before restoring an older installation.

Present the prepared release and those consequences for authorization. Apply only the approved operations, then verify Web, worker and database separately. A Web HTTP 200/configuration-presence response does not establish worker health, valid provider credentials or successful inference. Keep privacy/retention arrangements and access to a private security-reporting channel explicit before admitting real users.

## 5. Record actual live acceptance

Use two separately authenticated people and fictional/authorized project material. Verify registration/email, invitation, shared Conversation/reconnect, one useful real-model response, versioned proposal/adoption, shared Task responsibility and a bounded Active Work with shared control. Record observed behavior, failed paths and measured provider usage separately from deterministic correctness.

For Web Push, verify explicit opt-in/disable, ended-session/access suppression and delivery with the app closed on actual supported devices; test iPhone Home Screen installation separately. No native app work is required for that browser acceptance. Activate optional Google, research, voice/calling paths only with their specific credentials/consents and corresponding live checks.

Only then publish a demo link, screenshots/video and a release claim matching the verified scope. Update STATUS with the deployed commit, actual outcomes and outstanding limits; do not replace missing human/model/device acceptance with another automated pass.
