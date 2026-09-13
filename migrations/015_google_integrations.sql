-- Private integration credentials and one-time OAuth handoffs. Never part of Shared Context.
CREATE TABLE google_oauth_request (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), person_id text NOT NULL REFERENCES "user"(id),
 session_id text NOT NULL, membership_version integer NOT NULL, capability text NOT NULL CHECK(capability IN ('calendar','email')),
 state_hash text NOT NULL UNIQUE, ticket_hash text NOT NULL UNIQUE, browser_hash text, verifier_cipher text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','launched','exchanging','completed','failed')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), error_code text
);
CREATE INDEX google_oauth_expiry ON google_oauth_request(expires_at);
CREATE TABLE google_credential (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), person_id text NOT NULL REFERENCES "user"(id),
 membership_version integer NOT NULL, capability text NOT NULL CHECK(capability IN ('calendar','email')),
 google_subject text NOT NULL, email text NOT NULL, scopes text[] NOT NULL,
 access_cipher text, refresh_cipher text, expires_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('connecting','active','revoked','reconnect_required')),
 calendar_connection_id uuid REFERENCES calendar_connection(id), mailbox_connection_id uuid REFERENCES mailbox_connection(id),
 version integer NOT NULL DEFAULT 1, refresh_attempt uuid, refresh_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), error_code text,
 CHECK((capability='calendar' AND mailbox_connection_id IS NULL) OR (capability='email' AND calendar_connection_id IS NULL))
);
CREATE INDEX google_credential_owner ON google_credential(workspace_id,person_id);
-- Exactly one transport record per Gmail operation: an unknown dispatch is never blindly replayed.
CREATE TABLE google_email_delivery (
 credential_id uuid NOT NULL REFERENCES google_credential(id), operation_key text NOT NULL,
 envelope_hash text NOT NULL, internet_message_id text NOT NULL, expected jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('sending','accepted','rejected')), receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(credential_id,operation_key)
);
-- Local disconnection immediately destroys usable credentials, in the same transaction.
-- Remote Google grant revocation is separate because it may revoke other app connections too.
CREATE FUNCTION revoke_google_connection_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.active AND NOT NEW.active THEN
  IF TG_TABLE_NAME='calendar_connection' THEN
   UPDATE google_credential SET status='revoked',access_cipher=NULL,refresh_cipher=NULL,version=version+1,refresh_attempt=NULL,refresh_until=NULL WHERE calendar_connection_id=NEW.id;
  ELSE
   UPDATE google_credential SET status='revoked',access_cipher=NULL,refresh_cipher=NULL,version=version+1,refresh_attempt=NULL,refresh_until=NULL WHERE mailbox_connection_id=NEW.id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER google_credential_disconnect AFTER UPDATE OF active ON calendar_connection FOR EACH ROW EXECUTE FUNCTION revoke_google_connection_credential();
CREATE TRIGGER google_credential_disconnect AFTER UPDATE OF active ON mailbox_connection FOR EACH ROW EXECUTE FUNCTION revoke_google_connection_credential();
