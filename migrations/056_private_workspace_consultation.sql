CREATE TABLE private_workspace_consultation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  actor_id text NOT NULL REFERENCES "user"(id),
  admission integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('context','recap')),
  question text NOT NULL,
  anchor_id uuid,
  selected_through integer NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK(status IN ('running','ready','failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  answer text,
  references_json jsonb NOT NULL DEFAULT '[]',
  personal_message_ids uuid[] NOT NULL DEFAULT '{}',
  shared_message_id uuid,
  FOREIGN KEY (workspace_id,anchor_id) REFERENCES message(workspace_id,id),
  FOREIGN KEY (workspace_id,shared_message_id) REFERENCES message(workspace_id,id)
);
CREATE INDEX private_consultation_latest ON private_workspace_consultation(actor_id,workspace_id,kind,created_at DESC);
-- Public citations contain only the intentionally shared references. The
-- private question and individually addressed messages never enter projections.
CREATE TABLE consultation_public_citation (
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  position integer NOT NULL,
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  target_version integer NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (workspace_id,message_id,position),
  FOREIGN KEY (workspace_id,message_id) REFERENCES message(workspace_id,id)
);
