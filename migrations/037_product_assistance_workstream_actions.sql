-- Explicit shared references to a product form, never field values or a private screen snapshot.
CREATE TABLE message_product_assistance (
 workspace_id uuid NOT NULL, message_id uuid NOT NULL,
 guide_version integer NOT NULL CHECK(guide_version>0),
 screen text NOT NULL, field_id text, issue text,
 PRIMARY KEY(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 CHECK(issue IS NULL OR issue IN ('required','invalid','unavailable','stale'))
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON message_product_assistance
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();

-- Only a validated authenticated command can create this receipt. AI output cannot.
CREATE TABLE conversation_workstream_action (
 workspace_id uuid NOT NULL, source_message_id uuid NOT NULL, reply_message_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id),
 title text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('created','existing','needs_input')),
 workstream_id uuid, workstream_version integer, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,source_message_id), UNIQUE(workspace_id,reply_message_id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,reply_message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,workstream_id,workstream_version)
  REFERENCES workstream_version(workspace_id,workstream_id,version),
 CHECK((outcome='needs_input' AND workstream_id IS NULL AND workstream_version IS NULL)
  OR (outcome IN ('created','existing') AND workstream_id IS NOT NULL AND workstream_version IS NOT NULL))
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON conversation_workstream_action
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
