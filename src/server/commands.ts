import { applyCall } from "./calls.ts";
import { sendVoice } from "./voice.ts";
import { draftArtifact, reviewArtifact, approveArtifact } from "./artifacts.ts";
import { artifactDocumentCommandSchema } from "../contracts/artifact-document.ts";
import { composeArtifact } from "./artifact-document.ts";
import { applyCalendar } from "./calendar-commands.ts";
import { calendarCommandSchema } from "../contracts/calendar.ts";
import { emailCommandSchema } from "../contracts/email.ts";
import { applyEmail } from "./email-commands.ts";
import { taskCommandSchema } from "../contracts/tasks.ts";
import { applyTasks } from "./tasks-commands.ts";
import {
  workSuggestionCommandSchema,
  activeWorkCommandSchema,
} from "../contracts/active-work.ts";
import {
  applyActiveWork,
  createActiveWork,
  startObjective,
} from "./active-work-commands.ts";
import { applyWorkSuggestion } from "./work-suggestions.ts";
import { reassessActiveWork } from "./active-work-worker.ts";
import { accessCommandSchema } from "../contracts/access.ts";
import { applyAccess } from "./access-commands.ts";
import { projectCommandSchema } from "../contracts/project.ts";
import { attentionCommandSchema } from "../contracts/attention.ts";
import { attentionCommand } from "./attention.ts";
import { applyProject } from "./project-commands.ts";
import {
  eligible,
  authenticatedSession,
  member,
  lockWorkspace,
  changed,
  enqueue,
  type WorkspaceRow,
} from "./workspace-state.ts";
export {
  eligible,
  member,
  lockWorkspace,
  changed,
  enqueue,
} from "./workspace-state.ts";
export type { WorkspaceRow } from "./workspace-state.ts";
import { changeQuestion } from "./questions.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { requireThat, DomainError } from "./errors.ts";
import { uploadDocument, retryDocument } from "./sources.ts";
import { requestResearch, controlResearch } from "./research.ts";
import { enqueueInvitationMail } from "./invitation-delivery.ts";
import { applyWorkspaceLink } from "./workspace-links.ts";

import { commandSchema } from "../contracts/commands.ts";
import type { Command } from "../contracts/commands.ts";
export { commandSchema } from "../contracts/commands.ts";
export type { Command } from "../contracts/commands.ts";
const id = z.uuid();
async function membershipHistory(
  tx: Tx,
  w: string,
  person: string,
  actor: string,
  basis: string,
  accepted = false,
) {
  await tx.query(
    "INSERT INTO membership_history(id,workspace_id,user_id,version,active,actor_id,basis,full_history_accepted) SELECT $1,workspace_id,user_id,version,active,$4,$5,$6 FROM membership WHERE workspace_id=$2 AND user_id=$3",
    [randomUUID(), w, person, actor, basis, accepted],
  );
}
async function accessHistory(
  tx: Tx,
  w: string,
  person: string,
  actor: string,
  basis: string,
) {
  await tx.query(
    "INSERT INTO access_history(id,workspace_id,relationship_id,version,active,invitations,remove_members,change_access,protected,actor_id,basis) SELECT $1,workspace_id,id,version,active,invitations,remove_members,change_access,protected,$4,$5 FROM access_relationship WHERE workspace_id=$2 AND holder_id=$3 AND NOT EXISTS(SELECT 1 FROM access_history h WHERE h.relationship_id=access_relationship.id AND h.version=access_relationship.version)",
    [randomUUID(), w, person, actor, basis],
  );
}
async function capability(
  tx: Tx,
  w: string,
  actor: string,
  operation: "invitations" | "remove_members",
) {
  const r = await tx.query(
    `SELECT id FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2 AND active AND ${operation}=true`,
    [w, actor],
  );
  requireThat(r.rowCount, "ACCESS_AUTHORITY_REQUIRED", 403);
  return r.rows[0].id as string;
}
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function createWorkspace(
  actor: string,
  name: string,
  commandId: string,
) {
  id.parse(commandId);
  name = z.string().trim().min(1).max(120).parse(name);
  return transaction(async (tx) => {
    await eligible(tx, actor, true);
    // Serialize retries of creation before there is a Workspace row to lock.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${actor}:${commandId}`,
    ]);
    const prior = await tx.query(
      "SELECT id,name,created_by FROM workspace WHERE id=$1",
      [commandId],
    );
    if (prior.rowCount) {
      requireThat(
        prior.rows[0].created_by === actor && prior.rows[0].name === name,
        "COMMAND_ID_REUSED",
      );
      return { id: commandId };
    }
    const w = commandId,
      relation = randomUUID();
    await tx.query(
      "INSERT INTO workspace(id,name,created_by) VALUES($1,$2,$3)",
      [w, name, actor],
    );
    await tx.query(
      "INSERT INTO membership(workspace_id,user_id) VALUES($1,$2)",
      [w, actor],
    );
    await membershipHistory(
      tx,
      w,
      actor,
      actor,
      "workspace_initialization",
      true,
    );
    await tx.query(
      "INSERT INTO access_relationship(id,workspace_id,holder_id,invitations,remove_members,change_access,basis) VALUES($1,$2,$3,true,true,true,'workspace_initialization')",
      [relation, w, actor],
    );
    await accessHistory(tx, w, actor, actor, "workspace_initialization");
    await changed(tx, w, "workspace.created", false, true);
    await tx.query(
      "INSERT INTO command_receipt(workspace_id,actor_id,command_id,request_hash,result) VALUES($1,$2,$1,$3,$4)",
      [
        w,
        actor,
        tokenHash(JSON.stringify({ type: "workspace.create", name })),
        JSON.stringify({ id: w }),
      ],
    );
    return { id: w };
  });
}

export async function acceptInvitation(
  actor: string,
  token: string,
  fullHistoryAccepted: boolean,
) {
  requireThat(fullHistoryAccepted, "HISTORY_ACCEPTANCE_REQUIRED", 400);
  return transaction(async (tx) => {
    const user = await eligible(tx, actor, true);
    const lookup = await tx.query(
      "SELECT workspace_id FROM invitation WHERE token_hash=$1",
      [tokenHash(token)],
    );
    requireThat(lookup.rowCount, "INVITATION_INVALID", 404);
    const w = lookup.rows[0].workspace_id;
    await lockWorkspace(tx, w);
    const r = await tx.query(
      "SELECT * FROM invitation WHERE token_hash=$1 FOR UPDATE",
      [tokenHash(token)],
    );
    const invite = r.rows[0];
    requireThat(
      invite.recipient_email === user.email.toLowerCase(),
      "INVITATION_RECIPIENT_MISMATCH",
      403,
    );
    requireThat(
      !invite.accepted_at &&
        !invite.revoked_at &&
        new Date(invite.expires_at) > new Date(),
      "INVITATION_INVALID",
    );
    await member(tx, w, invite.issuer_id, false, true);
    const authority = await capability(tx, w, invite.issuer_id, "invitations");
    requireThat(
      authority === invite.relationship_id,
      "INVITATION_AUTHORITY_ENDED",
      403,
    );
    const existing = await tx.query(
      "SELECT active FROM membership WHERE workspace_id=$1 AND user_id=$2",
      [w, actor],
    );
    requireThat(!existing.rows[0]?.active, "ALREADY_A_MEMBER");
    await tx.query(
      "INSERT INTO membership(workspace_id,user_id) VALUES($1,$2) ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true,version=membership.version+1",
      [w, actor],
    );
    await membershipHistory(
      tx,
      w,
      actor,
      actor,
      `invitation:${invite.id}`,
      true,
    );
    await tx.query(
      "UPDATE invitation SET accepted_at=now(),accepted_by=$2 WHERE id=$1",
      [invite.id, actor],
    );
    await changed(tx, w, "member.joined", false, true);
    return { workspaceId: w };
  });
}

export async function execute(
  actor: string,
  w: string,
  commandId: string,
  input: unknown,
  sessionId?: string,
) {
  id.parse(w);
  id.parse(commandId);
  const c = commandSchema.parse(input);
  return transaction(async (tx) => {
    if (c.type === "workspace.link") {
      for (const workspace of [...new Set([w, c.otherWorkspaceId])].sort())
        await lockWorkspace(tx, workspace);
    }
    const ws = await lockWorkspace(tx, w);
    await member(tx, w, actor, false, true);
    if (sessionId) await authenticatedSession(tx, actor, sessionId);
    if (c.type === "message.send" && startObjective(c.content)) {
      await authenticatedSession(tx, actor, sessionId);
    }
    const hash = tokenHash(JSON.stringify(c));
    const previous = await tx.query(
      "SELECT request_hash,result FROM command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3",
      [w, actor, commandId],
    );
    if (previous.rowCount) {
      requireThat(previous.rows[0].request_hash === hash, "COMMAND_ID_REUSED");
      return previous.rows[0].result;
    }
    const calendar = calendarCommandSchema.safeParse(c);
    const email = emailCommandSchema.safeParse(c);
    const tasks = taskCommandSchema.safeParse(c);
    const work = activeWorkCommandSchema.safeParse(c);
    const access = accessCommandSchema.safeParse(c);
    const project = projectCommandSchema.safeParse(c);
    const attention = attentionCommandSchema.safeParse(c);
    const document = artifactDocumentCommandSchema.safeParse(c);
    const suggestion = workSuggestionCommandSchema.safeParse(c);
    const result = suggestion.success
      ? await applyWorkSuggestion(tx, w, actor, suggestion.data, sessionId)
      : document.success
        ? await composeArtifact(tx, ws, actor, document.data)
        : attention.success
          ? await attentionCommand(tx, w, actor, attention.data)
          : project.success
            ? await applyProject(tx, ws, actor, project.data, sessionId)
            : access.success
              ? await applyAccess(tx, ws, actor, access.data, sessionId)
              : work.success
                ? await applyActiveWork(tx, w, actor, work.data, sessionId)
                : tasks.success
                  ? await applyTasks(tx, ws, actor, tasks.data, sessionId)
                  : email.success
                    ? await applyEmail(tx, ws, actor, email.data, sessionId)
                    : calendar.success
                      ? await applyCalendar(
                          tx,
                          ws,
                          actor,
                          calendar.data,
                          sessionId,
                        )
                      : await apply(tx, ws, actor, c);
    await reassessActiveWork(tx, w);
    await tx.query(
      "INSERT INTO command_receipt(workspace_id,actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [w, actor, commandId, hash, JSON.stringify(result)],
    );
    return result;
  });
}

async function candidateFor(tx: Tx, ws: WorkspaceRow, candidateId: string) {
  const r = await tx.query(
    "SELECT * FROM candidate WHERE workspace_id=$1 AND id=$2",
    [ws.id, candidateId],
  );
  requireThat(r.rowCount, "CANDIDATE_NOT_FOUND", 404);
  requireThat(
    r.rows[0].context_revision === ws.context_revision,
    "CANDIDATE_STALE",
  );
  return r.rows[0];
}

async function apply(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: Command,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  if (c.type.startsWith("call."))
    return applyCall(tx, w, actor, c as Parameters<typeof applyCall>[3]);
  switch (c.type) {
    case "workspace.link":
      return applyWorkspaceLink(tx, w, actor, c);
    case "artifact.draft":
    case "artifact.revise":
      return draftArtifact(tx, ws, actor, c);
    case "artifact.review":
      return reviewArtifact(tx, ws, actor, c);
    case "artifact.approve":
      return approveArtifact(tx, ws, actor, c);
    case "question.open":
    case "question.answer":
    case "question.reopen":
      return changeQuestion(tx, ws, actor, c);
    case "voice.send":
      return sendVoice(tx, w, actor, c);
    case "document.upload":
      return uploadDocument(tx, w, actor, c);
    case "document.retry":
      return retryDocument(tx, w, actor, c);
    case "research.request":
      return requestResearch(tx, ws, actor, c);
    case "research.retry":
    case "research.cancel":
      return controlResearch(tx, ws, actor, c);
    case "goal.establish": {
      await member(tx, w, actor, true);
      requireThat(
        !(await tx.query("SELECT 1 FROM goal WHERE workspace_id=$1", [w]))
          .rowCount,
        "GOAL_CHANGE_REQUIRES_SEPARATE_TRANSITION",
      );
      const goalId = randomUUID();
      await tx.query(
        "INSERT INTO goal(id,workspace_id,current_version) VALUES($1,$2,1)",
        [goalId, w],
      );
      await tx.query(
        "INSERT INTO goal_version(workspace_id,goal_id,version,content,established_by) VALUES($1,$2,1,$3,$4)",
        [w, goalId, c.content, actor],
      );
      await tx.query("INSERT INTO goal_intent_participant VALUES($1,$2,1,$3)", [
        w,
        goalId,
        actor,
      ]);
      // Establishing intent does not manufacture a separate adherence act, even for its author.
      await changed(tx, w, c.type, true);
      return { goalId };
    }
    case "goal.adhere": {
      const g = await tx.query(
        "SELECT current_version FROM goal WHERE workspace_id=$1 AND id=$2 AND status='active'",
        [w, c.goalId],
      );
      requireThat(
        g.rows[0]?.current_version === c.version,
        "GOAL_VERSION_STALE",
      );
      await tx.query(
        "INSERT INTO goal_adherence(id,workspace_id,goal_id,goal_version,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [randomUUID(), w, c.goalId, c.version, actor],
      );
      await changed(tx, w, c.type);
      return {};
    }
    case "message.send": {
      await member(tx, w, actor, true);
      const messageId = randomUUID(),
        interpretationId = randomUUID();
      const seq = await tx.query(
        "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
        [w],
      );
      await tx.query(
        "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
        [messageId, w, seq.rows[0].next_message, actor, c.content],
      );
      await tx.query(
        "INSERT INTO interpretation(id,workspace_id,source_id,status) VALUES($1,$2,$3,'queued')",
        [interpretationId, w, messageId],
      );
      await enqueue(tx, interpretationId);
      await changed(tx, w, c.type);
      const objective = startObjective(c.content);
      const work = objective
        ? await createActiveWork(tx, w, objective, messageId, actor)
        : undefined;
      return { messageId, interpretationId, ...work };
    }
    case "invitation.create": {
      const relationship = await capability(tx, w, actor, "invitations");
      const token = randomBytes(32).toString("base64url"),
        inviteId = randomUUID();
      await tx.query(
        "INSERT INTO invitation(id,workspace_id,recipient_email,token_hash,issuer_id,relationship_id,expires_at,history_disclosed) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days',true)",
        [inviteId, w, c.email, tokenHash(token), actor, relationship],
      );
      await changed(tx, w, c.type);
      const invitationUrl = new URL(
        "/",
        process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000",
      );
      invitationUrl.searchParams.set("invite", token);
      if (c.sendEmail)
        await enqueueInvitationMail(tx, w, inviteId, invitationUrl.href);
      return {
        invitationId: inviteId,
        token,
        invitationUrl: invitationUrl.href,
      };
    }
    case "invitation.revoke": {
      await capability(tx, w, actor, "invitations");
      const r = await tx.query(
        "UPDATE invitation SET revoked_at=now() WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
        [w, c.invitationId],
      );
      requireThat(r.rowCount, "INVITATION_INVALID");
      await changed(tx, w, c.type);
      return {};
    }
    case "member.remove":
    case "member.leave":
    case "access.relinquish": {
      const person = c.type === "member.remove" ? c.personId : actor;
      if (c.type === "member.remove") {
        requireThat(
          c.expectedAccessRevision === ws.access_revision,
          "AUTHORITY_STALE",
        );
        requireThat(person !== actor, "USE_VOLUNTARY_LEAVE");
        await capability(tx, w, actor, "remove_members");
        // Revocable invitation delegation has no peer protection; stewardship changes use its own conditions.
        const protectedTarget = await tx.query(
          "SELECT 1 FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2 AND active AND (protected OR kind='stewardship')",
          [w, person],
        );
        requireThat(
          !protectedTarget.rowCount,
          "GOVERNANCE_CHANGE_REQUIRES_OWN_CONDITIONS",
          403,
        );
      }
      if (c.type !== "access.relinquish") {
        const r = await tx.query(
          "UPDATE membership SET active=false,version=version+1 WHERE workspace_id=$1 AND user_id=$2 AND active RETURNING user_id",
          [w, person],
        );
        requireThat(r.rowCount, "MEMBER_NOT_ACTIVE");
        await membershipHistory(tx, w, person, actor, c.type);
      }
      await tx.query(
        "UPDATE access_relationship SET active=false,version=version+1 WHERE workspace_id=$1 AND holder_id=$2 AND active",
        [w, person],
      );
      await accessHistory(tx, w, person, actor, c.type);
      // Named conditions survive. No last-governor veto, implicit successor or creator override.
      await changed(tx, w, c.type, false, true);
      return {};
    }
    case "information.accept":
    case "information.correct": {
      await member(tx, w, actor, true);
      const candidate = await candidateFor(tx, ws, c.candidateId);
      requireThat(
        candidate.classification === "descriptive",
        "DESCRIPTIVE_CLARIFICATION_REQUIRED",
      );
      let informationId: string, version: number;
      if (c.type === "information.accept") {
        requireThat(
          !(
            await tx.query(
              "SELECT 1 FROM accepted_information WHERE workspace_id=$1 AND subject=$2",
              [w, candidate.subject],
            )
          ).rowCount,
          "INFORMATION_EXISTS_USE_CORRECTION",
        );
        informationId = randomUUID();
        version = 1;
        await tx.query(
          "INSERT INTO accepted_information(id,workspace_id,subject,current_version) VALUES($1,$2,$3,1)",
          [informationId, w, candidate.subject],
        );
      } else {
        const r = await tx.query(
          "SELECT current_version,subject FROM accepted_information WHERE workspace_id=$1 AND id=$2",
          [w, c.informationId],
        );
        requireThat(
          r.rows[0]?.current_version === c.expectedVersion,
          "INFORMATION_VERSION_STALE",
        );
        requireThat(
          r.rows[0].subject === candidate.subject,
          "CORRECTION_SUBJECT_MISMATCH",
        );
        informationId = c.informationId;
        version = c.expectedVersion + 1;
        await tx.query(
          "UPDATE accepted_information SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
          [w, informationId, version],
        );
      }
      await tx.query(
        "INSERT INTO information_version(workspace_id,information_id,version,content,qualification,candidate_id,accepted_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          w,
          informationId,
          version,
          candidate.content,
          candidate.qualification,
          c.candidateId,
          actor,
          c.type === "information.correct"
            ? c.reason
            : "Explicit editorial acceptance",
        ],
      );
      await changed(tx, w, c.type, true);
      return { informationId, version };
    }
    case "commitment.propose": {
      await member(tx, w, actor, true);
      const candidate = await candidateFor(tx, ws, c.candidateId);
      const people = [...new Set(c.people)].sort();
      requireThat(people.includes(actor), "MUST_REPRESENT_SELF");
      for (const person of people) await member(tx, w, person);
      const goal = await tx.query(
        "SELECT id,current_version FROM goal WHERE workspace_id=$1 AND current_primary",
        [w],
      );
      const proposalId = randomUUID();
      await tx.query(
        "INSERT INTO normative_proposal(id,workspace_id,candidate_id,content,kind,proposed_by,goal_id,goal_version,context_revision) VALUES($1,$2,$3,$4,'commitment',$5,$6,$7,$8)",
        [
          proposalId,
          w,
          candidate.id,
          candidate.content,
          actor,
          goal.rows[0]?.id ?? null,
          goal.rows[0]?.current_version ?? null,
          ws.context_revision,
        ],
      );
      for (const person of people)
        await tx.query(
          "INSERT INTO required_project_approval(workspace_id,proposal_id,person_id) VALUES($1,$2,$3)",
          [w, proposalId, person],
        );
      await changed(tx, w, c.type);
      return { proposalId };
    }
    case "commitment.approve": {
      await member(tx, w, actor, true);
      requireThat(
        c.expectedContextRevision === ws.context_revision,
        "CONTEXT_STALE",
      );
      requireThat(
        c.expectedAccessRevision === ws.access_revision,
        "AUTHORITY_STALE",
      );
      const p = await tx.query(
        "SELECT * FROM normative_proposal WHERE workspace_id=$1 AND id=$2",
        [w, c.proposalId],
      );
      requireThat(p.rowCount, "PROPOSAL_NOT_FOUND", 404);
      requireThat(!p.rows[0].source_id, "USE_PROJECT_APPROVAL");
      requireThat(
        p.rows[0].context_revision === ws.context_revision,
        "PROPOSAL_STALE",
      );
      requireThat(
        !(
          await tx.query(
            "SELECT 1 FROM project_act WHERE workspace_id=$1 AND proposal_id=$2",
            [w, c.proposalId],
          )
        ).rowCount,
        "ALREADY_ADOPTED",
      );
      const people = await tx.query<{ person_id: string }>(
        "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
        [w, c.proposalId],
      );
      requireThat(
        people.rows.some((p) => p.person_id === actor),
        "NOT_A_NAMED_APPROVER",
        403,
      );
      await tx.query(
        "INSERT INTO project_approval(id,workspace_id,proposal_id,person_id,context_revision,access_revision) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          w,
          c.proposalId,
          actor,
          ws.context_revision,
          ws.access_revision,
        ],
      );
      const approvals = await tx.query<{ id: string; person_id: string }>(
        "SELECT DISTINCT ON(person_id) id,person_id FROM project_approval WHERE workspace_id=$1 AND proposal_id=$2 AND context_revision=$3 AND access_revision=$4 ORDER BY person_id,created_at DESC",
        [w, c.proposalId, ws.context_revision, ws.access_revision],
      );
      let adopted = false;
      if (approvals.rowCount === people.rowCount) {
        for (const p of people.rows)
          await member(tx, w, p.person_id, true, true);
        const actId = randomUUID();
        await tx.query(
          "INSERT INTO project_act(id,workspace_id,proposal_id) VALUES($1,$2,$3)",
          [actId, w, c.proposalId],
        );
        for (const a of approvals.rows)
          await tx.query(
            "INSERT INTO act_approval(workspace_id,act_id,approval_id) VALUES($1,$2,$3)",
            [w, actId, a.id],
          );
        adopted = true;
      }
      await changed(tx, w, c.type, adopted);
      return { adopted };
    }
    case "interpretation.retry": {
      await member(tx, w, actor, true);
      const r = await tx.query(
        "UPDATE interpretation SET status='queued',generation=generation+1,lease_until=NULL,error_code=NULL WHERE workspace_id=$1 AND id=$2 AND (status IN ('completed','stale','failed') OR (status='running' AND lease_until<now())) RETURNING id",
        [w, c.interpretationId],
      );
      requireThat(r.rowCount, "INTERPRETATION_NOT_RETRYABLE");
      await enqueue(tx, c.interpretationId);
      await changed(tx, w, c.type);
      return {};
    }
  }
  throw new DomainError("INVALID_COMMAND", 400);
}
