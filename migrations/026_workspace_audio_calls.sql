-- Call control is operational access, never project authority. Audio consent is personal.
CREATE TABLE audio_call (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','ended')),
 recording_requested boolean NOT NULL DEFAULT false, recording_epoch integer NOT NULL DEFAULT 0,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_open_audio_call ON audio_call(workspace_id) WHERE state='open';
CREATE TABLE call_participant (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, call_id uuid NOT NULL, user_id text NOT NULL REFERENCES "user"(id),
 membership_version integer NOT NULL, state text NOT NULL CHECK(state IN ('waiting','admitted','leaving','left')),
 consent_epoch integer, joined_at timestamptz NOT NULL DEFAULT now(), heartbeat_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
 FOREIGN KEY(workspace_id,call_id) REFERENCES audio_call(workspace_id,id), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_call_participation ON call_participant(call_id,user_id) WHERE state<>'left';
CREATE TABLE call_event (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, call_id uuid NOT NULL, version integer NOT NULL,
 actor_id text REFERENCES "user"(id), participant_id uuid REFERENCES call_participant(id), kind text NOT NULL,
 consent_text text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,call_id) REFERENCES audio_call(workspace_id,id), UNIQUE(call_id,version)
);
CREATE TABLE call_recording (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, call_id uuid NOT NULL, participant_id uuid NOT NULL,
 consent_epoch integer NOT NULL, track_id text NOT NULL, object_key text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('prepared','starting','active','stopping','complete','failed','unknown')),
 egress_id text UNIQUE, error_code text, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 FOREIGN KEY(workspace_id,call_id) REFERENCES audio_call(workspace_id,id),
 FOREIGN KEY(workspace_id,participant_id) REFERENCES call_participant(workspace_id,id), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_track_recording ON call_recording(participant_id,track_id) WHERE state NOT IN ('complete','failed');
CREATE TABLE call_transcription (
 recording_id uuid PRIMARY KEY REFERENCES call_recording(id), workspace_id uuid NOT NULL REFERENCES workspace(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed','needs_configuration')),
 attempt_id uuid, lease_until timestamptz, error_code text
);
CREATE TABLE call_transcript_segment (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, recording_id uuid NOT NULL, ordinal integer NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 200000), provider text NOT NULL, qualification text NOT NULL,
 audio_hash text NOT NULL, start_seconds integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,recording_id) REFERENCES call_recording(workspace_id,id), UNIQUE(recording_id,ordinal)
);
-- Raw call transcripts are intentionally NOT members of workspace_source. An explicit
-- post-call analysis request discloses immutable transcript segments into the normal source pipeline.
CREATE TABLE call_analysis_request (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, call_id uuid NOT NULL, actor_id text NOT NULL REFERENCES "user"(id),
 source_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,call_id) REFERENCES audio_call(workspace_id,id)
);
CREATE TABLE call_analysis_source (
 segment_id uuid PRIMARY KEY REFERENCES call_transcript_segment(id), source_id uuid NOT NULL UNIQUE REFERENCES external_source(id),
 request_id uuid NOT NULL REFERENCES call_analysis_request(id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['call_event','call_transcript_segment','call_analysis_request','call_analysis_source'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t);
 END LOOP;
END $$;
