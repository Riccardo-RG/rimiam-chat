-- Private mailbox capability records are outside the shared Workspace source view.
CREATE TABLE mailbox_connection (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspace(id),person_id text NOT NULL REFERENCES "user"(id),
 provider text NOT NULL,account_ref text NOT NULL,sender text NOT NULL,label text NOT NULL,version integer NOT NULL DEFAULT 1,
 membership_version integer NOT NULL,active boolean NOT NULL DEFAULT true,can_read boolean NOT NULL,can_send boolean NOT NULL,UNIQUE(workspace_id,id)
);
CREATE TABLE mailbox_history (
 workspace_id uuid NOT NULL,connection_id uuid NOT NULL,version integer NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),active boolean NOT NULL,basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,connection_id,version),FOREIGN KEY(workspace_id,connection_id) REFERENCES mailbox_connection(workspace_id,id)
);
CREATE TABLE email_read (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,connection_id uuid NOT NULL,person_id text NOT NULL REFERENCES "user"(id),session_id text NOT NULL,
 membership_version integer NOT NULL,connection_version integer NOT NULL,request jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('QUEUED','READING','COMPLETED','FAILED')),attempt_id uuid,lease_until timestamptz,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES mailbox_connection(workspace_id,id)
);
CREATE TABLE email_observation (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,connection_id uuid NOT NULL,person_id text NOT NULL REFERENCES "user"(id),read_id uuid NOT NULL,data jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,read_id) REFERENCES email_read(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES mailbox_connection(workspace_id,id)
);
CREATE TABLE email_attachment (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,connection_id uuid NOT NULL,person_id text NOT NULL REFERENCES "user"(id),observation_id uuid NOT NULL,
 message_id text NOT NULL,external_id text NOT NULL,filename text NOT NULL,media_type text NOT NULL,content_hash text NOT NULL,bytes bytea NOT NULL CHECK(octet_length(bytes)<=1048576),
 version integer NOT NULL DEFAULT 1,UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,observation_id) REFERENCES email_observation(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES mailbox_connection(workspace_id,id)
);
CREATE TABLE email_draft (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspace(id),person_id text NOT NULL REFERENCES "user"(id),current_version integer NOT NULL,UNIQUE(workspace_id,id)
);
CREATE TABLE email_draft_version (
 workspace_id uuid NOT NULL,draft_id uuid NOT NULL,version integer NOT NULL,connection_id uuid,connection_version integer,
 envelope jsonb NOT NULL,envelope_hash text NOT NULL,reason text NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,draft_id,version),FOREIGN KEY(workspace_id,draft_id) REFERENCES email_draft(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES mailbox_connection(workspace_id,id)
);
CREATE TABLE email_send (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,draft_id uuid NOT NULL,draft_version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('PROPOSED','AUTHORIZED','EXECUTING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN','REJECTED')),
 authorization_id uuid,attempt_id uuid,lease_until timestamptz,error_code text,safe_to_retry boolean NOT NULL DEFAULT false,receipt jsonb,
 UNIQUE(workspace_id,id),UNIQUE(draft_id,draft_version),FOREIGN KEY(workspace_id,draft_id,draft_version) REFERENCES email_draft_version(workspace_id,draft_id,version)
);
CREATE TABLE email_authorization (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,action_id uuid NOT NULL,draft_version integer NOT NULL,envelope_hash text NOT NULL,person_id text NOT NULL REFERENCES "user"(id),
 session_id text NOT NULL,membership_version integer NOT NULL,context_revision integer NOT NULL,access_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,action_id) REFERENCES email_send(workspace_id,id)
);
ALTER TABLE email_send ADD FOREIGN KEY(workspace_id,authorization_id) REFERENCES email_authorization(workspace_id,id);
CREATE TABLE email_transition (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,action_id uuid NOT NULL,status text NOT NULL,actor_id text REFERENCES "user"(id),authorization_id uuid,attempt_id uuid,detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,action_id) REFERENCES email_send(workspace_id,id),FOREIGN KEY(workspace_id,authorization_id) REFERENCES email_authorization(workspace_id,id)
);
-- Only this disclosure relationship and the precisely selected source cross into shared history.
CREATE TABLE email_disclosure (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,source_id uuid NOT NULL,person_id text NOT NULL REFERENCES "user"(id),observation_id uuid NOT NULL,message_id text NOT NULL,attachment_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id),FOREIGN KEY(workspace_id,observation_id) REFERENCES email_observation(workspace_id,id),FOREIGN KEY(workspace_id,attachment_id) REFERENCES email_attachment(workspace_id,id)
);
CREATE INDEX email_send_recovery ON email_send(status,lease_until);
CREATE INDEX email_read_recovery ON email_read(status,lease_until);
CREATE INDEX email_observation_owner ON email_observation(workspace_id,person_id,observed_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mailbox_history','email_observation','email_attachment','email_draft_version','email_authorization','email_transition','email_disclosure']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t); END LOOP;
END $$;
