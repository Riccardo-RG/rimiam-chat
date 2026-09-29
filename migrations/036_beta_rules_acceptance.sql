-- Account-level acknowledgement only; no Workspace membership, privacy consent or authority.
CREATE TABLE beta_rules_acceptance (
 user_id text NOT NULL REFERENCES "user"(id),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 100),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 content text NOT NULL CHECK(length(content)>0),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,version)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON beta_rules_acceptance
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
