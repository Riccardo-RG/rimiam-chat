import { randomUUID } from "node:crypto";
import { pool, transaction, type Tx } from "./db.ts";
import { DomainError, requireThat } from "./errors.ts";
import { lockWorkspace, changed } from "./workspace-state.ts";
import {
  actionVersion,
  calendarResource,
  calendarSession,
  calendarTransition,
  payloadEqual,
  temporalAt,
  temporalReference,
} from "./calendar-state.ts";
import {
  configuredCalendarProvider,
  calendarResourceResultSchema,
  CalendarNoEffect,
  type CalendarAccess,
  type CalendarEffect,
  type CalendarProvider,
  type CalendarReconciliation,
} from "./calendar-provider.ts";
import {
  externalEventSchema,
  observationDataSchema,
  type ExternalCalendarEvent,
} from "../contracts/calendar.ts";

const failureCode = (e: unknown) =>
  e instanceof DomainError || e instanceof CalendarNoEffect
    ? e.code
    : "CALENDAR_PROVIDER_ERROR";
function providerFor(key: string, p?: CalendarProvider) {
  const provider = p ?? configuredCalendarProvider();
  requireThat(provider?.key === key, "CALENDAR_PROVIDER_UNAVAILABLE", 503);
  return provider;
}
function externalAccess(r: Record<string, unknown>): CalendarAccess {
  return {
    connectionId: r.id as string,
    accountRef: r.external_account_ref as string,
    resourceId: r.external_id as string,
  };
}
function effect(a: Awaited<ReturnType<typeof actionVersion>>): CalendarEffect {
  return {
    operationKey: `miriam:${a.id}:${a.current_version}`,
    operation: a.operation,
    payload: a.payload,
    ...(a.external_id
      ? {
          externalId: a.external_id,
          expectedRevision: a.expected_external_revision,
        }
      : {}),
  };
}
async function validateAuthorization(tx: Tx, w: string, id: string) {
  const ws = await lockWorkspace(tx, w),
    a = await actionVersion(tx, w, id);
  const approval = (
    await tx.query(
      "SELECT * FROM calendar_authorization WHERE workspace_id=$1 AND id=$2",
      [w, a.authorization_id],
    )
  ).rows[0];
  requireThat(
    approval &&
      approval.action_version === a.current_version &&
      approval.person_id === a.person_id,
    "CALENDAR_AUTHORIZATION_REQUIRED",
    403,
  );
  const r = await calendarResource(
    tx,
    w,
    a.person_id,
    a.connection_id,
    a.resource_id,
    true,
  );
  await calendarSession(tx, a.person_id, approval.session_id);
  requireThat(
    r.current_membership_version === approval.membership_version &&
      r.version === a.connection_version &&
      r.resource_version === a.resource_version,
    "CALENDAR_ACCESS_CHANGED",
    403,
  );
  requireThat(
    ws.context_revision === approval.context_revision &&
      ws.access_revision === approval.access_revision,
    "CALENDAR_APPROVAL_STALE",
  );
  const ref = temporalReference(a);
  if (ref) {
    const t = await temporalAt(tx, w, ref, a.person_id);
    requireThat(
      payloadEqual(t.payload, a.payload),
      "CALENDAR_PAYLOAD_DIFFERS_FROM_CANONICAL",
    );
  }
  if (a.operation === "create" && a.temporal_id) {
    requireThat(
      !(
        await tx.query(
          "SELECT 1 FROM calendar_publication WHERE connection_id=$1 AND resource_id=$2 AND temporal_kind=$3 AND temporal_id=$4",
          [a.connection_id, a.resource_id, a.temporal_kind, a.temporal_id],
        )
      ).rowCount,
      "CALENDAR_ALREADY_PUBLISHED",
    );
    requireThat(
      !(
        await tx.query(
          `SELECT 1 FROM calendar_action other JOIN calendar_action_version v ON v.action_id=other.id AND v.version=other.current_version
      WHERE other.id<>$1 AND other.status IN ('EXECUTING','OUTCOME_UNKNOWN') AND v.connection_id=$2 AND v.resource_id=$3 AND v.temporal_kind=$4 AND v.temporal_id=$5`,
          [
            a.id,
            a.connection_id,
            a.resource_id,
            a.temporal_kind,
            a.temporal_id,
          ],
        )
      ).rowCount,
      "CALENDAR_OTHER_EFFECT_UNRESOLVED",
    );
  }
  if (a.operation === "update") {
    requireThat(
      !(
        await tx.query(
          `SELECT 1 FROM calendar_action other JOIN calendar_action_version v ON v.action_id=other.id AND v.version=other.current_version
      WHERE other.id<>$1 AND other.status IN ('EXECUTING','OUTCOME_UNKNOWN') AND v.publication_id=$2`,
          [a.id, a.publication_id],
        )
      ).rowCount,
      "CALENDAR_OTHER_EFFECT_UNRESOLVED",
    );
  }
  return { a, r };
}
async function finishFailure(
  w: string,
  id: string,
  attempt: string,
  unknown: boolean,
  code: string,
) {
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const a = await actionVersion(tx, w, id);
    if (
      a.attempt_id !== attempt ||
      !["EXECUTING", "OUTCOME_UNKNOWN"].includes(a.status)
    )
      return;
    const status = unknown ? "OUTCOME_UNKNOWN" : "FAILED";
    await tx.query(
      "UPDATE calendar_action SET status=$3,error_code=$4,lease_until=NULL,safe_to_retry=$5 WHERE workspace_id=$1 AND id=$2",
      [w, id, status, code, !unknown],
    );
    await calendarTransition(tx, w, id, a.current_version, status, null, {
      code,
    });
  });
}
async function recordSuccess(
  tx: Tx,
  w: string,
  a: Awaited<ReturnType<typeof actionVersion>>,
  raw: ExternalCalendarEvent,
) {
  const event = externalEventSchema.parse(raw);
  requireThat(
    event.operationKey === effect(a).operationKey &&
      event.selfOnly &&
      !event.deleted &&
      payloadEqual(event.payload, a.payload) &&
      (!a.external_id || a.external_id === event.id),
    "CALENDAR_EFFECT_NOT_PROVEN",
  );
  const publicationId = a.publication_id ?? randomUUID();
  if (a.publication_id) {
    await tx.query(
      "UPDATE calendar_publication SET external_revision=$3,published_payload=$4,temporal_version=$5,action_id=$6 WHERE workspace_id=$1 AND id=$2",
      [
        w,
        publicationId,
        event.revision,
        JSON.stringify(event.payload),
        a.temporal_version,
        a.id,
      ],
    );
  } else {
    await tx.query(
      `INSERT INTO calendar_publication(id,workspace_id,connection_id,resource_id,temporal_kind,temporal_id,temporal_version,external_id,external_revision,published_payload,action_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        publicationId,
        w,
        a.connection_id,
        a.resource_id,
        a.temporal_kind,
        a.temporal_id,
        a.temporal_version,
        event.id,
        event.revision,
        JSON.stringify(event.payload),
        a.id,
      ],
    );
  }
  await tx.query(
    "INSERT INTO calendar_publication_history(id,workspace_id,publication_id,action_id,action_version,external_revision,payload,temporal_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      w,
      publicationId,
      a.id,
      a.current_version,
      event.revision,
      JSON.stringify(event.payload),
      a.temporal_version,
    ],
  );
  await tx.query(
    "UPDATE calendar_action SET status='SUCCEEDED',external_id=$3,lease_until=NULL,error_code=NULL,safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
    [w, a.id, event.id],
  );
  // Store exact disclosed result, never arbitrary fields from the provider or a canonical rewrite.
  await calendarTransition(tx, w, a.id, a.current_version, "SUCCEEDED", null, {
    externalId: event.id,
    externalRevision: event.revision,
    operationKey: event.operationKey,
    publicationId,
  });
}

export async function processCalendarAction(
  id: string,
  provider?: CalendarProvider,
) {
  const lookup = (
    await pool.query("SELECT workspace_id FROM calendar_action WHERE id=$1", [
      id,
    ])
  ).rows[0];
  if (!lookup) return;
  const w = lookup.workspace_id as string;
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const a = await actionVersion(tx, w, id);
    if (a.status !== "AUTHORIZED") return;
    try {
      const { r } = await validateAuthorization(tx, w, id);
      const p = providerFor(r.provider, provider),
        attempt = randomUUID();
      await tx.query(
        "UPDATE calendar_action SET status='EXECUTING',attempt_id=$3,lease_until=now()+interval '60 seconds',error_code=NULL WHERE workspace_id=$1 AND id=$2",
        [w, id, attempt],
      );
      await calendarTransition(
        tx,
        w,
        id,
        a.current_version,
        "EXECUTING",
        null,
        { phase: "preflight" },
      );
      return { a, r, p, attempt };
    } catch (e) {
      await tx.query(
        "UPDATE calendar_action SET status='FAILED',error_code=$3,safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
        [w, id, failureCode(e)],
      );
      await calendarTransition(tx, w, id, a.current_version, "FAILED", null, {
        code: failureCode(e),
        noEffect: true,
      });
    }
  });
  if (!claim) return;
  const { a, r, p, attempt } = claim,
    access = externalAccess(r),
    operation = effect(a);
  // Bounded network preflight without holding the Workspace lock.
  try {
    const rights = calendarResourceResultSchema.parse(
      await p.checkAccess(access, AbortSignal.timeout(15000)),
    );
    requireThat(
      rights.id === access.resourceId && rights.canWriteSelf && rights.canRead,
      "CALENDAR_RESOURCE_ACCESS_DENIED",
      403,
    );
    if (a.operation === "update") {
      const event = await p.fetch(
        access,
        a.external_id,
        AbortSignal.timeout(15000),
      );
      requireThat(
        event &&
          event.selfOnly &&
          !event.deleted &&
          event.revision === a.expected_external_revision,
        "CALENDAR_EXTERNAL_PRECONDITION_CHANGED",
      );
    }
    // Last local check, immediately before the effect. It is not a transaction with the provider.
    await transaction(async (tx) => {
      const current = await validateAuthorization(tx, w, id);
      requireThat(
        current.a.status === "EXECUTING" &&
          current.a.attempt_id === attempt &&
          new Date(current.a.lease_until) > new Date(),
        "CALENDAR_ATTEMPT_ENDED",
      );
      await calendarTransition(
        tx,
        w,
        id,
        a.current_version,
        "EXECUTING",
        null,
        { phase: "commit_point", operationKey: operation.operationKey },
      );
    });
  } catch (e) {
    await finishFailure(w, id, attempt, false, failureCode(e));
    return;
  }
  let result: ExternalCalendarEvent;
  try {
    result = await (a.operation === "create"
      ? p.create(access, operation, AbortSignal.timeout(20000))
      : p.update(access, operation, AbortSignal.timeout(20000)));
  } catch (e) {
    await finishFailure(
      w,
      id,
      attempt,
      !(e instanceof CalendarNoEffect),
      failureCode(e),
    );
    return;
  }
  try {
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const current = await actionVersion(tx, w, id);
      if (
        current.attempt_id !== attempt ||
        !["EXECUTING", "OUTCOME_UNKNOWN"].includes(current.status)
      )
        return;
      // Recording an already performed effect remains necessary even if access ended after the Commit Point.
      await recordSuccess(tx, w, current, result);
    });
  } catch (e) {
    await finishFailure(w, id, attempt, true, failureCode(e));
  }
}

async function readBasis(tx: Tx, id: string) {
  const read = (await tx.query("SELECT * FROM calendar_read WHERE id=$1", [id]))
    .rows[0];
  requireThat(read, "CALENDAR_READ_NOT_FOUND", 404);
  const r = await calendarResource(
    tx,
    read.workspace_id,
    read.person_id,
    read.connection_id,
    read.resource_id,
  );
  await calendarSession(tx, read.person_id, read.session_id);
  requireThat(
    r.current_membership_version === read.membership_version &&
      r.version === read.connection_version &&
      r.resource_version === read.resource_version,
    "CALENDAR_ACCESS_CHANGED",
    403,
  );
  return { read, r };
}
export async function processCalendarRead(
  id: string,
  provider?: CalendarProvider,
) {
  const lookup = (
    await pool.query("SELECT workspace_id FROM calendar_read WHERE id=$1", [id])
  ).rows[0];
  if (!lookup) return;
  const w = lookup.workspace_id as string;
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const initial = (
      await tx.query("SELECT status FROM calendar_read WHERE id=$1", [id])
    ).rows[0];
    if (initial.status !== "QUEUED") return;
    try {
      const { read, r } = await readBasis(tx, id),
        p = providerFor(r.provider, provider),
        attempt = randomUUID();
      await tx.query(
        "UPDATE calendar_read SET status='READING',attempt_id=$2,lease_until=now()+interval '60 seconds' WHERE id=$1",
        [id, attempt],
      );
      return { read, r, p, attempt };
    } catch (e) {
      await tx.query(
        "UPDATE calendar_read SET status='FAILED',error_code=$2 WHERE id=$1",
        [id, failureCode(e)],
      );
      await changed(tx, w, "calendar.read_failed");
    }
  });
  if (!claim) return;
  const { read, r, p, attempt } = claim,
    access = externalAccess(r);
  try {
    const rights = calendarResourceResultSchema.parse(
      await p.checkAccess(access, AbortSignal.timeout(15000)),
    );
    requireThat(
      rights.id === access.resourceId && rights.canRead,
      "CALENDAR_RESOURCE_ACCESS_DENIED",
      403,
    );
    const a = read.action_id
      ? await transaction((tx) => actionVersion(tx, w, read.action_id))
      : undefined;
    let reconciliation: CalendarReconciliation | undefined;
    let data;
    if (a) {
      requireThat(
        a.current_version === read.action_version,
        "CALENDAR_ACTION_VERSION_STALE",
      );
      if (a.status === "OUTCOME_UNKNOWN") {
        reconciliation = await p.reconcile(
          access,
          effect(a),
          AbortSignal.timeout(15000),
        );
        data = {
          events:
            reconciliation.outcome === "applied" ? [reconciliation.event] : [],
          busy: [],
          complete: reconciliation.outcome !== "unknown",
          nextCursor: null,
        };
      } else {
        requireThat(a.status === "SUCCEEDED", "CALENDAR_NOT_RECONCILABLE");
        const event = await p.fetch(
          access,
          a.external_id,
          AbortSignal.timeout(15000),
        );
        // A missing linked event is itself an observation of divergence, not canonical cancellation.
        data = {
          events: [
            event ?? {
              id: a.external_id,
              revision: "absent",
              payload: a.payload,
              selfOnly: true,
              deleted: true,
            },
          ],
          busy: [],
          complete: true,
          nextCursor: null,
        };
      }
    } else
      data = await p.read(
        access,
        {
          mode: read.mode,
          start: new Date(read.starts_at).toISOString(),
          end: new Date(read.ends_at).toISOString(),
          ...(read.cursor ? { cursor: read.cursor } : {}),
        },
        AbortSignal.timeout(15000),
      );
    const parsed = observationDataSchema.parse(data);
    if (!a)
      for (const item of [
        ...parsed.events.map((e) => e.payload),
        ...parsed.busy,
      ])
        requireThat(
          Date.parse(item.end) > new Date(read.starts_at).getTime() &&
            Date.parse(item.start) < new Date(read.ends_at).getTime(),
          "CALENDAR_PROVIDER_OUTSIDE_WINDOW",
        );
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const current = await readBasis(tx, id);
      if (
        current.read.status !== "READING" ||
        current.read.attempt_id !== attempt
      )
        return;
      await tx.query(
        "INSERT INTO calendar_observation(id,workspace_id,read_id,resource_id,person_id,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          w,
          id,
          read.resource_id,
          read.person_id,
          JSON.stringify(parsed),
        ],
      );
      if (a && reconciliation) {
        const latest = await actionVersion(tx, w, a.id);
        if (
          latest.current_version === read.action_version &&
          latest.status === "OUTCOME_UNKNOWN"
        ) {
          if (reconciliation.outcome === "applied")
            await recordSuccess(tx, w, latest, reconciliation.event);
          else if (reconciliation.outcome === "not_applied") {
            requireThat(
              reconciliation.proof.length > 0,
              "CALENDAR_RECONCILIATION_NOT_PROVEN",
            );
            await tx.query(
              "UPDATE calendar_action SET status='FAILED',error_code='CALENDAR_CONFIRMED_NOT_APPLIED',safe_to_retry=true WHERE workspace_id=$1 AND id=$2",
              [w, a.id],
            );
            await calendarTransition(
              tx,
              w,
              a.id,
              a.current_version,
              "FAILED",
              read.person_id,
              { noEffect: true, proof: reconciliation.proof },
            );
          } else
            await calendarTransition(
              tx,
              w,
              a.id,
              a.current_version,
              "OUTCOME_UNKNOWN",
              read.person_id,
              { reconciled: false },
            );
        }
      }
      await tx.query(
        "UPDATE calendar_read SET status='COMPLETED',lease_until=NULL WHERE id=$1",
        [id],
      );
      await changed(tx, w, "calendar.observed");
    });
  } catch (e) {
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      await tx.query(
        "UPDATE calendar_read SET status='FAILED',error_code=$3,lease_until=NULL WHERE id=$1 AND attempt_id=$2 AND status='READING'",
        [id, attempt, failureCode(e)],
      );
      await changed(tx, w, "calendar.read_failed");
    });
  }
}
export async function recoverCalendar() {
  const expired = await pool.query(
    "SELECT id,workspace_id,attempt_id FROM calendar_action WHERE status='EXECUTING' AND lease_until<now()",
  );
  for (const a of expired.rows)
    await finishFailure(
      a.workspace_id,
      a.id,
      a.attempt_id,
      true,
      "CALENDAR_EXECUTION_INTERRUPTED",
    );
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE calendar_read SET status='QUEUED',attempt_id=NULL,lease_until=NULL WHERE status='READING' AND lease_until<now()",
    );
    // Queue is delivery infrastructure; recover from materialized domain state after restart.
    for (const row of (
      await tx.query("SELECT id FROM calendar_action WHERE status='AUTHORIZED'")
    ).rows)
      await tx.query(
        "SELECT graphile_worker.add_job('calendar_execute',json_build_object('id',$1::text),job_key:=$2)",
        [row.id, `calendar:${row.id}`],
      );
    for (const row of (
      await tx.query("SELECT id FROM calendar_read WHERE status='QUEUED'")
    ).rows)
      await tx.query(
        "SELECT graphile_worker.add_job('calendar_read',json_build_object('id',$1::text),job_key:=$2)",
        [row.id, `calendar-read:${row.id}`],
      );
  });
}
