-- Exact private source references for explicitly shared temporal corrections.
-- Retaining a reference does not grant access to the rest of the external observation.
ALTER TABLE scheduled_event_version ADD COLUMN source_observation_id uuid,
 ADD COLUMN source_external_event_id text,
 ADD FOREIGN KEY(workspace_id,source_observation_id) REFERENCES calendar_observation(workspace_id,id),
 ADD CHECK((source_observation_id IS NULL) = (source_external_event_id IS NULL));
ALTER TABLE calendar_action_version ADD COLUMN precondition_observation_id uuid,
 ADD FOREIGN KEY(workspace_id,precondition_observation_id) REFERENCES calendar_observation(workspace_id,id);
