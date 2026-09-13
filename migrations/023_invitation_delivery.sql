-- Invitation delivery is an explicit access operation, separate from account mail and Workspace Email.
CREATE TABLE invitation_delivery (
 invitation_id uuid PRIMARY KEY REFERENCES invitation(id),
 encrypted_link text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','needs_configuration','running','submitted','unknown','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, committed_at timestamptz, encrypted_payload text,
 provider_delivery_id text, error_code text, submitted_at timestamptz,
 CHECK ((committed_at IS NULL) = (encrypted_payload IS NULL))
);
CREATE INDEX invitation_delivery_pending ON invitation_delivery(status,lease_until);
CREATE TABLE invitation_delivery_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 invitation_id uuid NOT NULL REFERENCES invitation_delivery(invitation_id),
 attempt integer NOT NULL, status text NOT NULL, error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_invitation_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invitation delivery history is immutable'; END IF;
 IF NEW.invitation_id IS DISTINCT FROM OLD.invitation_id OR NEW.encrypted_link IS DISTINCT FROM OLD.encrypted_link
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR (OLD.committed_at IS NOT NULL AND (NEW.committed_at IS DISTINCT FROM OLD.committed_at OR NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload)) THEN
 RAISE EXCEPTION 'Invitation delivery provenance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invitation_delivery_identity BEFORE UPDATE OR DELETE ON invitation_delivery FOR EACH ROW EXECUTE FUNCTION guard_invitation_delivery();
CREATE TRIGGER invitation_delivery_event_immutable BEFORE UPDATE OR DELETE ON invitation_delivery_event FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
