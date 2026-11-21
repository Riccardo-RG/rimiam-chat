-- Contact details are read on demand in an authorized conversation.
CREATE TABLE profile_contact (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  phone varchar(32),
  version integer NOT NULL CHECK (version > 0)
);
