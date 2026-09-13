import type { Tx } from "./db.ts";
// Initial selection is small; explicit retrieval searches retained versions without a recency cutoff.
// These records are operational context, never grants of authority or automatic commitments.
export async function workContext(
  tx: Tx,
  w: string,
  terms: string[],
  initial = false,
) {
  if (!terms.length) return [];
  const rows = (
    await tx.query(
      `SELECT v.*,t.current_version,r.person_id,r.task_version AS accepted_version FROM task_version v JOIN workspace_task t ON (t.workspace_id,t.id)=(v.workspace_id,v.task_id) LEFT JOIN task_responsibility r ON (r.workspace_id,r.task_id,r.id)=(v.workspace_id,v.task_id,v.responsibility_id) WHERE v.workspace_id=$1 ${initial ? "AND v.version=t.current_version" : ""} AND EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE v.task_id::text=term OR to_tsvector('simple',v.title||' '||v.description) @@ plainto_tsquery('simple',term) OR v.title ILIKE '%'||term||'%' OR v.description ILIKE '%'||term||'%') ORDER BY v.created_at DESC ${initial ? "LIMIT 20" : ""}`,
      [w, terms],
    )
  ).rows;
  const records = [];
  for (const v of rows) {
    const references = (
      await tx.query(
        "SELECT kind,reference_id,reference_version FROM task_reference WHERE workspace_id=$1 AND task_id=$2 AND task_version=$3",
        [w, v.task_id, v.version],
      )
    ).rows;
    records.push({
      kind: "task",
      id: v.task_id,
      version: v.version,
      current: v.version === v.current_version,
      title: v.title,
      description: v.description,
      status: v.status,
      dueAt: v.due_at,
      timeZone: v.time_zone,
      responsible: v.person_id ?? null,
      acceptedVersion: v.accepted_version ?? null,
      actor: v.actor_id,
      reason: v.reason,
      candidateId: v.candidate_id,
      adoptedProposalId: v.adopted_proposal_id,
      references,
      qualification:
        "Operational record, not a Commitment, source ID or authority grant. Responsibility does not authorize external effects.",
    });
  }
  return records;
}
