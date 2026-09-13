import { authenticatedSession as calendarSession } from "./workspace-state.ts";
export { authenticatedSession as calendarSession } from "./workspace-state.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { changed, lockWorkspace, member } from "./workspace-state.ts";
import {
  calendarPayloadSchema,
  type CalendarPayload,
  type TemporalRef,
} from "../contracts/calendar.ts";
import type { CalendarProvider } from "./calendar-provider.ts";

export const payloadEqual = (a: CalendarPayload, b: CalendarPayload) =>
  a.title === b.title &&
  Date.parse(a.start) === Date.parse(b.start) &&
  Date.parse(a.end) === Date.parse(b.end) &&
  a.timeZone === b.timeZone;

export async function calendarContext(tx: Tx, w: string, terms?: string[]) {
  return (
    await tx.query(
      `SELECT * FROM (
    SELECT 'scheduled_event' AS kind,e.id,v.version,e.current_version,v.version=e.current_version AS current,e.person_id,v.title,v.starts_at,v.ends_at,v.time_zone,v.actor_id,v.reason,v.source_message_id,v.source_observation_id
    FROM scheduled_event e JOIN scheduled_event_version v ON v.workspace_id=e.workspace_id AND v.event_id=e.id WHERE e.workspace_id=$1
    UNION ALL SELECT 'commitment',t.proposal_id,v.version,t.current_version,v.version=t.current_version,v.actor_id,p.content,v.starts_at,v.ends_at,v.time_zone,v.actor_id,v.reason,NULL::uuid,NULL::uuid
    FROM commitment_time t JOIN commitment_time_version v ON v.workspace_id=t.workspace_id AND v.proposal_id=t.proposal_id
    JOIN normative_proposal p ON p.id=t.proposal_id WHERE t.workspace_id=$1) timing
    WHERE ($2::text[] IS NULL AND current) OR EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE timing.id::text=term OR timing.title ILIKE '%'||term||'%' OR timing.reason ILIKE '%'||term||'%')
    ORDER BY kind,id,version`,
      [w, terms ?? null],
    )
  ).rows;
}
export function rowPayload(row: Record<string, unknown>): CalendarPayload {
  return calendarPayloadSchema.parse({
    title: row.title,
    start: new Date(row.starts_at as string).toISOString(),
    end: new Date(row.ends_at as string).toISOString(),
    timeZone: row.time_zone,
  });
}
export async function calendarResource(
  tx: Tx,
  w: string,
  actor: string,
  connectionId: string,
  resourceId: string,
  write = false,
) {
  await member(tx, w, actor, true, true);
  const r = await tx.query(
    `SELECT c.*,r.id AS local_resource_id,r.external_id,r.version AS resource_version,r.label AS resource_label,
    r.can_read,r.can_write_self,m.version AS current_membership_version
    FROM calendar_connection c JOIN calendar_resource r ON r.connection_id=c.id AND r.workspace_id=c.workspace_id
    JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=c.person_id
    WHERE c.workspace_id=$1 AND c.id=$2 AND r.id=$3 AND c.person_id=$4 FOR SHARE OF c,r`,
    [w, connectionId, resourceId, actor],
  );
  const row = r.rows[0];
  requireThat(
    row &&
      row.active &&
      row.membership_version === row.current_membership_version &&
      row.can_read &&
      (!write || row.can_write_self),
    "CALENDAR_RESOURCE_ACCESS_DENIED",
    403,
  );
  return row;
}
export async function temporalAt(
  tx: Tx,
  w: string,
  ref: TemporalRef,
  actor?: string,
) {
  if (ref.kind === "scheduled_event") {
    const r = await tx.query(
      `SELECT e.person_id,e.current_version,v.* FROM scheduled_event e JOIN scheduled_event_version v ON
      v.workspace_id=e.workspace_id AND v.event_id=e.id AND v.version=e.current_version WHERE e.workspace_id=$1 AND e.id=$2`,
      [w, ref.id],
    );
    const row = r.rows[0];
    requireThat(
      row && row.current_version === ref.version,
      "TEMPORAL_VERSION_STALE",
    );
    if (actor)
      requireThat(
        row.person_id === actor,
        "CALENDAR_SELF_AUTHORITY_REQUIRED",
        403,
      );
    return { payload: rowPayload(row), personId: row.person_id as string };
  }
  const r = await tx.query(
    `SELECT p.content AS title,t.current_version,v.* FROM normative_proposal p JOIN current_project_act a ON a.proposal_id=p.id
    JOIN commitment_time t ON t.workspace_id=p.workspace_id AND t.proposal_id=p.id
    JOIN commitment_time_version v ON v.workspace_id=t.workspace_id AND v.proposal_id=t.proposal_id AND v.version=t.current_version
    WHERE p.workspace_id=$1 AND p.id=$2 AND p.kind='commitment'`,
    [w, ref.id],
  );
  const row = r.rows[0];
  requireThat(
    row && row.current_version === ref.version,
    "TEMPORAL_VERSION_STALE",
  );
  const people = await tx.query(
    "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
    [w, ref.id],
  );
  requireThat(
    people.rows.length === 1 && (!actor || people.rows[0].person_id === actor),
    "CALENDAR_SELF_AUTHORITY_REQUIRED",
    403,
  );
  return {
    payload: rowPayload(row),
    personId: people.rows[0].person_id as string,
  };
}
export async function actionVersion(tx: Tx, w: string, id: string) {
  const r = await tx.query(
    `SELECT a.*,v.*,a.id FROM calendar_action a JOIN calendar_action_version v ON
    v.workspace_id=a.workspace_id AND v.action_id=a.id AND v.version=a.current_version WHERE a.workspace_id=$1 AND a.id=$2`,
    [w, id],
  );
  requireThat(r.rowCount, "CALENDAR_ACTION_NOT_FOUND", 404);
  return r.rows[0];
}
export function temporalReference(
  row: Record<string, unknown>,
): TemporalRef | undefined {
  return row.temporal_id
    ? {
        kind: row.temporal_kind as TemporalRef["kind"],
        id: row.temporal_id as string,
        version: row.temporal_version as number,
      }
    : undefined;
}
export async function calendarTransition(
  tx: Tx,
  w: string,
  id: string,
  version: number,
  status: string,
  actor: string | null,
  detail: Record<string, unknown> = {},
) {
  await tx.query(
    `INSERT INTO calendar_transition(id,workspace_id,action_id,action_version,status,actor_id,authorization_id,attempt_id,detail)
    SELECT $1,workspace_id,id,$4,$5,$6,authorization_id,attempt_id,$7 FROM calendar_action WHERE workspace_id=$2 AND id=$3`,
    [randomUUID(), w, id, version, status, actor, JSON.stringify(detail)],
  );
  await changed(tx, w, `calendar.${status.toLowerCase()}`);
}
// Server-only activation seam. The caller must complete OAuth/credential verification first.
// There is intentionally no public endpoint accepting provider subjects or claiming resource control.
export async function establishCalendarConnection(
  actor: string,
  w: string,
  sessionId: string,
  provider: CalendarProvider,
  verifiedAccountRef: string,
  label: string,
  finalize?: (tx: Tx, connectionId: string) => Promise<void>,
) {
  z.string().min(1).max(500).parse(verifiedAccountRef);
  z.string().trim().min(1).max(120).parse(label);
  await transaction(async (tx) => {
    await member(tx, w, actor, true);
    await calendarSession(tx, actor, sessionId);
  });
  const resources = await provider.discover(
    verifiedAccountRef,
    AbortSignal.timeout(15000),
  );
  const parsed = z
    .array(
      z
        .object({
          id: z.string().min(1).max(1000),
          label: z.string().min(1).max(200),
          canRead: z.boolean(),
          canWriteSelf: z.boolean(),
        })
        .strict(),
    )
    .max(200)
    .parse(resources);
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await member(tx, w, actor, true, true);
    await calendarSession(tx, actor, sessionId);
    const m = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    const id = randomUUID();
    await tx.query(
      "INSERT INTO calendar_connection(id,workspace_id,person_id,provider,external_account_ref,label,membership_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, w, actor, provider.key, verifiedAccountRef, label, m.version],
    );
    await tx.query(
      "INSERT INTO calendar_connection_history(workspace_id,connection_id,version,actor_id,active,basis) VALUES($1,$2,1,$3,true,'verified_external_connection')",
      [w, id, actor],
    );
    const ids: string[] = [];
    for (const r of parsed) {
      const rid = randomUUID();
      ids.push(rid);
      await tx.query(
        "INSERT INTO calendar_resource(id,workspace_id,connection_id,external_id,label,can_read,can_write_self) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [rid, w, id, r.id, r.label, r.canRead, r.canWriteSelf],
      );
    }
    await changed(tx, w, "calendar.connected");
    // Trusted integration finalization is atomic with connection/history creation.
    await finalize?.(tx, id);
    return { connectionId: id, resourceIds: ids };
  });
}
