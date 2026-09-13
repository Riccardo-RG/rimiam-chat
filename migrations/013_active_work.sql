-- Active Work owns continuity. Attempts and Contributions never own domain authority.
CREATE TABLE active_work (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 contract_version integer NOT NULL, revision integer NOT NULL DEFAULT 0,
 phase text NOT NULL CHECK(phase IN ('queued','working','needs_input','paused','stopped','completed')),
 validity text NOT NULL DEFAULT 'current' CHECK(validity IN ('current','potentially_outdated')),
 generation integer NOT NULL DEFAULT 0, lease_until timestamptz, error_code text,
 topic_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE active_work_contract (
 workspace_id uuid NOT NULL, work_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 objective text NOT NULL, scope text NOT NULL, expected_output text NOT NULL,
 anchors text[] NOT NULL DEFAULT '{}', focus text[] NOT NULL DEFAULT '{}',
 direction_actors text[] NOT NULL DEFAULT '{}', actor_id text REFERENCES "user"(id),
 origin text NOT NULL CHECK(origin IN ('human','miriam')), source_id uuid, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,work_id,version),
 FOREIGN KEY(workspace_id,work_id) REFERENCES active_work(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
ALTER TABLE active_work ADD FOREIGN KEY(workspace_id,id,contract_version) REFERENCES active_work_contract(workspace_id,work_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE active_work_event (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, revision integer NOT NULL,
 contract_version integer NOT NULL, kind text NOT NULL, content text NOT NULL,
 actor_id text REFERENCES "user"(id), source_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,work_id,revision),
 FOREIGN KEY(workspace_id,work_id,contract_version) REFERENCES active_work_contract(workspace_id,work_id,version),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE active_work_issue (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, contract_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('objection','revision','context','input')),
 content text NOT NULL, actor_id text REFERENCES "user"(id), source_id uuid,
 proposed_objective text, required_people text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,work_id,id),
 FOREIGN KEY(workspace_id,work_id,contract_version) REFERENCES active_work_contract(workspace_id,work_id,version),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE active_work_issue_act (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, issue_id uuid NOT NULL,
 actor_id text REFERENCES "user"(id), membership_version integer,
 action text NOT NULL CHECK(action IN ('acknowledge','withdraw','resolved')),
 source_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_id,issue_id) REFERENCES active_work_issue(workspace_id,work_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE active_work_attempt (
 workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 contract_version integer NOT NULL, control_revision integer NOT NULL, provider text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,work_id,generation),
 FOREIGN KEY(workspace_id,work_id,contract_version) REFERENCES active_work_contract(workspace_id,work_id,version)
);
CREATE TABLE active_work_input (
 workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 input_key text NOT NULL, kind text NOT NULL, reference_id uuid NOT NULL, reference_version integer NOT NULL,
 content text NOT NULL, qualification text NOT NULL, provenance jsonb NOT NULL,
 PRIMARY KEY(workspace_id,work_id,generation,input_key),
 FOREIGN KEY(workspace_id,work_id,generation) REFERENCES active_work_attempt(workspace_id,work_id,generation)
);
CREATE TABLE active_work_retrieval (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 terms text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_id,generation) REFERENCES active_work_attempt(workspace_id,work_id,generation)
);
CREATE TABLE active_work_contribution (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL, generation integer NOT NULL,
 contract_version integer NOT NULL, body text NOT NULL, citation_keys text[] NOT NULL,
 qualification text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,work_id,generation),
 FOREIGN KEY(workspace_id,work_id,generation) REFERENCES active_work_attempt(workspace_id,work_id,generation),
 FOREIGN KEY(workspace_id,work_id,contract_version) REFERENCES active_work_contract(workspace_id,work_id,version)
);
CREATE TABLE active_work_initiative (
 workspace_id uuid NOT NULL, question_id uuid NOT NULL, question_version integer NOT NULL,
 work_id uuid, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,question_id,question_version),
 FOREIGN KEY(workspace_id,question_id,question_version) REFERENCES question_version(workspace_id,question_id,version),
 FOREIGN KEY(workspace_id,work_id) REFERENCES active_work(workspace_id,id)
);
CREATE INDEX active_work_pending ON active_work(phase,lease_until);
CREATE INDEX active_work_topic ON active_work(workspace_id,topic_key);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['active_work_contract','active_work_event','active_work_issue','active_work_issue_act','active_work_attempt','active_work_input','active_work_retrieval','active_work_contribution','active_work_initiative'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t);
 END LOOP;
END $$;
