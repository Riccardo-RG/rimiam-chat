-- Preserve the exact proposal adopted; 011 has already been applied and is immutable.
ALTER TABLE task_version ADD COLUMN adopted_proposal_id uuid;
ALTER TABLE task_version ADD FOREIGN KEY(workspace_id,adopted_proposal_id) REFERENCES task_revision_proposal(workspace_id,id);
