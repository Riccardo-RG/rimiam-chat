import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";
export async function recordTaskOffer(
  tx: Tx,
  w: string,
  id: string,
  version: number,
  actor: string,
  title: string,
) {
  const messageId = randomUUID();
  await tx.query(
    `WITH seq AS(UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message)
 INSERT INTO message(id,workspace_id,sequence,author_id,content,purpose) SELECT $2,$1,next_message,$3,$4,'task_offer' FROM seq`,
    [w, messageId, actor, title],
  );
  await tx.query(
    "INSERT INTO task_offer_message(workspace_id,task_id,version,message_id) VALUES($1,$2,$3,$4)",
    [w, id, version, messageId],
  );
}
export const taskOfferProjection = `CASE WHEN m.purpose='task_offer' THEN (
 SELECT jsonb_build_object('taskId',o.task_id,'version',o.version,'title',v.title,'description',v.description,
  'due',v.due_at,'person',v.suggested_person,'personName',p.name,'acceptedBy',a.name,
  'status',CASE WHEN a.id IS NOT NULL THEN 'accepted' WHEN d.person_id IS NOT NULL THEN 'declined' WHEN t.current_version<>o.version OR v.status IN ('completed','cancelled') THEN 'outdated' ELSE 'pending' END)
 FROM task_offer_message o JOIN task_version v ON (v.workspace_id,v.task_id,v.version)=(o.workspace_id,o.task_id,o.version)
 JOIN workspace_task t ON t.workspace_id=o.workspace_id AND t.id=o.task_id
 JOIN "user" p ON p.id=v.suggested_person
 LEFT JOIN task_offer_decline d ON (d.workspace_id,d.task_id,d.version,d.person_id)=(o.workspace_id,o.task_id,o.version,v.suggested_person)
 LEFT JOIN task_responsibility r ON (r.workspace_id,r.task_id,r.task_version)=(o.workspace_id,o.task_id,o.version)
 LEFT JOIN "user" a ON a.id=r.person_id
 WHERE o.workspace_id=m.workspace_id AND o.message_id=m.id
 ORDER BY r.accepted_at NULLS LAST LIMIT 1) END`;
