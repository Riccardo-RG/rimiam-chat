-- A focus is an attributed reference in the one shared Conversation, never a room/ACL.
-- Keep the exact Workstream version selected at send time even after later organization.
CREATE TABLE message_workstream_focus (
 workspace_id uuid NOT NULL, message_id uuid NOT NULL,
 workstream_id uuid NOT NULL, workstream_version integer NOT NULL,
 PRIMARY KEY(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,workstream_id,workstream_version)
  REFERENCES workstream_version(workspace_id,workstream_id,version)
);
CREATE INDEX message_focus_stream ON message_workstream_focus(workspace_id,workstream_id,message_id);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON message_workstream_focus
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
