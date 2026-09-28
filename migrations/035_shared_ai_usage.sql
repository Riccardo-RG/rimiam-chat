-- Diagnostics only: no prompt/content, private capability activity or domain effects.
CREATE TABLE shared_ai_usage_attempt (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 operation text NOT NULL CHECK(operation IN ('conversation','active_work')),
 provider text NOT NULL CHECK(provider IN ('openai','anthropic','ollama')),
 model text NOT NULL,
 rates jsonb,
 started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_ai_usage_workspace ON shared_ai_usage_attempt(workspace_id,started_at);
CREATE TABLE shared_ai_usage_result (
 attempt_id uuid PRIMARY KEY REFERENCES shared_ai_usage_attempt(id),
 outcome text NOT NULL CHECK(outcome IN ('returned','failed')),
 input_tokens bigint CHECK(input_tokens >= 0),
 cached_input_tokens bigint CHECK(cached_input_tokens >= 0),
 cache_write_tokens bigint CHECK(cache_write_tokens >= 0),
 output_tokens bigint CHECK(output_tokens >= 0),
 estimated_usd numeric(24,12) CHECK(estimated_usd >= 0),
 finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON shared_ai_usage_attempt
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON shared_ai_usage_result
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
