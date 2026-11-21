-- Current presentation identity. Source and membership history do not depend on photos.
CREATE TABLE profile_photo (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  image bytea CHECK (octet_length(image) BETWEEN 1 AND 256000),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE workspace_photo (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  image bytea CHECK (octet_length(image) BETWEEN 1 AND 256000),
  changed_by text NOT NULL REFERENCES "user"(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
