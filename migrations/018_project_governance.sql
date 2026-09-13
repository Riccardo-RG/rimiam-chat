-- Explicit, finite project mandates and proposed Goal/normative transitions.
-- No access relationship or AI result supplies project authority.
CREATE TABLE project_mandate (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), current_version integer NOT NULL,
 UNIQUE(workspace_id,id)
);
CREATE TABLE project_mandate_version (
 workspace_id uuid NOT NULL, mandate_id uuid NOT NULL, version integer NOT NULL,
 grantor_id text NOT NULL, holder_id text NOT NULL,
 grantor_membership_version integer NOT NULL, holder_membership_version integer NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN ('goal','act')), scope_id uuid NOT NULL, scope_version integer NOT NULL,
 capability text NOT NULL CHECK(capability IN ('goal.change','goal.conclude','goal.subgoal','act.create','act.replace','act.revoke')),
 status text NOT NULL CHECK(status IN ('offered','accepted','contested','revoked','declined','relinquished')),
 expires_at timestamptz, actor_id text NOT NULL, reason text NOT NULL, source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,mandate_id,version), FOREIGN KEY(workspace_id,mandate_id) REFERENCES project_mandate(workspace_id,id),
 FOREIGN KEY(workspace_id,grantor_id) REFERENCES membership(workspace_id,user_id),
 FOREIGN KEY(workspace_id,holder_id) REFERENCES membership(workspace_id,user_id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
ALTER TABLE goal ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned','replaced'));
ALTER TABLE goal ADD COLUMN parent_goal_id uuid;
ALTER TABLE goal ADD COLUMN parent_goal_version integer;
ALTER TABLE goal ADD FOREIGN KEY(workspace_id,parent_goal_id,parent_goal_version) REFERENCES goal_version(workspace_id,goal_id,version);
ALTER TABLE goal_version ADD COLUMN source_id uuid;
ALTER TABLE goal_version ADD COLUMN reason text NOT NULL DEFAULT 'Explicit initial intent';
ALTER TABLE goal_version ADD FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id);
CREATE TABLE goal_intent_participant (
 workspace_id uuid NOT NULL, goal_id uuid NOT NULL, goal_version integer NOT NULL, person_id text NOT NULL,
 PRIMARY KEY(workspace_id,goal_id,goal_version,person_id),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version)
);
INSERT INTO goal_intent_participant SELECT workspace_id,goal_id,version,established_by FROM goal_version;
CREATE TABLE goal_transition (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, goal_id uuid NOT NULL, goal_version integer NOT NULL,
 mode text NOT NULL CHECK(mode IN ('revise','replace','subgoal','complete','abandon')),
 base_status text NOT NULL, base_primary boolean NOT NULL, base_parent_goal_id uuid, base_parent_goal_version integer,
 content text NOT NULL, reason text NOT NULL, previous_becomes_subgoal boolean NOT NULL DEFAULT false,
 actor_id text NOT NULL, source_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE goal_transition_person (
 workspace_id uuid NOT NULL, transition_id uuid NOT NULL, person_id text NOT NULL,
 PRIMARY KEY(workspace_id,transition_id,person_id), FOREIGN KEY(workspace_id,transition_id) REFERENCES goal_transition(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES membership(workspace_id,user_id)
);
CREATE TABLE goal_transition_obligation (
 workspace_id uuid NOT NULL, transition_id uuid NOT NULL, act_id uuid NOT NULL, blocking boolean NOT NULL,
 PRIMARY KEY(workspace_id,transition_id,act_id), FOREIGN KEY(workspace_id,transition_id) REFERENCES goal_transition(workspace_id,id),
 FOREIGN KEY(workspace_id,act_id) REFERENCES project_act(workspace_id,id)
);
CREATE TABLE goal_transition_approval (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, transition_id uuid NOT NULL,
 person_id text NOT NULL, actor_id text NOT NULL, access_revision integer NOT NULL,
 mandate_id uuid, mandate_version integer, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,transition_id,person_id) REFERENCES goal_transition_person(workspace_id,transition_id,person_id),
 FOREIGN KEY(workspace_id,mandate_id,mandate_version) REFERENCES project_mandate_version(workspace_id,mandate_id,version)
);
CREATE TABLE goal_transition_adoption (
 workspace_id uuid NOT NULL, transition_id uuid NOT NULL, goal_id uuid NOT NULL, goal_version integer NOT NULL,
 adopted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,transition_id),
 FOREIGN KEY(workspace_id,transition_id) REFERENCES goal_transition(workspace_id,id),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version)
);
CREATE TABLE goal_relation (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, from_goal_id uuid NOT NULL, from_version integer NOT NULL,
 to_goal_id uuid NOT NULL, to_version integer NOT NULL, kind text NOT NULL CHECK(kind IN ('replaces','subgoal')),
 transition_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,from_goal_id,from_version) REFERENCES goal_version(workspace_id,goal_id,version),
 FOREIGN KEY(workspace_id,to_goal_id,to_version) REFERENCES goal_version(workspace_id,goal_id,version),
 FOREIGN KEY(workspace_id,transition_id) REFERENCES goal_transition(workspace_id,id)
);
ALTER TABLE normative_proposal ALTER COLUMN candidate_id DROP NOT NULL;
ALTER TABLE normative_proposal ADD COLUMN source_id uuid;
ALTER TABLE normative_proposal ADD COLUMN operation text NOT NULL DEFAULT 'establish' CHECK(operation IN ('establish','replace','revoke'));
ALTER TABLE normative_proposal ADD COLUMN replaces_act_id uuid;
ALTER TABLE normative_proposal ADD FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id);
ALTER TABLE normative_proposal ADD FOREIGN KEY(workspace_id,replaces_act_id) REFERENCES project_act(workspace_id,id);
ALTER TABLE project_approval ADD COLUMN actor_id text;
ALTER TABLE project_approval ADD COLUMN mandate_id uuid;
ALTER TABLE project_approval ADD COLUMN mandate_version integer;
ALTER TABLE project_approval ADD FOREIGN KEY(workspace_id,mandate_id,mandate_version) REFERENCES project_mandate_version(workspace_id,mandate_id,version);
CREATE TABLE project_act_supersession (
 workspace_id uuid NOT NULL, act_id uuid NOT NULL, successor_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('replace','revoke')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,act_id),
 FOREIGN KEY(workspace_id,act_id) REFERENCES project_act(workspace_id,id),
 FOREIGN KEY(workspace_id,successor_id) REFERENCES project_act(workspace_id,id)
);
CREATE VIEW current_project_act AS SELECT a.* FROM project_act a WHERE NOT EXISTS(SELECT 1 FROM project_act_supersession s WHERE (s.workspace_id,s.act_id)=(a.workspace_id,a.id));
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['project_mandate_version','goal_intent_participant','goal_transition','goal_transition_person','goal_transition_obligation','goal_transition_approval','goal_transition_adoption','goal_relation','project_act_supersession']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',table_name); END LOOP;
END $$;
