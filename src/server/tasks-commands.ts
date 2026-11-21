import { randomUUID } from "node:crypto";
import { recordTaskOffer } from "./task-offer-message.ts";
import { manageOccurrence } from "./agenda.ts";
import type { Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import {
  member,
  changed,
  authenticatedSession,
  type WorkspaceRow,
} from "./workspace-state.ts";
import {
  taskAt,
  taskContent,
  workReferences,
  followupAt,
  followupReference,
  followupRecurrence,
  nextFollowupOccurrence,
  validWorkReference,
} from "./tasks-state.ts";
import {
  taskContentSchema,
  type TaskCommand,
  type TaskContent,
} from "../contracts/tasks.ts";

async function saveTask(
  tx: Tx,
  w: string,
  id: string,
  version: number,
  content: TaskContent,
  status: string,
  responsibility: string | null,
  candidate: string | null,
  actor: string,
  reason: string,
  adoptedProposal: string | null = null,
) {
  await workReferences(tx, w, content.references);
  await tx.query(
    `INSERT INTO task_version(workspace_id,task_id,version,title,description,due_at,time_zone,suggested_person,status,responsibility_id,candidate_id,actor_id,reason,adopted_proposal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      w,
      id,
      version,
      content.title,
      content.description,
      content.dueAt,
      content.timeZone,
      content.suggestedPerson,
      status,
      responsibility,
      candidate,
      actor,
      reason,
      adoptedProposal,
    ],
  );
  for (const r of content.references)
    await tx.query(
      "INSERT INTO task_reference(workspace_id,task_id,task_version,kind,reference_id,reference_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [w, id, version, r.kind, r.id, r.version],
    );
  await tx.query(
    "UPDATE workspace_task SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
    [w, id, version],
  );
}
async function acceptance(
  tx: Tx,
  w: string,
  id: string,
  version: number,
  actor: string,
) {
  const membership = (
    await tx.query(
      "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
      [w, actor],
    )
  ).rows[0];
  const rid = randomUUID();
  await tx.query(
    "INSERT INTO task_responsibility(id,workspace_id,task_id,task_version,person_id,membership_version) VALUES($1,$2,$3,$4,$5,$6)",
    [rid, w, id, version, actor, membership.version],
  );
  return rid;
}
export async function enqueueFollowup(
  tx: Tx,
  w: string,
  id: string,
  version: number,
  at: string,
  recurring: boolean,
) {
  // Use the database instant both in the payload and the key: equivalent
  // offsets and recovered timestamps identify the same occurrence exactly.
  await tx.query(
    `SELECT graphile_worker.add_job('followup_due',
       json_build_object('workspaceId',$1::text,'id',$2::text,'version',$3::int,'scheduledAt',$4::timestamptz),
       run_at:=$4::timestamptz,job_key:=$5::text || CASE WHEN $6::boolean THEN ':' || extract(epoch FROM $4::timestamptz)::text ELSE '' END,max_attempts:=5)`,
    [w, id, version, at, `followup:${id}:${version}`, recurring],
  );
}
export async function applyTasks(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: TaskCommand,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  const personalHide = c.type === "followup.occurrence" && c.action === "hide";
  await member(tx, w, actor, !personalHide, true);
  await authenticatedSession(tx, actor, sessionId);
  if (c.type === "followup.occurrence" || c.type === "followup.previous") {
    const result = await manageOccurrence(tx, w, actor, c, (cmd) =>
      applyTasks(tx, ws, actor, cmd, sessionId),
    );
    if (c.type === "followup.occurrence" && c.action !== "hide")
      await changed(tx, w, c.type);
    return result;
  }
  if (c.type === "task.create") {
    const id = randomUUID();
    const content = structuredClone(c.content);
    if (content.suggestedPerson)
      await member(tx, w, content.suggestedPerson, true, true);
    if (c.candidateId) {
      const candidate = (
        await tx.query(
          "SELECT * FROM candidate WHERE workspace_id=$1 AND id=$2",
          [w, c.candidateId],
        )
      ).rows[0];
      requireThat(candidate, "CANDIDATE_NOT_FOUND", 404);
      requireThat(
        candidate.context_revision === ws.context_revision,
        "CANDIDATE_STALE",
      );
    }
    await tx.query(
      "INSERT INTO workspace_task(id,workspace_id,current_version) VALUES($1,$2,1)",
      [id, w],
    );
    await saveTask(
      tx,
      w,
      id,
      1,
      content,
      "open",
      null,
      c.candidateId ?? null,
      actor,
      "Explicit work record; no assignment or commitment.",
    );
    if (content.suggestedPerson)
      await recordTaskOffer(tx, w, id, 1, actor, content.title);
    await changed(tx, w, c.type, true);
    return { taskId: id, version: 1 };
  }
  if (c.type.startsWith("task.") && "taskId" in c) {
    const v = await taskAt(tx, w, c.taskId);
    requireThat(v.version === c.expectedVersion, "TASK_VERSION_STALE");
    if (c.type === "task.comment") {
      const commentId = randomUUID();
      // execute() already holds the Workspace lock. Each Task has its own ordered history.
      await tx.query(
        `INSERT INTO task_comment(workspace_id,task_id,position,id,task_version,actor_id,body)
         SELECT $1,$2,COALESCE(max(position),0)+1,$3,$4,$5,$6 FROM task_comment WHERE workspace_id=$1 AND task_id=$2`,
        [w, c.taskId, commentId, v.version, actor, c.body],
      );
      await changed(tx, w, c.type);
      return { taskId: c.taskId, version: v.version, commentId };
    }
    if (c.type === "task.decline") {
      requireThat(
        v.suggested_person === actor &&
          !v.responsibility_id &&
          !["completed", "cancelled"].includes(v.status),
        "TASK_NOT_OFFERED",
        403,
      );
      await tx.query(
        "INSERT INTO task_offer_decline(workspace_id,task_id,version,person_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [w, c.taskId, v.version, actor],
      );
      await changed(tx, w, c.type);
      return { taskId: c.taskId, version: v.version, declined: true };
    }
    let content = await taskContent(tx, v),
      status = v.status,
      rid = v.responsibility_id;
    const currentMember = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    const manages =
      !rid ||
      (v.person_id === actor &&
        v.accepted_membership_version === currentMember.version);
    if (c.type === "task.propose_revision") {
      requireThat(!["completed", "cancelled"].includes(status), "TASK_CLOSED");
      await workReferences(tx, w, c.content.references);
      if (c.content.suggestedPerson)
        await member(tx, w, c.content.suggestedPerson, true, true);
      const proposalId = randomUUID();
      await tx.query(
        "INSERT INTO task_revision_proposal(id,workspace_id,task_id,base_version,content,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [proposalId, w, c.taskId, v.version, c.content, actor, c.reason],
      );
      await changed(tx, w, c.type);
      return { proposalId };
    }
    if (c.type === "task.accept") {
      requireThat(!rid, "TASK_ALREADY_ASSIGNED");
      requireThat(!["completed", "cancelled"].includes(status), "TASK_CLOSED");
      if (v.suggested_person) {
        requireThat(
          v.suggested_person === actor && !v.declined,
          "TASK_NOT_OFFERED",
          403,
        );
      }
      rid = await acceptance(tx, w, c.taskId, v.version, actor);
    } else if (c.type === "task.relinquish") {
      requireThat(v.person_id === actor, "TASK_NOT_RESPONSIBLE", 403);
      rid = null;
      content.suggestedPerson = null;
      if (status === "in_progress") status = "open";
    } else if (c.type === "task.revise") {
      requireThat(!rid, "TASK_NEW_ACCEPTANCE_REQUIRED");
      requireThat(!["completed", "cancelled"].includes(status), "TASK_CLOSED");
      content = c.content;
      if (content.suggestedPerson)
        await member(tx, w, content.suggestedPerson, true, true);
    } else if (c.type === "task.adopt_revision") {
      requireThat(
        manages && rid && v.person_id === actor,
        "TASK_NOT_RESPONSIBLE",
        403,
      );
      requireThat(!["completed", "cancelled"].includes(status), "TASK_CLOSED");
      const p = (
        await tx.query(
          "SELECT * FROM task_revision_proposal WHERE workspace_id=$1 AND task_id=$2 AND id=$3",
          [w, c.taskId, c.proposalId],
        )
      ).rows[0];
      requireThat(p && p.base_version === v.version, "TASK_PROPOSAL_STALE");
      content = taskContentSchema.parse(p.content);
      if (content.suggestedPerson)
        await member(tx, w, content.suggestedPerson, true, true);
      rid = await acceptance(tx, w, c.taskId, v.version + 1, actor);
    } else if (c.type === "task.status") {
      requireThat(manages, "TASK_NOT_RESPONSIBLE", 403);
      status = c.status;
      if (status === v.status) return { taskId: c.taskId, version: v.version };
      if (
        !rid &&
        (v.declined ||
          ["completed", "cancelled"].includes(status) ||
          ["completed", "cancelled"].includes(v.status))
      )
        content.suggestedPerson = null;
    }
    const version = v.version + 1;
    await saveTask(
      tx,
      w,
      c.taskId,
      version,
      content,
      status,
      rid,
      v.candidate_id,
      actor,
      c.reason,
      c.type === "task.adopt_revision" ? c.proposalId : v.adopted_proposal_id,
    );
    if (
      !rid &&
      content.suggestedPerson &&
      (c.type === "task.revise" || c.type === "task.status")
    )
      await recordTaskOffer(tx, w, c.taskId, version, actor, content.title);
    await changed(tx, w, c.type, true);
    return { taskId: c.taskId, version };
  }
  if (
    c.type === "followup.create" ||
    c.type === "followup.revise" ||
    c.type === "followup.close"
  ) {
    let id: string,
      version: number,
      status = "active";
    let value: {
      content: string;
      kind: string;
      remindAt: string;
      timeZone: string;
      reference: ReturnType<typeof followupReference>;
      recurrence?: ReturnType<typeof followupRecurrence>;
    };
    if (c.type === "followup.create") {
      id = randomUUID();
      version = 1;
      value = c;
      await tx.query(
        "INSERT INTO workspace_followup(id,workspace_id,owner_id,current_version) VALUES($1,$2,$3,1)",
        [id, w, actor],
      );
    } else {
      id = c.followupId;
      const v = await followupAt(tx, w, id);
      requireThat(v.version === c.expectedVersion, "FOLLOWUP_VERSION_STALE");
      requireThat(v.owner_id === actor, "FOLLOWUP_NOT_OWNER", 403);
      version = v.version + 1;
      value =
        c.type === "followup.revise"
          ? {
              ...c,
              recurrence:
                c.recurrence === undefined
                  ? followupRecurrence(v)
                  : c.recurrence,
            }
          : {
              content: v.content,
              kind: v.kind,
              remindAt: v.schedule_anchor,
              timeZone: v.time_zone,
              reference: followupReference(v),
              recurrence: followupRecurrence(v),
            };
      if (c.type === "followup.close") status = c.status;
    }
    if (value.reference) {
      await workReferences(tx, w, [value.reference]);
      if (status === "active")
        requireThat(
          await validWorkReference(tx, w, value.reference, true),
          "FOLLOWUP_REFERENCE_STALE",
        );
    }
    let next: string | null = null;
    if (status === "active") {
      if (value.recurrence) {
        next = await nextFollowupOccurrence(
          tx,
          value.remindAt,
          value.timeZone,
          value.recurrence,
        );
        requireThat(next, "FOLLOWUP_NO_OCCURRENCE", 400);
        if (c.type === "followup.revise") {
          // Editing the description must not replay reminders already covered
          // by a late/wake-up delivery, even when the anchor is years old.
          const previous = (
            await tx.query<{ watermark: string }>(
              `SELECT GREATEST(scheduled_at,delivered_at)::text AS watermark FROM followup_delivery
             WHERE workspace_id=$1 AND followup_id=$2 ORDER BY version DESC,scheduled_at DESC LIMIT 1`,
              [w, id],
            )
          ).rows[0];
          if (previous)
            next = await nextFollowupOccurrence(
              tx,
              value.remindAt,
              value.timeZone,
              value.recurrence,
              previous.watermark,
            );
        }
      } else next = value.remindAt;
    }
    if (
      next &&
      (
        await tx.query(
          "SELECT 1 FROM followup_series_split WHERE workspace_id=$1 AND followup_id=$2 AND effective_at<=$3",
          [w, id, next],
        )
      ).rowCount
    )
      next = null;
    const m = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    await tx.query(
      `INSERT INTO followup_version(workspace_id,followup_id,version,content,kind,remind_at,time_zone,reference_kind,reference_id,reference_version,status,actor_id,membership_version,reason,recurrence_weekdays,recurrence_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::smallint[],$16::date)`,
      [
        w,
        id,
        version,
        value.content,
        value.kind,
        value.remindAt,
        value.timeZone,
        value.reference?.kind ?? null,
        value.reference?.id ?? null,
        value.reference?.version ?? null,
        status,
        actor,
        m.version,
        "reason" in c
          ? c.reason
          : "Reminder explicitly scheduled for this Workspace Conversation.",
        value.recurrence?.weekdays ?? null,
        value.recurrence?.until ?? null,
      ],
    );
    await tx.query(
      "UPDATE workspace_followup SET current_version=$3,next_remind_at=$4 WHERE workspace_id=$1 AND id=$2",
      [w, id, version, next],
    );
    if (next)
      await enqueueFollowup(tx, w, id, version, next, !!value.recurrence);
    await changed(tx, w, c.type, true);
    return { followupId: id, version };
  }
  throw new Error("Unreachable task command");
}
