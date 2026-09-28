-- Explicit contextual references in shared Conversation, never approvals or commands to act.
-- Exact target versions/events are validated under the Workspace command lock against retained
-- immutable shared domain records. No private mailbox/calendar observation reference is accepted.
CREATE TABLE message_context_reference (
 workspace_id uuid NOT NULL, message_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('goal','information','commitment','task','artifact','question','workstream','active_work','scheduled_event','source')),
 reference_id uuid NOT NULL, reference_version integer NOT NULL CHECK(reference_version>0),
 activity_event_id text CHECK(length(activity_event_id) BETWEEN 1 AND 220),
 PRIMARY KEY(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE INDEX message_context_reference_target ON message_context_reference(workspace_id,kind,reference_id,reference_version);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON message_context_reference
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
