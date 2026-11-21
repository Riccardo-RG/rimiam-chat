CREATE TABLE personal_research_brief(
 workspace_id uuid NOT NULL, work_id uuid NOT NULL,generation integer NOT NULL,status text NOT NULL CHECK(status IN ('queued','analyzing','ready','failed')),
 attempt uuid,lease_until timestamptz,summary text,cited_ids uuid[] NOT NULL DEFAULT '{}',error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(work_id,generation),
 FOREIGN KEY(workspace_id,work_id) REFERENCES research_work(workspace_id,id)
);
