-- Bounded, untrusted UI handoffs; existing capability commands own every effect.
CREATE TABLE conversation_handoff (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, source_id uuid NOT NULL, source_message_id uuid NOT NULL,
 interpretation_id uuid NOT NULL, generation integer NOT NULL CHECK(generation>0),
 kind text NOT NULL CHECK(kind IN ('goal.establish','goal.change','information.accept','information.correct','project.propose','project.replace','project.revoke','task.create','task.change','artifact.prepare','email.prepare','calendar.prepare')),
 summary text NOT NULL, suggested_text text NOT NULL,
 target_kind text CHECK(target_kind IN ('goal','information','commitment','task')), target_id uuid, target_version integer CHECK(target_version>0), target_event_id text,
 candidate_id uuid, source_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 CHECK((target_kind IS NULL AND target_id IS NULL AND target_version IS NULL AND target_event_id IS NULL) OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_version IS NOT NULL)),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,interpretation_id) REFERENCES interpretation(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id)
);
CREATE INDEX conversation_handoff_source ON conversation_handoff(workspace_id,source_id,created_at);
CREATE TABLE conversation_handoff_application (
 workspace_id uuid NOT NULL, handoff_id uuid NOT NULL, actor_id text NOT NULL, command_id uuid NOT NULL,
 command_type text NOT NULL,
 result_kind text CHECK(result_kind IN ('goal','information','commitment','task','artifact')), result_id uuid, result_version integer CHECK(result_version>0),
 prepared_kind text CHECK(prepared_kind IN ('goal_transition','project_proposal','task_revision_proposal')), prepared_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,handoff_id),
 CHECK((result_kind IS NULL AND result_id IS NULL AND result_version IS NULL) OR (result_kind IS NOT NULL AND result_id IS NOT NULL AND result_version IS NOT NULL)),
 CHECK((prepared_kind IS NULL)=(prepared_id IS NULL)),
 FOREIGN KEY(workspace_id,handoff_id) REFERENCES conversation_handoff(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES command_receipt(workspace_id,actor_id,command_id)
);
CREATE INDEX conversation_handoff_result ON conversation_handoff_application(workspace_id,result_kind,result_id,result_version);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON conversation_handoff FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON conversation_handoff_application FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
