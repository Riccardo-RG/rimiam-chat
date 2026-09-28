-- Shared beta observations are not Conversation sources or governed project state.
CREATE TABLE beta_feedback (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 author_id text NOT NULL REFERENCES "user"(id),
 author_name text NOT NULL,
 message_id uuid,
 content text NOT NULL CHECK(length(btrim(content)) BETWEEN 1 AND 6000),
 provider_at_capture text NOT NULL CHECK(provider_at_capture IN ('openai','anthropic','ollama','unconfigured')),
 model_at_capture text,
 conversation_prompt_hash_at_capture text NOT NULL,
 app_revision_at_capture text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE INDEX beta_feedback_workspace ON beta_feedback(workspace_id,created_at,id);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON beta_feedback FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
