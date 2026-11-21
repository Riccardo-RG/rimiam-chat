-- A direct exchange is a separate privacy boundary: it has no Workspace ID,
-- shared Context, interpretations, invitations, or inherited authority.
CREATE TABLE direct_chat (
 id uuid PRIMARY KEY, person_a text NOT NULL REFERENCES "user"(id), person_b text NOT NULL REFERENCES "user"(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), consent_version integer NOT NULL DEFAULT 0,
 UNIQUE(person_a,person_b), CHECK(person_a COLLATE "C" < person_b COLLATE "C")
);
CREATE TABLE direct_reader (
 chat_id uuid NOT NULL REFERENCES direct_chat(id), actor_id text NOT NULL REFERENCES "user"(id),
 consent boolean NOT NULL DEFAULT false, anchor_id uuid, anchor_offset integer NOT NULL DEFAULT 0, cursor_version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(chat_id,actor_id)
);
CREATE TABLE direct_message (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL, sender_id text NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 body text NOT NULL, sent_at timestamptz NOT NULL DEFAULT clock_timestamp(), payload_hash text NOT NULL, quote_id uuid,
 UNIQUE(chat_id,id), FOREIGN KEY(chat_id,sender_id) REFERENCES direct_reader(chat_id,actor_id),
 FOREIGN KEY(chat_id,quote_id) REFERENCES direct_message(chat_id,id)
);
ALTER TABLE direct_reader ADD FOREIGN KEY(chat_id,anchor_id) REFERENCES direct_message(chat_id,id);
CREATE INDEX direct_message_chronology ON direct_message(chat_id,ordinal);
CREATE TABLE direct_seen (
 chat_id uuid NOT NULL, actor_id text NOT NULL, message_id uuid NOT NULL,
 PRIMARY KEY(chat_id,actor_id,message_id), FOREIGN KEY(chat_id,actor_id) REFERENCES direct_reader(chat_id,actor_id),
 FOREIGN KEY(chat_id,message_id) REFERENCES direct_message(chat_id,id)
);
CREATE TABLE direct_file (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL, message_id uuid NOT NULL, position smallint NOT NULL,
 filename text NOT NULL, content_type text NOT NULL, original_bytes bytea NOT NULL,
 UNIQUE(chat_id,message_id,position), FOREIGN KEY(chat_id,message_id) REFERENCES direct_message(chat_id,id)
);
CREATE TABLE direct_consent_act (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL, actor_id text NOT NULL, enabled boolean NOT NULL, consent_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(chat_id,consent_version),
 FOREIGN KEY(chat_id,actor_id) REFERENCES direct_reader(chat_id,actor_id)
);
CREATE TABLE direct_recap (
 id uuid PRIMARY KEY, chat_id uuid NOT NULL, actor_id text NOT NULL, consent_version integer NOT NULL,
 through_message uuid NOT NULL, status text NOT NULL CHECK(status IN('processing','ready','failed')),
 body text, source_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(chat_id,actor_id) REFERENCES direct_reader(chat_id,actor_id),
 FOREIGN KEY(chat_id,through_message) REFERENCES direct_message(chat_id,id)
);
CREATE TRIGGER immutable_direct_consent BEFORE UPDATE OR DELETE ON direct_consent_act FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_direct_message BEFORE UPDATE OR DELETE ON direct_message FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_direct_file BEFORE UPDATE OR DELETE ON direct_file FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
ALTER TABLE ai_invocation_admission DROP CONSTRAINT ai_invocation_admission_operation_check;
ALTER TABLE ai_invocation_admission ADD COLUMN direct_chat_id uuid REFERENCES direct_chat(id),
ADD CHECK(workspace_id IS NULL OR direct_chat_id IS NULL),
ADD CHECK(operation IN ('conversation','active_work','vision','transcription','email_composition','direct_recap','private_recap'));
CREATE INDEX ai_admission_direct_time ON ai_invocation_admission(direct_chat_id,admitted_at) WHERE direct_chat_id IS NOT NULL;
