import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { member } from "./workspace-state.ts";
import { activityEventSchema, activitySchema } from "../contracts/activity.ts";
import { DomainError } from "./errors.ts";

// Read projection of real domain records. Change notifications/queues are never the ledger.
const events = `
 SELECT 'goal:'||v.goal_id||':'||v.version AS event_id,v.created_at AS occurred_at,v.established_by AS actor,
 'goal.version' AS kind,'Intento registrato' AS title,v.content AS summary,
 'Versione del Goal registrata; nessuna adesione o authority implicita.' AS qualification,
 'goal' AS ref_kind,v.goal_id AS ref_id,v.version AS ref_version FROM goal_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'information:'||v.information_id||':'||v.version,v.created_at,v.accepted_by,'information.accepted','Informazione accettata',v.content,
 'Accettazione editoriale attribuita, non verità garantita né consenso collettivo. '||v.qualification,'information',v.information_id,v.version FROM information_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'commitment:'||p.id||':1:proposed',p.created_at,p.proposed_by,'commitment.proposed','Proposta da valutare',p.content,
 'Proposta normativa; questo evento non registra un atto efficace.','commitment',p.id,1 FROM normative_proposal p WHERE p.workspace_id=$1
 UNION ALL SELECT 'commitment:'||p.id||':1:adopted',a.adopted_at,NULL::text,'commitment.adopted','Atto adottato',p.content,
 'Adozione registrata a questa data, entro il proprio perimetro e le approvazioni conservate; la validità corrente va verificata.','commitment',p.id,1 FROM project_act a JOIN normative_proposal p ON (p.workspace_id,p.id)=(a.workspace_id,a.proposal_id) WHERE a.workspace_id=$1
 UNION ALL SELECT 'task:'||v.task_id||':'||v.version,v.created_at,v.actor_id,'task.version',v.title,v.reason,
 'Versione operativa del Task; responsabilità e obblighi restano distinti. Completamento senza effetti normativi automatici.','task',v.task_id,v.version FROM task_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'artifact:'||v.artifact_id||':'||v.version,v.created_at,v.authored_by,'artifact.version',v.title,v.reason,
 'Versione di Artifact preparata; questo evento non ne costituisce adozione.','artifact',v.artifact_id,v.version FROM artifact_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'artifact:'||r.artifact_id||':'||r.artifact_version||':adopted:'||a.id,a.created_at,NULL::text,'artifact.adopted','Artifact adottato',v.title,
 'Adozione di questa versione registrata; non accetta fonti né crea impegni o azioni esterne.','artifact',r.artifact_id,r.artifact_version FROM artifact_adoption a JOIN artifact_review r ON (r.workspace_id,r.id)=(a.workspace_id,a.review_id) JOIN artifact_version v ON (v.workspace_id,v.artifact_id,v.version)=(r.workspace_id,r.artifact_id,r.artifact_version) WHERE a.workspace_id=$1
 UNION ALL SELECT 'question:'||v.question_id||':'||v.version,v.created_at,v.recorded_by,'question.version','Domanda '||CASE WHEN v.status='open' THEN 'aperta' ELSE 'con risposta registrata' END,v.content,
 'Domanda e risposta registrate con le proprie fonti; le premesse non diventano automaticamente vere.','question',v.question_id,v.version FROM question_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'workstream:'||v.workstream_id||':'||v.version,v.created_at,v.actor_id,'workstream.version',v.title,
 CASE WHEN v.lifecycle_action IS NULL THEN v.description ELSE 'Lifecycle: '||v.lifecycle_action END,
 'Organizzazione dello stesso Workspace, senza nuova privacy, authority o adozione.','workstream',v.workstream_id,v.version FROM workstream_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'active_work:'||e.work_id||':'||e.revision,e.created_at,e.actor_id,'work.'||e.kind,c.objective,e.content,
 'Evento operativo di Active Work; Contribution e completamento non sono adozione né validità corrente.','active_work',e.work_id,e.revision FROM active_work_event e JOIN active_work_contract c ON (c.workspace_id,c.work_id,c.version)=(e.workspace_id,e.work_id,e.contract_version) WHERE e.workspace_id=$1
 UNION ALL SELECT 'scheduled_event:'||v.event_id||':'||v.version,v.created_at,v.actor_id,'calendar.version',v.title,v.reason,
 'Stato temporale interno condiviso; non prova un effetto sul calendario esterno.','scheduled_event',v.event_id,v.version FROM scheduled_event_version v WHERE v.workspace_id=$1
 UNION ALL SELECT 'source:'||s.id||':1',COALESCE(e.created_at,s.created_at),s.author_id,'source.shared',COALESCE(s.title,'Fonte condivisa'),left(s.content,240),
 s.qualification,'source',s.id,1 FROM workspace_source s LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published' WHERE s.workspace_id=$1 AND s.kind<>'message'
`;
const projection = `SELECT e.*,COALESCE(u.name,CASE WHEN e.actor IS NULL AND e.kind ~ '^(work[.]|workstream[.])' THEN 'Miriam' ELSE 'Atto registrato' END) AS actor_name,
 to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM (${events}) e LEFT JOIN "user" u ON u.id=e.actor`;
interface EventRow {
  event_id: string;
  occurred_at: Date;
  actor: string | null;
  actor_name: string;
  kind: string;
  title: string;
  summary: string;
  qualification: string;
  ref_kind: string;
  ref_id: string;
  ref_version: number;
  cursor_time: string;
}
function event(row: EventRow) {
  return activityEventSchema.parse({
    eventId: row.event_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actor: row.actor,
    actorName: row.actor_name,
    kind: row.kind,
    title: row.title,
    summary: row.summary.slice(0, 360),
    qualification: row.qualification,
    reference: {
      kind: row.ref_kind,
      id: row.ref_id,
      version: row.ref_version,
      eventId: row.event_id,
    },
  });
}
export async function activityEvent(tx: Tx, w: string, id: string) {
  const row = (
    await tx.query<EventRow>(`${projection} WHERE e.event_id=$2`, [w, id])
  ).rows[0];
  return row ? event(row) : null;
}
const cursorSchema = z
  .object({ at: z.iso.datetime(), key: z.string().min(1).max(220) })
  .strict();
export async function activity(
  actor: string,
  w: string,
  before?: string,
  limit = 50,
) {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (before) {
    try {
      z.string().max(1024).parse(before);
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(before, "base64url").toString("utf8")),
      );
    } catch {
      throw new DomainError("INVALID_CURSOR", 400);
    }
  }
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const rows = (
      await tx.query<EventRow>(
        `${projection} WHERE ($2::timestamptz IS NULL OR (e.occurred_at,e.event_id)<($2,$3)) ORDER BY e.occurred_at DESC,e.event_id DESC LIMIT $4`,
        [w, cursor?.at ?? null, cursor?.key ?? null, limit + 1],
      )
    ).rows;
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return activitySchema.parse({
      events: page.map(event),
      next:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ at: last.cursor_time, key: last.event_id }),
            ).toString("base64url")
          : null,
    });
  });
}
