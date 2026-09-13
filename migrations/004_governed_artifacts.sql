-- A bounded research brief. Drafting and adoption never mutate normative domain records.
CREATE TABLE artifact (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 current_draft_version integer NOT NULL, current_adoption_id uuid,
 UNIQUE(workspace_id,id)
);
CREATE TABLE artifact_version (
 workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), notes text NOT NULL,
 body text NOT NULL, authored_by text NOT NULL REFERENCES "user"(id),
 origin text NOT NULL CHECK(origin IN ('reference_compilation','human_revision')),
 generator text NOT NULL, provider text, model text,
 question_id uuid NOT NULL, question_version integer NOT NULL,
 goal_id uuid, goal_version integer, context_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,version),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifact(workspace_id,id),
 FOREIGN KEY(workspace_id,question_id,question_version) REFERENCES question_version(workspace_id,question_id,version),
 FOREIGN KEY(workspace_id,goal_id,goal_version) REFERENCES goal_version(workspace_id,goal_id,version),
 CHECK((goal_id IS NULL)=(goal_version IS NULL))
);
ALTER TABLE artifact ADD FOREIGN KEY(workspace_id,id,current_draft_version) REFERENCES artifact_version(workspace_id,artifact_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE artifact_information (
 workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, artifact_version integer NOT NULL,
 information_id uuid NOT NULL, information_version integer NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,artifact_version,information_id),
 FOREIGN KEY(workspace_id,artifact_id,artifact_version) REFERENCES artifact_version(workspace_id,artifact_id,version),
 FOREIGN KEY(workspace_id,information_id,information_version) REFERENCES information_version(workspace_id,information_id,version)
);
CREATE TABLE artifact_source (
 workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, artifact_version integer NOT NULL,
 source_id uuid NOT NULL, explicitly_selected boolean NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,artifact_version,source_id),
 FOREIGN KEY(workspace_id,artifact_id,artifact_version) REFERENCES artifact_version(workspace_id,artifact_id,version),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
CREATE TABLE artifact_project_basis (
 workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, artifact_version integer NOT NULL, act_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,artifact_version,act_id),
 FOREIGN KEY(workspace_id,artifact_id,artifact_version) REFERENCES artifact_version(workspace_id,artifact_id,version),
 FOREIGN KEY(workspace_id,act_id) REFERENCES project_act(workspace_id,id)
);
CREATE TABLE artifact_review (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, artifact_version integer NOT NULL,
 previous_adoption_id uuid, proposed_by text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,artifact_id,id),
 FOREIGN KEY(workspace_id,artifact_id,artifact_version) REFERENCES artifact_version(workspace_id,artifact_id,version)
);
CREATE TABLE artifact_reviewer (
 workspace_id uuid NOT NULL, review_id uuid NOT NULL, person_id text NOT NULL REFERENCES "user"(id),
 PRIMARY KEY(workspace_id,review_id,person_id),
 FOREIGN KEY(workspace_id,review_id) REFERENCES artifact_review(workspace_id,id)
);
CREATE TABLE artifact_approval (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, review_id uuid NOT NULL, person_id text NOT NULL,
 membership_version integer NOT NULL, access_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,review_id,person_id) REFERENCES artifact_reviewer(workspace_id,review_id,person_id)
);
CREATE TABLE artifact_adoption (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, artifact_id uuid NOT NULL, review_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,artifact_id,id), UNIQUE(workspace_id,review_id),
 FOREIGN KEY(workspace_id,artifact_id,review_id) REFERENCES artifact_review(workspace_id,artifact_id,id)
);
CREATE TABLE artifact_adoption_approval (
 workspace_id uuid NOT NULL, adoption_id uuid NOT NULL, approval_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,adoption_id,approval_id),
 FOREIGN KEY(workspace_id,adoption_id) REFERENCES artifact_adoption(workspace_id,id),
 FOREIGN KEY(workspace_id,approval_id) REFERENCES artifact_approval(workspace_id,id)
);
ALTER TABLE artifact ADD FOREIGN KEY(workspace_id,id,current_adoption_id) REFERENCES artifact_adoption(workspace_id,artifact_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE artifact_review ADD FOREIGN KEY(workspace_id,artifact_id,previous_adoption_id) REFERENCES artifact_adoption(workspace_id,artifact_id,id);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_version FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_information FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_source FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_project_basis FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_review FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_reviewer FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_approval FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_adoption FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON artifact_adoption_approval FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
