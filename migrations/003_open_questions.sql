CREATE TABLE open_question (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), current_version integer NOT NULL,
 UNIQUE(workspace_id,id)
);
CREATE TABLE question_version (
 workspace_id uuid NOT NULL, question_id uuid NOT NULL, version integer NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 status text NOT NULL CHECK(status IN ('open','answered')),
 source_id uuid NOT NULL, candidate_id uuid,
 recorded_by text NOT NULL REFERENCES "user"(id), reason text NOT NULL,
 answer_information_id uuid, answer_information_version integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,question_id,version),
 FOREIGN KEY(workspace_id,question_id) REFERENCES open_question(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES candidate(workspace_id,id),
 FOREIGN KEY(workspace_id,answer_information_id,answer_information_version) REFERENCES information_version(workspace_id,information_id,version),
 CHECK((status='open' AND answer_information_id IS NULL AND answer_information_version IS NULL)
 OR (status='answered' AND answer_information_id IS NOT NULL AND answer_information_version IS NOT NULL))
);
ALTER TABLE open_question ADD FOREIGN KEY(workspace_id,id,current_version) REFERENCES question_version(workspace_id,question_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON question_version FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
ALTER TABLE research_work ADD COLUMN question_id uuid, ADD COLUMN question_version integer;
ALTER TABLE research_work ADD CHECK((question_id IS NULL)=(question_version IS NULL));
ALTER TABLE research_work ADD FOREIGN KEY(workspace_id,question_id,question_version) REFERENCES question_version(workspace_id,question_id,version);
ALTER TABLE candidate DROP CONSTRAINT candidate_classification_check;
ALTER TABLE candidate ADD CHECK(classification IN ('descriptive','normative','uncertain','question'));
