-- The message is immutable human history; transcription is a separately qualified source.
CREATE TABLE voice_message (
 message_id uuid PRIMARY KEY REFERENCES message(id), workspace_id uuid NOT NULL,
 source_id uuid NOT NULL UNIQUE, mode text NOT NULL CHECK(mode IN ('message','miriam')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON voice_message FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
