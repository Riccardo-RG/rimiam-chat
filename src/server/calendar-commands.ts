import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { member, changed, type WorkspaceRow } from "./workspace-state.ts";
import {
  actionVersion,
  calendarResource,
  calendarSession,
  calendarTransition,
  payloadEqual,
  temporalAt,
} from "./calendar-state.ts";
import type { CalendarCommand } from "../contracts/calendar.ts";

async function source(tx: Tx, w: string, id?: string) {
  if (id)
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM message WHERE workspace_id=$1 AND id=$2",
          [w, id],
        )
      ).rowCount,
      "CALENDAR_SOURCE_NOT_FOUND",
      404,
    );
}
async function enqueue(tx: Tx, task: string, id: string) {
  await tx.query(
    "SELECT graphile_worker.add_job($1,json_build_object('id',$2::text),max_attempts:=3)",
    [task, id],
  );
}
export async function applyCalendar(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: CalendarCommand,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  await member(tx, w, actor, true);
  if (c.type === "temporal.create" || c.type === "temporal.revise") {
    requireThat(
      c.expectedContextRevision === ws.context_revision,
      "CONTEXT_STALE",
    );
    await source(tx, w, c.sourceMessageId);
    let observationId: string | null = null,
      externalEventId: string | null = null;
    if (c.type === "temporal.revise" && c.sourceObservationId) {
      requireThat(
        c.shareObservedContent === true,
        "CALENDAR_EXPLICIT_SHARING_REQUIRED",
        400,
      );
      const observation = (
        await tx.query(
          `SELECT o.*,r.connection_id FROM calendar_observation o JOIN calendar_resource r ON r.workspace_id=o.workspace_id AND r.id=o.resource_id
         WHERE o.workspace_id=$1 AND o.id=$2 AND o.person_id=$3`,
          [w, c.sourceObservationId, actor],
        )
      ).rows[0];
      requireThat(observation, "CALENDAR_OBSERVATION_NOT_FOUND", 404);
      await calendarResource(
        tx,
        w,
        actor,
        observation.connection_id,
        observation.resource_id,
      );
      const publication = (
        await tx.query(
          `SELECT external_id FROM calendar_publication WHERE workspace_id=$1 AND resource_id=$2 AND temporal_kind='scheduled_event' AND temporal_id=$3`,
          [w, observation.resource_id, c.eventId],
        )
      ).rows[0];
      const observed = observation.data.events.find(
        (e: { id: string }) => e.id === publication?.external_id,
      );
      requireThat(
        observed &&
          !observed.deleted &&
          payloadEqual(observed.payload, c.payload),
        "CALENDAR_OBSERVED_CORRECTION_MISMATCH",
      );
      observationId = observation.id;
      externalEventId = observed.id;
    }
    let eventId: string, version: number;
    if (c.type === "temporal.create") {
      eventId = randomUUID();
      version = 1;
      await tx.query(
        "INSERT INTO scheduled_event(id,workspace_id,person_id,current_version) VALUES($1,$2,$3,1)",
        [eventId, w, actor],
      );
    } else {
      eventId = c.eventId;
      version = c.expectedVersion + 1;
      await temporalAt(
        tx,
        w,
        { kind: "scheduled_event", id: eventId, version: c.expectedVersion },
        actor,
      );
      await tx.query(
        "UPDATE scheduled_event SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
        [w, eventId, version],
      );
    }
    await tx.query(
      `INSERT INTO scheduled_event_version(workspace_id,event_id,version,title,starts_at,ends_at,time_zone,actor_id,reason,source_message_id,source_observation_id,source_external_event_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        w,
        eventId,
        version,
        c.payload.title,
        c.payload.start,
        c.payload.end,
        c.payload.timeZone,
        actor,
        c.reason,
        c.sourceMessageId ?? null,
        observationId,
        externalEventId,
      ],
    );
    await changed(tx, w, c.type, true);
    return { eventId, version };
  }
  if (c.type === "commitment.time.set") {
    requireThat(
      c.expectedContextRevision === ws.context_revision,
      "CONTEXT_STALE",
    );
    const adopted = await tx.query(
      "SELECT p.id FROM normative_proposal p JOIN current_project_act a ON a.proposal_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 AND p.kind='commitment'",
      [w, c.commitmentId],
    );
    const people = await tx.query(
      "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
      [w, c.commitmentId],
    );
    requireThat(
      adopted.rowCount &&
        people.rows.length === 1 &&
        people.rows[0].person_id === actor,
      "CALENDAR_SELF_AUTHORITY_REQUIRED",
      403,
    );
    const current =
      (
        await tx.query(
          "SELECT current_version FROM commitment_time WHERE workspace_id=$1 AND proposal_id=$2",
          [w, c.commitmentId],
        )
      ).rows[0]?.current_version ?? 0;
    requireThat(current === c.expectedVersion, "TEMPORAL_VERSION_STALE");
    const version = current + 1;
    await tx.query(
      "INSERT INTO commitment_time(workspace_id,proposal_id,current_version) VALUES($1,$2,$3) ON CONFLICT(workspace_id,proposal_id) DO UPDATE SET current_version=$3",
      [w, c.commitmentId, version],
    );
    await tx.query(
      "INSERT INTO commitment_time_version(workspace_id,proposal_id,version,starts_at,ends_at,time_zone,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        w,
        c.commitmentId,
        version,
        c.time.start,
        c.time.end,
        c.time.timeZone,
        actor,
        c.reason,
      ],
    );
    await changed(tx, w, c.type, true);
    return { commitmentId: c.commitmentId, version };
  }
  if (c.type === "calendar.disconnect") {
    const r = await tx.query(
      "UPDATE calendar_connection SET active=false,version=version+1 WHERE workspace_id=$1 AND id=$2 AND person_id=$3 AND version=$4 AND active RETURNING version",
      [w, c.connectionId, actor, c.expectedVersion],
    );
    requireThat(r.rowCount, "CALENDAR_CONNECTION_STALE_OR_DENIED", 403);
    await tx.query(
      "INSERT INTO calendar_connection_history(workspace_id,connection_id,version,actor_id,active,basis) VALUES($1,$2,$3,$4,false,'explicit_disconnection')",
      [w, c.connectionId, r.rows[0].version, actor],
    );
    await changed(tx, w, c.type);
    return { disconnected: true };
  }
  if (c.type === "calendar.propose" || c.type === "calendar.revise") {
    const resource = await calendarResource(
      tx,
      w,
      actor,
      c.connectionId,
      c.resourceId,
      true,
    );
    await source(tx, w, c.sourceMessageId);
    if (c.temporal) {
      const t = await temporalAt(tx, w, c.temporal, actor);
      requireThat(
        payloadEqual(t.payload, c.payload),
        "CALENDAR_PAYLOAD_DIFFERS_FROM_CANONICAL",
      );
    }
    let preconditionObservationId: string | null = null;
    let publication:
      | {
          temporal_id: string | null;
          temporal_kind: string | null;
          external_id: string;
          external_revision: string;
        }
      | undefined;
    if (c.operation === "update") {
      requireThat(c.publicationId, "CALENDAR_PUBLICATION_REQUIRED", 400);
      publication = (
        await tx.query(
          "SELECT * FROM calendar_publication WHERE workspace_id=$1 AND id=$2 AND connection_id=$3 AND resource_id=$4",
          [w, c.publicationId, c.connectionId, c.resourceId],
        )
      ).rows[0];
      requireThat(publication, "CALENDAR_PUBLICATION_NOT_FOUND", 404);
      requireThat(
        (c.temporal?.id ?? null) === publication.temporal_id &&
          (c.temporal?.kind ?? null) === publication.temporal_kind,
        "CALENDAR_IDENTITY_MISMATCH",
      );
      // A linked external change is never silently overwritten. A fresh observed revision may be proposed explicitly.
      const observed = (
        await tx.query(
          `SELECT o.id,e.value FROM calendar_observation o CROSS JOIN LATERAL jsonb_array_elements(o.data->'events') e(value)
        WHERE o.workspace_id=$1 AND o.resource_id=$2 AND o.person_id=$3 AND e.value->>'id'=$4 ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`,
          [w, c.resourceId, actor, publication.external_id],
        )
      ).rows[0];
      if (observed) {
        publication = {
          ...publication,
          external_revision: observed.value.revision,
        };
        preconditionObservationId = observed.id;
      }
    } else requireThat(!c.publicationId, "INVALID_REQUEST", 400);
    let actionId: string, version: number;
    if (c.type === "calendar.revise") {
      const previous = await actionVersion(tx, w, c.actionId);
      requireThat(
        previous.proposed_by === actor && previous.person_id === actor,
        "CALENDAR_SELF_AUTHORITY_REQUIRED",
        403,
      );
      requireThat(
        previous.current_version === c.expectedVersion &&
          ["PROPOSED", "AUTHORIZED", "FAILED"].includes(previous.status),
        "CALENDAR_ACTION_NOT_REVISABLE",
      );
      actionId = c.actionId;
      version = c.expectedVersion + 1;
      await tx.query(
        "UPDATE calendar_action SET current_version=$3,status='PROPOSED',authorization_id=NULL,attempt_id=NULL,lease_until=NULL,error_code=NULL,safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
        [w, actionId, version],
      );
    } else {
      actionId = randomUUID();
      version = 1;
      await tx.query(
        "INSERT INTO calendar_action(id,workspace_id,current_version,status) VALUES($1,$2,1,'PROPOSED')",
        [actionId, w],
      );
    }
    await tx.query(
      `INSERT INTO calendar_action_version(workspace_id,action_id,version,connection_id,connection_version,resource_id,resource_version,person_id,proposed_by,target_label,operation,publication_id,temporal_kind,temporal_id,temporal_version,payload,expected_external_revision,external_id,reason,source_message_id,precondition_observation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        w,
        actionId,
        version,
        c.connectionId,
        resource.version,
        c.resourceId,
        resource.resource_version,
        actor,
        `${resource.label} / ${resource.resource_label}`,
        c.operation,
        c.publicationId ?? null,
        c.temporal?.kind ?? null,
        c.temporal?.id ?? null,
        c.temporal?.version ?? null,
        JSON.stringify(c.payload),
        publication?.external_revision ?? null,
        publication?.external_id ?? null,
        c.reason,
        c.sourceMessageId ?? null,
        preconditionObservationId,
      ],
    );
    await calendarTransition(tx, w, actionId, version, "PROPOSED", actor, {
      reason: c.reason,
    });
    return { actionId, version };
  }
  if (c.type === "calendar.read") {
    const r = await calendarResource(
      tx,
      w,
      actor,
      c.connectionId,
      c.resourceId,
    );
    await calendarSession(tx, actor, sessionId);
    const span = Date.parse(c.end) - Date.parse(c.start);
    requireThat(
      span > 0 && span <= 31 * 86400000,
      "CALENDAR_READ_WINDOW_INVALID",
      400,
    );
    const readId = randomUUID();
    await tx.query(
      `INSERT INTO calendar_read(id,workspace_id,connection_id,resource_id,person_id,session_id,membership_version,connection_version,resource_version,mode,starts_at,ends_at,cursor,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'QUEUED')`,
      [
        readId,
        w,
        c.connectionId,
        c.resourceId,
        actor,
        sessionId,
        r.current_membership_version,
        r.version,
        r.resource_version,
        c.mode,
        c.start,
        c.end,
        c.cursor ?? null,
      ],
    );
    await enqueue(tx, "calendar_read", readId);
    await changed(tx, w, c.type);
    return { readId };
  }
  const a = await actionVersion(tx, w, c.actionId);
  requireThat(a.current_version === c.version, "CALENDAR_ACTION_VERSION_STALE");
  requireThat(a.person_id === actor, "CALENDAR_SELF_AUTHORITY_REQUIRED", 403);
  if (c.type === "calendar.reject") {
    requireThat(
      ["PROPOSED", "AUTHORIZED", "FAILED"].includes(a.status),
      "CALENDAR_EFFECT_MAY_ALREADY_EXIST",
    );
    await tx.query(
      "UPDATE calendar_action SET status='REJECTED',safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
      [w, a.id],
    );
    await calendarTransition(tx, w, a.id, c.version, "REJECTED", actor, {
      reason: c.reason,
    });
    return { actionId: a.id, status: "REJECTED" };
  }
  const r = await calendarResource(
    tx,
    w,
    actor,
    a.connection_id,
    a.resource_id,
    c.type !== "calendar.reconcile",
  );
  await calendarSession(tx, actor, sessionId);
  requireThat(
    r.version === a.connection_version &&
      r.resource_version === a.resource_version,
    "CALENDAR_RESOURCE_STALE",
  );
  if (c.type === "calendar.authorize") {
    requireThat(
      ["PROPOSED", "FAILED"].includes(a.status),
      "CALENDAR_NOT_AWAITING_AUTHORIZATION",
    );
    requireThat(
      ws.context_revision === c.expectedContextRevision &&
        ws.access_revision === c.expectedAccessRevision,
      "CALENDAR_APPROVAL_STALE",
    );
    if (a.temporal_id) {
      const t = await temporalAt(
        tx,
        w,
        {
          kind: a.temporal_kind,
          id: a.temporal_id,
          version: a.temporal_version,
        },
        actor,
      );
      requireThat(
        payloadEqual(t.payload, a.payload),
        "CALENDAR_PAYLOAD_DIFFERS_FROM_CANONICAL",
      );
    }
    const authorizationId = randomUUID();
    await tx.query(
      `INSERT INTO calendar_authorization(id,workspace_id,action_id,action_version,person_id,session_id,membership_version,context_revision,access_revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        authorizationId,
        w,
        a.id,
        c.version,
        actor,
        sessionId,
        r.current_membership_version,
        ws.context_revision,
        ws.access_revision,
      ],
    );
    await tx.query(
      "UPDATE calendar_action SET status='AUTHORIZED',authorization_id=$3,error_code=NULL,safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
      [w, a.id, authorizationId],
    );
    await calendarTransition(tx, w, a.id, c.version, "AUTHORIZED", actor);
    await enqueue(tx, "calendar_execute", a.id);
    return { actionId: a.id, status: "AUTHORIZED" };
  }
  if (c.type === "calendar.retry") {
    requireThat(
      a.status === "FAILED" && a.safe_to_retry && a.authorization_id,
      "CALENDAR_RECONCILIATION_REQUIRED",
    );
    // Reuses the exact authorization/version; the worker revalidates it, never manufactures a fresh approval.
    await tx.query(
      "UPDATE calendar_action SET status='AUTHORIZED',error_code=NULL,safe_to_retry=false WHERE workspace_id=$1 AND id=$2",
      [w, a.id],
    );
    await calendarTransition(tx, w, a.id, c.version, "AUTHORIZED", actor, {
      retry: true,
    });
    await enqueue(tx, "calendar_execute", a.id);
    return { actionId: a.id, status: "AUTHORIZED" };
  }
  requireThat(
    c.type === "calendar.reconcile" &&
      ["OUTCOME_UNKNOWN", "SUCCEEDED"].includes(a.status),
    "CALENDAR_NOT_RECONCILABLE",
  );
  const readId = randomUUID();
  await tx.query(
    `INSERT INTO calendar_read(id,workspace_id,connection_id,resource_id,person_id,session_id,membership_version,connection_version,resource_version,mode,action_id,action_version,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reconcile',$10,$11,'QUEUED')`,
    [
      readId,
      w,
      a.connection_id,
      a.resource_id,
      actor,
      sessionId,
      r.current_membership_version,
      r.version,
      r.resource_version,
      a.id,
      c.version,
    ],
  );
  await enqueue(tx, "calendar_read", readId);
  await changed(tx, w, c.type);
  return { readId };
}
