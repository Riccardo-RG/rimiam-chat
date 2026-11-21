-- Existing bookmarks were saved against the top of the viewport.
ALTER TABLE conversation_reading ADD COLUMN anchor_at_bottom boolean NOT NULL DEFAULT false;
ALTER TABLE direct_reader ADD COLUMN anchor_at_bottom boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION begin_conversation_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active AND (TG_OP = 'INSERT' OR NOT OLD.active) THEN
    INSERT INTO conversation_reading(workspace_id,user_id,admission,joined_sequence)
    SELECT NEW.workspace_id,NEW.user_id,NEW.version,next_message FROM workspace WHERE id=NEW.workspace_id
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET admission=EXCLUDED.admission,
      joined_sequence=EXCLUDED.joined_sequence,anchor_id=NULL,anchor_offset=0,anchor_at_bottom=false,cursor_version=0;
  END IF;
  RETURN NEW;
END $$;
