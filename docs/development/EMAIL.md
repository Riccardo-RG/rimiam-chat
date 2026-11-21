# Workspace Email BUILD

**2026-09-10.** Supported model: [ADR-0012](../decisions/ADR-0012-workspace-email-privacy-bozze-invio.md). Shared transport/session discipline: [MULTICLIENT](MULTICLIENT.md). Actual verification/checkpoint: [STATUS](STATUS.md). Real mailbox activation remains [WIRE](EXTERNAL_SERVICES.md).

## Persistence and private boundary

Migrations **009–010** add person-owned mailbox connections, immutable connection history, bounded read requests/observations, private attachment bytes, internal drafts/versions, composition suggestions, exact send proposals/authorizations, attempts/transitions/receipts and explicit disclosure links. PostgreSQL owns current state and historical provenance; Graphile carries record IDs. Existing migrations and approved ADRs are unchanged.

Connection discovery is a trusted server seam (`establishMailbox`), not a public claim of ownership. It records verified account/sender/capabilities and the current membership version. Departure/re-entry cannot revive that relationship. Account-security mail/Resend grants no mailbox authority. The current slice requires readable mailbox access; sending additionally requires verified self-send capability.

Mailbox observations, metadata, BCC, attachments, drafts, AI suggestions and send details stay in the owner's private operational surface. They are excluded from shared Context, conversation, shared history and shared revision notifications. They are not hidden personal AI memory inside Shared Context. Queries require current eligible membership and the owning actor; operations additionally require contribution capability, actual session and relevant connection permissions. Logout/Workspace changes clear client read state and fence late responses.

An explicit disclosure copies only the selected exact body excerpt or selected attachment into the existing unaccepted document-source pipeline. Its qualification identifies private-email origin and distinguishes contributor from author. An immutable `email_disclosure` links that shared source to the exact private observation/message/attachment; thread/provider references remain on the private original. Shared members see the disclosed content and contributor, not undisclosed headers, sender address, BCC or other original content. Access to original evidence remains private. Disclosure acknowledges current/future members' retained-history visibility under ADR-0009; it creates neither Accepted Information nor an adopted obligation.

## Draft and composition

A new internal draft works without a mailbox; its placeholder sender is the authenticated person's account address and cannot be sent until a verified controlled connection is selected. Every save/revision is attributable and immutable. New, reply and forward retain the exact observation/message target. Reply prepares the reply-to address and appropriate subject; forward prepares editable source text, without automatically including attachments or additional thread content. The complete outgoing envelope must still be inspected and explicitly authorized.

Emme can suggest subject/body for a **saved exact draft version**, using only that draft text and the person's explicit instruction. The small `EmailComposer` boundary reuses existing AI configuration, never the mailbox provider. No implicit Workspace/mailbox retrieval, recipients or attachment bytes are sent for composition. Insufficient context yields a clarification instead of invented text. The untrusted structured result is validated, privately persisted with instruction/base version, and cannot modify the draft or send. An explicit subsequent draft revision can cite its composition ID; manual refinement retains that provenance. Concurrent edits/access revocation reject a stale result. Suggestions are available in private history after response loss; retrying composition may rerun inference, never send email. Live model quality remains VERIFY-pending; unconfigured AI returns `AI_CONFIGURATION_REQUIRED`.

## Exact envelope, Commit Point and recovery

The authorized envelope includes sender, ordered To/CC/BCC, subject/body, exact file identity/version/hash/filename and new/reply/forward target. No provider adapter may append a signature, quoted text, recipients or forwarded attachments. Workspace files are referenced without duplicating bytes in the draft; their latest version must still match at execution. Private attachments remain owner/connection protected. Explicit attachment disclosure creates separate shared source bytes so later private-access changes do not silently rewrite shared history.

Draft changes invalidate earlier PROPOSED/AUTHORIZED/FAILED actions. Exactly one send action exists per draft version. EXECUTING/OUTCOME_UNKNOWN blocks revisions of that draft and blind retry/rejection; a receipt must resolve the possible effect first. A separately created intentional new message remains a separate operation, not an inferred retry.

Only **self-representation** is supported. Creator status, access governance, membership and technical mailbox access cannot authorize representing another person. Authorization is an explicit session-bound command against exact draft/context/access versions and disclosure to named recipients.

Execution claims a fenced attempt/lease. Before Commit Point the provider verifies sender/capabilities and the source of a reply/forward; a fresh short transaction revalidates session/account, member/contribution/access, connection, exact envelope/hash/version, files and action state. Provider calls do not hold Workspace locks. Independent sends can run concurrently. Context/access changes conservatively require fresh authorization; this is not a semantic policy engine.

PROPOSED → AUTHORIZED → EXECUTING → SUCCEEDED, with FAILED, OUTCOME_UNKNOWN and explicit REJECTED. Immutable transitions record approvals, attempts, Commit Point, errors and receipts. The stable operation key binds action/version/envelope. Recovery scans domain records, expires interrupted executions to unknown and separately recovers safe bounded reads. Provider acceptance followed by response loss stays unknown; a missing search result is not proof of no effect. Reconciliation needs a matching accepted receipt or positive evidence excluding accepted/in-flight delivery before a retry. Otherwise uncertainty remains and no resend is scheduled.

A receipt proves provider acceptance, not final delivery/read. Local and external commits are not atomic; revocation before Commit Point blocks dispatch, while a later revocation cannot undo an already accepted send. Its receipt remains recorded and private. Real adapters must implement these guarantees or decline unsupported operations.

## Common API and clients

`src/contracts/email.ts` and OpenAPI define the common contract. Standard cookie/CSRF web and signed native sessions use the same server rules.

- `GET /api/v1/workspaces/{id}/email`: private capability view, shared disclosure references, draft paging (`before`) and exact observation lookup (`observationId`).
- `GET .../email-history?draftId=…`: private immutable versions, composition provenance and transitions.
- `GET .../email-attachment?id=…`: authenticated private byte download, attachment disposition/no-store.
- `POST .../email-compose`: bounded instruction + draft ID/version; private suggestion only, not an application-state authorization.
- Existing `/commands` and `/receipts`: `email.draft.create/revise`, `email.propose/authorize/reject/retry/reconcile`, `email.read`, `email.disclose`, `email.attachment.disclose`, `email.disconnect`. Exact command payloads use actor-bound receipts and durable client journals.

The Web app supports mailbox connection, bounded private reads, explicit excerpt and attachment disclosure, versioned new/reply/forward drafts, composition suggestions, exact-envelope review and send reconciliation. Read the [client checkpoint](MULTICLIENT.md) for mobile availability.

Private Email view refresh is foreground/panel-scoped polling independent of shared Workspace revision. SSE remains a shared-change hint, never a channel carrying mailbox data. Read requests are paged/bounded rather than whole-mailbox imports. Drafts page by stable creation order; observations retain exact source/request/completeness/cursor. Current 50-observation display, 50-message provider pages, text/recipient/file size bounds are operational bounds, not retention or universal context-sufficiency rules. A caller can fetch relevant messages/threads/pages and exact historical observation IDs. General private-history browsing remains outside this minimum UI.

## Verification and WIRE

`tests/email.test.ts` uses real PostgreSQL/commands/auth with deterministic provider/composer boundaries for privacy/isolation, negative authority, disclosure/provenance, exact attachments, reply/forward, stale approvals/AI output, Commit Point revocation, response loss, recovery and reconciliation. [Browser regressions](../../tests/e2e/email.spec.ts) cover the Web workflow and check that a member can find installation guidance without losing an unsaved draft. OAuth handoffs in that test stop at the provider boundary. Real mailbox consent and delivery require the live checks below.

In a Workspace, open **Strumenti → Email → Le tue caselle**. Choose Gmail or Outlook and complete consent in the provider tab. The selected mailbox address must match the verified RIMIAM address. If several eligible connections exist, choose the sender in the draft. **Controlla invio** opens the precise review. **Autorizza e invia** authorizes that version and its recipients and attachments. A member can save a private draft in RIMIAM before connecting a mailbox.

Gmail and Outlook.com/Microsoft 365 each have a delegated connection and provider-specific receipt. Outlook can accept a submission for processing without giving a message identifier. No transport receipt proves delivery. See [mailbox activation and acceptance](DEPLOY_EXTERNAL_SERVICES.md#caselle-personali-gmail-e-outlook) and the [Google credential boundary](GOOGLE_INTEGRATIONS.md). Explicit attachment disclosure uses [rich input ingestion](RICH_INPUTS.md). A mailbox connection alone never shares correspondence or authorizes a send.
