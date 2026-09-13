ALTER TABLE artifact_version ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE artifact_version ALTER COLUMN question_version DROP NOT NULL;
ALTER TABLE artifact_version ADD CHECK((question_id IS NULL)=(question_version IS NULL));
CREATE TABLE artifact_document (
 workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, artifact_version integer NOT NULL,
 purpose text NOT NULL, blocks jsonb NOT NULL CHECK(jsonb_typeof(blocks)='array'), contribution_id uuid REFERENCES active_work_contribution(id),
 PRIMARY KEY(workspace_id,artifact_id,artifact_version),
 FOREIGN KEY(workspace_id,artifact_id,artifact_version) REFERENCES artifact_version(workspace_id,artifact_id,version)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_document FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
