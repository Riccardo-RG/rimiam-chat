-- Original binary source stays immutable; textual extraction is separate and attributable.
ALTER TABLE external_source DROP CONSTRAINT external_source_content_check;
ALTER TABLE external_source ADD CONSTRAINT external_source_content_check CHECK(length(content)<=200000 AND (length(content)>0 OR (kind='document' AND media_type NOT IN ('text/plain','text/csv','text/markdown'))));
ALTER TABLE external_source DROP CONSTRAINT external_source_check;
ALTER TABLE external_source ADD CONSTRAINT external_source_check CHECK((kind='document' AND document_id IS NOT NULL AND document_version>0 AND filename IS NOT NULL AND media_type IS NOT NULL AND original_bytes IS NOT NULL AND octet_length(original_bytes)<=8388608 AND work_id IS NULL AND url IS NULL AND provider IS NULL AND work_generation IS NULL)
 OR (kind='web' AND document_id IS NULL AND document_version IS NULL AND previous_source_id IS NULL AND original_bytes IS NULL AND filename IS NULL AND media_type IS NULL AND url IS NOT NULL AND provider IS NOT NULL AND work_id IS NOT NULL AND work_generation IS NOT NULL));
CREATE TABLE document_processing (
 source_id uuid PRIMARY KEY REFERENCES external_source(id),workspace_id uuid NOT NULL REFERENCES workspace(id),
 kind text NOT NULL CHECK(kind IN ('pdf','docx','image','audio')),
 status text NOT NULL CHECK(status IN ('queued','processing','ready','needs_configuration','needs_input','failed')),
 requested_by text NOT NULL REFERENCES "user"(id),membership_version integer NOT NULL,allow_model_processing boolean NOT NULL DEFAULT false,
 attempt_id uuid,lease_until timestamptz,error_code text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE TABLE document_extraction_attempt (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,source_id uuid NOT NULL,requested_by text NOT NULL REFERENCES "user"(id),membership_version integer NOT NULL,
 allow_model_processing boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE TABLE document_extraction (
 attempt_id uuid PRIMARY KEY REFERENCES document_extraction_attempt(id),workspace_id uuid NOT NULL,source_id uuid NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 200000),qualification text NOT NULL,provider text NOT NULL,content_hash text NOT NULL,
 publication text NOT NULL CHECK(publication IN ('published','superseded','access_ended')),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE UNIQUE INDEX document_extraction_published ON document_extraction(source_id) WHERE publication='published';
CREATE INDEX document_processing_recovery ON document_processing(status,lease_until);
CREATE INDEX document_extraction_search ON document_extraction USING gin(to_tsvector('simple',content));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['document_extraction_attempt','document_extraction']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t);END LOOP;
END $$;
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
 FROM external_source s LEFT JOIN document_processing p ON p.source_id=s.id
 LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published'
 WHERE p.source_id IS NULL OR (p.status='ready' AND e.attempt_id IS NOT NULL);
