-- Introductions are immutable Conversation sources, not a second description domain.
ALTER TABLE message ADD COLUMN purpose text NOT NULL DEFAULT 'conversation'
 CHECK(purpose IN ('conversation','workspace_introduction','workspace_welcome'));
ALTER TABLE message ADD CONSTRAINT message_purpose_actor CHECK
 ((purpose<>'workspace_introduction' OR actor_kind='human') AND
  (purpose<>'workspace_welcome' OR actor_kind='miriam'));
CREATE UNIQUE INDEX one_workspace_introduction ON message(workspace_id)
 WHERE purpose='workspace_introduction';
CREATE UNIQUE INDEX one_workspace_welcome ON message(workspace_id)
 WHERE purpose='workspace_welcome';

-- AI organization is a proposal until explicitly activated. Legacy human creation
-- is the existing explicit act; no consent is fabricated for AI-created groups.
ALTER TABLE workstream ADD COLUMN state text NOT NULL DEFAULT 'proposed'
 CHECK(state IN ('proposed','active','resolved','archived'));
UPDATE workstream w SET state='active' WHERE EXISTS
 (SELECT 1 FROM workstream_version v WHERE v.workspace_id=w.workspace_id
  AND v.workstream_id=w.id AND v.version=1 AND v.origin='human');
-- NULL on historical versions means lifecycle was not recorded at that time.
-- Do not rewrite immutable history or manufacture a historical transition/actor.
ALTER TABLE workstream_version ADD COLUMN lifecycle_state text
 CHECK(lifecycle_state IN ('proposed','active','resolved','archived'));
ALTER TABLE workstream_version ADD COLUMN lifecycle_action text
 CHECK(lifecycle_action IN ('activate','resolve','archive','reopen'));
CREATE INDEX workstream_by_state ON workstream(workspace_id,state,id);
