-- An account's optional personal utility archive is its own Workspace identity.
-- Existing workspaces keep their shared scope. Personal scope is set on insert.
ALTER TABLE workspace ADD COLUMN personal_owner_id text REFERENCES "user"(id),
 ADD CHECK(personal_owner_id IS NULL OR personal_owner_id=created_by);
CREATE UNIQUE INDEX workspace_personal_owner ON workspace(personal_owner_id) WHERE personal_owner_id IS NOT NULL;
CREATE FUNCTION guard_personal_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id THEN
   RAISE EXCEPTION 'Workspace scope cannot be converted or reassigned';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_personal_scope BEFORE UPDATE OF personal_owner_id ON workspace
 FOR EACH ROW EXECUTE FUNCTION guard_personal_scope();

-- Keep future admission paths and direct persistence writes from admitting
-- another account, granting share capabilities, issuing invites or linking a space.
CREATE FUNCTION guard_personal_participation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
 IF TG_TABLE_NAME='workspace_link' THEN
   IF EXISTS(SELECT 1 FROM workspace WHERE id IN (NEW.first_workspace,NEW.second_workspace) AND personal_owner_id IS NOT NULL) THEN
     RAISE EXCEPTION 'A personal workspace cannot be linked';
   END IF;
 ELSE
   SELECT personal_owner_id INTO owner_id FROM workspace WHERE id=NEW.workspace_id;
   IF owner_id IS NOT NULL THEN
     IF TG_TABLE_NAME='membership' THEN
       IF NEW.user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'Personal membership belongs to its account'; END IF;
     ELSE RAISE EXCEPTION 'A personal workspace cannot be shared';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_membership BEFORE INSERT OR UPDATE OF workspace_id,user_id ON membership
 FOR EACH ROW EXECUTE FUNCTION guard_personal_participation();
CREATE TRIGGER personal_invitation BEFORE INSERT OR UPDATE OF workspace_id ON invitation
 FOR EACH ROW EXECUTE FUNCTION guard_personal_participation();
CREATE TRIGGER personal_access BEFORE INSERT OR UPDATE OF workspace_id ON access_relationship
 FOR EACH ROW EXECUTE FUNCTION guard_personal_participation();
CREATE TRIGGER personal_link BEFORE INSERT OR UPDATE OF first_workspace,second_workspace ON workspace_link
 FOR EACH ROW EXECUTE FUNCTION guard_personal_participation();
