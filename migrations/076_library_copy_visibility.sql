-- A person who explicitly shared or saved an independent copy controls the
-- copy's visibility in its destination. Its source retains its own lifecycle.
-- Record this with the copy, including writes from an older application
-- process during a rolling release.
CREATE FUNCTION start_library_copy_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_visibility_event(workspace_id,source_id,version,withdrawn,actor_id,created_at)
  SELECT s.workspace_id,s.id,1,false,s.contributed_by,s.created_at
  FROM external_source s
  WHERE (s.workspace_id,s.id,s.contributed_by)=(NEW.workspace_id,NEW.source_id,NEW.copied_by)
    AND s.kind='document';
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_copy_visibility AFTER INSERT ON library_copy_origin
FOR EACH ROW EXECUTE FUNCTION start_library_copy_visibility();

INSERT INTO document_visibility_event(workspace_id,source_id,version,withdrawn,actor_id,created_at)
SELECT s.workspace_id,s.id,1,false,s.contributed_by,s.created_at
FROM library_copy_origin c
JOIN external_source s ON (s.workspace_id,s.id,s.contributed_by)=(c.workspace_id,c.source_id,c.copied_by)
WHERE s.kind='document'
  AND NOT EXISTS (
    SELECT 1 FROM document_visibility_event v
    WHERE (v.workspace_id,v.source_id)=(s.workspace_id,s.id)
  );
