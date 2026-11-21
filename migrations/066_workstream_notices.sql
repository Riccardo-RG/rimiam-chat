ALTER TABLE message DROP CONSTRAINT message_purpose_check,
 ADD CONSTRAINT message_purpose_check CHECK(purpose IN ('conversation','workspace_introduction','workspace_welcome','followup_reminder','task_offer','workstream_event')),
 ADD CHECK(purpose <> 'workstream_event' OR actor_kind='human');

ALTER TABLE workstream_version DROP CONSTRAINT workstream_version_lifecycle_action_check,
 ADD CONSTRAINT workstream_version_lifecycle_action_check
 CHECK(lifecycle_action IN ('activate','resolve','archive','reopen','restore'));

-- A timeline notice records an operation. It is not a statement by its actor.
CREATE OR REPLACE VIEW workspace_source AS
 SELECT m.id,m.workspace_id,m.content,m.author_id,u.name AS author_name,m.sequence,m.created_at,
 'message'::text AS kind,NULL::text AS title,NULL::text AS url,
 'Affermazione umana attribuita, non verificata indipendentemente.'::text AS qualification,
 NULL::uuid AS document_id,NULL::integer AS document_version,NULL::text AS content_hash
 FROM message m JOIN "user" u ON u.id=m.author_id
 WHERE m.purpose <> 'workstream_event'
 UNION ALL
 SELECT s.id,s.workspace_id,coalesce(e.content,s.content),s.contributed_by,
 CASE WHEN s.kind='document' THEN 'Documento: '||s.title ELSE 'Fonte web: '||s.title END,
 NULL::integer,s.created_at,s.kind,s.title,s.url,
 s.qualification || CASE WHEN e.qualification IS NULL THEN '' ELSE ' '||e.qualification END,
 s.document_id,s.document_version,s.content_hash
 FROM available_external_source s LEFT JOIN document_processing p ON p.source_id=s.id
 LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published'
 WHERE p.source_id IS NULL OR (p.status='ready' AND e.attempt_id IS NOT NULL);
