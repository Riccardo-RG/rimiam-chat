-- Audience and responses belong to the exact internal event version. Neither
-- an invitation nor an RSVP grants authority or writes to an external calendar.
ALTER TABLE scheduled_event_version ADD COLUMN audience text NOT NULL DEFAULT 'calendar'
  CHECK (audience IN ('calendar','all','people'));
CREATE TABLE scheduled_event_invitee (
  workspace_id uuid NOT NULL, event_id uuid NOT NULL, version integer NOT NULL,
  person_id text NOT NULL REFERENCES "user"(id), membership_version integer NOT NULL,
  PRIMARY KEY(workspace_id,event_id,version,person_id),
  FOREIGN KEY(workspace_id,event_id,version) REFERENCES scheduled_event_version(workspace_id,event_id,version)
);
CREATE TABLE scheduled_event_response (
  workspace_id uuid NOT NULL, event_id uuid NOT NULL, version integer NOT NULL,
  person_id text NOT NULL REFERENCES "user"(id), membership_version integer NOT NULL,
  response text NOT NULL CHECK(response IN ('accepted','declined')),
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,event_id,version,person_id,membership_version),
  FOREIGN KEY(workspace_id,event_id,version) REFERENCES scheduled_event_version(workspace_id,event_id,version)
);
-- A private dismissal never closes another person's occurrence. A closure or
-- replacement of one date leaves the scheduling rule for the series intact.
CREATE TABLE followup_occurrence_change (
  workspace_id uuid NOT NULL, followup_id uuid NOT NULL, version integer NOT NULL,
  scheduled_at timestamptz NOT NULL, person_id text NOT NULL REFERENCES "user"(id),
  replacement_id uuid, changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,followup_id,version,scheduled_at),
  FOREIGN KEY(workspace_id,followup_id,version) REFERENCES followup_version(workspace_id,followup_id,version),
  FOREIGN KEY(workspace_id,replacement_id) REFERENCES workspace_followup(workspace_id,id)
);
CREATE TABLE followup_occurrence_dismissal (
  workspace_id uuid NOT NULL, followup_id uuid NOT NULL, version integer NOT NULL,
  scheduled_at timestamptz NOT NULL, person_id text NOT NULL REFERENCES "user"(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,followup_id,version,scheduled_at,person_id),
  FOREIGN KEY(workspace_id,followup_id,version) REFERENCES followup_version(workspace_id,followup_id,version)
);
CREATE TABLE task_offer_decline (
  workspace_id uuid NOT NULL, task_id uuid NOT NULL, version integer NOT NULL,
  person_id text NOT NULL REFERENCES "user"(id), declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,task_id,version,person_id),
  FOREIGN KEY(workspace_id,task_id,version) REFERENCES task_version(workspace_id,task_id,version)
);
CREATE INDEX scheduled_event_day ON scheduled_event_version(starts_at, ends_at);
CREATE INDEX followup_delivery_day ON followup_delivery(workspace_id, scheduled_at);
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['scheduled_event_invitee','scheduled_event_response','followup_occurrence_change','followup_occurrence_dismissal','task_offer_decline'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',t);
END LOOP;
END $$;
