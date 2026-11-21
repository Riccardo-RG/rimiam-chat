import type { Tx } from "./db.ts";
import type {
  WorkRef,
  TaskContent,
  FollowupRecurrence,
} from "../contracts/tasks.ts";
import { requireThat } from "./errors.ts";

// Finite references to existing domain records, never dynamic caller-supplied SQL.
export async function validWorkReference(
  tx: Tx,
  w: string,
  r: WorkRef,
  current = false,
): Promise<boolean> {
  const queries = {
    goal: `SELECT 1 FROM goal_version v JOIN goal g ON g.workspace_id=v.workspace_id AND g.id=v.goal_id WHERE v.workspace_id=$1 AND v.goal_id=$2 AND v.version=$3 ${current ? "AND g.current_version=v.version AND g.status='active'" : ""}`,
    commitment: `SELECT 1 FROM ${current ? "current_project_act" : "project_act"} WHERE workspace_id=$1 AND id=$2 AND $3::int=1`,
    information: `SELECT 1 FROM information_version v JOIN accepted_information i ON i.workspace_id=v.workspace_id AND i.id=v.information_id WHERE v.workspace_id=$1 AND v.information_id=$2 AND v.version=$3 ${current ? "AND i.current_version=v.version" : ""}`,
    artifact: `SELECT 1 FROM artifact_version v JOIN artifact a ON a.workspace_id=v.workspace_id AND a.id=v.artifact_id WHERE v.workspace_id=$1 AND v.artifact_id=$2 AND v.version=$3 ${current ? "AND a.current_draft_version=v.version" : ""}`,
    source:
      "SELECT 1 FROM source_identity WHERE workspace_id=$1 AND id=$2 AND $3::int=1",
    message:
      "SELECT 1 FROM message WHERE workspace_id=$1 AND id=$2 AND $3::int=1",
    question: `SELECT 1 FROM question_version v JOIN open_question q ON q.workspace_id=v.workspace_id AND q.id=v.question_id WHERE v.workspace_id=$1 AND v.question_id=$2 AND v.version=$3 ${current ? "AND q.current_version=v.version AND v.status='open'" : ""}`,
    task: `SELECT 1 FROM task_version v JOIN workspace_task t ON t.workspace_id=v.workspace_id AND t.id=v.task_id WHERE v.workspace_id=$1 AND v.task_id=$2 AND v.version=$3 ${current ? "AND t.current_version=v.version AND v.status NOT IN ('completed','cancelled')" : ""}`,
  };
  return !!(await tx.query(queries[r.kind], [w, r.id, r.version])).rowCount;
}
export async function workReferences(tx: Tx, w: string, refs: WorkRef[]) {
  for (const r of refs)
    requireThat(
      await validWorkReference(tx, w, r),
      "WORK_REFERENCE_NOT_FOUND",
      404,
    );
}
export async function taskAt(tx: Tx, w: string, id: string) {
  const v = (
    await tx.query(
      `SELECT v.*,r.person_id,r.task_version AS accepted_version,r.membership_version AS accepted_membership_version,d.person_id AS declined
    FROM workspace_task t JOIN task_version v ON (v.workspace_id,v.task_id,v.version)=(t.workspace_id,t.id,t.current_version)
    LEFT JOIN task_responsibility r ON (r.workspace_id,r.task_id,r.id)=(v.workspace_id,v.task_id,v.responsibility_id)
    LEFT JOIN task_offer_decline d ON (d.workspace_id,d.task_id,d.version,d.person_id)=(v.workspace_id,v.task_id,v.version,v.suggested_person)
    WHERE t.workspace_id=$1 AND t.id=$2`,
      [w, id],
    )
  ).rows[0];
  requireThat(v, "TASK_NOT_FOUND", 404);
  return v;
}
export async function taskContent(
  tx: Tx,
  v: Record<string, unknown>,
): Promise<TaskContent> {
  const references = (
    await tx.query(
      "SELECT kind,reference_id AS id,reference_version AS version FROM task_reference WHERE workspace_id=$1 AND task_id=$2 AND task_version=$3 ORDER BY kind,reference_id",
      [v.workspace_id, v.task_id, v.version],
    )
  ).rows;
  return {
    title: String(v.title),
    description: String(v.description),
    dueAt: v.due_at ? (v.due_at as Date).toISOString() : null,
    timeZone: String(v.time_zone),
    suggestedPerson: v.suggested_person as string | null,
    references,
  };
}
// Read projection for the current rows aliased f (identity) and v (version).
// The delivery cursor must remain intact so the worker can record suppression.
export const nextVisibleFollowup = `(
  WITH RECURSIVE candidates(at) AS (
    SELECT f.next_remind_at
    UNION ALL
    SELECT followup_next_occurrence(v.remind_at,v.time_zone,v.recurrence_weekdays,v.recurrence_until,c.at)
    FROM candidates c JOIN followup_occurrence_change x
      ON (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(f.workspace_id,f.id,f.current_version,c.at)
    WHERE v.recurrence_weekdays IS NOT NULL
  )
  SELECT c.at FROM candidates c WHERE c.at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM followup_occurrence_change x
      WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(f.workspace_id,f.id,f.current_version,c.at))
    AND NOT EXISTS (SELECT 1 FROM followup_series_split s
      WHERE s.workspace_id=f.workspace_id AND s.followup_id=f.id AND s.effective_at<=c.at)
)`;
export async function followupAt(tx: Tx, w: string, id: string) {
  const v = (
    await tx.query(
      `SELECT v.*,v.recurrence_until::text AS recurrence_until,v.remind_at::text AS schedule_anchor,f.owner_id,f.next_remind_at,f.next_remind_at::text AS scheduled_instant FROM workspace_followup f JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version) WHERE f.workspace_id=$1 AND f.id=$2`,
      [w, id],
    )
  ).rows[0];
  requireThat(v, "FOLLOWUP_NOT_FOUND", 404);
  return v;
}
export function followupRecurrence(
  v: Record<string, unknown>,
): FollowupRecurrence | null {
  return v.recurrence_weekdays
    ? {
        weekdays: v.recurrence_weekdays as number[],
        ...(v.recurrence_until ? { until: String(v.recurrence_until) } : {}),
      }
    : null;
}

// Intl also accepts fixed-offset zones. PostgreSQL's POSIX-style names use
// the opposite sign for those, while IANA names can be passed through.
export function followupZone(zone: string) {
  const fixed = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(zone);
  return fixed
    ? `UTC${fixed[1] === "+" ? "-" : "+"}${fixed[2]}:${fixed[3] ?? "00"}`
    : zone;
}

export async function nextFollowupOccurrence(
  tx: Tx,
  anchor: string,
  zone: string,
  rule: FollowupRecurrence,
  after?: string,
) {
  const { rows } = await tx.query<{ due: string | null }>(
    "SELECT followup_next_occurrence($1::timestamptz,$2::text,$3::smallint[],$4::date,$5::timestamptz)::text AS due",
    [
      anchor,
      followupZone(zone),
      rule.weekdays,
      rule.until ?? null,
      after ?? null,
    ],
  );
  return rows[0].due;
}

export function followupReference(v: Record<string, unknown>): WorkRef | null {
  return v.reference_kind
    ? {
        kind: v.reference_kind as WorkRef["kind"],
        id: String(v.reference_id),
        version: Number(v.reference_version),
      }
    : null;
}
export async function followupValid(tx: Tx, v: Record<string, unknown>) {
  const active = (
    await tx.query(
      `SELECT 1 FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active AND m.contributes AND m.version=$3 AND u.eligible AND u."emailVerified" FOR SHARE OF u`,
      [v.workspace_id, v.owner_id, v.membership_version],
    )
  ).rowCount;
  if (!active) return false;
  const ref = followupReference(v);
  return (
    !ref || (await validWorkReference(tx, String(v.workspace_id), ref, true))
  );
}
