import {
  productAssistanceJoin,
  productAssistanceProjection,
  conversationOperationProjection,
} from "./product-assistance.ts";
import {
  messageReferenceJoin,
  messageReferenceProjection,
} from "./conversation-reference.ts";
import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  requireReadableWorkstream,
  messageFocusJoin,
  messageFocusProjection,
  focusedMessagePredicate,
} from "./workstream-focus.ts";
import {
  stateSchema,
  messagesSchema,
  changesSchema,
  receiptSchema,
  historySchema,
} from "../contracts/v1.ts";

// Public, bounded read projections. Retained history is still accessible; page sizes are not access cutoffs.
export async function state(actor: string, w: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const workspace = (
      await tx.query(
        'SELECT id,name,revision,context_revision AS "contextRevision",access_revision AS "accessRevision" FROM workspace WHERE id=$1',
        [w],
      )
    ).rows[0];
    const messageSequence = Number(
      (
        await tx.query(
          "SELECT COALESCE(max(sequence),0) AS seq FROM message WHERE workspace_id=$1",
          [w],
        )
      ).rows[0].seq,
    );
    const goals = (
      await tx.query(
        'SELECT g.id,g.current_version AS version,g.current_primary AS "currentPrimary",v.content,v.established_by AS "establishedBy" FROM goal g JOIN goal_version v ON (v.workspace_id,v.goal_id,v.version)=(g.workspace_id,g.id,g.current_version) WHERE g.workspace_id=$1',
        [w],
      )
    ).rows;
    const adherences = (
      await tx.query(
        'SELECT goal_id AS "goalId",goal_version AS "goalVersion",user_id AS "personId" FROM goal_adherence WHERE workspace_id=$1',
        [w],
      )
    ).rows;
    const information = (
      await tx.query(
        'SELECT a.id,a.subject,a.current_version AS version,v.content,v.qualification,v.accepted_by AS "acceptedBy",v.candidate_id AS "candidateId" FROM accepted_information a JOIN information_version v ON (v.workspace_id,v.information_id,v.version)=(a.workspace_id,a.id,a.current_version) WHERE a.workspace_id=$1 ORDER BY a.subject,a.id',
        [w],
      )
    ).rows;
    const commitments = (
      await tx.query(
        `SELECT p.id,p.content,p.kind,CASE WHEN a.id IS NULL THEN 'proposed' WHEN EXISTS(SELECT 1 FROM current_project_act effective WHERE effective.workspace_id=a.workspace_id AND effective.id=a.id) THEN 'effective' ELSE 'superseded' END AS status,p.candidate_id AS "candidateId",a.adopted_at AS "adoptedAt",ARRAY(SELECT person_id FROM required_project_approval r WHERE (r.workspace_id,r.proposal_id)=(p.workspace_id,p.id) ORDER BY person_id) AS people FROM normative_proposal p LEFT JOIN project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 ORDER BY p.created_at,p.id`,
        [w],
      )
    ).rows.map((row) => ({
      ...row,
      adoptedAt: row.adoptedAt?.toISOString() ?? null,
    }));
    return stateSchema.parse({
      workspace,
      messageSequence,
      goals,
      adherences,
      information,
      commitments,
    });
  });
}

export async function messages(
  actor: string,
  w: string,
  after: number,
  through: number,
  limit: number,
  workstreamId?: string,
) {
  requireThat(after <= through, "INVALID_CURSOR", 400);
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    await requireReadableWorkstream(tx, w, workstreamId);
    const rows = (
      await tx.query(
        `SELECT m.id,m.sequence,m.content,COALESCE(m.author_id,'miriam') AS "authorId",COALESCE(u.name,'Miriam') AS "authorName",m.actor_kind AS "actorKind",m.purpose,m.reply_to_source_id AS "replyToSourceId",${messageFocusProjection} AS "workstreamFocus",${messageReferenceProjection} AS reference,${productAssistanceProjection} AS "assistanceContext",${conversationOperationProjection} AS "operationResult",COALESCE(r.source_ids,CASE WHEN cwa.reply_message_id IS NOT NULL THEN ARRAY[cwa.source_message_id] END,'{}'::uuid[]) AS "citationSourceIds",m.created_at AS "createdAt" FROM message m LEFT JOIN "user" u ON u.id=m.author_id LEFT JOIN miriam_response r ON (r.workspace_id,r.message_id)=(m.workspace_id,m.id) ${messageFocusJoin} ${messageReferenceJoin} ${productAssistanceJoin} WHERE m.workspace_id=$1 AND m.sequence>$2 AND m.sequence<=$3 AND ${focusedMessagePredicate} ORDER BY m.sequence LIMIT $4`,
        [w, after, through, limit + 1, workstreamId ?? null],
      )
    ).rows;
    const page = rows
      .slice(0, limit)
      .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    return messagesSchema.parse({
      messages: page,
      nextAfter: page.at(-1)?.sequence ?? after,
      through,
      hasMore: rows.length > limit,
    });
  });
}

export async function changes(
  actor: string,
  w: string,
  after: number,
  limit: number,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const head = (
      await tx.query("SELECT revision FROM workspace WHERE id=$1", [w])
    ).rows[0].revision as number;
    requireThat(after <= head, "CURSOR_AHEAD", 409);
    const rows = (
      await tx.query(
        "SELECT revision,kind FROM workspace_change WHERE workspace_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT $4",
        [w, after, head, limit + 1],
      )
    ).rows;
    const page = rows.slice(0, limit);
    // A future feed-retention policy must provide reset semantics, never silently skip a gap.
    requireThat(
      (page[0]?.revision ?? head + 1) === after + 1,
      "SYNC_RESET_REQUIRED",
      409,
    );
    return changesSchema.parse({
      changes: page,
      nextAfter: page.at(-1)?.revision ?? after,
      headRevision: head,
      hasMore: rows.length > limit,
    });
  });
}

export async function history(
  actor: string,
  w: string,
  before: number,
  through: number,
  limit: number,
  workstreamId?: string,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    await requireReadableWorkstream(tx, w, workstreamId);
    const rows = (
      await tx.query(
        `SELECT m.id,m.sequence,m.content,COALESCE(m.author_id,'miriam') AS "authorId",COALESCE(u.name,'Miriam') AS "authorName",m.actor_kind AS "actorKind",m.purpose,m.reply_to_source_id AS "replyToSourceId",${messageFocusProjection} AS "workstreamFocus",${messageReferenceProjection} AS reference,${productAssistanceProjection} AS "assistanceContext",${conversationOperationProjection} AS "operationResult",COALESCE(r.source_ids,CASE WHEN cwa.reply_message_id IS NOT NULL THEN ARRAY[cwa.source_message_id] END,'{}'::uuid[]) AS "citationSourceIds",m.created_at AS "createdAt" FROM message m LEFT JOIN "user" u ON u.id=m.author_id LEFT JOIN miriam_response r ON (r.workspace_id,r.message_id)=(m.workspace_id,m.id) ${messageFocusJoin} ${messageReferenceJoin} ${productAssistanceJoin} WHERE m.workspace_id=$1 AND m.sequence<$2 AND m.sequence<=$3 AND ${focusedMessagePredicate} ORDER BY m.sequence DESC LIMIT $4`,
        [w, before, through, limit + 1, workstreamId ?? null],
      )
    ).rows;
    const page = rows
      .slice(0, limit)
      .reverse()
      .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    return historySchema.parse({
      messages: page,
      nextBefore: page[0]?.sequence ?? before,
      through,
      hasMore: rows.length > limit,
    });
  });
}

export async function receipt(actor: string, w: string, commandId: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const row = (
      await tx.query(
        "SELECT result FROM command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3",
        [w, actor, commandId],
      )
    ).rows[0];
    // Absence is not proof of failure: an in-flight transaction may still commit.
    requireThat(row, "RECEIPT_NOT_FOUND", 404);
    return receiptSchema.parse({
      commandId,
      status: "committed",
      result: row.result,
    });
  });
}
