-- Retrying delivery may update transport state, never the approved recipient/link content.
CREATE FUNCTION protect_account_delivery_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.deduplication_key,NEW.kind,NEW.recipient,NEW.encrypted_link,NEW.expires_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.deduplication_key,OLD.kind,OLD.recipient,OLD.encrypted_link,OLD.expires_at,OLD.created_at)
 THEN RAISE EXCEPTION 'Account delivery payload is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_payload BEFORE UPDATE ON account_delivery FOR EACH ROW EXECUTE FUNCTION protect_account_delivery_payload();
