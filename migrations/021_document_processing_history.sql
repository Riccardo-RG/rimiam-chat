-- Per-attempt outcomes remain inspectable after retry/recovery changes current state.
CREATE TABLE document_processing_event (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,source_id uuid NOT NULL,
 attempt_id uuid REFERENCES document_extraction_attempt(id),
 actor_id text REFERENCES "user"(id),kind text NOT NULL CHECK(kind IN ('started','published','superseded','access_ended','failed','recovered','retry_requested')),
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,source_id) REFERENCES external_source(workspace_id,id)
);
CREATE INDEX document_processing_event_source ON document_processing_event(workspace_id,source_id,created_at,id);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON document_processing_event FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
