CREATE TABLE message_attachment (
 workspace_id uuid NOT NULL,
 message_id uuid NOT NULL,
 position smallint NOT NULL CHECK(position >= 0),
 source_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,message_id,position),
 UNIQUE(workspace_id,source_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
-- Only a successful upload receipt establishes an original share. A message
-- citing somebody else's file later is not the original publication.
INSERT INTO message_attachment(workspace_id,message_id,position,source_id)
 SELECT r.workspace_id,m.id,0,s.id FROM command_receipt r
 JOIN message m ON m.workspace_id=r.workspace_id AND m.id::text=r.result->>'messageId'
 JOIN external_source s ON s.workspace_id=r.workspace_id AND s.id::text=r.result->>'sourceId'
 WHERE r.result ? 'documentId' AND s.kind='document';
CREATE TABLE library_favorite (
 workspace_id uuid NOT NULL,
 user_id text NOT NULL REFERENCES "user"(id),
 source_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,user_id,source_id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES source_identity(workspace_id,id)
);
