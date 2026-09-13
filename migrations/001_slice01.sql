-- Sources and current domain state are separate; this is not an event-sourced store.
CREATE TABLE workspace (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 created_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 0, context_revision integer NOT NULL DEFAULT 0,
 access_revision integer NOT NULL DEFAULT 0, next_message integer NOT NULL DEFAULT 0
);
CREATE TABLE membership (
 workspace_id uuid NOT NULL REFERENCES workspace(id), user_id text NOT NULL REFERENCES "user"(id),
 active boolean NOT NULL DEFAULT true, contributes boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE membership_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, user_id text NOT NULL,
 version integer NOT NULL, active boolean NOT NULL, actor_id text NOT NULL REFERENCES "user"(id),
 basis text NOT NULL, full_history_accepted boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,user_id) REFERENCES membership(workspace_id,user_id), UNIQUE(workspace_id,user_id,version)
);
CREATE TABLE access_relationship (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), holder_id text NOT NULL,
 version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
 invitations boolean NOT NULL, remove_members boolean NOT NULL, change_access boolean NOT NULL,
 protected boolean NOT NULL DEFAULT false, basis text NOT NULL,
 FOREIGN KEY(workspace_id,holder_id) REFERENCES membership(workspace_id,user_id), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_active_stewardship ON access_relationship(workspace_id,holder_id) WHERE active;
CREATE TABLE access_condition (
 workspace_id uuid NOT NULL, relationship_id uuid NOT NULL, required_participation_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,relationship_id,required_participation_id),
 FOREIGN KEY(workspace_id,relationship_id) REFERENCES access_relationship(workspace_id,id),
 FOREIGN KEY(workspace_id,required_participation_id) REFERENCES access_relationship(workspace_id,id)
);
CREATE TABLE access_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, relationship_id uuid NOT NULL, version integer NOT NULL,
 active boolean NOT NULL, invitations boolean NOT NULL, remove_members boolean NOT NULL, change_access boolean NOT NULL,
 protected boolean NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(relationship_id,version), FOREIGN KEY(workspace_id,relationship_id) REFERENCES access_relationship(workspace_id,id)
);
CREATE TABLE invitation (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), recipient_email text NOT NULL,
 token_hash text NOT NULL UNIQUE, issuer_id text NOT NULL REFERENCES "user"(id), relationship_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, accepted_at timestamptz, accepted_by text REFERENCES "user"(id),
 history_disclosed boolean NOT NULL CHECK(history_disclosed), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,relationship_id) REFERENCES access_relationship(workspace_id,id)
);
CREATE TABLE goal (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), current_version integer NOT NULL,
 current_primary boolean NOT NULL DEFAULT true, UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_current_primary ON goal(workspace_id) WHERE current_primary;
CREATE TABLE goal_version (
 workspace_id uuid NOT NULL, goal_id uuid NOT NULL, version integer NOT NULL, content text NOT NULL,
 established_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,goal_id,version), FOREIGN KEY(workspace_id,goal_id) REFERENCES goal(workspace_id,id)
);
CREATE TABLE goal_adherence (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, goal_id uuid NOT NULL, goal_version integer NOT NULL,
 user_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version),
 UNIQUE(workspace_id,goal_id,goal_version,user_id)
);
CREATE TABLE message (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), sequence integer NOT NULL,
 author_id text NOT NULL REFERENCES "user"(id), content text NOT NULL CHECK(length(content) BETWEEN 1 AND 12000),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,sequence)
);
CREATE TABLE interpretation (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, source_id uuid NOT NULL, generation integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('queued','running','completed','stale','failed')),
 context_revision integer, access_revision integer, lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(source_id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES message(workspace_id,id)
);
CREATE TABLE candidate (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, interpretation_id uuid NOT NULL, source_id uuid NOT NULL,
 subject text NOT NULL, content text NOT NULL, classification text NOT NULL CHECK(classification IN ('descriptive','normative','uncertain')),
 origin text NOT NULL CHECK(origin IN ('attributed','inferred')), qualification text NOT NULL,
 context_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,interpretation_id) REFERENCES interpretation(workspace_id,id)
);
CREATE TABLE candidate_source (
 workspace_id uuid NOT NULL, candidate_id uuid NOT NULL, message_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,candidate_id,message_id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE TABLE accepted_information (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), subject text NOT NULL,
 current_version integer NOT NULL, UNIQUE(workspace_id,id), UNIQUE(workspace_id,subject)
);
CREATE TABLE information_version (
 workspace_id uuid NOT NULL, information_id uuid NOT NULL, version integer NOT NULL,
 content text NOT NULL, qualification text NOT NULL, candidate_id uuid NOT NULL,
 accepted_by text NOT NULL REFERENCES "user"(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,information_id,version),
 FOREIGN KEY(workspace_id,information_id) REFERENCES accepted_information(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id)
);
CREATE TABLE normative_proposal (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, candidate_id uuid NOT NULL, content text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('constraint','commitment','decision')), proposed_by text NOT NULL REFERENCES "user"(id),
 goal_id uuid, goal_version integer, context_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version)
);
CREATE TABLE required_project_approval (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, person_id text NOT NULL REFERENCES "user"(id),
 PRIMARY KEY(workspace_id,proposal_id,person_id), FOREIGN KEY(workspace_id,proposal_id) REFERENCES normative_proposal(workspace_id,id)
);
CREATE TABLE project_approval (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, person_id text NOT NULL,
 context_revision integer NOT NULL, access_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,proposal_id,person_id) REFERENCES required_project_approval(workspace_id,proposal_id,person_id)
);
CREATE TABLE project_act (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, proposal_id uuid NOT NULL UNIQUE,
 adopted_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES normative_proposal(workspace_id,id)
);
CREATE TABLE act_approval (
 workspace_id uuid NOT NULL, act_id uuid NOT NULL, approval_id uuid NOT NULL REFERENCES project_approval(id),
 PRIMARY KEY(act_id,approval_id), FOREIGN KEY(workspace_id,act_id) REFERENCES project_act(workspace_id,id)
);
CREATE TABLE command_receipt (
 workspace_id uuid NOT NULL REFERENCES workspace(id), actor_id text NOT NULL REFERENCES "user"(id),
 command_id uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE workspace_change (
 workspace_id uuid NOT NULL REFERENCES workspace(id), revision integer NOT NULL,
 kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,revision)
);
-- Private local email sink: intentionally outside every Workspace read boundary.
CREATE TABLE local_mail (
 id uuid PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, link text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_search ON message USING gin(to_tsvector('simple',content));
CREATE INDEX candidate_subject ON candidate(workspace_id,subject);
CREATE INDEX member_workspaces ON membership(user_id) WHERE active;
CREATE FUNCTION reject_historical_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable historical record'; END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['membership_history','access_history','access_condition','goal_version','goal_adherence','message','candidate','candidate_source','information_version','normative_proposal','required_project_approval','project_approval','project_act','act_approval','command_receipt','workspace_change']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',table_name); END LOOP;
END $$;
