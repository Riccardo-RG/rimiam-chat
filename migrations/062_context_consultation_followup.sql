ALTER TABLE private_workspace_consultation
  ADD COLUMN parent_id uuid,
  ADD UNIQUE (workspace_id,actor_id,admission,kind,id),
  ADD CHECK (parent_id IS NULL OR (kind='context' AND parent_id<>id)),
  ADD FOREIGN KEY (workspace_id,actor_id,admission,kind,parent_id)
    REFERENCES private_workspace_consultation(workspace_id,actor_id,admission,kind,id);
