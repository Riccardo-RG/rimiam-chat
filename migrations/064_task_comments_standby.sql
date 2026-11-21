ALTER TABLE task_version
 DROP CONSTRAINT task_version_status_check,
 ADD CONSTRAINT task_version_status_check
 CHECK(status IN ('open','in_progress','standby','completed','cancelled'));

CREATE TABLE task_comment (
 workspace_id uuid NOT NULL,
 task_id uuid NOT NULL,
 position integer NOT NULL CHECK(position > 0),
 id uuid NOT NULL UNIQUE,
 task_version integer NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,task_id,position),
 FOREIGN KEY(workspace_id,task_id,task_version)
  REFERENCES task_version(workspace_id,task_id,version)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON task_comment
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
