import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { conversationMilestonesSchema } from "../contracts/conversation-milestones.ts";

// Read operational and governed events at their actual time. Their presence never
// appends a message, marks a read receipt or changes the Home activity order.
export async function conversationMilestones(
  actor: string,
  w: string,
  first: string,
  last: string,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const result = await tx.query(
      `WITH bounds AS (
      SELECT a.sequence AS first_seq,b.sequence AS last_seq,a.created_at AS lo,
        COALESCE((SELECT m.created_at FROM message m WHERE m.workspace_id=a.workspace_id AND m.sequence>b.sequence ORDER BY m.sequence LIMIT 1),'infinity') AS hi
      FROM message a JOIN message b ON b.workspace_id=a.workspace_id AND b.sequence>=a.sequence
      WHERE a.workspace_id=$1 AND a.id=$2 AND b.id=$3
    ), events AS (
      SELECT 'decision' AS kind,p.id::text AS object_id,a.adopted_at AS at,p.content AS label,NULL::text AS brief,NULL::integer AS completion_revision
      FROM project_act a JOIN normative_proposal p ON (p.workspace_id,p.id)=(a.workspace_id,a.proposal_id)
      CROSS JOIN bounds t WHERE a.workspace_id=$1 AND p.kind='decision' AND a.adopted_at>=t.lo AND a.adopted_at<t.hi
      UNION ALL
      SELECT 'completed',e.work_id::text,e.created_at,c.objective,result.body,e.revision
      FROM active_work_event e JOIN active_work_contract c ON (c.workspace_id,c.work_id,c.version)=(e.workspace_id,e.work_id,e.contract_version)
      LEFT JOIN LATERAL (SELECT r.body FROM active_work_contribution r
        WHERE (r.workspace_id,r.work_id,r.contract_version)=(e.workspace_id,e.work_id,e.contract_version) AND r.created_at<=e.created_at
        ORDER BY r.generation DESC LIMIT 1) result ON true
      CROSS JOIN bounds t WHERE e.workspace_id=$1 AND e.kind='completed' AND e.created_at>=t.lo AND e.created_at<t.hi

    ) SELECT e.kind,e.object_id,e.at,e.label,e.brief,e.completion_revision,anchor.id AS anchor FROM events e CROSS JOIN bounds t JOIN LATERAL (
      SELECT m.id FROM message m WHERE m.workspace_id=$1 AND m.sequence BETWEEN t.first_seq AND t.last_seq AND m.created_at<=e.at
      ORDER BY m.sequence DESC LIMIT 1
    ) anchor ON true ORDER BY e.at,e.kind,e.object_id`,
      [w, first, last],
    );
    return conversationMilestonesSchema.parse({
      items: result.rows.map((r) => ({
        kind: r.kind,
        id: r.kind + ":" + r.object_id + ":" + r.at.toISOString(),
        objectId: r.object_id,
        at: r.at.toISOString(),
        anchor: r.anchor,
        label: r.label,
        completionRevision: r.completion_revision ?? undefined,
        conclusion: conclusionExcerpt(r.brief),
      })),
    });
  });
}
function conclusionExcerpt(body: string | null): string | undefined {
  const text = body
    ?.match(/^(?:Conclusion|Conclusione):[ \t]*(.+)$/im)?.[1]
    ?.trim();
  if (!text) return;
  return text.length > 160 ? text.slice(0, 159).trimEnd() + "…" : text;
}
