import { transaction, type Tx } from "./db.ts";
import { authenticatedSession, eligible, member } from "./workspace-state.ts";
import {
  agendaQuerySchema,
  agendaViewSchema,
  agendaDestinationSchema,
} from "../contracts/agenda.ts";
import { requireThat } from "./errors.ts";
import {
  followupAt,
  followupReference,
  followupRecurrence,
  followupZone,
  nextVisibleFollowup,
} from "./tasks-state.ts";
import type { TaskCommand } from "../contracts/tasks.ts";
import { activeCalendarConnections } from "./calendar-queries.ts";

const visible = `visible AS (
  SELECT w.id AS wid,w.name AS "workspaceName",(w.personal_owner_id=$1) IS TRUE AS personal,m.version AS member_version,m.contributes
  FROM membership m JOIN workspace w ON w.id=m.workspace_id
  WHERE m.user_id=$1 AND m.active AND w.personal_archive_id IS NULL AND (w.personal_owner_id IS NULL OR w.personal_owner_id=$1)
)`;
const reminderVisible = `NOT EXISTS (SELECT 1 FROM followup_occurrence_change x WHERE
  (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(r."workspaceId",r.id,r.version,r.at))
  AND NOT EXISTS (SELECT 1 FROM followup_series_split s WHERE s.workspace_id=r."workspaceId" AND s.followup_id=r.id AND s.effective_at<=r.at)
  AND NOT EXISTS (SELECT 1 FROM followup_occurrence_dismissal d WHERE
  (d.workspace_id,d.followup_id,d.version,d.scheduled_at,d.person_id)=(r."workspaceId",r.id,r.version,r.at,$1))`;

export async function agendaView(
  actor: string,
  sessionId: string,
  day: string,
  zone: string,
) {
  agendaQuerySchema.parse({ day, zone });
  return transaction(async (tx) => {
    // The complete view is projected from one membership and clock snapshot.
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, sessionId);
    const {
      rows: [{ start, end, today, hasLinkedCalendar }],
    } = await tx.query(
      `SELECT $1::date::timestamp AT TIME ZONE $2 AS start,($1::date+1)::timestamp AT TIME ZONE $2 AS "end", ((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2 AS today,
        EXISTS (SELECT 1 FROM (${activeCalendarConnections}) c JOIN workspace w ON w.id=c.workspace_id
          WHERE c.person_id=$3 AND w.personal_owner_id=$3 AND w.personal_archive_id IS NULL) AS "hasLinkedCalendar"`,
      [day, followupZone(zone), actor],
    );
    const events = await tx.query(
      `WITH ${visible}
      SELECT e.workspace_id AS "workspaceId",s."workspaceName",s.personal,e.id,v.version,v.title,'event' AS kind,
      v.starts_at AS at,v.ends_at AS until,e.person_id AS owner,false AS recurring,CASE WHEN s.personal THEN NULL ELSE COALESCE(r.response,'pending') END AS rsvp
      FROM scheduled_event e JOIN visible s ON s.wid=e.workspace_id JOIN scheduled_event_version v ON (v.workspace_id,v.event_id,v.version)=(s.wid,e.id,e.current_version)
      LEFT JOIN scheduled_event_response r ON (r.workspace_id,r.event_id,r.version,r.person_id,r.membership_version)=(s.wid,e.id,v.version,$1,s.member_version)
      WHERE v.starts_at<$3 AND v.ends_at>$2 AND r.response IS DISTINCT FROM 'declined'
      AND (s.personal OR v.audience='all' OR EXISTS(SELECT 1 FROM scheduled_event_invitee i WHERE
       (i.workspace_id,i.event_id,i.version,i.person_id,i.membership_version)=(s.wid,e.id,v.version,$1,s.member_version)))`,
      [actor, start, end],
    );
    const reminders = await tx.query(
      `WITH ${visible}, scheduled AS (
      SELECT s.wid AS "workspaceId",s."workspaceName",s.personal,f.id,v.version,v.content AS title,f.owner_id AS owner,v.recurrence_weekdays IS NOT NULL AS recurring,
      CASE WHEN v.recurrence_weekdays IS NULL THEN f.next_remind_at ELSE followup_next_occurrence(v.remind_at,v.time_zone,v.recurrence_weekdays,v.recurrence_until,GREATEST($2::timestamptz,f.next_remind_at)-interval '1 microsecond') END AS at
      FROM visible s JOIN workspace_followup f ON f.workspace_id=s.wid JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(s.wid,f.id,f.current_version)
      WHERE v.status='active' AND f.next_remind_at IS NOT NULL
      UNION ALL SELECT s.wid,s."workspaceName",s.personal,f.id,v.version,v.content,f.owner_id,v.recurrence_weekdays IS NOT NULL,d.scheduled_at
      FROM visible s JOIN followup_delivery d ON d.workspace_id=s.wid JOIN workspace_followup f ON (f.workspace_id,f.id)=(s.wid,d.followup_id)
      JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(d.workspace_id,d.followup_id,d.version)
      JOIN followup_version cv ON (cv.workspace_id,cv.followup_id,cv.version)=(s.wid,f.id,f.current_version)
      WHERE d.scheduled_at>=$2 AND d.scheduled_at<$3 AND d.outcome='delivered' AND cv.status='active'
    ) SELECT r.*,'reminder' AS kind,NULL AS until,NULL AS rsvp FROM scheduled r WHERE at>=$2 AND at<$3 AND ${reminderVisible}`,
      [actor, start, end],
    );
    const previous = await tx.query(
      `WITH ${visible}, earlier AS (
       SELECT f.workspace_id AS "workspaceId",s."workspaceName",s.personal,f.id,v.version,v.content AS title,d.scheduled_at AS at
       FROM visible s JOIN workspace_followup f ON f.workspace_id=s.wid JOIN followup_delivery d ON (d.workspace_id,d.followup_id)=(s.wid,f.id)
       JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(s.wid,f.id,f.current_version)
       WHERE s.personal AND v.status='active' AND d.scheduled_at<$2 AND d.outcome='delivered'
       AND NOT EXISTS (SELECT 1 FROM followup_occurrence_change x WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(s.wid,f.id,d.version,d.scheduled_at))
       AND NOT EXISTS (SELECT 1 FROM followup_occurrence_dismissal h WHERE (h.workspace_id,h.followup_id,h.version,h.scheduled_at,h.person_id)=(s.wid,f.id,d.version,d.scheduled_at,$1))
    ) SELECT "workspaceId","workspaceName",personal,id,version,title,count(*)::integer AS count FROM earlier GROUP BY 1,2,3,4,5,6 ORDER BY max(at) DESC`,
      [actor, today],
    );
    const offers = await tx.query(
      `WITH ${visible} SELECT t.id,t.workspace_id AS "workspaceId",s."workspaceName",s.personal,v.version,v.title,v.description,v.due_at AS due
    FROM workspace_task t JOIN visible s ON s.wid=t.workspace_id JOIN task_version v ON (v.workspace_id,v.task_id,v.version)=(s.wid,t.id,t.current_version)
    WHERE s.contributes AND v.suggested_person=$1 AND v.status NOT IN ('completed','cancelled') AND v.responsibility_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM task_offer_decline d WHERE (d.workspace_id,d.task_id,d.version,d.person_id)=(s.wid,t.id,v.version,$1)) ORDER BY v.due_at NULLS LAST,v.created_at`,
      [actor],
    );
    const items = [...events.rows, ...reminders.rows]
      .sort(
        (a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id),
      )
      .map((r) => ({
        ...r,
        at: r.at.toISOString(),
        until: r.until?.toISOString() ?? null,
      }));
    return agendaViewSchema.parse({
      hasLinkedCalendar,
      items,
      previous: previous.rows,
      offers: offers.rows.map((o) => ({
        ...o,
        due: o.due?.toISOString() ?? null,
      })),
      before: today.toISOString(),
    });
  });
}

export async function agendaDestination(
  actor: string,
  session: string,
  w: string,
) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    await member(tx, w, actor, true, true);
    const destination = (
      await tx.query(
        "SELECT context_revision,personal_archive_id FROM workspace WHERE id=$1",
        [w],
      )
    ).rows[0];
    requireThat(
      !destination.personal_archive_id,
      "PERSONAL_SPACE_UNSUPPORTED",
      403,
    );
    const revision = destination.context_revision;
    const members = (
      await tx.query(
        'SELECT m.user_id AS id,u.name FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active AND u.eligible AND u."emailVerified" ORDER BY u.name,u.id',
        [w],
      )
    ).rows;
    return agendaDestinationSchema.parse({
      contextRevision: revision,
      members,
    });
  });
}

type ScheduleCreate = Extract<TaskCommand, { type: "followup.create" }>;
export async function manageOccurrence(
  tx: Tx,
  w: string,
  actor: string,
  c: Extract<
    TaskCommand,
    { type: "followup.occurrence" | "followup.previous" }
  >,
  create: (input: ScheduleCreate) => Promise<Record<string, unknown>>,
) {
  const v = await followupAt(tx, w, c.followupId);
  requireThat(v.status === "active", "FOLLOWUP_CLOSED");
  if (c.type === "followup.previous") {
    requireThat(
      v.owner_id === actor &&
        (
          await tx.query(
            "SELECT 1 FROM workspace WHERE id=$1 AND personal_owner_id=$2 AND personal_archive_id IS NULL",
            [w, actor],
          )
        ).rowCount,
      "FOLLOWUP_NOT_OWNER",
      403,
    );
    const day = (
      await tx.query(
        `SELECT $1::timestamptz=(((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2) AS valid,
      ($3::timestamptz AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date AND $3::timestamptz>=now() AS rescheduled`,
        [c.before, followupZone(c.timeZone), c.remindAt ?? null],
      )
    ).rows[0];
    requireThat(day.valid, "AGENDA_DATE_CHANGED");
    const count = (
      await tx.query(
        `INSERT INTO followup_occurrence_dismissal(workspace_id,followup_id,version,scheduled_at,person_id)
      SELECT d.workspace_id,d.followup_id,d.version,d.scheduled_at,$3 FROM followup_delivery d WHERE d.workspace_id=$1 AND d.followup_id=$2 AND d.outcome='delivered' AND d.scheduled_at<$4
      AND NOT EXISTS(SELECT 1 FROM followup_occurrence_change x WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(d.workspace_id,d.followup_id,d.version,d.scheduled_at)) ON CONFLICT DO NOTHING`,
        [w, c.followupId, actor, c.before],
      )
    ).rowCount;
    requireThat(count, "AGENDA_NOTHING_PENDING");
    if (c.action === "remind_today") {
      requireThat(c.remindAt && day.rescheduled, "AGENDA_TIME_INVALID", 400);
      return {
        ...(await create({
          type: "followup.create",
          kind: v.kind,
          content: v.content,
          remindAt: c.remindAt,
          timeZone: c.timeZone,
          reference: followupReference(v),
        })),
        archived: count,
      };
    }
    return { archived: count };
  }
  const params = [w, c.followupId, c.expectedVersion, c.scheduledAt] as const;
  const valid = (
    await tx.query(
      `SELECT 1 FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2 AND version=$3 AND scheduled_at=$4 AND outcome='delivered'
    UNION ALL SELECT 1 FROM workspace_followup f JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
    WHERE f.workspace_id=$1 AND f.id=$2 AND f.current_version=$3 AND f.next_remind_at<=$4 AND (f.next_remind_at=$4 OR followup_next_occurrence(v.remind_at,v.time_zone,v.recurrence_weekdays,v.recurrence_until,$4::timestamptz-interval '1 microsecond')=$4)`,
      [...params],
    )
  ).rowCount;
  requireThat(valid, "FOLLOWUP_OCCURRENCE_STALE");
  if (c.action === "hide") {
    await tx.query(
      "INSERT INTO followup_occurrence_dismissal(workspace_id,followup_id,version,scheduled_at,person_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [...params, actor],
    );
    return { hidden: true };
  }
  requireThat(v.owner_id === actor, "FOLLOWUP_NOT_OWNER", 403);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM followup_occurrence_change WHERE workspace_id=$1 AND followup_id=$2 AND version=$3 AND scheduled_at=$4",
        [...params],
      )
    ).rowCount,
    "FOLLOWUP_OCCURRENCE_STALE",
  );
  let replacement: null | string = null;
  if (c.action === "replace_following") {
    const original = followupRecurrence(v);
    requireThat(
      c.replacement && original && v.version === c.expectedVersion,
      "FOLLOWUP_VERSION_STALE",
    );
    const bounds = (
      await tx.query(
        `SELECT min(effective_at) AS stop,
        extract(isodow from ($3::timestamptz AT TIME ZONE $4))::integer AS old_day,
        extract(isodow from ($5::timestamptz AT TIME ZONE $6))::integer AS new_day
        FROM followup_series_split WHERE workspace_id=$1 AND followup_id=$2`,
        [
          w,
          c.followupId,
          c.scheduledAt,
          followupZone(v.time_zone),
          c.replacement.remindAt,
          followupZone(c.replacement.timeZone),
        ],
      )
    ).rows[0];
    requireThat(
      !bounds.stop || Date.parse(c.scheduledAt) < bounds.stop.getTime(),
      "FOLLOWUP_OCCURRENCE_STALE",
    );
    const until = bounds.stop
      ? (
          await tx.query(
            "SELECT (($1::timestamptz AT TIME ZONE $2)::date-1)::text AS day",
            [bounds.stop, followupZone(v.time_zone)],
          )
        ).rows[0].day
      : original.until;
    const weekdays = [
      ...new Set(
        original.weekdays.map((d) =>
          original.weekdays.length < 7 && d === bounds.old_day
            ? bounds.new_day
            : d,
        ),
      ),
    ];
    const created = await create({
      type: "followup.create",
      ...c.replacement,
      kind: v.kind,
      reference: followupReference(v),
      recurrence: { weekdays, ...(until ? { until } : {}) },
    });
    await tx.query(
      "INSERT INTO followup_series_split(workspace_id,followup_id,version,effective_at,replacement_id,person_id) VALUES($1,$2,$3,$4,$5,$6)",
      [...params, created.followupId, actor],
    );
    await tx.query(
      "UPDATE workspace_followup SET next_remind_at=NULL WHERE workspace_id=$1 AND id=$2 AND next_remind_at>=$3",
      [w, c.followupId, c.scheduledAt],
    );
    return { replacementId: created.followupId };
  }
  if (c.action === "replace") {
    requireThat(
      c.replacement && v.version === c.expectedVersion,
      "FOLLOWUP_VERSION_STALE",
    );
    replacement = String(
      (
        await create({
          type: "followup.create",
          ...c.replacement,
          kind: v.kind,
          reference: followupReference(v),
        })
      ).followupId,
    );
  }
  await tx.query(
    "INSERT INTO followup_occurrence_change(workspace_id,followup_id,version,scheduled_at,person_id,replacement_id) VALUES($1,$2,$3,$4,$5,$6)",
    [...params, actor, replacement],
  );
  return { closed: true, replacementId: replacement };
}

export async function workspaceSchedule(
  actor: string,
  w: string,
  mine: boolean,
  limit: number,
) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const rows = (
      await tx.query(
        `WITH entries AS (
    SELECT t.id,'task' AS kind,v.title,v.due_at AS at FROM workspace_task t JOIN task_version v ON (v.workspace_id,v.task_id,v.version)=(t.workspace_id,t.id,t.current_version)
    LEFT JOIN task_responsibility r ON r.workspace_id=t.workspace_id AND r.id=v.responsibility_id
    LEFT JOIN membership m ON m.workspace_id=t.workspace_id AND m.user_id=r.person_id AND m.active AND m.version=r.membership_version
    WHERE t.workspace_id=$1 AND v.status NOT IN ('completed','cancelled') AND (NOT $3::boolean OR m.user_id=$2)
    UNION ALL SELECT f.id,'followup',v.content,display.at FROM workspace_followup f
    JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
    CROSS JOIN LATERAL ${nextVisibleFollowup} AS display(at)
    WHERE display.at IS NOT NULL AND f.workspace_id=$1 AND f.next_remind_at IS NOT NULL AND v.status='active' AND (NOT $3::boolean OR f.owner_id=$2))
   SELECT * FROM entries ORDER BY at NULLS LAST,id LIMIT $4`,
        [w, actor, mine, limit + 1],
      )
    ).rows;
    return {
      entries: rows
        .slice(0, limit)
        .map((r) => ({ ...r, at: r.at?.toISOString() ?? null })),
      more: rows.length > limit,
    };
  });
}
