-- Record the exact retained source separately from its independent copy.
-- Workspace-wide snapshots must not expose the origin to new audiences.
CREATE TABLE library_copy_origin (
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  origin_workspace_id uuid NOT NULL,
  origin_source_id uuid NOT NULL,
  copied_by text NOT NULL REFERENCES "user"(id),
  PRIMARY KEY (workspace_id,source_id),
  FOREIGN KEY (workspace_id,source_id) REFERENCES external_source(workspace_id,id),
  FOREIGN KEY (origin_workspace_id,origin_source_id) REFERENCES external_source(workspace_id,id),
  CHECK(workspace_id <> origin_workspace_id)
);
