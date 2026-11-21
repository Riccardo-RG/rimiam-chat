import type { Tx } from "./db.ts";
import type { WorkspaceRow } from "./workspace-state.ts";
import {
  member,
  authenticatedSession,
  lockWorkspace,
} from "./workspace-state.ts";
import { applyTasks } from "./tasks-commands.ts";
import { followupZone } from "./tasks-state.ts";
import { requireThat } from "./errors.ts";
import {
  isAssistantAddress,
  withoutAssistantAddress,
} from "../shared/miriam-address.ts";

const weekdays = [
  "lunedì",
  "martedì",
  "mercoledì",
  "giovedì",
  "venerdì",
  "sabato",
  "domenica",
];
const absolute = /\bil\s+(\d{4}-\d{2}-\d{2})\b/iu;
const when =
  /\b(dopodomani|domani|oggi|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\b/iu;
const time =
  /\b(?:alle(?:\s+ore)?|all[’'](?:una)?|ore)\s*(\d{1,2})(?:[:.](\d{2}))?\b/iu;
const dayName = weekdays.join("|");
const repetition = new RegExp(
  "\\bogni\\s+(giorno|(?:" +
    dayName +
    ")(?:(?:\\s*,\\s*|\\s+e\\s+)(?:" +
    dayName +
    "))*)(?=\\s|[,.;!?]|$)",
  "iu",
);
export function parseReminderRequest(
  text: string,
  personal: boolean,
  displayName = "Emme",
) {
  if (!personal && !isAssistantAddress(text, displayName)) return null;
  const match = /^(?:per favore[, ]+)?ricorda(mi|ci)\s+(.+)$/iu.exec(
    withoutAssistantAddress(text, displayName).trim(),
  );
  if (!match) return null;
  let body = match[2].trim();
  if (/[\n]/u.test(body) || body.length > 2000) return null;
  const recurring = body.match(repetition);
  body = body.replace(repetition, " ");
  const exact = body.match(absolute),
    date = body.match(when),
    hour = body.match(time);
  // Preserve informational requests such as "ricordami come funziona il calendario".
  if (!exact && !date && !hour && !recurring && !/^di\s+/iu.test(body))
    return null;
  const content = body
    .replace(absolute, " ")
    .replace(when, " ")
    .replace(time, " ")
    .replace(/^\s*[,;:]?\s*(?:di\s+)?/iu, "")
    .replace(/[\s,;.]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!content) return null;
  return {
    audience:
      match[1].toLowerCase() === "mi" || personal ? "personal" : "space",
    content,
    date: exact?.[1] ?? date?.[1]?.toLowerCase() ?? null,
    hour: hour ? Number(hour[1]) : null,
    minute: hour ? Number(hour[2] ?? 0) : null,
    weekdays: recurring
      ? recurring[1].toLowerCase() === "giorno"
        ? [1, 2, 3, 4, 5, 6, 7]
        : [
            ...new Set(
              recurring[1]
                .toLowerCase()
                .split(/\s*,\s*|\s+e\s+/u)
                .map((d) => weekdays.indexOf(d) + 1),
            ),
          ]
      : null,
  };
}
type Request = NonNullable<ReturnType<typeof parseReminderRequest>>;
type GetPersonal = (
  tx: Tx,
  actor: string,
  session: string,
) => Promise<{ id: string }>;
export async function recordReminderRequest(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  source: string,
  request: Request,
  zone: string,
  session: string,
  getPersonal: GetPersonal,
) {
  await authenticatedSession(tx, actor, session);
  const pgZone = followupZone(zone);
  const dateInfo = (
    await tx.query(
      "SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS today,extract(isodow from clock_timestamp() AT TIME ZONE $1)::int AS weekday",
      [pgZone],
    )
  ).rows[0];
  const desired =
    request.date ??
    (request.weekdays?.length === 1 ? weekdays[request.weekdays[0] - 1] : null);
  const dayIndex = desired ? weekdays.indexOf(desired) : -1;
  const offset =
    desired === "domani"
      ? 1
      : desired === "dopodomani"
        ? 2
        : dayIndex >= 0
          ? (dayIndex + 1 - dateInfo.weekday + 7) % 7
          : 0;
  let day: string | null = (
    await tx.query("SELECT ($1::date+$2::integer)::text AS day", [
      dateInfo.today,
      offset,
    ])
  ).rows[0].day;
  if (desired && /^\d{4}/.test(desired)) {
    const valid = new Date(desired + "T00:00:00Z");
    day =
      Number.isNaN(+valid) || valid.toISOString().slice(0, 10) !== desired
        ? null
        : desired;
  }
  const saved = await tx.query(
    `INSERT INTO conversation_reminder_request(workspace_id,message_id,person_id,audience,content,local_day,time_zone,weekdays)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      ws.id,
      source,
      actor,
      request.audience,
      request.content,
      day,
      zone,
      request.weekdays,
    ],
  );
  if (
    !day ||
    request.hour === null ||
    request.hour > 23 ||
    request.minute === null ||
    request.minute > 59
  )
    return;
  const local =
    day +
    " " +
    String(request.hour).padStart(2, "0") +
    ":" +
    String(request.minute).padStart(2, "0");
  const at = (
    await tx.query(
      `WITH t AS(SELECT $1::timestamp AT TIME ZONE $2 AS instant) SELECT instant,(instant AT TIME ZONE $2)=$1::timestamp AND instant>clock_timestamp() AND NOT EXISTS(
 SELECT 1 FROM unnest(ARRAY[interval '30 minutes',interval '1 hour',interval '2 hours',interval '-30 minutes',interval '-1 hour',interval '-2 hours']) delta WHERE ((instant+delta) AT TIME ZONE $2)=$1::timestamp) AS valid FROM t`,
      [local, pgZone],
    )
  ).rows[0];
  if (at.valid)
    await saveRequest(
      tx,
      ws,
      actor,
      saved.rows[0],
      at.instant.toISOString(),
      session,
      getPersonal,
    );
}
type Row = {
  workspace_id: string;
  message_id: string;
  person_id: string;
  audience: "personal" | "space";
  content: string;
  time_zone: string;
  weekdays: number[] | null;
};
export async function completeReminderRequest(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  source: string,
  at: string,
  session: string,
  getPersonal: GetPersonal,
) {
  await authenticatedSession(tx, actor, session);
  await member(tx, ws.id, actor, true, true);
  const r = (
    await tx.query(
      "SELECT * FROM conversation_reminder_request WHERE workspace_id=$1 AND message_id=$2 AND person_id=$3",
      [ws.id, source, actor],
    )
  ).rows[0];
  requireThat(r, "REMINDER_REQUEST_NOT_FOUND", 404);
  requireThat(
    !(
      await tx.query(
        "SELECT 1 FROM conversation_reminder_result WHERE workspace_id=$1 AND message_id=$2",
        [ws.id, source],
      )
    ).rowCount,
    "REMINDER_ALREADY_SCHEDULED",
  );
  requireThat(
    (await tx.query("SELECT $1::timestamptz>clock_timestamp() AS valid", [at]))
      .rows[0].valid,
    "AGENDA_TIME_INVALID",
    400,
  );
  return saveRequest(tx, ws, actor, r, at, session, getPersonal);
}
async function saveRequest(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  r: Row,
  at: string,
  session: string,
  getPersonal: GetPersonal,
) {
  const destination =
    r.audience === "personal" &&
    (!ws.personal_owner_id || !!ws.personal_archive_id)
      ? await lockWorkspace(tx, (await getPersonal(tx, actor, session)).id)
      : ws;
  const result = await applyTasks(
    tx,
    destination,
    actor,
    {
      type: "followup.create",
      content: r.content,
      kind: "remember",
      remindAt: at,
      timeZone: r.time_zone,
      reference: null,
      ...(r.weekdays ? { recurrence: { weekdays: r.weekdays } } : {}),
    },
    session,
  );
  await tx.query(
    "INSERT INTO conversation_reminder_result(workspace_id,message_id,destination_id,followup_id) VALUES($1,$2,$3,$4)",
    [ws.id, r.message_id, destination.id, result.followupId],
  );
  return { scheduled: true };
}
// A personal result and its destination are never serialized for other members.
export const reminderProjection = (
  viewer: string,
) => `(SELECT jsonb_build_object('audience',q.audience,'content',COALESCE(chosen.content,q.content),'day',q.local_day,'zone',COALESCE(chosen.time_zone,q.time_zone),'destination',r.destination_id,'id',chosen.id,'at',chosen.at,'version',chosen.version,'closed',coalesce(chosen.closed,false),'recurring',coalesce(chosen.recurring,false))
 FROM conversation_reminder_request q LEFT JOIN conversation_reminder_result r USING(workspace_id,message_id)
 LEFT JOIN LATERAL (
  WITH RECURSIVE chain(id) AS (
    SELECT r.followup_id WHERE r.followup_id IS NOT NULL
    UNION
    SELECT next.id FROM chain prev
    JOIN workspace_followup f ON f.workspace_id=r.destination_id AND f.id=prev.id
    JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
    CROSS JOIN LATERAL (SELECT COALESCE(
      (SELECT x.replacement_id FROM followup_occurrence_change x WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(r.destination_id,f.id,v.version,COALESCE(f.next_remind_at,v.remind_at))),
      (SELECT s.replacement_id FROM followup_series_split s WHERE s.workspace_id=r.destination_id AND s.followup_id=f.id AND (f.next_remind_at IS NULL OR s.effective_at<=f.next_remind_at) ORDER BY s.effective_at LIMIT 1)) AS id) next WHERE next.id IS NOT NULL
  ) SELECT f.id,v.content,v.time_zone,v.version,COALESCE(f.next_remind_at,v.remind_at) AS at,v.recurrence_weekdays IS NOT NULL AS recurring,
      (v.status<>'active' OR EXISTS(SELECT 1 FROM followup_occurrence_change x WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(r.destination_id,f.id,v.version,COALESCE(f.next_remind_at,v.remind_at)))) AS closed
    FROM chain p JOIN workspace_followup f ON f.workspace_id=r.destination_id AND f.id=p.id
    JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
    ORDER BY v.created_at DESC LIMIT 1) chosen ON true
 WHERE q.workspace_id=m.workspace_id AND q.message_id=m.id AND q.person_id=${viewer})`;
