# AI invocation safeguards

The production [model](../../src/server/structured-llm.ts) and [media](../../src/server/media-provider.ts) adapters reserve an invocation through [the admission gate](../../src/server/ai-admission.ts) before dispatch. Migrations [038](../../migrations/038_ai_admission.sql) and [040](../../migrations/040_private_ai_admission.sql) store immutable, content-free reservations. Conversation, Active Work, private email composition, image understanding and transcription share this gate; local PDF/DOCX extraction does not consume it. Private email uses a separate admission scope and never enters the shared usage report. Each transcribed call segment counts separately. Test doubles remain test-only.

| Variable                               | Default | Meaning                                     |
| -------------------------------------- | ------: | ------------------------------------------- |
| `AI_MAX_INVOCATIONS_PER_MINUTE`        |      20 | Deployment-wide rolling minute              |
| `AI_MAX_INVOCATIONS_PER_DAY`           |     500 | Deployment-wide rolling 24 hours            |
| `AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY` |     200 | Rolling 24 hours for the supplied Workspace |

Zero blocks new dispatches in that scope. Invalid settings fail closed with `AI_LIMIT_CONFIGURATION_INVALID`. The global transaction lock covers only admission/counting, never model execution, so multiple workers cannot overshoot the admitted count. Workspace-less adapter calls still consume the global limits. Production Workspace calls supply their scope. Interrupted, failed and unknown dispatches retain reservations: a crash must not become free capacity. Counters survive worker restarts and use database time. There is no automatic refund or blind resubmission.

These are configurable operational abuse/cost safeguards, **not a dollar spending cap**. Input size, model pricing, provider accounting and each call's output limit affect cost. They do not meter Brave, email, hosting, LiveKit or storage. Configure provider-side billing controls separately and verify them live. The existing [usage report](BETA_FEEDBACK.md) remains diagnostics rather than authoritative billing; it covers Conversation/Active Work and can report unknown cost.

A denied operation retains the original source/work and a readable limit error. It produces no partial accepted information or adopted result. The user can retry after capacity becomes available; existing stale/access/authority rules still apply. No context is truncated to fit a quota: [Minimum Sufficient Context](../decisions/ADR-0004-context-efficiency-minimum-sufficient-context.md) remains authoritative. Model-output length exhaustion is an explicit failure/input condition, never success.

OpenAI Responses requests explicitly set `store:false` for text and images. This avoids optional provider response storage; it does not claim zero provider retention or replace contractual/privacy verification. Workspace history stays in PostgreSQL.

Verification: `tests/ai-admission.test.ts` exercises real PostgreSQL concurrent reservation, global/Workspace/rolling limits, immutable unknown outcomes, malformed configuration and denial before model/media dispatch. Adapter tests use a mocked admission port to isolate schema/provider behavior. No live paid invocation is part of these checks.
