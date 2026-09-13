-- Miriam is an AI participant, never a fabricated human account. Original messages stay immutable.
ALTER TABLE message ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE message ADD COLUMN actor_kind text NOT NULL DEFAULT 'human'
 CHECK(actor_kind IN ('human','miriam'));
ALTER TABLE message ADD CONSTRAINT message_actor_shape CHECK
 ((actor_kind='human' AND author_id IS NOT NULL) OR (actor_kind='miriam' AND author_id IS NULL));
ALTER TABLE message ADD COLUMN reply_to_source_id uuid;
ALTER TABLE message ADD CONSTRAINT message_reply_source FOREIGN KEY(workspace_id,reply_to_source_id)
 REFERENCES source_identity(workspace_id,id);

CREATE TABLE interpretation_input (
 workspace_id uuid NOT NULL, interpretation_id uuid NOT NULL, generation integer NOT NULL,
 round integer NOT NULL CHECK(round>0), context jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,interpretation_id,generation,round),
 FOREIGN KEY(workspace_id,interpretation_id) REFERENCES interpretation(workspace_id,id)
);
CREATE TABLE interpretation_result (
 workspace_id uuid NOT NULL, interpretation_id uuid NOT NULL, generation integer NOT NULL,
 round integer NOT NULL, output jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,interpretation_id,generation,round),
 FOREIGN KEY(workspace_id,interpretation_id,generation,round)
 REFERENCES interpretation_input(workspace_id,interpretation_id,generation,round)
);
CREATE TABLE miriam_response (
 workspace_id uuid NOT NULL, message_id uuid NOT NULL, interpretation_id uuid NOT NULL,
 generation integer NOT NULL, source_ids uuid[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(workspace_id,message_id), UNIQUE(workspace_id,interpretation_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,interpretation_id) REFERENCES interpretation(workspace_id,id)
);
CREATE TABLE collaboration_preference (
 workspace_id uuid NOT NULL REFERENCES workspace(id), version integer NOT NULL,
 mode text NOT NULL CHECK(mode IN ('discreet','collaborative','proactive')),
 actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['interpretation_input','interpretation_result','miriam_response','collaboration_preference']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t); END LOOP;
END $$;
