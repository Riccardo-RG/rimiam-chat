import type { Tx } from "./db.ts";

// Small current summaries are a starting selection. Terms can retrieve older retained versions;
// each row keeps its identity, exact version and current/historical/adopted qualification.
export async function goalContext(
  tx: Tx,
  w: string,
  terms: string[] | null = null,
) {
  return (
    await tx.query(
      `SELECT v.*,g.status,g.current_primary,g.parent_goal_id,g.parent_goal_version,
 (v.version=g.current_version) AS current_version,
 ARRAY(SELECT p.person_id FROM goal_intent_participant p WHERE p.workspace_id=v.workspace_id AND p.goal_id=v.goal_id AND p.goal_version=v.version) AS represented_intents,
 ARRAY(SELECT a.user_id FROM goal_adherence a WHERE a.workspace_id=v.workspace_id AND a.goal_id=v.goal_id AND a.goal_version=v.version) AS explicit_adherents
 FROM goal g JOIN goal_version v ON (v.workspace_id,v.goal_id)=(g.workspace_id,g.id)
 WHERE g.workspace_id=$1 AND (($2::text[] IS NULL AND v.version=g.current_version AND g.status='active') OR
 ($2::text[] IS NOT NULL AND EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE v.content ILIKE '%'||term||'%')))
 ORDER BY g.current_primary DESC,g.id,v.version`,
      [w, terms],
    )
  ).rows;
}
export async function activeWorkContext(
  tx: Tx,
  w: string,
  terms: string[] | null = null,
) {
  return (
    await tx.query(
      `SELECT a.id,a.revision,a.contract_version,a.phase,a.validity,c.version AS selected_contract_version,c.objective,c.scope,c.anchors,c.focus,
 (c.version=a.contract_version) AS current_contract,
 (SELECT jsonb_agg(jsonb_build_object('kind',i.kind,'content',i.content,'actor_id',i.actor_id,'source_id',i.source_id)) FROM active_work_issue i WHERE i.workspace_id=a.workspace_id AND i.work_id=a.id
 AND NOT EXISTS(SELECT 1 FROM active_work_issue_act x WHERE x.workspace_id=i.workspace_id AND x.issue_id=i.id AND x.action IN ('withdraw','resolved'))) AS restrictions,
 (SELECT jsonb_build_object('id',r.id,'contract_version',r.contract_version,'body',r.body,'qualification',r.qualification,'citation_keys',r.citation_keys,'adopted',false,
 'inputs',(SELECT jsonb_agg(jsonb_build_object('key',s.input_key,'kind',s.kind,'id',s.reference_id,'version',s.reference_version,'qualification',s.qualification,'provenance',s.provenance)) FROM active_work_input s WHERE (s.workspace_id,s.work_id,s.generation)=(r.workspace_id,r.work_id,r.generation))) FROM active_work_contribution r WHERE r.workspace_id=a.workspace_id AND r.work_id=a.id AND r.contract_version=c.version ORDER BY r.created_at DESC LIMIT 1) AS contribution
 FROM active_work a JOIN active_work_contract c ON (c.workspace_id,c.work_id)=(a.workspace_id,a.id)
 WHERE a.workspace_id=$1 AND (($2::text[] IS NULL AND c.version=a.contract_version) OR
 ($2::text[] IS NOT NULL AND EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE c.objective ILIKE '%'||term||'%' OR c.scope ILIKE '%'||term||'%' OR EXISTS(SELECT 1 FROM active_work_contribution r WHERE r.workspace_id=a.workspace_id AND r.work_id=a.id AND r.contract_version=c.version AND r.body ILIKE '%'||term||'%'))))
 ORDER BY a.created_at DESC,c.version DESC LIMIT CASE WHEN $2::text[] IS NULL THEN 20 ELSE NULL END`,
      [w, terms],
    )
  ).rows;
}
export async function artifactContext(
  tx: Tx,
  w: string,
  terms: string[] | null = null,
) {
  return (
    await tx.query(
      `SELECT a.id,v.version,v.title,v.body,v.origin,v.reason,v.authored_by,v.created_at,d.purpose,d.contribution_id,
 a.current_draft_version,ar.artifact_version AS current_adopted_version,(ar.artifact_version=v.version) IS TRUE AS is_current_adopted_version,
 ARRAY(SELECT s.source_id FROM artifact_source s WHERE s.workspace_id=v.workspace_id AND s.artifact_id=v.artifact_id AND s.artifact_version=v.version) AS source_ids,
 (SELECT jsonb_agg(jsonb_build_object('id',i.information_id,'version',i.information_version,'qualification',iv.qualification)) FROM artifact_information i JOIN information_version iv ON (iv.workspace_id,iv.information_id,iv.version)=(i.workspace_id,i.information_id,i.information_version) WHERE i.workspace_id=v.workspace_id AND i.artifact_id=v.artifact_id AND i.artifact_version=v.version) AS information_references,
 'Adoption concerns only this Artifact; no Goal, commitment, information acceptance or external effect follows.' AS adoption_scope
 FROM artifact a JOIN artifact_version v ON (v.workspace_id,v.artifact_id)=(a.workspace_id,a.id)
 LEFT JOIN artifact_adoption ad ON ad.workspace_id=a.workspace_id AND ad.id=a.current_adoption_id
 LEFT JOIN artifact_review ar ON ar.workspace_id=ad.workspace_id AND ar.id=ad.review_id
 LEFT JOIN artifact_document d ON (d.workspace_id,d.artifact_id,d.artifact_version)=(v.workspace_id,v.artifact_id,v.version)
 WHERE a.workspace_id=$1 AND (($2::text[] IS NULL AND (v.version=a.current_draft_version OR v.version=ar.artifact_version)) OR
 ($2::text[] IS NOT NULL AND EXISTS(SELECT 1 FROM unnest($2::text[]) term WHERE v.title ILIKE '%'||term||'%' OR v.body ILIKE '%'||term||'%')))
 ORDER BY v.created_at DESC,a.id,v.version DESC LIMIT CASE WHEN $2::text[] IS NULL THEN 16 ELSE NULL END`,
      [w, terms],
    )
  ).rows;
}
