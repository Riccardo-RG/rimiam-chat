-- A model may suggest operational steering, never apply it or impersonate a member.
CREATE TABLE work_control_suggestion (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, work_id uuid NOT NULL,
 expected_revision integer NOT NULL CHECK(expected_revision>0),
 operation text NOT NULL CHECK(operation IN ('pause','stop','resume','input','assumption','objection','redirect','format')),
 content text NOT NULL, source_id uuid NOT NULL, interpretation_id uuid NOT NULL, generation integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,interpretation_id,generation),
 FOREIGN KEY(workspace_id,work_id) REFERENCES active_work(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,interpretation_id) REFERENCES interpretation(workspace_id,id)
);
CREATE TABLE work_control_application (
 workspace_id uuid NOT NULL, suggestion_id uuid NOT NULL, actor_id text NOT NULL REFERENCES "user"(id),
 source_id uuid NOT NULL, resulting_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,suggestion_id),
 FOREIGN KEY(workspace_id,suggestion_id) REFERENCES work_control_suggestion(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON work_control_suggestion FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON work_control_application FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
