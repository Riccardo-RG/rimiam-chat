import type { ArtifactBlock } from "./artifact-document.ts";
// Legacy web projection contract; no imports from server implementation.
export interface ArtifactVersion {
  workspace_id: string;
  artifact_id: string;
  version: number;
  title: string;
  notes: string;
  body: string;
  authored_by: string;
  origin: string;
  generator: string;
  provider: string | null;
  model: string | null;
  question_id: string | null;
  question_version: number | null;
  purpose?: string | null;
  blocks?: ArtifactBlock[] | null;
  contribution_id?: string | null;
  goal_id: string | null;
  goal_version: number | null;
  context_revision: number;
  created_at: string;
  reason: string;
}

export interface ArtifactSnapshot {
  artifacts: {
    id: string;
    current_draft_version: number;
    current_adoption_id: string | null;
  }[];
  artifactVersions: (ArtifactVersion & { outdated_reasons: string[] })[];
  artifactReviews: {
    id: string;
    artifact_id: string;
    artifact_version: number;
    previous_adoption_id: string | null;
    proposed_by: string;
    people: string[];
    created_at: string;
  }[];
  artifactApprovals: {
    id: string;
    review_id: string;
    person_id: string;
    access_revision: number;
    created_at: string;
  }[];
  artifactAdoptions: {
    id: string;
    artifact_id: string;
    review_id: string;
    created_at: string;
  }[];
  artifactInformation: {
    artifact_id: string;
    artifact_version: number;
    information_id: string;
    information_version: number;
  }[];
  artifactSources: {
    artifact_id: string;
    artifact_version: number;
    source_id: string;
    explicitly_selected: boolean;
  }[];
}

export interface Candidate {
  id: string;
  interpretation_id: string;
  source_id: string;
  subject: string;
  content: string;
  classification: "descriptive" | "normative" | "uncertain" | "question";
  origin: string;
  qualification: string;
  context_revision: number;
  author_name: string;
  source_content: string;
  source_ids: string[];
  created_at: string;
}
export interface QuestionVersion {
  question_id: string;
  version: number;
  content: string;
  status: "open" | "answered";
  source_id: string;
  candidate_id: string | null;
  recorded_by: string;
  reason: string;
  answer_information_id: string | null;
  answer_information_version: number | null;
  created_at: string;
}
export interface Snapshot extends ArtifactSnapshot {
  questions: (QuestionVersion & { id: string })[];
  questionHistory: QuestionVersion[];
  sources: {
    id: string;
    kind: "document" | "web";
    title: string;
    content: string;
    contributed_by: string;
    qualification: string;
    content_hash: string;
    created_at: string;
    document_id: string | null;
    document_version: number | null;
    previous_source_id: string | null;
    filename: string | null;
    url: string | null;
    provider: string | null;
    work_id: string | null;
    media_type?: string | null;
    processing_status?: string | null;
    processing_error?: string | null;
    extraction_id?: string | null;
    processing_history?: {
      id: string;
      attempt_id: string | null;
      actor_id: string | null;
      kind: string;
      error_code: string | null;
      created_at: string;
    }[];
    extraction_provider?: string | null;
    extraction_hash?: string | null;
    extracted_at?: string | null;
  }[];
  research: {
    id: string;
    requested_by: string;
    request_source_id: string;
    query: string;
    status: string;
    generation: number;
    error_code: string | null;
    created_at: string;
  }[];
  researchEvents: {
    work_id: string;
    generation: number;
    status: string;
    actor_id: string | null;
    detail: string | null;
    created_at: string;
  }[];
  workspace: {
    id: string;
    name: string;
    revision: number;
    context_revision: number;
    access_revision: number;
  };
  members: {
    user_id: string;
    name: string;
    active: boolean;
    contributes: boolean;
  }[];
  access: {
    id: string;
    holder_id: string;
    version: number;
    active: boolean;
    invitations: boolean;
    remove_members: boolean;
    change_access: boolean;
    protected: boolean;
    basis: string;
  }[];
  goals: {
    id: string;
    content: string;
    current_version: number;
    current_primary: boolean;
    established_by: string;
  }[];
  adherences: {
    goal_id: string;
    goal_version: number;
    user_id: string;
    created_at: string;
  }[];
  messages: {
    id: string;
    content: string;
    author_id: string | null;
    actor_kind: "human" | "miriam";
    citation_source_ids: string[];
    reply_to_source_id: string | null;
    author_name: string;
    created_at: string;
    sequence: number;
  }[];
  candidates: Candidate[];
  information: {
    id: string;
    subject: string;
    current_version: number;
    content: string;
    qualification: string;
    accepted_by: string;
    candidate_id: string;
    created_at: string;
  }[];
  versions: {
    information_id: string;
    version: number;
    content: string;
    qualification: string;
    candidate_id: string;
    accepted_by_name: string;
    reason: string;
    created_at: string;
  }[];
  commitments: {
    id: string;
    candidate_id: string | null;
    content: string;
    people: string[];
    context_revision: number;
    adopted_at: string | null;
  }[];
  approvals: {
    proposal_id: string;
    person_id: string;
    context_revision: number;
    access_revision: number;
  }[];
  interpretations: {
    id: string;
    source_id: string;
    status: string;
    error_code: string | null;
  }[];
  links?: import("./workspace-links.ts").WorkspaceLink[];
  invitations: {
    id: string;
    recipient_email: string;
    revoked_at: string | null;
    accepted_at: string | null;
    expires_at: string;
    delivery_status?: string | null;
    delivery_error?: string | null;
  }[];
}
