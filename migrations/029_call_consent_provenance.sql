-- Preserve the exact personal consent behind each capture interval. Older records
-- retain NULL epoch rather than inventing approval provenance retroactively.
ALTER TABLE call_event ADD COLUMN recording_epoch integer;
ALTER TABLE call_event ADD CONSTRAINT call_event_workspace_identity UNIQUE(workspace_id,id);
CREATE TABLE call_recording_consent (
 recording_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, consent_event_id uuid NOT NULL,
 FOREIGN KEY(workspace_id,recording_id) REFERENCES call_recording(workspace_id,id),
 FOREIGN KEY(workspace_id,consent_event_id) REFERENCES call_event(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON call_recording_consent FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
