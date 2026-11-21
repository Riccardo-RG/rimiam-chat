-- Retain the authored request independently of its private or shared destination.
CREATE TABLE conversation_reminder_request(
 workspace_id uuid NOT NULL, message_id uuid NOT NULL, person_id text NOT NULL REFERENCES "user"(id),
 audience text NOT NULL CHECK(audience IN ('personal','space')), content text NOT NULL,
 local_day date, time_zone text NOT NULL, weekdays smallint[], PRIMARY KEY(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES message(workspace_id,id)
);
CREATE TABLE conversation_reminder_result(
 workspace_id uuid NOT NULL, message_id uuid NOT NULL, destination_id uuid NOT NULL, followup_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,message_id), FOREIGN KEY(workspace_id,message_id) REFERENCES conversation_reminder_request(workspace_id,message_id),
 FOREIGN KEY(destination_id,followup_id) REFERENCES workspace_followup(workspace_id,id)
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON conversation_reminder_request FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON conversation_reminder_result FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
