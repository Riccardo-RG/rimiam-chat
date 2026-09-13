-- Finite, explicit access arrangements; project authority remains independent.
ALTER TABLE access_relationship ADD COLUMN kind text NOT NULL DEFAULT 'stewardship'
 CHECK(kind IN ('stewardship','invitation_delegate'));
CREATE TABLE access_proposal (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace(id),
 kind text NOT NULL CHECK(kind IN ('stewardship','delegation','revoke')),
 base_access_revision integer NOT NULL, proposed_by text NOT NULL REFERENCES "user"(id),
 reason text NOT NULL, terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version=1),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE access_proposal_target (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, relationship_id uuid NOT NULL,
 holder_id text NOT NULL, base_version integer NOT NULL, active boolean NOT NULL,
 kind text NOT NULL CHECK(kind IN ('stewardship','invitation_delegate')), protected boolean NOT NULL,
 PRIMARY KEY(workspace_id,proposal_id,relationship_id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES access_proposal(workspace_id,id),
 FOREIGN KEY(workspace_id,holder_id) REFERENCES membership(workspace_id,user_id)
);
CREATE TABLE access_proposal_requirement (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('authority','holder')),
 person_id text NOT NULL, participation_id uuid,
 PRIMARY KEY(workspace_id,proposal_id,role,person_id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES access_proposal(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES membership(workspace_id,user_id),
 FOREIGN KEY(workspace_id,participation_id) REFERENCES access_relationship(workspace_id,id),
 CHECK((role='authority')=(participation_id IS NOT NULL))
);
CREATE TABLE access_proposal_approval (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, proposal_id uuid NOT NULL,
 role text NOT NULL, person_id text NOT NULL, session_id text NOT NULL,
 membership_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,proposal_id,role,person_id),
 FOREIGN KEY(workspace_id,proposal_id,role,person_id) REFERENCES access_proposal_requirement(workspace_id,proposal_id,role,person_id)
);
CREATE TABLE access_proposal_adoption (
 workspace_id uuid NOT NULL, proposal_id uuid NOT NULL, adopted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,proposal_id), FOREIGN KEY(workspace_id,proposal_id) REFERENCES access_proposal(workspace_id,id)
);
CREATE TABLE access_version_terms (
 workspace_id uuid NOT NULL, relationship_id uuid NOT NULL, version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('stewardship','invitation_delegate')),
 membership_version integer NOT NULL, proposal_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,relationship_id,version),
 FOREIGN KEY(workspace_id,relationship_id) REFERENCES access_relationship(workspace_id,id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES access_proposal(workspace_id,id)
);
CREATE TABLE access_version_condition (
 workspace_id uuid NOT NULL, relationship_id uuid NOT NULL, version integer NOT NULL,
 required_participation_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,relationship_id,version,required_participation_id),
 FOREIGN KEY(workspace_id,relationship_id,version) REFERENCES access_version_terms(workspace_id,relationship_id,version),
 FOREIGN KEY(workspace_id,required_participation_id) REFERENCES access_relationship(workspace_id,id)
);
CREATE INDEX access_proposal_workspace ON access_proposal(workspace_id,created_at);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['access_proposal','access_proposal_target','access_proposal_requirement','access_proposal_approval','access_proposal_adoption','access_version_terms','access_version_condition']
 LOOP EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_historical_mutation()',table_name); END LOOP;
END $$;
