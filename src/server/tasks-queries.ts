import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import {
  taskAt,
  taskContent,
  followupAt,
  followupReference,
  followupRecurrence,
  followupValid,
  nextVisibleFollowup,
} from "./tasks-state.ts";
import {
  tasksViewSchema,
  tasksHistorySchema,
  taskCommentsSchema,
} from "../contracts/tasks.ts";
export async function tasksView(
  actor: string,
  w: string,
  before?: string,
  focus?: string,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await member(tx, w, actor);
    const ids = (
      await tx.query(
        `SELECT id,kind FROM (SELECT id,'task' AS kind FROM workspace_task WHERE workspace_id=$1 UNION ALL SELECT id,'followup' AS kind FROM workspace_followup WHERE workspace_id=$1) e WHERE ($2::uuid IS NULL OR id<$2) AND ($3::uuid IS NULL OR id=$3) ORDER BY id DESC LIMIT 51`,
        [w, before ?? null, focus ?? null],
      )
    ).rows;
    const tasks = [],
      followups = [],
      proposals = [];
    for (const row of ids.slice(0, 50)) {
      if (row.kind === "task") {
        const v = await taskAt(tx, w, row.id);
        const available = v.person_id
          ? !!(
              await tx.query(
                `SELECT 1 FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active AND m.contributes AND m.version=$3 AND u.eligible AND u."emailVerified"`,
                [w, v.person_id, v.accepted_membership_version],
              )
            ).rowCount
          : false;
        tasks.push({
          ...(await taskContent(tx, v)),
          declinedBy: v.declined ?? null,
          id: row.id,
          version: v.version,
          status: v.status,
          actor: v.actor_id,
          createdAt: v.created_at.toISOString(),
          reason: v.reason,
          candidateId: v.candidate_id,
          responsible: v.person_id ?? null,
          acceptedVersion: v.accepted_version ?? null,
          responsibleAvailable: available,
        });
        const ps = (
          await tx.query(
            'SELECT id,task_id AS "taskId",base_version AS "baseVersion",content,actor_id AS actor,reason,created_at AS "createdAt" FROM task_revision_proposal WHERE workspace_id=$1 AND task_id=$2 AND base_version=$3 ORDER BY created_at DESC LIMIT 50',
            [w, row.id, v.version],
          )
        ).rows;
        proposals.push(
          ...ps.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
        );
      } else {
        const v = await followupAt(tx, w, row.id);
        const d = (
          await tx.query(
            `SELECT (
             SELECT CASE WHEN outcome='suppressed' AND EXISTS(SELECT 1 FROM followup_occurrence_change x WHERE (x.workspace_id,x.followup_id,x.version,x.scheduled_at)=(d.workspace_id,d.followup_id,d.version,d.scheduled_at)) THEN 'closed' ELSE outcome END FROM followup_delivery d WHERE workspace_id=$1 AND followup_id=$2 AND version=$3
             ORDER BY scheduled_at DESC LIMIT 1
             ) AS outcome, (
             SELECT delivered_at FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2 AND version=$3
             AND outcome='delivered' ORDER BY scheduled_at DESC LIMIT 1
             ) AS last_delivered, ${nextVisibleFollowup} AS next_visible
             FROM workspace_followup f JOIN followup_version v
               ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
             WHERE f.workspace_id=$1 AND f.id=$2 AND f.current_version=$3`,
            [w, row.id, v.version],
          )
        ).rows[0];
        followups.push({
          id: row.id,
          version: v.version,
          owner: v.owner_id,
          content: v.content,
          kind: v.kind,
          remindAt: v.remind_at.toISOString(),
          nextRemindAt: d.next_visible?.toISOString() ?? null,
          recurrence: followupRecurrence(v),
          timeZone: v.time_zone,
          reference: followupReference(v),
          status: v.status,
          createdAt: v.created_at.toISOString(),
          reason: v.reason,
          needsReview:
            v.status === "active" &&
            (d.outcome === "suppressed" ||
              ((v.next_remind_at || !v.recurrence_weekdays) &&
                !(await followupValid(tx, v)))),
          deliveredAt: d.last_delivered?.toISOString() ?? null,
        });
      }
    }
    const members = (
      await tx.query(
        'SELECT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active AND m.contributes AND u.eligible AND u."emailVerified" ORDER BY u.name',
        [w],
      )
    ).rows;
    const suggestions = (
      await tx.query(
        `SELECT c.id,c.content,c.subject,c.origin,c.qualification FROM candidate c JOIN workspace w ON w.id=c.workspace_id WHERE c.workspace_id=$1 AND c.context_revision=w.context_revision ORDER BY c.created_at DESC LIMIT 30`,
        [w],
      )
    ).rows;
    return tasksViewSchema.parse({
      tasks,
      followups,
      proposals,
      members,
      suggestions,
      next: ids.length > 50 ? ids[49].id : null,
    });
  });
}
export async function taskComments(
  actor: string,
  w: string,
  id: string,
  before?: number,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    await taskAt(tx, w, id);
    const { rows } = await tx.query(
      `SELECT c.position,c.id,c.actor_id AS actor,u.name AS "authorName",c.body,c.task_version AS "taskVersion",c.created_at
       FROM task_comment c JOIN "user" u ON u.id=c.actor_id
       WHERE c.workspace_id=$1 AND c.task_id=$2 AND ($3::int IS NULL OR c.position<$3)
       ORDER BY c.position DESC LIMIT 31`,
      [w, id, before ?? null],
    );
    return taskCommentsSchema.parse({
      comments: rows
        .slice(0, 30)
        .map((c) => ({ ...c, createdAt: c.created_at.toISOString() })),
      next: rows.length > 30 ? String(rows[29].position) : null,
    });
  });
}
export async function tasksHistory(
  actor: string,
  w: string,
  id: string,
  kind: "task" | "followup",
  before = 2147483647,
  beforeDelivery?: { version: number; scheduledAt: string },
) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    if (kind === "task") await taskAt(tx, w, id);
    else await followupAt(tx, w, id);
    const versions = (
      await tx.query(
        kind === "task"
          ? "SELECT * FROM task_version WHERE workspace_id=$1 AND task_id=$2 AND version<$3 ORDER BY version DESC LIMIT 50"
          : "SELECT v.*,v.recurrence_until::text AS recurrence_until FROM followup_version v WHERE workspace_id=$1 AND followup_id=$2 AND version<$3 ORDER BY version DESC LIMIT 50",
        [w, id, before],
      )
    ).rows;
    const low = versions.at(-1)?.version ?? before;
    const acceptances =
      kind === "task"
        ? (
            await tx.query(
              "SELECT * FROM task_responsibility WHERE workspace_id=$1 AND task_id=$2 AND task_version>=$3 AND task_version<$4 ORDER BY accepted_at",
              [w, id, low, before],
            )
          ).rows
        : [];
    const references =
      kind === "task"
        ? (
            await tx.query(
              "SELECT * FROM task_reference WHERE workspace_id=$1 AND task_id=$2 AND task_version>=$3 AND task_version<$4",
              [w, id, low, before],
            )
          ).rows
        : [];
    const proposals =
      kind === "task"
        ? (
            await tx.query(
              "SELECT * FROM task_revision_proposal WHERE workspace_id=$1 AND task_id=$2 AND base_version>=$3 AND base_version<$4 ORDER BY created_at",
              [w, id, low, before],
            )
          ).rows
        : (
            await tx.query(
              `SELECT d.*, to_char(d.scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scheduled_at
               FROM followup_delivery d WHERE workspace_id=$1 AND followup_id=$2 AND version>=$3 AND version<$4
               AND ($5::int IS NULL OR (version,d.scheduled_at)<($5,$6::timestamptz))
               ORDER BY version DESC,d.scheduled_at DESC LIMIT 51`,
              [
                w,
                id,
                low,
                before,
                beforeDelivery?.version ?? null,
                beforeDelivery?.scheduledAt ?? null,
              ],
            )
          ).rows;
    return tasksHistorySchema.parse({
      versions,
      acceptances,
      references,
      proposals: kind === "followup" ? proposals.slice(0, 50) : proposals,
      ...(kind === "followup" && {
        nextDelivery:
          proposals.length > 50
            ? {
                version: proposals[49].version,
                scheduledAt: proposals[49].scheduled_at,
              }
            : null,
      }),
    });
  });
}
