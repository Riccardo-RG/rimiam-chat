-- Private AI suggestions are inspectable source material, never send authorizations.
CREATE TABLE email_composition (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 draft_id uuid NOT NULL,
 draft_version integer NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id),
 instruction text NOT NULL,
 suggestion jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,draft_id,draft_version) REFERENCES email_draft_version(workspace_id,draft_id,version)
);
ALTER TABLE email_draft_version ADD COLUMN composition_id uuid;
ALTER TABLE email_draft_version ADD CONSTRAINT email_version_composition_fk FOREIGN KEY(workspace_id,composition_id) REFERENCES email_composition(workspace_id,id);
CREATE TRIGGER immutable_email_composition BEFORE UPDATE OR DELETE ON email_composition FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
