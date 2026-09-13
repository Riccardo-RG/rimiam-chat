-- Calendar is a projection of canonical temporal state, not a mirror of a provider.
CREATE TABLE scheduled_event (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 person_id text NOT NULL REFERENCES "user"(id), current_version integer NOT NULL,
 UNIQUE(workspace_id,id)
);
CREATE TABLE scheduled_event_version (
 workspace_id uuid NOT NULL, event_id uuid NOT NULL, version integer NOT NULL,
 title text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 time_zone text NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), reason text NOT NULL,
 source_message_id uuid, created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at),
 PRIMARY KEY(workspace_id,event_id,version),
 FOREIGN KEY(workspace_id,event_id) REFERENCES scheduled_event(workspace_id,id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES message(workspace_id,id)
);
-- Timing belongs to the existing adopted commitment; it is not another appointment identity.
CREATE TABLE commitment_time (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, current_version integer NOT NULL,
 PRIMARY KEY(workspace_id,proposal_id), FOREIGN KEY(workspace_id,proposal_id) REFERENCES normative_proposal(workspace_id,id)
);
CREATE TABLE commitment_time_version (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, version integer NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, time_zone text NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at), PRIMARY KEY(workspace_id,proposal_id,version),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES commitment_time(workspace_id,proposal_id)
);
-- Private external access metadata, excluded from the ordinary shared history boundary.
-- No credentials or client-supplied provider subjects; adapters resolve secrets server-side.
CREATE TABLE calendar_connection (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), person_id text NOT NULL REFERENCES "user"(id),
 provider text NOT NULL, external_account_ref text NOT NULL, label text NOT NULL,
 version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
 membership_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE calendar_connection_history (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, version integer NOT NULL,
 actor_id text NOT NULL REFERENCES "user"(id), active boolean NOT NULL, basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,connection_id,version),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES calendar_connection(workspace_id,id)
);
CREATE TABLE calendar_resource (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL,
 label text NOT NULL, version integer NOT NULL DEFAULT 1, can_read boolean NOT NULL, can_write_self boolean NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES calendar_connection(workspace_id,id)
);
CREATE TABLE calendar_action (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id), current_version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('PROPOSED','AUTHORIZED','EXECUTING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN','REJECTED')),
 authorization_id uuid, attempt_id uuid, lease_until timestamptz, error_code text,
 safe_to_retry boolean NOT NULL DEFAULT false, external_id text, UNIQUE(workspace_id,id)
);
CREATE TABLE calendar_action_version (
 workspace_id uuid NOT NULL, action_id uuid NOT NULL, version integer NOT NULL,
 connection_id uuid NOT NULL, connection_version integer NOT NULL, resource_id uuid NOT NULL, resource_version integer NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id), proposed_by text NOT NULL REFERENCES "user"(id), target_label text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('create','update')), publication_id uuid,
 temporal_kind text CHECK(temporal_kind IN ('scheduled_event','commitment')), temporal_id uuid, temporal_version integer,
 payload jsonb NOT NULL, expected_external_revision text, external_id text,
 reason text NOT NULL, source_message_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,action_id,version),
 FOREIGN KEY(workspace_id,action_id) REFERENCES calendar_action(workspace_id,id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES calendar_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES calendar_resource(workspace_id,id),
 FOREIGN KEY(workspace_id,source_message_id) REFERENCES message(workspace_id,id),
 CHECK((temporal_kind IS NULL AND temporal_id IS NULL AND temporal_version IS NULL) OR
       (temporal_kind IS NOT NULL AND temporal_id IS NOT NULL AND temporal_version>0)),
 CHECK((operation='create' AND publication_id IS NULL AND external_id IS NULL AND expected_external_revision IS NULL) OR
       (operation='update' AND publication_id IS NOT NULL AND external_id IS NOT NULL AND expected_external_revision IS NOT NULL))
);
CREATE TABLE calendar_authorization (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, action_id uuid NOT NULL, action_version integer NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id), session_id text NOT NULL,
 membership_version integer NOT NULL, context_revision integer NOT NULL, access_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,action_id,action_version) REFERENCES calendar_action_version(workspace_id,action_id,version)
);
ALTER TABLE calendar_action ADD FOREIGN KEY(workspace_id,authorization_id) REFERENCES calendar_authorization(workspace_id,id);
CREATE TABLE calendar_transition (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, action_id uuid NOT NULL, action_version integer NOT NULL,
 status text NOT NULL, actor_id text REFERENCES "user"(id), authorization_id uuid, attempt_id uuid,
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,action_id,action_version) REFERENCES calendar_action_version(workspace_id,action_id,version),
 FOREIGN KEY(workspace_id,authorization_id) REFERENCES calendar_authorization(workspace_id,id)
);
CREATE TABLE calendar_publication (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connection_id uuid NOT NULL, resource_id uuid NOT NULL,
 temporal_kind text, temporal_id uuid, temporal_version integer,
 external_id text NOT NULL, external_revision text NOT NULL, published_payload jsonb NOT NULL, action_id uuid NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(connection_id,resource_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES calendar_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES calendar_resource(workspace_id,id),
 FOREIGN KEY(workspace_id,action_id) REFERENCES calendar_action(workspace_id,id)
);
CREATE UNIQUE INDEX calendar_one_representation ON calendar_publication(connection_id,resource_id,temporal_kind,temporal_id) WHERE temporal_id IS NOT NULL;
ALTER TABLE calendar_action_version ADD FOREIGN KEY(workspace_id,publication_id) REFERENCES calendar_publication(workspace_id,id);
CREATE TABLE calendar_publication_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, publication_id uuid NOT NULL, action_id uuid NOT NULL,
 action_version integer NOT NULL, external_revision text NOT NULL, payload jsonb NOT NULL,
 temporal_version integer, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES calendar_publication(workspace_id,id),
 FOREIGN KEY(workspace_id,action_id,action_version) REFERENCES calendar_action_version(workspace_id,action_id,version)
);
CREATE TABLE calendar_read (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connection_id uuid NOT NULL, resource_id uuid NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id), session_id text NOT NULL, membership_version integer NOT NULL,
 connection_version integer NOT NULL, resource_version integer NOT NULL,
 mode text NOT NULL CHECK(mode IN ('events','availability','reconcile')),
 starts_at timestamptz, ends_at timestamptz, cursor text, action_id uuid, action_version integer,
 status text NOT NULL CHECK(status IN ('QUEUED','READING','COMPLETED','FAILED')), attempt_id uuid, lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES calendar_connection(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES calendar_resource(workspace_id,id),
 FOREIGN KEY(workspace_id,action_id,action_version) REFERENCES calendar_action_version(workspace_id,action_id,version)
);
CREATE TABLE calendar_observation (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, read_id uuid NOT NULL, resource_id uuid NOT NULL,
 person_id text NOT NULL REFERENCES "user"(id), data jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,read_id) REFERENCES calendar_read(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES calendar_resource(workspace_id,id)
);
CREATE INDEX calendar_action_recovery ON calendar_action(status,lease_until);
CREATE INDEX calendar_read_recovery ON calendar_read(status,lease_until);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['scheduled_event_version','commitment_time_version','calendar_connection_history','calendar_action_version','calendar_authorization','calendar_transition','calendar_publication_history','calendar_observation']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',table_name); END LOOP;
END $$;
