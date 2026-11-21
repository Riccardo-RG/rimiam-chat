-- Optional delivery preferences, not authority or canonical project state.
CREATE TABLE web_push_device (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id),
 session_id text REFERENCES session(id) ON DELETE SET NULL,
 endpoint_hash text NOT NULL UNIQUE, encrypted_subscription text NOT NULL,
 vapid_key_hash text NOT NULL, version integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_push_opt_in (
 device_id uuid NOT NULL REFERENCES web_push_device(id),
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 membership_version integer NOT NULL, version integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT true, opted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,workspace_id)
);
CREATE TABLE web_push_delivery (
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES web_push_device(id),
 device_version integer NOT NULL, preference_version integer NOT NULL,
 workspace_id uuid NOT NULL, revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('message','result','work.completed','work.needs_input','followup')),
 reference_id uuid NOT NULL, reference_version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','submitted','suppressed','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(workspace_id,revision) REFERENCES workspace_change(workspace_id,revision),
 UNIQUE(device_id,workspace_id,revision)
);
CREATE INDEX web_push_due ON web_push_delivery(next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX web_push_workspace_opt_in ON web_push_opt_in(workspace_id) WHERE enabled;
