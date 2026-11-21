-- Append-only operating settings for personal conversations or one shared workspace.
CREATE TABLE assistant_setting_version (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  personal_actor text REFERENCES "user"(id),
  workspace_id uuid REFERENCES workspace(id),
  revision integer NOT NULL CHECK(revision > 0),
  actor_id text NOT NULL REFERENCES "user"(id),
  connection_id text NOT NULL,
  connection_revision text NOT NULL CHECK (connection_revision ~ '^[0-9a-f]{64}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 48),
  instructions text NOT NULL CHECK (length(instructions) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(personal_actor,workspace_id)=1),
  CHECK (personal_actor IS NULL OR personal_actor=actor_id),
  UNIQUE(personal_actor,revision),
  UNIQUE(workspace_id,revision)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON assistant_setting_version
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();

-- A retry cannot silently send a previously claimed conversation to another service.
ALTER TABLE interpretation ADD COLUMN routing_epoch integer NOT NULL DEFAULT 0;
CREATE TABLE assistant_turn_binding (
  interpretation_id uuid NOT NULL REFERENCES interpretation(id),
  routing_epoch integer NOT NULL,
  PRIMARY KEY(interpretation_id,routing_epoch),
  settings_id bigint REFERENCES assistant_setting_version(id),
  connection_id text NOT NULL,
  connection_revision text NOT NULL
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON assistant_turn_binding
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();

ALTER TABLE shared_ai_usage_attempt DROP CONSTRAINT shared_ai_usage_attempt_provider_check;
ALTER TABLE shared_ai_usage_attempt ADD CHECK (provider IN ('openai','anthropic','ollama','agent'));
