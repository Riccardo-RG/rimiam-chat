-- Email-only invitations retain their existing recipient semantics. A personal
-- contact selection also binds admission to the specific account selected.
ALTER TABLE invitation ADD COLUMN recipient_contact_id text REFERENCES "user"(id);
