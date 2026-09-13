-- Editorial semantic organization never moves/duplicates original sources or grants authority.
CREATE TABLE workstream (
 workspace_id uuid NOT NULL REFERENCES workspace(id), id uuid NOT NULL,
 current_version integer NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,id)
);
CREATE TABLE workstream_version (
 workspace_id uuid NOT NULL, workstream_id uuid NOT NULL, version integer NOT NULL,
 title text NOT NULL, description text NOT NULL DEFAULT '', actor_id text REFERENCES "user"(id),
 origin text NOT NULL CHECK(origin IN ('human','miriam')), source_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,workstream_id,version),
 FOREIGN KEY(workspace_id,workstream_id) REFERENCES workstream(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id),
 CHECK((origin='human' AND actor_id IS NOT NULL) OR (origin='miriam' AND actor_id IS NULL))
);
CREATE TABLE workstream_source (
 workspace_id uuid NOT NULL, workstream_id uuid NOT NULL, source_id uuid NOT NULL,
 version integer NOT NULL, included boolean NOT NULL, actor_id text REFERENCES "user"(id),
 origin text NOT NULL CHECK(origin IN ('human','miriam')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,workstream_id,source_id,version),
 FOREIGN KEY(workspace_id,workstream_id) REFERENCES workstream(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE workspace_alignment (
 workspace_id uuid NOT NULL REFERENCES workspace(id), person_id text NOT NULL REFERENCES "user"(id),
 revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,person_id,revision)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workstream_version','workstream_source','workspace_alignment']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t); END LOOP;
END $$;
