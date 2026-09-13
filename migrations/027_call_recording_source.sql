-- Pin the exact object version and hash independently from transcription success.
CREATE TABLE call_recording_source (
 recording_id uuid PRIMARY KEY REFERENCES call_recording(id), object_version text NOT NULL,
 byte_length bigint NOT NULL CHECK(byte_length>0), sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON call_recording_source FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();

-- A confirmed transport removal fences subsequent capture even when the egress outcome is unknown.
ALTER TABLE call_recording ADD COLUMN capture_fenced_at timestamptz;
