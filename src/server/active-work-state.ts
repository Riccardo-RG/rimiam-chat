import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";
import { changed } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import type { WorkInput } from "../contracts/active-work.ts";
export async function workAt(tx: Tx, w: string, id: string) {
  const row = (
    await tx.query(
      `SELECT a.*,c.objective,c.scope,c.expected_output,c.anchors,c.focus,c.direction_actors FROM active_work a JOIN active_work_contract c ON c.workspace_id=a.workspace_id AND c.work_id=a.id AND c.version=a.contract_version WHERE a.workspace_id=$1 AND a.id=$2`,
      [w, id],
    )
  ).rows[0];
  requireThat(row, "ACTIVE_WORK_NOT_FOUND", 404);
  return row;
}
export async function workEvent(
  tx: Tx,
  w: string,
  id: string,
  kind: string,
  content: string,
  actor: string | null = null,
  source: string | null = null,
) {
  const a = (
    await tx.query(
      "UPDATE active_work SET revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING revision,contract_version",
      [w, id],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO active_work_event(id,workspace_id,work_id,revision,contract_version,kind,content,actor_id,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      w,
      id,
      a.revision,
      a.contract_version,
      kind,
      content,
      actor,
      source,
    ],
  );
  await changed(tx, w, `work.${kind}`);
  return a.revision as number;
}
export async function queueWork(tx: Tx, w: string, id: string) {
  await tx.query(
    "SELECT graphile_worker.add_job('active_work',json_build_object('workspaceId',$1::text,'id',$2::text),max_attempts:=3,job_key:=$3)",
    [w, id, `active-work:${id}`],
  );
}
export async function fenceWork(tx: Tx, w: string, id: string, phase: string) {
  await tx.query(
    "UPDATE active_work SET generation=generation+1,lease_until=NULL,phase=$3 WHERE workspace_id=$1 AND id=$2",
    [w, id, phase],
  );
}
export async function openIssues(tx: Tx, w: string, id: string) {
  return (
    await tx.query(
      `SELECT i.*,ARRAY(SELECT DISTINCT a.actor_id FROM active_work_issue_act a JOIN membership m ON m.workspace_id=a.workspace_id AND m.user_id=a.actor_id JOIN "user" u ON u.id=m.user_id WHERE a.workspace_id=i.workspace_id AND a.issue_id=i.id AND a.action='acknowledge' AND m.active AND m.contributes AND m.version=a.membership_version AND u.eligible AND u."emailVerified") AS acknowledged_by FROM active_work_issue i WHERE i.workspace_id=$1 AND i.work_id=$2 AND NOT EXISTS(SELECT 1 FROM active_work_issue_act a WHERE a.workspace_id=i.workspace_id AND a.issue_id=i.id AND a.action IN ('resolved','withdraw')) ORDER BY i.created_at,i.id`,
      [w, id],
    )
  ).rows;
}
export async function issue(
  tx: Tx,
  w: string,
  id: string,
  kind: string,
  content: string,
  actor: string | null = null,
  source: string | null = null,
  proposed: string | null = null,
  required: string[] = [],
) {
  const a = await workAt(tx, w, id),
    issueId = randomUUID();
  await tx.query(
    "INSERT INTO active_work_issue(id,workspace_id,work_id,contract_version,kind,content,actor_id,source_id,proposed_objective,required_people) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      issueId,
      w,
      id,
      a.contract_version,
      kind,
      content,
      actor,
      source,
      proposed,
      required,
    ],
  );
  await fenceWork(tx, w, id, "needs_input");
  await workEvent(tx, w, id, "needs_input", content, actor, source);
  return issueId;
}
export async function issueAct(
  tx: Tx,
  w: string,
  id: string,
  issueId: string,
  actor: string | null,
  action: string,
  source: string | null = null,
) {
  const membership = actor
    ? (
        await tx.query(
          "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
          [w, actor],
        )
      ).rows[0]?.version
    : null;
  await tx.query(
    "INSERT INTO active_work_issue_act(id,workspace_id,work_id,issue_id,actor_id,membership_version,action,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [randomUUID(), w, id, issueId, actor, membership, action, source],
  );
}
export async function priorInputs(
  tx: Tx,
  w: string,
  id: string,
  generation: number,
): Promise<WorkInput[]> {
  return (
    await tx.query(
      "SELECT input_key AS key,kind,reference_id AS id,reference_version AS version,content,qualification,provenance FROM active_work_input WHERE workspace_id=$1 AND work_id=$2 AND generation=$3 ORDER BY input_key",
      [w, id, generation],
    )
  ).rows;
}
export async function persistInputs(
  tx: Tx,
  w: string,
  id: string,
  generation: number,
  inputs: WorkInput[],
) {
  for (const i of inputs)
    await tx.query(
      "INSERT INTO active_work_input(workspace_id,work_id,generation,input_key,kind,reference_id,reference_version,content,qualification,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",
      [
        w,
        id,
        generation,
        i.key,
        i.kind,
        i.id,
        i.version,
        i.content,
        i.qualification,
        JSON.stringify(i.provenance),
      ],
    );
}
