import { createHash } from "node:crypto";
import {
  conversationReferenceSchema,
  referenceDetailSchema,
  type ConversationReference,
} from "../contracts/activity.ts";
import { transaction, type Tx } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { activityEvent } from "./activity.ts";

// Closed vocabulary of existing shared domain records; never private mailbox/calendar data.
const selects: Record<ConversationReference["kind"], string> = {
  goal: `SELECT v.content AS title,v.content,v.established_by AS actor,v.created_at,(v.version=g.current_version AND g.status='active') AS current,
 'Intento registrato, non consenso collettivo o autorizzazione ad agire.' AS qualification,ARRAY[v.source_id] AS source_ids,
 jsonb_build_object('currentVersion',g.current_version,'currentPrimary',g.current_primary,'status',g.status,'sourceId',v.source_id,
 'explicitAdherents',ARRAY(SELECT user_id FROM goal_adherence WHERE workspace_id=v.workspace_id AND goal_id=v.goal_id AND goal_version=v.version ORDER BY user_id)) AS provenance
 FROM goal_version v JOIN goal g ON (g.workspace_id,g.id)=(v.workspace_id,v.goal_id) WHERE v.workspace_id=$1 AND v.goal_id=$2 AND v.version=$3`,
  information: `SELECT a.subject AS title,v.content,v.accepted_by AS actor,v.created_at,v.version=a.current_version AS current,
 'Informazione accettata editorialmente, non verità garantita né consenso collettivo. '||v.qualification AS qualification,
 ARRAY(SELECT source_id FROM candidate_source WHERE workspace_id=v.workspace_id AND candidate_id=v.candidate_id) AS source_ids,
 jsonb_build_object('candidateId',v.candidate_id,'reason',v.reason,'currentVersion',a.current_version) AS provenance
 FROM information_version v JOIN accepted_information a ON (a.workspace_id,a.id)=(v.workspace_id,v.information_id) WHERE v.workspace_id=$1 AND v.information_id=$2 AND v.version=$3`,
  commitment: `SELECT p.kind AS title,p.content,p.proposed_by AS actor,p.created_at,EXISTS(SELECT 1 FROM current_project_act c WHERE c.workspace_id=p.workspace_id AND c.proposal_id=p.id) AS current,
 CASE WHEN a.id IS NULL THEN 'Proposta normativa non adottata.' ELSE 'Atto adottato storicamente entro il proprio perimetro; current indica se ancora efficace. Nessuna modifica tramite questa conversazione.' END AS qualification,
 ARRAY_REMOVE(ARRAY[p.source_id],NULL)||ARRAY(SELECT source_id FROM candidate_source WHERE workspace_id=p.workspace_id AND candidate_id=p.candidate_id) AS source_ids,
 jsonb_build_object('normativeKind',p.kind,'adoptedAt',a.adopted_at,'representedPeople',ARRAY(SELECT person_id FROM required_project_approval WHERE workspace_id=p.workspace_id AND proposal_id=p.id ORDER BY person_id),'actApprovals',(SELECT jsonb_agg(jsonb_build_object('personId',ap.person_id,'actorId',COALESCE(ap.actor_id,ap.person_id),'mandateId',ap.mandate_id,'mandateVersion',ap.mandate_version,'createdAt',ap.created_at) ORDER BY ap.created_at,ap.id) FROM act_approval chosen JOIN project_approval ap ON ap.id=chosen.approval_id WHERE chosen.workspace_id=p.workspace_id AND chosen.act_id=a.id),'goalId',p.goal_id,'goalVersion',p.goal_version) AS provenance
 FROM normative_proposal p LEFT JOIN project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 AND p.id=$2 AND $3=1`,
  task: `SELECT v.title,v.description AS content,v.actor_id AS actor,v.created_at,v.version=t.current_version AS current,
 'Versione operativa del Task; responsabilità esplicita, Commitment e authority sono distinti. Completamento senza effetti normativi automatici.' AS qualification,
 ARRAY(SELECT reference_id FROM task_reference WHERE workspace_id=v.workspace_id AND task_id=v.task_id AND task_version=v.version AND kind IN ('source','message')) AS source_ids,
 jsonb_build_object('status',v.status,'dueAt',v.due_at,'timeZone',v.time_zone,'reason',v.reason,'currentVersion',t.current_version,'responsible',r.person_id,'responsibilityAcceptedVersion',r.task_version,'responsibilityAcceptedAt',r.accepted_at,
 'references',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',reference_id,'version',reference_version) ORDER BY kind,reference_id,reference_version) FROM task_reference WHERE workspace_id=v.workspace_id AND task_id=v.task_id AND task_version=v.version)) AS provenance
 FROM task_version v JOIN workspace_task t ON (t.workspace_id,t.id)=(v.workspace_id,v.task_id) LEFT JOIN task_responsibility r ON (r.workspace_id,r.task_id,r.id)=(v.workspace_id,v.task_id,v.responsibility_id) WHERE v.workspace_id=$1 AND v.task_id=$2 AND v.version=$3`,
  artifact: `SELECT v.title,v.body AS content,v.authored_by AS actor,v.created_at,(v.version=a.current_draft_version OR v.version=review.artifact_version) IS TRUE AS current,
 'Versione di Artifact. Soltanto selectedCurrentlyAdopted indica adozione corrente di questa versione, non delle fonti né di azioni o impegni.' AS qualification,
 ARRAY(SELECT source_id FROM artifact_source WHERE workspace_id=v.workspace_id AND artifact_id=v.artifact_id AND artifact_version=v.version) AS source_ids,
 jsonb_build_object('origin',v.origin,'reason',v.reason,'currentDraftVersion',a.current_draft_version,'currentAdoptedVersion',review.artifact_version,'selectedCurrentlyAdopted',(v.version=review.artifact_version) IS TRUE,
 'informationReferences',(SELECT jsonb_agg(jsonb_build_object('id',information_id,'version',information_version) ORDER BY information_id,information_version) FROM artifact_information WHERE workspace_id=v.workspace_id AND artifact_id=v.artifact_id AND artifact_version=v.version)) AS provenance
 FROM artifact_version v JOIN artifact a ON (a.workspace_id,a.id)=(v.workspace_id,v.artifact_id)
 LEFT JOIN artifact_adoption adoption ON (adoption.workspace_id,adoption.id)=(a.workspace_id,a.current_adoption_id)
 LEFT JOIN artifact_review review ON (review.workspace_id,review.id)=(adoption.workspace_id,adoption.review_id)
 WHERE v.workspace_id=$1 AND v.artifact_id=$2 AND v.version=$3`,
  question: `SELECT 'Domanda' AS title,v.content,v.recorded_by AS actor,v.created_at,v.version=q.current_version AS current,
 'Domanda registrata; la risposta indicata non accetta automaticamente le premesse.' AS qualification,ARRAY[v.source_id] AS source_ids,
 jsonb_build_object('status',v.status,'reason',v.reason,'answerInformationId',v.answer_information_id,'answerInformationVersion',v.answer_information_version,'currentVersion',q.current_version) AS provenance
 FROM question_version v JOIN open_question q ON (q.workspace_id,q.id)=(v.workspace_id,v.question_id) WHERE v.workspace_id=$1 AND v.question_id=$2 AND v.version=$3`,
  workstream: `SELECT v.title,v.description AS content,v.actor_id AS actor,v.created_at,v.version=w.current_version AS current,
 'Filone editoriale dello stesso Workspace; non Goal, Context privato, adozione o authority. Lifecycle storico e corrente restano distinti.' AS qualification,ARRAY[v.source_id] AS source_ids,
 jsonb_build_object('origin',v.origin,'recordedLifecycle',v.lifecycle_state,'recordedAction',v.lifecycle_action,'currentVersion',w.current_version,'currentState',w.state) AS provenance
 FROM workstream_version v JOIN workstream w ON (w.workspace_id,w.id)=(v.workspace_id,v.workstream_id) WHERE v.workspace_id=$1 AND v.workstream_id=$2 AND v.version=$3`,
  active_work: `SELECT c.objective AS title,e.content||CASE WHEN result.body IS NULL THEN '' ELSE E'\n\nContribution storica non adottata:\n'||result.body END AS content,
 e.actor_id AS actor,e.created_at,e.revision=a.revision AS current,
 'Evento significativo di Active Work, versione = revisione evento. Work Contract separato; Completed non implica adozione o validità corrente.' AS qualification,
 ARRAY_REMOVE(ARRAY[e.source_id,c.source_id],NULL)||ARRAY(SELECT reference_id FROM active_work_input WHERE workspace_id=e.workspace_id AND work_id=e.work_id AND generation=result.generation AND kind='source') AS source_ids,
 jsonb_build_object('eventKind',e.kind,'contractVersion',e.contract_version,'scope',c.scope,'expectedOutput',c.expected_output,'anchors',c.anchors,'focus',c.focus,
 'currentRevision',a.revision,'currentContractVersion',a.contract_version,'currentPhase',a.phase,'currentValidity',a.validity,'contributionId',result.id,'contributionQualification',result.qualification,'adopted',false) AS provenance
 FROM active_work_event e JOIN active_work a ON (a.workspace_id,a.id)=(e.workspace_id,e.work_id)
 JOIN active_work_contract c ON (c.workspace_id,c.work_id,c.version)=(e.workspace_id,e.work_id,e.contract_version)
 LEFT JOIN LATERAL (SELECT * FROM active_work_contribution r WHERE r.workspace_id=e.workspace_id AND r.work_id=e.work_id AND r.contract_version=e.contract_version AND r.created_at<=e.created_at ORDER BY r.generation DESC LIMIT 1) result ON true
 WHERE e.workspace_id=$1 AND e.work_id=$2 AND e.revision=$3`,
  scheduled_event: `SELECT v.title,v.title||' · '||v.starts_at||' → '||v.ends_at AS content,v.actor_id AS actor,v.created_at,v.version=e.current_version AS current,
 'Stato temporale interno già condiviso. Nessuna osservazione privata o autorizzazione a modificare il provider esterno.' AS qualification,ARRAY[v.source_message_id] AS source_ids,
 jsonb_build_object('startsAt',v.starts_at,'endsAt',v.ends_at,'timeZone',v.time_zone,'reason',v.reason,'personId',e.person_id,'currentVersion',e.current_version) AS provenance
 FROM scheduled_event_version v JOIN scheduled_event e ON (e.workspace_id,e.id)=(v.workspace_id,v.event_id) WHERE v.workspace_id=$1 AND v.event_id=$2 AND v.version=$3`,
  source: `SELECT COALESCE(s.title,'Messaggio condiviso') AS title,s.content,s.author_id AS actor,s.created_at,
 NOT EXISTS(SELECT 1 FROM external_source newer WHERE newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version) AS current,
 s.qualification,ARRAY[s.id] AS source_ids,jsonb_build_object('sourceKind',s.kind,'documentId',s.document_id,'documentVersion',s.document_version,'url',s.url,'authorName',s.author_name) AS provenance
 FROM workspace_source s WHERE s.workspace_id=$1 AND s.id=$2 AND $3=1`,
};
export async function resolveReference(
  tx: Tx,
  w: string,
  reference: ConversationReference,
) {
  const ref = conversationReferenceSchema.parse(reference);
  const row = (await tx.query(selects[ref.kind], [w, ref.id, ref.version]))
    .rows[0];
  requireThat(row, "REFERENCE_NOT_FOUND", 404);
  // Request provenance supplements the capability's explicit act/source; it never replaces it.
  const origins = (
    await tx.query(
      `SELECT h.id AS "handoffId",h.source_id AS "sourceId",h.source_message_id AS "sourceMessageId",h.source_ids AS "sourceIds",a.actor_id AS actor,a.command_id AS "commandId",a.command_type AS "commandType",a.created_at AS "preparedAt" FROM conversation_handoff h JOIN conversation_handoff_application a ON (a.workspace_id,a.handoff_id)=(h.workspace_id,h.id) WHERE h.workspace_id=$1 AND ((a.result_kind=$2 AND a.result_id=$3 AND a.result_version=$4) OR ($2='goal' AND a.prepared_kind='goal_transition' AND EXISTS(SELECT 1 FROM goal_transition_adoption g WHERE g.workspace_id=a.workspace_id AND g.transition_id=a.prepared_id AND g.goal_id=$3 AND g.goal_version=$4)) OR ($2='task' AND a.prepared_kind='task_revision_proposal' AND EXISTS(SELECT 1 FROM task_version t WHERE t.workspace_id=a.workspace_id AND t.adopted_proposal_id=a.prepared_id AND t.task_id=$3 AND t.version=$4))) ORDER BY a.created_at,a.handoff_id`,
      [w, ref.kind, ref.id, ref.version],
    )
  ).rows;
  const sourceIds = (
    await tx.query(
      "SELECT id FROM workspace_source WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",
      [
        w,
        [
          ...(row.source_ids ?? []),
          ...origins.flatMap((o) => o.sourceIds),
        ].filter(Boolean),
      ],
    )
  ).rows.map((r) => r.id);
  const event = ref.eventId ? await activityEvent(tx, w, ref.eventId) : null;
  if (ref.eventId)
    requireThat(
      event &&
        event.reference.kind === ref.kind &&
        event.reference.id === ref.id &&
        event.reference.version === ref.version,
      "REFERENCE_EVENT_MISMATCH",
      409,
    );
  return referenceDetailSchema.parse({
    reference: ref,
    title: row.title,
    content: row.content,
    qualification: row.qualification,
    actor: row.actor,
    createdAt: row.created_at.toISOString(),
    current: row.current,
    sourceIds,
    provenance: { ...row.provenance, conversationOrigins: origins },
    event,
  });
}
export async function referenceDetail(
  actor: string,
  w: string,
  reference: ConversationReference,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    return resolveReference(tx, w, reference);
  });
}
export async function recordMessageReference(
  tx: Tx,
  w: string,
  message: string,
  reference: ConversationReference,
) {
  const resolved = await resolveReference(tx, w, reference);
  await tx.query(
    "INSERT INTO message_context_reference(workspace_id,message_id,kind,reference_id,reference_version,activity_event_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      w,
      message,
      reference.kind,
      reference.id,
      reference.version,
      reference.eventId ?? null,
    ],
  );
  return resolved;
}
export async function messageReferenceContext(
  tx: Tx,
  w: string,
  source: string,
) {
  const row = (
    await tx.query(
      `SELECT r.kind,r.reference_id AS id,r.reference_version AS version,r.activity_event_id AS "eventId" FROM message_context_reference r
 WHERE r.workspace_id=$1 AND (r.message_id=$2 OR EXISTS(SELECT 1 FROM voice_message v WHERE v.workspace_id=r.workspace_id AND v.message_id=r.message_id AND v.source_id=$2))`,
      [w, source],
    )
  ).rows[0];
  if (!row) return null;
  return resolveReference(tx, w, {
    kind: row.kind,
    id: row.id,
    version: row.version,
    ...(row.eventId ? { eventId: row.eventId } : {}),
  });
}
export function referenceFingerprint(
  detail: Awaited<ReturnType<typeof messageReferenceContext>>,
) {
  return createHash("sha256").update(JSON.stringify(detail)).digest("hex");
}
export const messageReferenceJoin = `LEFT JOIN message_context_reference mr ON mr.workspace_id=m.workspace_id AND mr.message_id=COALESCE(
 (SELECT v.message_id FROM voice_message v WHERE v.workspace_id=m.workspace_id AND v.source_id=m.reply_to_source_id),m.reply_to_source_id,m.id)`;
export const messageReferenceProjection = `CASE WHEN mr.message_id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('kind',mr.kind,'id',mr.reference_id,'version',mr.reference_version,'eventId',mr.activity_event_id)) END`;
