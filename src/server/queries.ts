import {
  productAssistanceJoin,
  productAssistanceProjection,
  conversationOperationProjection,
} from "./product-assistance.ts";
import { readHandoffs } from "./conversation-handoffs.ts";
import {
  messageReferenceJoin,
  messageReferenceProjection,
} from "./conversation-reference.ts";
import {
  messageFocusJoin,
  messageFocusProjection,
} from "./workstream-focus.ts";
import { readArtifacts } from "./artifacts.ts";
import { readWorkspaceLinks } from "./workspace-links.ts";
import { sourceRecords } from "./sources.ts";
import { transaction } from "./db.ts";
import { eligible, member, tokenHash } from "./commands.ts";
import { requireThat } from "./errors.ts";

export async function listWorkspaces(actor: string) {
  return transaction(async (tx) => {
    await eligible(tx, actor);
    return (
      await tx.query(
        "SELECT w.id,w.name FROM workspace w JOIN membership m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.active ORDER BY w.created_at",
        [actor],
      )
    ).rows as { id: string; name: string }[];
  });
}
export async function invitationDetails(actor: string, token: string) {
  return transaction(async (tx) => {
    const user = await eligible(tx, actor);
    const r = await tx.query(
      "SELECT i.id,i.recipient_email,i.expires_at,i.revoked_at,i.accepted_at,w.name FROM invitation i JOIN workspace w ON w.id=i.workspace_id WHERE i.token_hash=$1",
      [tokenHash(token)],
    );
    requireThat(
      r.rowCount && r.rows[0].recipient_email === user.email.toLowerCase(),
      "INVITATION_INVALID",
      404,
    );
    requireThat(
      !r.rows[0].revoked_at &&
        !r.rows[0].accepted_at &&
        new Date(r.rows[0].expires_at) > new Date(),
      "INVITATION_INVALID",
    );
    return r.rows[0];
  });
}
export async function snapshot(actor: string, w: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const workspace = (
      await tx.query(
        "SELECT id,name,revision,context_revision,access_revision FROM workspace WHERE id=$1",
        [w],
      )
    ).rows[0];
    const members = (
      await tx.query(
        'SELECT m.user_id,u.name,m.active,m.contributes FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name',
        [w],
      )
    ).rows;
    const access = (
      await tx.query(
        "SELECT id,holder_id,version,active,invitations,remove_members,change_access,protected,basis FROM access_relationship WHERE workspace_id=$1",
        [w],
      )
    ).rows;
    const goals = (
      await tx.query(
        "SELECT g.*,v.content,v.established_by FROM goal g JOIN goal_version v ON (v.workspace_id,v.goal_id,v.version)=(g.workspace_id,g.id,g.current_version) WHERE g.workspace_id=$1",
        [w],
      )
    ).rows;
    const adherences = (
      await tx.query(
        "SELECT goal_id,goal_version,user_id,created_at FROM goal_adherence WHERE workspace_id=$1",
        [w],
      )
    ).rows;
    const messages = (
      await tx.query(
        `SELECT m.*,COALESCE(u.name,'Miriam') AS author_name,
         COALESCE(r.source_ids,CASE WHEN cwa.reply_message_id IS NOT NULL THEN ARRAY[cwa.source_message_id] END,'{}'::uuid[]) AS citation_source_ids,${messageFocusProjection} AS workstream_focus,${messageReferenceProjection} AS reference,${productAssistanceProjection} AS "assistanceContext",${conversationOperationProjection} AS "operationResult"
         FROM message m LEFT JOIN "user" u ON u.id=m.author_id
         LEFT JOIN miriam_response r ON (r.workspace_id,r.message_id)=(m.workspace_id,m.id) ${messageFocusJoin} ${messageReferenceJoin} ${productAssistanceJoin}
         WHERE m.workspace_id=$1 ORDER BY sequence`,
        [w],
      )
    ).rows;
    const candidates = (
      await tx.query(
        "SELECT c.*,m.author_name,m.content AS source_content,ARRAY(SELECT source_id FROM candidate_source s WHERE s.workspace_id=c.workspace_id AND s.candidate_id=c.id) AS source_ids FROM candidate c JOIN workspace_source m ON (m.workspace_id,m.id)=(c.workspace_id,c.source_id) WHERE c.workspace_id=$1 ORDER BY c.created_at DESC",
        [w],
      )
    ).rows;
    const information = (
      await tx.query(
        "SELECT a.*,v.content,v.qualification,v.accepted_by,v.candidate_id,v.created_at FROM accepted_information a JOIN information_version v ON (v.workspace_id,v.information_id,v.version)=(a.workspace_id,a.id,a.current_version) WHERE a.workspace_id=$1 ORDER BY a.subject",
        [w],
      )
    ).rows;
    const versions = (
      await tx.query(
        'SELECT v.*,u.name AS accepted_by_name FROM information_version v JOIN "user" u ON u.id=v.accepted_by WHERE v.workspace_id=$1 ORDER BY v.version',
        [w],
      )
    ).rows;
    const commitments = (
      await tx.query(
        "SELECT p.*,a.adopted_at,CASE WHEN a.id IS NULL THEN 'proposed' WHEN EXISTS(SELECT 1 FROM current_project_act effective WHERE effective.workspace_id=a.workspace_id AND effective.id=a.id) THEN 'effective' ELSE 'superseded' END AS status,ARRAY(SELECT person_id FROM required_project_approval r WHERE (r.workspace_id,r.proposal_id)=(p.workspace_id,p.id)) AS people FROM normative_proposal p LEFT JOIN project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 ORDER BY p.created_at",
        [w],
      )
    ).rows;
    const approvals = (
      await tx.query(
        "SELECT proposal_id,person_id,context_revision,access_revision,created_at FROM project_approval WHERE workspace_id=$1",
        [w],
      )
    ).rows;
    const interpretations = (
      await tx.query(
        "SELECT id,source_id,status,error_code FROM interpretation WHERE workspace_id=$1",
        [w],
      )
    ).rows;
    const questions = (
      await tx.query(
        "SELECT q.id,v.* FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1 ORDER BY v.created_at",
        [w],
      )
    ).rows;
    const questionHistory = (
      await tx.query(
        "SELECT * FROM question_version WHERE workspace_id=$1 ORDER BY created_at",
        [w],
      )
    ).rows;
    // Usage is a projection of governed records, never an AI acceptance score.
    // Preserve historical references after corrections and supersession.
    for (const c of candidates) {
      c.uses = {
        information: versions
          .filter((v) => v.candidate_id === c.id)
          .map((v) => ({
            id: v.information_id,
            version: v.version,
            current: information.some(
              (i) =>
                i.id === v.information_id && i.current_version === v.version,
            ),
          })),
        questions: questionHistory
          .filter((v) => v.candidate_id === c.id)
          .map((v) => ({
            id: v.question_id,
            version: v.version,
            current: questions.some(
              (q) => q.id === v.question_id && q.version === v.version,
            ),
          })),
        proposals: commitments
          .filter((p) => p.candidate_id === c.id)
          .map((p) => ({ id: p.id, status: p.status })),
      };
    }
    const sources = await sourceRecords(tx, w);
    const research = (
      await tx.query(
        "SELECT id,requested_by,request_source_id,query,goal_id,goal_version,question_id,question_version,status,generation,error_code,created_at FROM research_work WHERE workspace_id=$1 ORDER BY created_at DESC",
        [w],
      )
    ).rows;
    const researchEvents = (
      await tx.query(
        "SELECT work_id,generation,status,actor_id,detail,created_at FROM research_event WHERE workspace_id=$1 ORDER BY created_at",
        [w],
      )
    ).rows;
    // Token hashes and diagnostic payloads never enter the shared read model.
    const invitations = access.some(
      (a) => a.holder_id === actor && a.active && a.invitations,
    )
      ? (
          await tx.query(
            "SELECT i.id,i.recipient_email,i.expires_at,i.revoked_at,i.accepted_at,d.status AS delivery_status,d.error_code AS delivery_error FROM invitation i LEFT JOIN invitation_delivery d ON d.invitation_id=i.id WHERE i.workspace_id=$1 ORDER BY i.created_at DESC",
            [w],
          )
        ).rows
      : [];
    return {
      ...(await readArtifacts(tx, w)),
      ...(await readHandoffs(tx, w)),
      workspace,
      members,
      access,
      goals,
      adherences,
      messages,
      candidates,
      information,
      versions,
      commitments,
      approvals,
      interpretations,
      sources,
      research,
      researchEvents,
      questions,
      questionHistory,
      invitations,
      links: await readWorkspaceLinks(tx, w, actor),
    };
  });
}
export async function currentRevision(actor: string, w: string) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    return (await tx.query("SELECT revision FROM workspace WHERE id=$1", [w]))
      .rows[0].revision as number;
  });
}
