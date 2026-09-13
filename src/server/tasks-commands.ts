import { randomUUID } from "node:crypto";
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
) {
  await tx.query(
    "SELECT graphile_worker.add_job('followup_due',json_build_object('workspaceId',$1::text,'id',$2::text,'version',$3::int),run_at:=$4::timestamptz,job_key:=$5,max_attempts:=5)",
    [w, id, version, at, `followup:${id}:${version}`],
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
  await member(tx, w, actor, true, true);
  await authenticatedSession(tx, actor, sessionId);
  if (c.type === "task.create") {
    const id = randomUUID();
    const content = structuredClone(c.content);
    if (content.suggestedPerson) await member(tx, w, content.suggestedPerson);
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
    await changed(tx, w, c.type, true);
    return { taskId: id, version: 1 };
  }
  if (c.type.startsWith("task.") && "taskId" in c) {
    const v = await taskAt(tx, w, c.taskId);
    requireThat(v.version === c.expectedVersion, "TASK_VERSION_STALE");
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
        await member(tx, w, c.content.suggestedPerson);
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
      rid = await acceptance(tx, w, c.taskId, v.version, actor);
    } else if (c.type === "task.relinquish") {
      requireThat(v.person_id === actor, "TASK_NOT_RESPONSIBLE", 403);
      rid = null;
      if (status === "in_progress") status = "open";
    } else if (c.type === "task.revise") {
      requireThat(!rid, "TASK_NEW_ACCEPTANCE_REQUIRED");
      requireThat(!["completed", "cancelled"].includes(status), "TASK_CLOSED");
      content = c.content;
      if (content.suggestedPerson) await member(tx, w, content.suggestedPerson);
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
      if (content.suggestedPerson) await member(tx, w, content.suggestedPerson);
      rid = await acceptance(tx, w, c.taskId, v.version + 1, actor);
    } else if (c.type === "task.status") {
      requireThat(manages, "TASK_NOT_RESPONSIBLE", 403);
      status = c.status;
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
          ? c
          : {
              content: v.content,
              kind: v.kind,
              remindAt: v.remind_at.toISOString(),
              timeZone: v.time_zone,
              reference: followupReference(v),
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
    const m = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    await tx.query(
      `INSERT INTO followup_version(workspace_id,followup_id,version,content,kind,remind_at,time_zone,reference_kind,reference_id,reference_version,status,actor_id,membership_version,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
          : "Explicit personal follow-up; no authority to act.",
      ],
    );
    await tx.query(
      "UPDATE workspace_followup SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
      [w, id, version],
    );
    if (status === "active")
      await enqueueFollowup(tx, w, id, version, value.remindAt);
    await changed(tx, w, c.type, true);
    return { followupId: id, version };
  }
  throw new Error("Unreachable task command");
}
