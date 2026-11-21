ALTER TABLE private_workspace_consultation
  DROP CONSTRAINT private_workspace_consultation_kind_check,
  ADD CHECK (kind IN ('context','recap','document')),
  ADD COLUMN document_workspace_id uuid,
  ADD COLUMN document_source_id uuid,
  ADD FOREIGN KEY (document_workspace_id,document_source_id) REFERENCES external_source(workspace_id,id) MATCH FULL,
  ADD CHECK (document_source_id IS NULL OR kind='document'),
  ADD UNIQUE (document_workspace_id,document_source_id);
