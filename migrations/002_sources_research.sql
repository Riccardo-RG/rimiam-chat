-- Extend provenance to concrete source kinds without rewriting message history.
CREATE TABLE source_identity (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 kind text NOT NULL CHECK(kind IN ('message','document','web')),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,id,kind)
);
INSERT INTO source_identity SELECT id,workspace_id,'message' FROM message;
CREATE FUNCTION register_message_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO source_identity(id,workspace_id,kind) VALUES(NEW.id,NEW.workspace_id,'message');
 RETURN NEW;
END $$;
CREATE TRIGGER register_source BEFORE INSERT ON message FOR EACH ROW EXECUTE FUNCTION register_message_source();
ALTER TABLE interpretation DROP CONSTRAINT interpretation_workspace_id_source_id_fkey;
ALTER TABLE interpretation ADD FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id);
ALTER TABLE candidate DROP CONSTRAINT candidate_workspace_id_source_id_fkey;
ALTER TABLE candidate ADD FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id);
ALTER TABLE candidate_source DROP CONSTRAINT candidate_source_workspace_id_message_id_fkey;
ALTER TABLE candidate_source RENAME COLUMN message_id TO source_id;
ALTER TABLE candidate_source ADD FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id);

CREATE TABLE research_work (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 requested_by text NOT NULL REFERENCES "user"(id), request_source_id uuid NOT NULL,
 query text NOT NULL CHECK(length(query) BETWEEN 1 AND 500),
 goal_id uuid, goal_version integer,
 context_revision integer NOT NULL, access_revision integer NOT NULL,
 requester_membership_version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed','stale','cancelled','needs_configuration')),
 generation integer NOT NULL DEFAULT 0, lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,request_source_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version)
);
CREATE TABLE research_attempt (
 workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 provider text NOT NULL, query text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,work_id,generation),
 FOREIGN KEY(workspace_id,work_id) REFERENCES research_work(workspace_id,id)
);
CREATE TABLE research_event (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 status text NOT NULL, actor_id text REFERENCES "user"(id), detail text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_id) REFERENCES research_work(workspace_id,id)
);
CREATE TABLE external_source (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('document','web')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 200000),
 contributed_by text NOT NULL REFERENCES "user"(id),
 qualification text NOT NULL, content_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 document_id uuid, document_version integer, previous_source_id uuid,
 filename text, media_type text, original_bytes bytea,
 url text, provider text, work_id uuid, work_generation integer,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,document_id,document_version),
 FOREIGN KEY(workspace_id,id,kind) REFERENCES source_identity(workspace_id,id,kind),
 FOREIGN KEY(workspace_id,previous_source_id) REFERENCES external_source(workspace_id,id),
 FOREIGN KEY(workspace_id,work_id,work_generation) REFERENCES research_attempt(workspace_id,work_id,generation),
 CHECK((kind='document' AND document_id IS NOT NULL AND document_version>0 AND filename IS NOT NULL AND media_type IS NOT NULL AND original_bytes IS NOT NULL AND octet_length(original_bytes)<=1048576 AND work_id IS NULL AND url IS NULL AND provider IS NULL AND work_generation IS NULL)
 OR (kind='web' AND document_id IS NULL AND document_version IS NULL AND previous_source_id IS NULL AND original_bytes IS NULL AND filename IS NULL AND media_type IS NULL AND url IS NOT NULL AND provider IS NOT NULL AND work_id IS NOT NULL AND work_generation IS NOT NULL)),
 CHECK(kind<>'document' OR (document_version=1 AND previous_source_id IS NULL) OR (document_version>1 AND previous_source_id IS NOT NULL))
);
CREATE INDEX external_source_search ON external_source USING gin(to_tsvector('simple',content));
CREATE INDEX external_source_workspace ON external_source(workspace_id,created_at);
CREATE INDEX research_work_pending ON research_work(status,lease_until);
CREATE VIEW workspace_source AS
 SELECT m.id,m.workspace_id,m.content,m.author_id,u.name AS author_name,m.sequence,m.created_at,
 'message'::text AS kind,NULL::text AS title,NULL::text AS url,
 'Affermazione umana attribuita, non verificata indipendentemente.'::text AS qualification,
 NULL::uuid AS document_id,NULL::integer AS document_version,NULL::text AS content_hash
 FROM message m JOIN "user" u ON u.id=m.author_id
 UNION ALL
 SELECT s.id,s.workspace_id,s.content,s.contributed_by,
 CASE WHEN s.kind='document' THEN 'Documento: '||s.title ELSE 'Fonte web: '||s.title END,
 NULL::integer,s.created_at,s.kind,s.title,s.url,s.qualification,s.document_id,s.document_version,s.content_hash
 FROM external_source s;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['source_identity','external_source','research_attempt','research_event']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',table_name); END LOOP;
END $$;
