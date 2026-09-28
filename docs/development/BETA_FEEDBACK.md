# Beta feedback and on-demand AI usage

Small testing aid requested by the user on 2026-09-26, extended in the same conversation with on-demand cost estimates. No ADR/product-governance change, automated evaluation loop, provider activation or billing system.

## Web use

- Write `/feedback Your observation` in the Conversation composer, or open a message’s existing source/origin details and choose **Feedback**. A visible composer hint distinguishes the explicit command from ordinary chat; natural messages are not silently intercepted.
- **Lens → Feedback beta** collects the Workspace's shared notes. A contributor can add an attributed note; eligible members can read/export retained notes under the existing shared-history policy. Corrections are additional notes. Feedback never becomes a Conversation source, model input, Context candidate, accepted information or project task.
- **Scarica report (.md)** exports original notes and only explicitly linked messages, with attribution/time and safe configuration at capture. Configuration at capture is not execution provenance for an older message. Review the file before sharing it with Codex: user text may contain sensitive information. Nothing is sent automatically.
- **Mostra utilizzo e costi stimati** explicitly reads the last 7/30 days. No cost counters, cost messages, warnings or automatic summaries appear in Conversation. Usage is included in the downloaded report only while this section is open; export rechecks current access and rereads current data.

This aid currently has a web UI and authenticated common API; native beta-report screens are not implemented. It does not change existing native product capabilities. Report reads above 1,000 notes fail explicitly rather than silently truncate; subdivided export is not implemented.

## Usage coverage and pricing

Only **shared Conversation interpretation and Active Work analysis** are instrumented. The server records each actual dispatch attempt before contacting a configured model, then stores provider-reported input/cache/output counts when available. Retries and expansion rounds are separate attempts. Invalid output can still consume tokens; timeouts, crashes or failed outcome persistence remain unknown, never zero. Usage predating migration 035 cannot be reconstructed. Successful output is preserved if outcome bookkeeping fails; the recorded attempt stays unresolved. Failure to persist an attempt prevents that dispatch.

Private Email activity, image extraction, transcription/speech, Brave/search, calls, hosting, storage and subscriptions are **excluded**; no private capability metadata is disclosed through this report. No prompts, outputs, credentials or diagnostic error bodies enter usage records. Counts are diagnostic evidence, not domain state or authority. Refreshing the report makes no model call.

Configure optional `AI_USAGE_RATES_JSON` on the server/worker when activating providers; restart API/worker processes after upgrading code/configuration. It is a JSON array, matched exactly by `provider` (`openai`, `anthropic`, `ollama`) and `model`, with these fields:

| Field                                                 | Meaning                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `inputPerMillionUsd`, `outputPerMillionUsd`           | Verified USD rate per million uncached input / total output tokens    |
| `cachedInputPerMillionUsd`, `cacheWritePerMillionUsd` | Optional; required when the corresponding measured bucket is nonzero  |
| `verifiedOn`                                          | ISO date on which the operator checked that model's applicable tariff |

Use actual applicable rates from the provider, not invented defaults. Empty, invalid, duplicate or unmatched configuration leaves cost **unknown** while retaining counts. Each attempt snapshots its tariff; later configuration changes do not silently reprice history. Calculation: `(uncached input × input rate + cached reads × cached rate + cache writes × write rate + output × output rate) / 1,000,000`. Cache buckets are not double-counted, and reasoning tokens already included in total output are not added again. Missing/inconsistent counts leave the estimate unknown. USD subtotals cover **only priced attempts** and display coverage; they are not total application cost or a provider invoice. Tiered/custom pricing, taxes, discounts and currency conversion are not modeled. Check the provider bill during live verification.

Reference: [OpenAI response usage](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) documents input, cached/cache-write and output/reasoning counts. The implementation consumes the installed AI SDK's normalized usage; no token estimation from visible text or paid Usage API polling. Model-facing report guidance is English; original feedback and messages retain their language.

## Maintenance and verification

- Persistence: migrations [034](../../migrations/034_beta_feedback.sql), [035](../../migrations/035_shared_ai_usage.sql); immutable notes/usage attempts/results, existing command receipts and Workspace guards. Diagnostic usage does not advance project/Context revisions or emit Conversation events.
- Boundaries: [feedback command/read](../../src/server/beta-feedback.ts), [usage capture/read](../../src/server/ai-usage.ts), [model adapter](../../src/server/structured-llm.ts), [common contracts](../../src/contracts/beta-feedback.ts), [usage contract](../../src/contracts/ai-usage.ts), [web panel](../../src/client/workspace-beta-feedback.tsx), [Markdown serialization](../../src/shared/beta-feedback.ts).
- Targeted verification: [feedback](../../tests/beta-feedback.test.ts), [usage](../../tests/ai-usage.test.ts), [adapter](../../tests/structured-llm.test.ts), common [API contract](../../tests/api-contract.test.ts). Production observations are not simulated by these tests; real-provider consumption/bill reconciliation and manual download acceptance remain pending.
