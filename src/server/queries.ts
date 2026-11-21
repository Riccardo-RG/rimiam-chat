import { readyPersonalResearch } from "./personal-research.ts";
import { activeCalendarConnections } from "./calendar-queries.ts";
import { reminderProjection } from "./conversation-reminder.ts";
import { taskOfferProjection } from "./task-offer-message.ts";
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
import {
  authenticatedSession,
  noDepartureSinceInvitation,
} from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  personalReading,
  quoteProjection,
  workspaceDirectory,
} from "./conversation-reading.ts";

export async function listWorkspaces(actor: string) {
  return transaction(async (tx) => {
    await eligible(tx, actor);
    return workspaceDirectory(tx, actor);
  });
}
export async function personalHome(actor: string, sessionId: string) {
  return transaction(async (tx) => {
    await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, sessionId);
    const personal = (
      await tx.query<{ id: string }>(
        "SELECT w.id FROM workspace w JOIN membership m ON m.workspace_id=w.id AND m.user_id=$1 AND m.active WHERE w.personal_owner_id=$1 AND w.personal_archive_id IS NULL",
        [actor],
      )
    ).rows[0];
    if (!personal) return { id: null, reminders: [] };
    const reminders = (
      await tx.query<{ id: string; content: string; due: Date }>(
        `SELECT f.id,v.content,f.next_remind_at AS due FROM workspace_followup f
       JOIN followup_version v ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
       WHERE f.workspace_id=$1 AND f.owner_id=$2 AND v.status='active' AND f.next_remind_at IS NOT NULL
       ORDER BY f.next_remind_at,f.id LIMIT 3`,
        [personal.id, actor],
      )
    ).rows;
    const readyResearch = await readyPersonalResearch(tx, actor);
    return {
      ...(readyResearch ? { readyResearch } : {}),
      id: personal.id,
      reminders: reminders.map((r) => ({
        id: r.id,
        content: r.content,
        nextRemindAt: r.due.toISOString(),
      })),
    };
  });
}
export async function invitationDetails(actor: string, token: string) {
  return transaction(async (tx) => {
    const user = await eligible(tx, actor);
    const r = await tx.query(
      `SELECT i.id,i.recipient_email,i.expires_at,i.revoked_at,i.accepted_at,w.name FROM invitation i JOIN workspace w ON w.id=i.workspace_id WHERE i.token_hash=$1 AND (i.recipient_contact_id IS NULL OR i.recipient_contact_id=$2) AND ${noDepartureSinceInvitation}`,
      [tokenHash(token), actor],
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
export async function incomingInvitations(actor: string, sessionId: string) {
  return transaction(async (tx) => {
    const user = await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, sessionId);
    const { rows } = await tx.query<{
      id: string;
      workspace_name: string;
      inviter_name: string;
      expires_at: Date;
    }>(
      `SELECT i.id, w.name AS workspace_name, u.name AS inviter_name, i.expires_at
       FROM invitation i
       JOIN workspace w ON w.id = i.workspace_id
       JOIN access_relationship r ON r.workspace_id = i.workspace_id AND r.id = i.relationship_id
         AND r.holder_id = i.issuer_id AND r.active AND r.invitations
       JOIN membership issuer ON issuer.workspace_id = i.workspace_id AND issuer.user_id = i.issuer_id AND issuer.active
       JOIN "user" u ON u.id = i.issuer_id AND u.eligible AND u."emailVerified"
       WHERE i.recipient_email = $1 AND i.revoked_at IS NULL AND i.accepted_at IS NULL
         AND (i.recipient_contact_id IS NULL OR i.recipient_contact_id=$2)
         AND i.expires_at > clock_timestamp() AND ${noDepartureSinceInvitation}
         AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.workspace_id = i.workspace_id AND m.user_id = $2 AND m.active)
       ORDER BY i.created_at DESC, i.id`,
      [user.email.toLowerCase(), actor],
    );
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        workspaceName: row.workspace_name,
        inviterName: row.inviter_name,
        expiresAt: row.expires_at.toISOString(),
      })),
    };
  });
}
export async function snapshot(actor: string, w: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const workspace = (
      await tx.query(
        `SELECT w.id,w.name,w.revision,w.context_revision,w.access_revision,w.personal_archive_id,(w.personal_owner_id IS NOT NULL) AS personal,
          COALESCE((SELECT version FROM workspace_photo WHERE workspace_id=w.id),0) AS photo_revision,
          COALESCE(CASE WHEN w.personal_owner_id IS NULL
            THEN (SELECT max(revision) FROM assistant_setting_version WHERE workspace_id=w.id)
            ELSE (SELECT max(revision) FROM assistant_setting_version WHERE personal_actor=w.personal_owner_id)
          END,0) AS assistant_settings_revision,
          EXISTS (SELECT 1 FROM (${activeCalendarConnections}) c WHERE c.workspace_id=w.id AND c.person_id=$2) AS has_linked_calendar
          FROM workspace w WHERE w.id=$1`,
        [w, actor],
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
        `SELECT m.*,COALESCE(u.name,m.assistant_display_name,'Emme') AS author_name,${reminderProjection("$2")} AS reminder,${taskOfferProjection} AS "taskOffer",${quoteProjection} AS "quoteMessageId",
         coalesce((SELECT jsonb_agg(jsonb_build_object('kind',c.target_kind,'id',c.target_id,'version',c.target_version,'label',c.label) ORDER BY c.position) FROM consultation_public_citation c WHERE (c.workspace_id,c.message_id)=(m.workspace_id,m.id)),'[]'::jsonb) AS "consultationReferences",
         COALESCE(r.source_ids,CASE WHEN cwa.reply_message_id IS NOT NULL THEN ARRAY[cwa.source_message_id] END,'{}'::uuid[]) AS citation_source_ids,${messageFocusProjection} AS workstream_focus,${messageReferenceProjection} AS reference,${productAssistanceProjection} AS "assistanceContext",${conversationOperationProjection} AS "operationResult"
         FROM message m LEFT JOIN "user" u ON u.id=m.author_id
         LEFT JOIN miriam_response r ON (r.workspace_id,r.message_id)=(m.workspace_id,m.id) ${messageFocusJoin} ${messageReferenceJoin} ${productAssistanceJoin}
         WHERE m.workspace_id=$1 ORDER BY sequence`,
        [w, actor],
      )
    ).rows;
    const candidates = (
      await tx.query(
        "SELECT c.*,coalesce(m.author_name,'Documento ritirato') AS author_name,coalesce(m.content,'') AS source_content,ARRAY(SELECT source_id FROM candidate_source s WHERE s.workspace_id=c.workspace_id AND s.candidate_id=c.id) AS source_ids FROM candidate c LEFT JOIN workspace_source m ON (m.workspace_id,m.id)=(c.workspace_id,c.source_id) WHERE c.workspace_id=$1 ORDER BY c.created_at DESC",
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
        `SELECT i.id,i.source_id,i.status,i.error_code,i.failed_explicit_request AS "explicitRequest",
          CASE WHEN i.status='failed' THEN
            (SELECT coalesce(s.display_name,'Emme') FROM assistant_turn_binding b
             LEFT JOIN assistant_setting_version s ON s.id=b.settings_id
             WHERE (b.interpretation_id,b.routing_epoch)=(i.id,i.routing_epoch)) END AS "requestDisplayName",
          CASE WHEN i.status='failed' THEN
            (SELECT coalesce(x.context->>'addressee'='other_member',false) FROM interpretation_input x
             WHERE (x.workspace_id,x.interpretation_id,x.generation,x.round)=(i.workspace_id,i.id,i.generation,1)) END AS "otherMemberTarget",
          CASE WHEN i.status='failed' THEN EXISTS(
            SELECT 1 FROM miriam_response r WHERE (r.workspace_id,r.interpretation_id)=(i.workspace_id,i.id)
          ) END AS "hasPublishedReply",
          CASE WHEN i.status='failed' THEN
            (SELECT v.message_id FROM voice_message v WHERE (v.workspace_id,v.source_id)=(i.workspace_id,i.source_id) AND v.mode='miriam')
          END AS "requestMessageId"
         FROM interpretation i WHERE i.workspace_id=$1`,
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
    const sources = await sourceRecords(tx, w, actor);
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
            `SELECT i.id,CASE WHEN i.recipient_contact_id IS NULL THEN i.recipient_email ELSE '' END AS recipient_email,
             u.name AS recipient_name,i.expires_at,i.revoked_at,i.accepted_at,d.status AS delivery_status,d.error_code AS delivery_error
             FROM invitation i LEFT JOIN "user" u ON u.id=i.recipient_contact_id
             LEFT JOIN invitation_delivery d ON d.invitation_id=i.id WHERE i.workspace_id=$1 ORDER BY i.created_at DESC`,
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
      reading: await personalReading(tx, w, actor),
      joins: (
        await tx.query(
          `SELECT h.id,h.created_at,u.name FROM membership_history h JOIN "user" u ON u.id=h.user_id
        WHERE h.workspace_id=$1 AND h.active AND h.basis LIKE 'invitation:%' ORDER BY h.created_at,h.id`,
          [w],
        )
      ).rows,
      candidates,
      information,
      versions,
      commitments,
      approvals,
      interpretations,
      sources,
      ...(workspace.personal
        ? {
            libraryDestinations: (
              await tx.query<{ id: string; name: string }>(
                "SELECT w.id,w.name FROM membership m JOIN workspace w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.active AND m.contributes AND w.personal_owner_id IS NULL ORDER BY w.name,w.id",
                [actor],
              )
            ).rows,
          }
        : {}),
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
