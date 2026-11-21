-- Personal attention and navigation never advance the shared Workspace revision.
CREATE TABLE conversation_reading (
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  admission integer NOT NULL,
  joined_sequence integer NOT NULL,
  anchor_id uuid,
  anchor_offset integer NOT NULL DEFAULT 0,
  cursor_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,user_id),
  FOREIGN KEY(workspace_id,user_id) REFERENCES membership(workspace_id,user_id),
  FOREIGN KEY(workspace_id,anchor_id) REFERENCES message(workspace_id,id)
);
CREATE TABLE conversation_seen (
  workspace_id uuid NOT NULL, user_id text NOT NULL, admission integer NOT NULL,
  message_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,user_id,admission,message_id),
  FOREIGN KEY(workspace_id,user_id) REFERENCES membership(workspace_id,user_id),
  FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id)
);
-- Earlier clients recorded no reliable visibility. Do not manufacture a backlog
-- of historical unread messages when upgrading an existing installation.
INSERT INTO conversation_reading(workspace_id,user_id,admission,joined_sequence)
SELECT m.workspace_id,m.user_id,m.version,w.next_message FROM membership m
JOIN workspace w ON w.id=m.workspace_id WHERE m.active;
CREATE FUNCTION begin_conversation_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active AND (TG_OP = 'INSERT' OR NOT OLD.active) THEN
    INSERT INTO conversation_reading(workspace_id,user_id,admission,joined_sequence)
    SELECT NEW.workspace_id,NEW.user_id,NEW.version,next_message FROM workspace WHERE id=NEW.workspace_id
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET admission=EXCLUDED.admission,
      joined_sequence=EXCLUDED.joined_sequence,anchor_id=NULL,anchor_offset=0,cursor_version=0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_admission AFTER INSERT OR UPDATE OF active ON membership
FOR EACH ROW EXECUTE FUNCTION begin_conversation_reading();
CREATE TABLE conversation_mention (
  workspace_id uuid NOT NULL, message_id uuid NOT NULL, recipient_id text NOT NULL,
  PRIMARY KEY(workspace_id,message_id,recipient_id),
  FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES membership(workspace_id,user_id)
);
CREATE INDEX conversation_mentions_inbox ON conversation_mention(workspace_id,recipient_id,message_id);
CREATE TABLE conversation_quote (
  workspace_id uuid NOT NULL, message_id uuid NOT NULL, quoted_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,message_id),
  FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
  FOREIGN KEY(workspace_id,quoted_id) REFERENCES message(workspace_id,id),
  CHECK(message_id <> quoted_id)
);
CREATE TABLE conversation_answer_request (
  workspace_id uuid NOT NULL, message_id uuid NOT NULL, recipient_id text NOT NULL,
  requested_by text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  recipient_admission integer NOT NULL, resolved_at timestamptz, reply_id uuid,
  PRIMARY KEY(workspace_id,message_id,recipient_id,recipient_admission),
  FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
  FOREIGN KEY(workspace_id,reply_id) REFERENCES message(workspace_id,id),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES membership(workspace_id,user_id),
  FOREIGN KEY(workspace_id,requested_by) REFERENCES membership(workspace_id,user_id)
);
CREATE INDEX conversation_pending_answers ON conversation_answer_request(workspace_id,recipient_id,recipient_admission) WHERE resolved_at IS NULL;
