-- The original personal utility workspace remains the unique account archive.
-- Each additional chat has an independent private workspace, including AI retrieval.
ALTER TABLE workspace ADD COLUMN personal_archive_id uuid REFERENCES workspace(id);
DROP INDEX workspace_personal_owner;
CREATE UNIQUE INDEX workspace_personal_owner ON workspace(personal_owner_id)
 WHERE personal_owner_id IS NOT NULL AND personal_archive_id IS NULL;
CREATE INDEX personal_chat_owner ON workspace(personal_owner_id,created_at) WHERE personal_owner_id IS NOT NULL;
CREATE FUNCTION guard_chat_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.personal_archive_id IS DISTINCT FROM OLD.personal_archive_id THEN
  RAISE EXCEPTION 'A chat cannot change archives';
 END IF;
 IF NEW.personal_archive_id IS NOT NULL AND (NEW.personal_owner_id IS NULL OR NEW.id=NEW.personal_archive_id OR NOT EXISTS(
   SELECT 1 FROM workspace a WHERE a.id=NEW.personal_archive_id AND a.personal_archive_id IS NULL AND a.personal_owner_id=NEW.personal_owner_id
 )) THEN RAISE EXCEPTION 'The chat requires its own account archive'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_archive_binding BEFORE INSERT OR UPDATE OF personal_archive_id ON workspace FOR EACH ROW EXECUTE FUNCTION guard_chat_archive();
CREATE TABLE personal_chat_resume(
 actor_id text PRIMARY KEY REFERENCES "user"(id), thread_id uuid NOT NULL REFERENCES workspace(id)
);
CREATE TABLE personal_chat_consultation(
 thread_id uuid PRIMARY KEY REFERENCES workspace(id), target_id uuid REFERENCES workspace(id), admission integer,
 version integer NOT NULL, CHECK((target_id IS NULL)=(admission IS NULL))
);
CREATE TABLE personal_consultation_turn(
 id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES workspace(id), message_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id), target_id uuid NOT NULL REFERENCES workspace(id), admission integer NOT NULL,
 selection_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(thread_id,message_id),
 FOREIGN KEY(thread_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON personal_consultation_turn FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TABLE personal_research_preference(
 workspace_id uuid NOT NULL,work_id uuid PRIMARY KEY,actor_id text NOT NULL REFERENCES "user"(id), notify boolean NOT NULL,
 read_at timestamptz, origin_id uuid REFERENCES workspace(id),
 FOREIGN KEY(workspace_id,work_id) REFERENCES research_work(workspace_id,id)
);
CREATE TABLE personal_research_publication(
 workspace_id uuid NOT NULL,work_id uuid NOT NULL,generation integer NOT NULL, destination_id uuid NOT NULL,
 message_id uuid NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,work_id,generation,destination_id),
 FOREIGN KEY(workspace_id,work_id) REFERENCES research_work(workspace_id,id),
 FOREIGN KEY(destination_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON personal_research_publication FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
ALTER TABLE web_push_delivery DROP CONSTRAINT web_push_delivery_kind_check,
 ADD CONSTRAINT web_push_delivery_kind_check CHECK(kind IN ('message','result','work.completed','work.needs_input','followup','followup.chat','personal_research'));
