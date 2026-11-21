ALTER TABLE message DROP CONSTRAINT message_purpose_check,
 ADD CONSTRAINT message_purpose_check CHECK (purpose IN ('conversation','workspace_introduction','workspace_welcome','followup_reminder','task_offer')),
 ADD CHECK(purpose<>'task_offer' OR actor_kind='human');
CREATE TABLE task_offer_message(
 workspace_id uuid NOT NULL, task_id uuid NOT NULL, version integer NOT NULL, message_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,task_id,version), UNIQUE(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id),
 FOREIGN KEY(workspace_id,task_id,version) REFERENCES task_version(workspace_id,task_id,version)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON task_offer_message
 FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
