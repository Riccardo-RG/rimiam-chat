// This catalog describes shipped forms. It never receives form values or private state.
export const PRODUCT_GUIDE_VERSION = 1;
export const productScreenIds = [
  "conversation",
  "goal",
  "information",
  "commitments",
  "tasks",
  "active_work",
  "workstreams",
  "artifacts",
  "sources",
  "calendar",
  "email",
  "people",
  "workspace_links",
] as const;
export type ProductScreen = (typeof productScreenIds)[number];
export const productIssueIds = [
  "required",
  "invalid",
  "unavailable",
  "stale",
] as const;

export interface ProductField {
  id: string;
  label: string;
  requirement: "required" | "optional" | "conditional";
  explanation: string;
}
interface ProductScreenGuide {
  label: string;
  purpose: string;
  instructions: string;
  fields: readonly ProductField[];
}
export interface ProductAssistanceSnapshot {
  guideVersion: number;
  screen: ProductScreen;
  label: string;
  purpose: string;
  instructions: string;
  field?: ProductField;
  fields?: readonly ProductField[];
  issue?: (typeof productIssueIds)[number];
  issueExplanation?: string;
}
function field(
  id: string,
  label: string,
  requirement: ProductField["requirement"],
  explanation: string,
): ProductField {
  return { id, label, requirement, explanation };
}

export const productScreens = {
  conversation: {
    label: "Conversazione",
    purpose:
      "Converse with the workspace and ask Miriam for explanation or preparation.",
    instructions:
      "A shared message is retained history, not automatic agreement, accepted information or authority. A selected workstream focuses the conversation without moving history.",
    fields: [
      field(
        "content",
        "Messaggio",
        "required",
        "Write the message or the explicit request. Up to 12,000 characters. Product help shares only the selected screen, field and issue; it cannot see unsent form values.",
      ),
    ],
  },
  goal: {
    label: "Goal",
    purpose:
      "Inspect and establish personal initial intent, or prepare a versioned Goal transition.",
    instructions:
      "Initial intent is personal. Other people adhere explicitly to the identified Goal/version. Membership is not adherence or authority. Use the existing form for establishment, changes and approvals; preserve existing obligations.",
    fields: [
      field(
        "content",
        "Il mio intento iniziale / Testo del Goal",
        "conditional",
        "Required to establish initial intent and to propose a revised Goal, replacement or sub-goal. Describe the desired outcome, up to 12,000 characters. Completion and abandonment refer to the existing Goal content.",
      ),
      field(
        "mode",
        "Tipo di modifica",
        "conditional",
        "For an existing Goal choose revision, replacement, sub-goal, completion or abandonment. The authorized change determines continuity of identity; it does not transfer consent.",
      ),
      field(
        "reason",
        "Motivo",
        "conditional",
        "Required for a Goal transition, up to 4,000 characters. Explain the change; the initial Goal form does not ask for this field.",
      ),
      field(
        "affectedPeople",
        "Persone coinvolte",
        "optional",
        "Identify additional affected people when relevant. Selecting a person never supplies their consent or representation.",
      ),
    ],
  },
  information: {
    label: "Informazioni accettate",
    purpose:
      "Accept an exact descriptive candidate or correct an accepted reference with provenance.",
    instructions:
      "Use the existing candidate acceptance or correction action. Editorial acceptance is available to contributing members, independently of project mandates. It does not establish truth, collective agreement, commitments, artifact changes or external permissions.",
    fields: [
      field(
        "reason",
        "Motivo della correzione",
        "conditional",
        "Required when correcting an accepted reference, up to 12,000 characters. Explain why this exact candidate replaces the selected version. History and dissent remain; simple acceptance has no reason field.",
      ),
    ],
  },
  commitments: {
    label: "Impegni",
    purpose:
      "Inspect commitments and propose a precise candidate to named people.",
    instructions:
      "A proposal is not an effective commitment. The existing approval flow validates precise content, current versions and pertinent authority. No person is represented by silence or by being selected.",
    fields: [
      field(
        "people",
        "Persone coinvolte",
        "required",
        "The candidate proposal includes the proposer and any additional selected active members. Each named person approves for themselves through the existing flow. Names do not grant authority.",
      ),
    ],
  },
  tasks: {
    label: "Task e follow-up",
    purpose:
      "Record work to do, explicit version-bound responsibility and personal follow-up.",
    instructions:
      "A new Task is unassigned. A suggested person accepts responsibility explicitly. Material changes to accepted work require fresh acceptance or pertinent authority. Completion and reminders do not satisfy or alter commitments.",
    fields: [
      field(
        "title",
        "Attività",
        "required",
        "Name the work to do, up to 160 characters.",
      ),
      field(
        "description",
        "Perimetro e aspettative",
        "optional",
        "Describe scope and expected output, up to 8,000 characters. An empty description is allowed.",
      ),
      field(
        "dueAt",
        "Scadenza facoltativa",
        "optional",
        "Choose a date and time only when useful; a Task may have no deadline. The form supplies the local time zone.",
      ),
      field(
        "suggestedPerson",
        "Possibile referente — non assegnato",
        "optional",
        "Suggest an active member or leave Nobody selected. This is not assignment or acceptance of responsibility.",
      ),
      field(
        "reason",
        "Motivo della modifica",
        "conditional",
        "Required when modifying a Task, up to 2,000 characters; not required when creating one.",
      ),
      field(
        "followupContent",
        "Cosa ricordare / verificare",
        "conditional",
        "Required for a personal follow-up, up to 2,000 characters. State what to remember or check.",
      ),
      field(
        "remindAt",
        "Quando",
        "conditional",
        "Required for a follow-up. Choose its date and time; this does not create a Task deadline or an external calendar event.",
      ),
    ],
  },
  active_work: {
    label: "Lavoro di Miriam",
    purpose:
      "Inspect persistent exploratory work, provide input and steer its current contract.",
    instructions:
      "Use an explicit request or the existing work controls. Pausing, stopping, resuming or changing an analysis never grants authority, adopts a contribution or overrides unresolved objections. A simple answer need not become Active Work.",
    fields: [
      field(
        "instruction",
        "Come vuoi contribuire?",
        "required",
        "Select input, analytical assumption, objection, proposed direction or output format. The form defaults to input.",
      ),
      field(
        "content",
        "Istruzione per questo lavoro",
        "required",
        "State the relevant instruction, up to 4,000 characters. For output format, choose summary, list or detailed analysis from the form. Do not treat an analytical assumption as accepted shared information.",
      ),
    ],
  },
  workstreams: {
    label: "Filoni",
    purpose:
      "Organize related shared work and sources without changing historical conversation.",
    instructions:
      "Create a shared workstream using Crea filone or an explicit authenticated text request naming it. Ask for a name if missing. A workstream is not a sub-goal; source linking and lifecycle controls use their existing UI and version checks.",
    fields: [
      field(
        "title",
        "Nome del filone",
        "required",
        "Choose a meaningful shared title, up to 160 characters. The creation form requires only this title.",
      ),
      field(
        "description",
        "Descrizione",
        "optional",
        "Available when editing a workstream, up to 4,000 characters. Explain its focus; creation may leave it empty.",
      ),
    ],
  },
  artifacts: {
    label: "Brief e Artifacts",
    purpose:
      "Prepare versioned documents from selected questions, accepted information and sources.",
    instructions:
      "The brief form requires a current question and at least one accepted information version. Drafting and non-operative review do not authorize external actions or adopt commitments. Explicitly reselect references that became stale.",
    fields: [
      field(
        "title",
        "Titolo del brief",
        "required",
        "Name the brief, up to 160 characters.",
      ),
      field(
        "questionId",
        "Domanda di riferimento",
        "required",
        "Select the exact current question/version from the available choices.",
      ),
      field(
        "information",
        "Informazioni accettate da includere",
        "required",
        "Select at least one and at most 20 accepted information versions. Candidates and raw sources do not replace this requirement.",
      ),
      field(
        "sourceIds",
        "Fonti aggiuntive da esaminare",
        "optional",
        "Select up to 20 additional current sources. Including a source does not accept its claims.",
      ),
      field(
        "notes",
        "Note e ipotesi della bozza",
        "optional",
        "Add observations and assumptions to discuss, up to 12,000 characters. They do not become decisions or commitments.",
      ),
      field(
        "reason",
        "Motivo della revisione",
        "conditional",
        "Required when revising an existing brief, up to 4,000 characters.",
      ),
      field(
        "people",
        "Persone per la review",
        "conditional",
        "Required when starting a named review: at least one person. This review is explicitly non-operative.",
      ),
    ],
  },
  sources: {
    label: "Fonti e ricerche",
    purpose:
      "Share source material and request external research with explicit disclosure.",
    instructions:
      "Shared files remain available in retained workspace history. Extracted content and research remain sources/evidence, not automatically accepted information. External processing requires the relevant disclosure choice and configured service.",
    fields: [
      field(
        "document",
        "Documento, immagine o messaggio vocale",
        "conditional",
        "Required for file sharing. Choose a supported file up to 8 MB; extracted text is limited to 200,000 characters. PDF and DOCX extraction is local; image and audio processing require the configured service.",
      ),
      field(
        "query",
        "Che cosa serve sapere?",
        "conditional",
        "Required for web research, up to 500 characters. Only this research text is sent to the search service.",
      ),
      field(
        "discloseQuery",
        "Autorizzo l’invio del testo della ricerca",
        "conditional",
        "Required to start external research. Confirm that the precise query may cross the external service boundary.",
      ),
      field(
        "allowModelProcessing",
        "Consenso all’elaborazione AI",
        "conditional",
        "Required to process an image or audio through the configured AI service. This choice does not accept the resulting claims.",
      ),
    ],
  },
  calendar: {
    label: "Calendario",
    purpose:
      "Manage internal temporal state separately from private calendar observations and external publication.",
    instructions:
      "An internal appointment does not update a connected calendar. External creation/update requires the existing proposal and exact authorization flow on a personally controlled resource. Private observations are not shared automatically; unknown outcomes require reconciliation.",
    fields: [
      field(
        "title",
        "Titolo appuntamento",
        "required",
        "Name the internal appointment. The web form allows up to 200 characters.",
      ),
      field(
        "start",
        "Inizio appuntamento",
        "required",
        "Choose the start date and time in the form's local time zone.",
      ),
      field(
        "end",
        "Fine appuntamento",
        "required",
        "Choose an end strictly after the start.",
      ),
      field(
        "timeZone",
        "Fuso orario",
        "required",
        "The current form supplies the browser's local IANA time zone automatically; there is no separate time-zone input to fill.",
      ),
      field(
        "reason",
        "Motivo appuntamento",
        "required",
        "Explain why the appointment is being recorded or revised, up to 2,000 characters.",
      ),
      field(
        "representSelf",
        "Rappresento soltanto me",
        "required",
        "Confirm personal representation for the internal appointment. This does not modify other people's commitments or constraints.",
      ),
    ],
  },
  email: {
    label: "Email",
    purpose:
      "Prepare versioned email drafts, inspect personal mailbox observations and authorize precise sends.",
    instructions:
      "Drafts and mailbox observations are private to their owner. Product help has no access to unsent values, drafts or mailbox connections. Saving a draft is not sending; use the existing exact send proposal/authorization flow. Never resend an unknown outcome blindly.",
    fields: [
      field(
        "connectionId",
        "Mailbox verificata",
        "conditional",
        "Optional for saving a draft. A verified active personal mailbox with send access is required for sending; product help does not inspect whether one is connected.",
      ),
      field(
        "to",
        "TO",
        "conditional",
        "Recipient addresses may be empty in a draft. Sending requires at least one valid recipient, with at most 20 unique recipients in total across TO, CC and BCC.",
      ),
      field(
        "cc",
        "CC",
        "optional",
        "Optional valid recipient addresses; TO, CC and BCC together allow at most 20 unique recipients. Review all recipients before authorizing the exact send.",
      ),
      field(
        "bcc",
        "BCC",
        "optional",
        "Optional hidden recipient addresses, within the total of 20 unique recipients. They remain part of the exact envelope being authorized.",
      ),
      field(
        "subject",
        "Oggetto email",
        "optional",
        "Draft subject, up to 500 characters, without line breaks. Empty is allowed.",
      ),
      field(
        "body",
        "Corpo email",
        "optional",
        "Draft body, up to 24,000 characters. Empty is allowed; assistance does not automatically read or share it.",
      ),
      field(
        "attachments",
        "Allegati",
        "optional",
        "Select up to 10 exact attachment versions. Selection alone neither sends nor shares private attachments.",
      ),
      field(
        "reason",
        "Motivo bozza",
        "required",
        "Explain the draft creation or revision, up to 2,000 characters. Do not include private draft contents in a shared help request.",
      ),
    ],
  },
  people: {
    label: "Persone e accesso",
    purpose:
      "Invite eligible people and inspect separate, protected access relationships.",
    instructions:
      "An invitation admits access to retained shared history without a join-time cutoff. Authentication, membership, Goal adherence and project authority are distinct. Access changes follow existing server-validated governance; creator status grants no override.",
    fields: [
      field(
        "email",
        "Email del destinatario",
        "conditional",
        "Required for a personal invitation. Enter a valid email address; this does not itself admit the recipient or represent them.",
      ),
      field(
        "fullHistoryDisclosed",
        "Accesso all’intera storia condivisa",
        "conditional",
        "Required for an invitation: explicitly acknowledge that admission includes all retained shared history.",
      ),
      field(
        "sendEmail",
        "Invia anche un’email al destinatario",
        "optional",
        "Select to request delivery of the personal invitation through the configured email service. The invitation link remains a separate admission flow.",
      ),
      field(
        "reason",
        "Motivo della proposta",
        "conditional",
        "Required when preparing an access relationship change or revocation, up to 4,000 characters. A reason cannot substitute for protected approvals.",
      ),
    ],
  },
  workspace_links: {
    label: "Spazi collegati",
    purpose:
      "Link accessible workspaces for navigation while keeping their contexts separate.",
    instructions:
      "Both workspace access checks still apply. A link does not merge histories or Shared Context, disclose private content, grant membership or transfer authority.",
    fields: [
      field(
        "otherWorkspaceId",
        "Altro spazio a cui partecipi",
        "required",
        "Choose a different accessible workspace from the selector. Only spaces available to the current person can be linked through this form.",
      ),
    ],
  },
} satisfies Record<ProductScreen, ProductScreenGuide>;

const issues = {
  required:
    "Explain the canonical requirement for this form. Do not claim that you can see a missing value; the user only selected the issue category.",
  invalid:
    "Explain the documented format and limits. Do not invent the entered value or raw validation error.",
  unavailable:
    "Explain prerequisites and the existing path. Configuration presence is not service health, account connection or permission; do not infer the actual cause of a disabled control.",
  stale:
    "Explain that the current content/version must be reviewed before retrying. Do not overwrite changed content or infer renewed consent.",
} as const;

export function isProductScreen(value: unknown): value is ProductScreen {
  return typeof value === "string" && Object.hasOwn(productScreens, value);
}
export function isProductField(screen: ProductScreen, value: string) {
  return productScreens[screen].fields.some((f) => f.id === value);
}

// Reconstruct from the catalog; never echo client-supplied strings into model context.
export function resolveProductAssistance(
  input: unknown,
): ProductAssistanceSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (
    Object.keys(data).some((k) => !["screen", "field", "issue"].includes(k)) ||
    !isProductScreen(data.screen) ||
    (data.field !== undefined &&
      (typeof data.field !== "string" ||
        !isProductField(data.screen, data.field))) ||
    (data.issue !== undefined &&
      (typeof data.issue !== "string" || !Object.hasOwn(issues, data.issue)))
  )
    return null;
  const screen = productScreens[data.screen];
  const selectedField = screen.fields.find((f) => f.id === data.field);
  const issue = data.issue as keyof typeof issues | undefined;
  return {
    guideVersion: PRODUCT_GUIDE_VERSION,
    screen: data.screen,
    label: screen.label,
    purpose: screen.purpose,
    instructions: screen.instructions,
    ...(selectedField ? { field: selectedField } : { fields: screen.fields }),
    ...(issue ? { issue, issueExplanation: issues[issue] } : {}),
  };
}
