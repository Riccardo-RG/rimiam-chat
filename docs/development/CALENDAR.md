# Calendar BUILD

Implementation checkpoint, **2026-09-10**. Product semantics: [ADR-0011](../decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md). Common transport: [MULTICLIENT](MULTICLIENT.md). External activation: [manifest](EXTERNAL_SERVICES.md). This increment does not start Workspace Email or WIRE.

## Three separate records

- **Canonical temporal state:** an autonomous personal appointment has a stable `scheduled_event` identity and immutable versions. Timing on an already adopted, self-only commitment uses `commitment_time`, retaining the commitment identity. Both contribute to the Workspace Calendar view and application-owned Context; relevant historical timing versions can be retrieved selectively by identity/text. There is no provider mirror, second commitment or inferred amendment.
- **Private external observations:** a verified connection identifies a person and their external resources. Explicit bounded event/free-busy requests produce durable observations, including source, request, resource, time, completeness and cursor. Only the currently eligible owning member can read them. They never automatically enter Accepted Information or shared AI context. Private connection/account references are excluded from shared history.
- **Shared external proposals/actions:** the person explicitly discloses the exact target label, operation and payload. A versioned action records the connection/resource versions, represented person, optional internal identity/version, preconditions and provenance. Proposal, authorization, external receipt and internal amendment are distinct.

Migrations **007–008** add these typed concepts, immutable history/approvals/transitions, publication links, durable reads and exact observation references. Existing migrations and identities are preserved. JSON is confined to validated provider payloads/observations and transition details. Current state remains directly queryable in PostgreSQL.

## Commands and authority

`src/contracts/calendar.ts` defines the shared validated vocabulary. `POST /api/v1/workspaces/{id}/commands` uses existing actor-bound command IDs/receipts and short Workspace transactions. `GET .../calendar?start=…&end=…&afterAction=…` returns the view; `GET .../calendar-history?id=…&kind=action|scheduled_event|commitment` exposes shared immutable acts, without session IDs or private observation contents. OpenAPI includes these endpoints.

- `temporal.create`, `temporal.revise`, `commitment.time.set`: explicit self-representation, current context/version and attributable reason. A commitment must already have exactly that person as its represented set; timing cannot alter its text or another person's obligations.
- `calendar.propose`, `calendar.revise`: precise create/update proposal, disclosure acknowledgement and resource access. Update requires an existing publication link; a linked payload must match its current canonical version. Material revision returns to PROPOSED and invalidates prior authorization.
- `calendar.authorize`: exact action version, context/access revisions and self-representation. It stores the authenticated session ID, membership version and approval transactionally with queued delivery. It does not report success.
- `calendar.reject`: explicit rejection before an effect may exist. `calendar.retry`: only unchanged authorized content after a proven no-effect failure. `calendar.reconcile`: observe uncertain or previously successful effects. `calendar.read`: scoped events/availability. `calendar.disconnect`: own versioned connection revocation, without external deletion.

Only self-only operations on an owned/controlled resource are supported. Membership, creator status and connection access do not grant representation. No attendee invitations, third-party notifications, delegated/shared-resource writes or generic policy engine. Runtime has no public endpoint that accepts a client claim of resource ownership: `establishCalendarConnection` is a server-only activation seam for a future verified adapter.

## Commit Point and recovery

Graphile jobs contain record IDs. A claim validates the approval and claims an attempt/lease. Provider preflight checks current rights and, for updates, the expected external revision. Immediately before writing, a fresh transaction rechecks session/account eligibility, membership, connection/resource versions, exact proposal, authority, context/access revisions, internal version and operation state. Network calls do not hold Workspace locks. Independent effects may run concurrently; uncertain effects on the same linked identity block duplicate publication/update.

The provider and PostgreSQL do not share an atomic transaction. Revocation before the Commit Point blocks execution; a change after dispatch cannot recall an already performed effect. Its receipt must still be recorded, while access to it remains authorized. This residual interval is explicit, not an exactly-once promise.

PROPOSED → AUTHORIZED → EXECUTING → SUCCEEDED; FAILED means known failure/no confirmed effect, OUTCOME_UNKNOWN means an effect may already exist. Lost responses, interrupted execution or malformed success evidence remain unknown. Recovery scans domain state, not inference logs or queue retention. Read retries are separate from write retries. A failed/restarted worker cannot silently authorize another write.

`CalendarProvider` supports discovery, access checks, bounded reads/free-busy, fetch, create, conditional update and reconciliation. Writes use a stable action/version operation key. An adapter must deduplicate that operation and support conditional updates; otherwise it must decline unsupported writes. Reconciliation reports exact applied evidence, proven absence of any accepted/in-flight effect, or unknown. Merely failing to find an event is not proof that it is safe to retry. See interface comments in `src/server/calendar-provider.ts` before implementing a real adapter.

## Identity, comparison and explicit reconciliation

Publication links join one internal identity to one external representation. Linked representations do not conflict with themselves; distinct overlapping identities produce alerts without merging. Internal revisions and observed external changes produce divergence alerts without propagation. A successful receipt certifies the performed version, not perpetual agreement with the provider's current state.

For a linked personal Scheduled Event, an external observation can prefill a correction on each client. Saving requires a reason and explicit self/disclosure acknowledgement. The server checks the precise observation, owning resource, publication identity, payload and current internal version, then appends a canonical version with its observation reference. Other private events are not disclosed. Selecting or viewing the correction makes no change. Publishing an internal revision externally still requires its own proposal and authorization. Deleted external events are observations, never automatic internal cancellation.

## Clients and verification

Web, SwiftUI and Compose have real Calendar screens: date window, personal appointment creation/revision, proposal target/payload, authorize/reject, result/unknown/retry/reconciliation, scoped observations and overlap/divergence. Existing journals persist exact commands before send; recovery consults receipts and does not auto-replay consequential approvals. Web exposes shared history; detailed native history inspection remains future client work. Commitment timing is currently a common API capability, not a separate native editing flow.

The 30-day default/31-day request maximum, 100-action pages, 50 recent observations and 200-item provider pages are transport/UI bounds, not retention or AI correctness limits. Other periods and continuation cursors can be requested; partial responses remain explicit. Existing private observations are retained. A real adapter's recovery must search the affected identity/operation independently of these display limits. General private-observation history browsing and recurring/all-day event policy are not part of this slice.

Targeted checks: `npm test -- tests/calendar.test.ts`, `npm run test:e2e -- tests/e2e/calendar.spec.ts`. Native verification uses `tests/run-native-server.ts` on **miriam_native**, compiled API 3102 and a test-only Calendar worker. `FixtureCalendar` exists only under tests; `[response-loss]` is a fixture scenario, never a runtime feature. Tests cover real PostgreSQL/auth, negative authority/isolation, stale approvals, revocation, exact retries, response loss, recovery, conditional races, provenance and absence of silent propagation. Actual build/test results and remaining release checks live in [STATUS](STATUS.md).

## WIRE boundary

The [Google adapter and OAuth boundary](GOOGLE_INTEGRATIONS.md) now implement discovery, encrypted credentials/refresh, protected connection and conditional writes. Actual Google consent, credentials and live verification remain pending; unconfigured runtime still supports internal appointments and reports external unavailability. No account, charge, hosting, push or release distribution has been activated. Provider-specific limits and real idempotency/reconciliation evidence still require controlled WIRE/VERIFY.
