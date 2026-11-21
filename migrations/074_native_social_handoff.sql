-- An OAuth callback can authorize a new device session for a short window.
-- Only a digest of the single-use code survives the browser handoff.
CREATE TABLE native_social_handoff (
  code_hash text PRIMARY KEY CHECK (length(code_hash) = 64),
  challenge text NOT NULL CHECK (length(challenge) = 43),
  client_state text NOT NULL CHECK (length(client_state) = 64),
  browser_session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX native_social_handoff_expiry ON native_social_handoff(expires_at);
