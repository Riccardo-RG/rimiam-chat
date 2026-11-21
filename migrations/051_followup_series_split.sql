-- A future-series edit preserves the original rule until the selected occurrence
-- and starts a separately versioned series. Individual historical deliveries stay put.
CREATE TABLE followup_series_split(
  workspace_id uuid NOT NULL, followup_id uuid NOT NULL, version integer NOT NULL,
  effective_at timestamptz NOT NULL, replacement_id uuid NOT NULL,
  person_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,followup_id,effective_at),
  FOREIGN KEY(workspace_id,followup_id,version) REFERENCES followup_version(workspace_id,followup_id,version),
  FOREIGN KEY(workspace_id,replacement_id) REFERENCES workspace_followup(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON followup_series_split
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
