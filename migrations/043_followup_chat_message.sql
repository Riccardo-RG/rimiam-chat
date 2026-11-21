-- Future, valid reminder deliveries can publish one deterministic shared chat
-- message. Historical receipts stay unchanged and never trigger backfill.
ALTER TABLE message DROP CONSTRAINT message_purpose_check,
 ADD CONSTRAINT message_purpose_check CHECK (
   purpose IN ('conversation','workspace_introduction','workspace_welcome','followup_reminder')
 ),
 ADD CONSTRAINT message_followup_actor CHECK (
   purpose<>'followup_reminder' OR (actor_kind='miriam' AND reply_to_source_id IS NULL)
 );
ALTER TABLE followup_delivery ADD COLUMN message_id uuid,
 ADD FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 ADD CHECK (message_id IS NULL OR outcome='delivered');
CREATE UNIQUE INDEX followup_delivery_message ON followup_delivery(workspace_id,message_id)
 WHERE message_id IS NOT NULL;
-- Keep already-queued personal reminder pushes identifiable at dispatch.
ALTER TABLE web_push_delivery DROP CONSTRAINT web_push_delivery_kind_check,
 ADD CONSTRAINT web_push_delivery_kind_check CHECK (
   kind IN ('message','result','work.completed','work.needs_input','followup','followup.chat')
 );
