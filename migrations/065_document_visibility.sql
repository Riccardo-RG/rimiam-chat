-- Only an ordinary upload has a visibility lifecycle controlled by its uploader.
-- The original and already-published references always retain their identities.
CREATE TABLE document_visibility_event (
 workspace_id uuid NOT NULL, source_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 withdrawn boolean NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id, source_id, version),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON document_visibility_event FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();

-- Old uploads are identified by an upload receipt or the human message that
-- attached them. Exclude sources created as a side effect of another capability.
INSERT INTO document_visibility_event(workspace_id,source_id,version,withdrawn,actor_id,created_at)
SELECT s.workspace_id,s.id,1,false,s.contributed_by,s.created_at FROM external_source s
WHERE s.kind='document' AND (EXISTS (
 SELECT 1 FROM command_receipt r WHERE r.workspace_id=s.workspace_id AND r.actor_id=s.contributed_by
 AND r.result ? 'documentId' AND r.result->>'sourceId'=s.id::text
) OR EXISTS (
 SELECT 1 FROM message_attachment a JOIN message m ON (m.workspace_id,m.id)=(a.workspace_id,a.message_id)
 WHERE (a.workspace_id,a.source_id)=(s.workspace_id,s.id) AND m.author_id=s.contributed_by
 AND NOT EXISTS(SELECT 1 FROM personal_research_publication p WHERE (p.destination_id,p.message_id)=(m.workspace_id,m.id))
))
AND NOT EXISTS(SELECT 1 FROM email_disclosure d WHERE d.source_id=s.id)
AND NOT EXISTS(SELECT 1 FROM voice_message v WHERE v.source_id=s.id)
AND NOT EXISTS(SELECT 1 FROM call_analysis_source c WHERE c.source_id=s.id)
AND NOT EXISTS(SELECT 1 FROM library_copy_origin o WHERE o.source_id=s.id)
AND NOT EXISTS(SELECT 1 FROM private_workspace_consultation c WHERE c.document_source_id=s.id);

CREATE VIEW document_visibility AS
 SELECT DISTINCT ON(workspace_id,source_id) workspace_id,source_id,version,withdrawn,actor_id,created_at
 FROM document_visibility_event ORDER BY workspace_id,source_id,version DESC;
CREATE VIEW available_external_source AS
 SELECT s.* FROM external_source s WHERE NOT EXISTS(SELECT 1 FROM document_visibility v
 WHERE (v.workspace_id,v.source_id)=(s.workspace_id,s.id) AND v.withdrawn);
CREATE OR REPLACE VIEW workspace_source AS
 SELECT m.id,m.workspace_id,m.content,m.author_id,u.name AS author_name,m.sequence,m.created_at,
 'message'::text AS kind,NULL::text AS title,NULL::text AS url,
 'Affermazione umana attribuita, non verificata indipendentemente.'::text AS qualification,
 NULL::uuid AS document_id,NULL::integer AS document_version,NULL::text AS content_hash
 FROM message m JOIN "user" u ON u.id=m.author_id
 UNION ALL
 SELECT s.id,s.workspace_id,coalesce(e.content,s.content),s.contributed_by,
 CASE WHEN s.kind='document' THEN 'Documento: '||s.title ELSE 'Fonte web: '||s.title END,
 NULL::integer,s.created_at,s.kind,s.title,s.url,
 s.qualification || CASE WHEN e.qualification IS NULL THEN '' ELSE ' '||e.qualification END,
 s.document_id,s.document_version,s.content_hash
 FROM available_external_source s LEFT JOIN document_processing p ON p.source_id=s.id
 LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published'
 WHERE p.source_id IS NULL OR (p.status='ready' AND e.attempt_id IS NOT NULL);
