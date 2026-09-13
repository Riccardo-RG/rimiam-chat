import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import {
  taskAt,
  taskContent,
  followupAt,
  followupReference,
  followupValid,
} from "./tasks-state.ts";
import { tasksViewSchema, tasksHistorySchema } from "../contracts/tasks.ts";
export async function tasksView(actor: string, w: string, before?: string) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const ids = (
      await tx.query(
        `SELECT id,kind FROM (SELECT id,'task' AS kind FROM workspace_task WHERE workspace_id=$1 UNION ALL SELECT id,'followup' AS kind FROM workspace_followup WHERE workspace_id=$1) e WHERE ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT 51`,
        [w, before ?? null],
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
            "SELECT * FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2 AND version=$3",
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
          timeZone: v.time_zone,
          reference: followupReference(v),
          status: v.status,
          createdAt: v.created_at.toISOString(),
          reason: v.reason,
          needsReview:
            v.status === "active" &&
            (d?.outcome === "suppressed" || !(await followupValid(tx, v))),
          deliveredAt:
            d?.outcome === "delivered" ? d.delivered_at.toISOString() : null,
        });
      }
    }
    const members = (
      await tx.query(
        'SELECT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active ORDER BY u.name',
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
export async function tasksHistory(
  actor: string,
  w: string,
  id: string,
  kind: "task" | "followup",
  before = 2147483647,
) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    if (kind === "task") await taskAt(tx, w, id);
    else await followupAt(tx, w, id);
    const versions = (
      await tx.query(
        kind === "task"
          ? "SELECT * FROM task_version WHERE workspace_id=$1 AND task_id=$2 AND version<$3 ORDER BY version DESC LIMIT 50"
          : "SELECT * FROM followup_version WHERE workspace_id=$1 AND followup_id=$2 AND version<$3 ORDER BY version DESC LIMIT 50",
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
              "SELECT * FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2 AND version>=$3 AND version<$4",
              [w, id, low, before],
            )
          ).rows;
    return tasksHistorySchema.parse({
      versions,
      acceptances,
      references,
      proposals,
    });
  });
}
