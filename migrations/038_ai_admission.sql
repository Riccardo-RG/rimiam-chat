-- Operational invocation guard, not billing or governed product state.
-- Unknown/crashed dispatches retain their reservation instead of becoming free.
CREATE TABLE ai_invocation_admission (
 id uuid PRIMARY KEY,
 workspace_id uuid REFERENCES workspace(id),
 operation text NOT NULL CHECK(operation IN ('conversation','active_work','vision','transcription')),
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_admission_time ON ai_invocation_admission(admitted_at);
CREATE INDEX ai_admission_workspace_time ON ai_invocation_admission(workspace_id,admitted_at);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON ai_invocation_admission
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
