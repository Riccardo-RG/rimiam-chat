-- Navigation only. No hierarchy, context inheritance, cross-space retrieval or authority grant.
CREATE TABLE workspace_link (
 first_workspace uuid NOT NULL REFERENCES workspace(id), second_workspace uuid NOT NULL REFERENCES workspace(id),
 current_version integer NOT NULL CHECK(current_version>0), active boolean NOT NULL,
 PRIMARY KEY(first_workspace,second_workspace), CHECK(first_workspace<second_workspace)
);
CREATE TABLE workspace_link_version (
 first_workspace uuid NOT NULL, second_workspace uuid NOT NULL, version integer NOT NULL,
 active boolean NOT NULL, actor_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(first_workspace,second_workspace,version),
 FOREIGN KEY(first_workspace,second_workspace) REFERENCES workspace_link(first_workspace,second_workspace)
);
CREATE TRIGGER workspace_link_version_immutable BEFORE UPDATE OR DELETE ON workspace_link_version FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation();
