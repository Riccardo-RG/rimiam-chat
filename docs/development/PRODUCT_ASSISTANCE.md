# Product capability awareness and contextual help

Implemented locally on 2026-09-29 following the user's request to make Miriam explain actual app capabilities, create explicitly requested shared filoni, and help with unclear forms. This integrates existing product boundaries; it approves no new governance or external capability.

## Runtime boundary

- [Capability map](../../src/server/product-capabilities.ts) supplies a compact, server-derived description of shipped actions, execution mode and configuration presence to Conversation inference. It distinguishes explanation, preparation, existing UI and Commit Points. Presence is not service health, private connection status, permission or a successful operation. It never reads private mailbox/calendar connections or drafts.
- [Product guide](../../src/shared/product-guide.ts) owns stable screen/field IDs, actual field requirements and English model-facing explanations. Only an explicitly selected screen/field/issue is attached to a help message through the [strict contract](../../src/contracts/product-assistance.ts). No form values, raw errors, DOM or screenshots are captured. Update the guide alongside affected forms/contracts; preserve version interpretation when changing its semantics.
- Contextual help is response-only, including in discreet mode without an @mention. The server prevents help metadata from starting Active Work or publishing extracted candidates, organization, handoffs or work-control proposals. Remove the visible help reference to send an ordinary operational request.
- Free-form conversation without a help reference cannot inspect the screen. Miriam should ask which screen/field is unclear instead of inventing it. [Prompt](../../src/server/miriam-prompt.ts) uses the guide and existing qualified Workspace state; no whole-repository prompt, generic tools or agent framework was added.

## Explicit shared filone creation

`@Miriam crea un filone chiamato "Marketing"` creates a shared Workstream through the existing contributor command in the authenticated message transaction. A bounded Italian/English parser accepts simple named requests; complex, conditional, private-room or compound requests remain ordinary Conversation input for clarification or the existing Filoni UI. This is not unrestricted natural-language command execution, and does not apply to audio/document extraction.

The [adapter](../../src/server/conversation-workstreams.ts) reuses Workspace locking, current session/eligibility/contribution checks, `workstream.save`, source linking and idempotent command receipts. One exact normalized-name active match is reused. Proposed, resolved, archived or ambiguous matches require input; no implicit activation/reopening. Different people can contribute without creator/requester privilege. A Workstream is still a view of shared history, not a private room, Goal or access grant.

The human source, Workstream version/link and deterministic Miriam reply commit atomically. Successful creation/reuse bypasses model inference; the reply carries a historical operation result and link to the actual Workstream. AI organization remains proposed. Other changes/adoptions/external effects retain their existing governed UI and Commit Points.

## Persistence and clients

[Migration 037](../../migrations/037_product_assistance_workstream_actions.sql) adds immutable explicit help references (including guide version) and source-bound Workstream action receipts. Existing source history is not rewritten. Both legacy web snapshots and v1 sync/history expose optional nullable `assistanceContext` and `operationResult`; earlier messages remain compatible. Command journals retain the exact metadata for retry.

Web offers screen/field/issue help and a removable Conversation reference. Native screen-level help was implemented locally in that increment; its changes remain outside the 2026-10-07 Web publication and are retained for later native alignment. Original form drafts stay local and mounted while help is composed; account/Workspace changes invalidate the interaction. Stored references and historical operation outcomes remain inspectable. Opening a receipt resolves the Workstream's current version/state, without rewriting the historical outcome.

## Verification and limits

Focused coverage: [server/contract/provenance](../../tests/conversation-product-assistance.test.ts), [guide/configuration](../../tests/product-capabilities.test.ts), [web help](../../tests/product-help-client.test.ts). Native test compilation from the earlier local increment remains historical evidence in STATUS, not current native runtime acceptance. Completion evidence and pending deployment/live checks belong in [STATUS](STATUS.md).

Model response usefulness and arbitrary conversational phrasing still need real-provider behavioral acceptance. Browser/manual/device validation is pending. The original local increment did not include provider activation, credential changes or publication. On 2026-10-07 the user authorized the Web redesign and commit/push; its publication includes these existing server/contract/Web dependencies and migration 037. Native changes remain unpublished. Apply migration 037 through the existing migration path before running the updated web/worker/API against a database.
