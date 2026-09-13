CREATE TABLE workspace_task (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), current_version integer NOT NULL,
 UNIQUE(workspace_id,id)
);
CREATE TABLE task_version (
 workspace_id uuid NOT NULL, task_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), description text NOT NULL,
 due_at timestamptz, time_zone text NOT NULL, suggested_person text REFERENCES "user"(id),
 status text NOT NULL CHECK(status IN ('open','in_progress','completed','cancelled')),
 responsibility_id uuid, candidate_id uuid,
 actor_id text NOT NULL REFERENCES "user"(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,task_id,version),
 FOREIGN KEY(workspace_id,task_id) REFERENCES workspace_task(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id)
);
ALTER TABLE workspace_task ADD FOREIGN KEY(workspace_id,id,current_version) REFERENCES task_version(workspace_id,task_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE task_responsibility (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, task_id uuid NOT NULL, task_version integer NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id), membership_version integer NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,task_id,id),
 FOREIGN KEY(workspace_id,task_id,task_version) REFERENCES task_version(workspace_id,task_id,version) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE task_version ADD FOREIGN KEY(workspace_id,task_id,responsibility_id) REFERENCES task_responsibility(workspace_id,task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE task_reference (
 workspace_id uuid NOT NULL, task_id uuid NOT NULL, task_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('goal','commitment','information','artifact','source','message','question','task')),
 reference_id uuid NOT NULL, reference_version integer NOT NULL CHECK(reference_version>0),
 PRIMARY KEY(workspace_id,task_id,task_version,kind,reference_id,reference_version),
 FOREIGN KEY(workspace_id,task_id,task_version) REFERENCES task_version(workspace_id,task_id,version)
);
CREATE TABLE task_revision_proposal (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, task_id uuid NOT NULL, base_version integer NOT NULL,
 content jsonb NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,task_id,base_version) REFERENCES task_version(workspace_id,task_id,version)
);
CREATE TABLE workspace_followup (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), owner_id text NOT NULL REFERENCES "user"(id),
 current_version integer NOT NULL, UNIQUE(workspace_id,id)
);
CREATE TABLE followup_version (
 workspace_id uuid NOT NULL, followup_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 content text NOT NULL, kind text NOT NULL CHECK(kind IN ('remember','check','request_update','review')),
 remind_at timestamptz NOT NULL, time_zone text NOT NULL,
 reference_kind text, reference_id uuid, reference_version integer,
 status text NOT NULL CHECK(status IN ('active','done','cancelled')),
 actor_id text NOT NULL REFERENCES "user"(id), membership_version integer NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,followup_id,version),
 FOREIGN KEY(workspace_id,followup_id) REFERENCES workspace_followup(workspace_id,id),
 CHECK((reference_kind IS NULL AND reference_id IS NULL AND reference_version IS NULL) OR
 (reference_kind IN ('goal','commitment','information','artifact','source','message','question','task') AND reference_id IS NOT NULL AND reference_version>0))
);
ALTER TABLE workspace_followup ADD FOREIGN KEY(workspace_id,id,current_version) REFERENCES followup_version(workspace_id,followup_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE followup_delivery (
 workspace_id uuid NOT NULL, followup_id uuid NOT NULL, version integer NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('delivered','suppressed')), reason text NOT NULL,
 delivered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,followup_id,version),
 FOREIGN KEY(workspace_id,followup_id,version) REFERENCES followup_version(workspace_id,followup_id,version)
);
CREATE INDEX followup_due ON followup_version(remind_at) WHERE status='active';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['task_version','task_responsibility','task_reference','task_revision_proposal','followup_version','followup_delivery'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t);
 END LOOP;
END $$;
