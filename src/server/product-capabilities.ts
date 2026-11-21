import { PRODUCT_GUIDE_VERSION } from "../shared/product-guide.ts";
import type { Tx } from "./db.ts";
import { callConfigured, recordingConfigured } from "./call-provider.ts";
import { transcriptionConfiguration } from "./media-provider.ts";
import { integrationConfiguration } from "./google-credentials.ts";
import { listAssistantConnectionsWithRevisions } from "./assistant-connections.ts";

export interface ProductAction {
  id: string;
  explain: true;
  prepare: boolean;
  execute: "conversation" | "existing_ui" | "commit_point";
  available: boolean;
  limits: string;
}

// A descriptive snapshot, never a permission token or a service-health probe.
// This query intentionally excludes all private connections, observations and drafts.
export async function productCapabilities(
  tx: Tx,
  w: string,
  actor: string | null,
  personal = false,
  selected?: { connectionId: string; connectionRevision: string },
) {
  const participation = actor
    ? (
        await tx.query<{ contributes: boolean }>(
          `SELECT m.contributes FROM membership m JOIN "user" u ON u.id=m.user_id
           WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.active
           AND u.eligible AND u."emailVerified"`,
          [w, actor],
        )
      ).rows[0]
    : undefined;
  const canContribute = participation?.contributes === true;
  const configuration = {
    assistant: listAssistantConnectionsWithRevisions().some(
      (c) =>
        c.id === (selected?.connectionId ?? "default") &&
        c.configured &&
        (!selected || c.revision === selected.connectionRevision),
    ),
    webResearch: Boolean(
      process.env.RESEARCH_PROVIDER === "brave" &&
      process.env.BRAVE_SEARCH_API_KEY?.trim(),
    ),
    calendar: Boolean(integrationConfiguration("google", "calendar")),
    email: Boolean(
      integrationConfiguration("google", "email") ||
      integrationConfiguration("microsoft"),
    ),
    invitationDelivery: Boolean(
      process.env.MAIL_PROVIDER === "resend" &&
      process.env.RESEND_API_KEY &&
      process.env.MAIL_FROM &&
      process.env.BETTER_AUTH_URL,
    ),
    imageReading: Boolean(
      process.env.AI_MODEL?.trim() &&
      (process.env.AI_MODE === "openai"
        ? process.env.OPENAI_API_KEY?.trim()
        : process.env.AI_MODE === "anthropic"
          ? process.env.ANTHROPIC_API_KEY?.trim()
          : false),
    ),
    audioTranscription: Boolean(transcriptionConfiguration()),
    calls: callConfigured(),
    callRecording: recordingConfigured(),
  };
  const action = (
    id: string,
    execute: ProductAction["execute"],
    limits: string,
    available = canContribute,
    prepare = true,
  ): ProductAction => ({
    id,
    explain: true,
    prepare,
    execute,
    available,
    limits,
  });
  const base = {
    guideVersion: PRODUCT_GUIDE_VERSION,
    participation: {
      hasHumanActor: actor !== null,
      activeEligibleMember: Boolean(participation),
      canContribute,
    },
  };
  if (personal)
    return {
      ...base,
      configuration: {
        ...configuration,
        webResearch: false,
        calendar: false,
        email: false,
        invitationDelivery: false,
        imageReading: false,
        audioTranscription: false,
        calls: false,
        callRecording: false,
      },
      actions: [
        action(
          "conversation",
          "conversation",
          "Only the requesting account sees this archive. Reply to explicit personal questions using material in this space.",
        ),
        action(
          "artifacts",
          "existing_ui",
          "Create or edit draft notes. Saving a draft cannot adopt a decision or commitment.",
        ),
        action(
          "sources.upload",
          "existing_ui",
          "Store personal files. Uploading a file or saving a link does not request AI reading, fetch the page or disclose material to another workspace.",
        ),
        action(
          "followup",
          "existing_ui",
          "Set, revise or stop a personal reminder. Its due message appears in this private space.",
        ),
      ],
      boundaries: [
        "This account-only utility space is independent of shared workspaces. No invitations, shared state adoption, tasks, delegation or external actions. Never claim to execute these from conversation.",
      ],
    };
  return {
    ...base,
    configuration,
    actions: [
      action(
        "conversation",
        "conversation",
        "Shared text and contextual product help. An ordinary message does not adopt information or grant authority.",
      ),
      action(
        "workstream.create",
        "conversation",
        "Supported by an explicit authenticated text request naming a shared workstream, or Nuovo argomento. Missing/ambiguous names need clarification. No creation from quoted text, sources or model inference.",
      ),
      action(
        "workstream.manage",
        "existing_ui",
        "Rename, describe, link shared sources and change lifecycle through existing controls. No history movement, sub-goal or permission changes.",
      ),
      action(
        "goal",
        "commit_point",
        "Prepare initial intent or a versioned change. Any current contributor can save a text edit to the current primary Goal; the chat records the editor. Replacement, conclusion, obligations and personal adherence keep their own governed controls. A suggested change cannot save itself.",
      ),
      action(
        "information",
        "commit_point",
        "Prepare exact descriptive candidates. Acceptance/correction uses existing UI, provenance and versions; editorial capability needs no project mandate and never changes commitments.",
      ),
      action(
        "project.governance",
        "commit_point",
        "Prepare decisions, constraints, commitments and scoped mandates. Existing named approval and authority checks own every effect.",
      ),
      action(
        "tasks",
        "existing_ui",
        "Prepare Task creation/change via the existing form. Suggested people are not assigned; personal responsibility and material revisions use explicit version-bound acceptance.",
      ),
      action(
        "followup",
        "existing_ui",
        "Schedule reminders in Tasks for the shared chat. When due, Emme posts the reminder to the group. Eligible members may receive a push on opted-in devices. Only the creator can revise or close the reminder. Reminders and closure do not change commitments, responsibility or external calendars.",
      ),
      action(
        "active_work",
        "conversation",
        "Existing natural-language work requests and explicit shared controls manage exploratory analysis; generating analysis needs assistant configuration. General inferred controls are suggestions to apply through existing UI. Unresolved restrictions survive resume. Contributions remain unadopted; no external tools or effects from the analysis Specialist.",
      ),
      action(
        "artifacts",
        "existing_ui",
        "Prepare versioned briefs/documents from selected shared references or Contributions, with inspectable provenance and non-operative review. Adoption and consequential effects remain separate.",
      ),
      action(
        "sources.upload",
        "existing_ui",
        "Explicitly share supported files, up to 8 MB and 200,000 extracted characters. Local PDF/DOCX extraction depends on runtime support; image/audio processing needs separate disclosure and configuration. Sources do not become accepted information.",
        canContribute,
        false,
      ),
      action(
        "research",
        "existing_ui",
        "Prepare a web query, then request external research with explicit disclosure of that query. Results remain evidence. Configuration does not prove provider availability.",
        canContribute && configuration.webResearch,
      ),
      action(
        "calendar.internal",
        "existing_ui",
        "Prepare internal appointments and temporal state. Existing forms apply personal representation and version checks; no automatic external publication.",
      ),
      action(
        "calendar.external",
        "commit_point",
        "Existing private connection/read and exact proposal/authorization flow for personally controlled calendars. No attendees, invitations or automatic propagation. Private connection state is unknown here; reconcile unknown outcomes.",
        canContribute && configuration.calendar,
      ),
      action(
        "email.draft",
        "existing_ui",
        "Prepare text/navigation in shared conversation, or privately compose/save versioned drafts in Email. Do not read or disclose private drafts through shared assistance; saving is not sending.",
      ),
      action(
        "email.send",
        "commit_point",
        "In Strumenti → Email → Le tue caselle the owner can connect Gmail or Outlook when configured. Signing in to RIMIAM does not connect a mailbox. The owner reviews and authorizes the exact envelope in Email. Private connection state is unknown here. Disclosure is separate; reconcile an uncertain send before retrying.",
        canContribute && configuration.email,
      ),
      action(
        "people.access",
        "commit_point",
        "On Web, a member with invitation capability selects Invita in the chat header, enters the recipient email and acknowledges retained history. The recipient signs in with that verified address and can accept an incoming invitation in the app or follow the personal link. Email delivery is optional. Joining grants ordinary participation and access to retained shared history. It grants no invitation management or project authority.",
      ),
      action(
        "workspace_links",
        "existing_ui",
        "Link accessible spaces for navigation. Both access boundaries remain; linking grants no membership and merges no contexts.",
      ),
      action(
        "voice",
        "existing_ui",
        "Explicitly share/transcribe a voice message when configured. Browser microphone/playback support is not inspected; recorded input never substitutes for consequential authorization.",
        canContribute && configuration.audioTranscription,
        false,
      ),
      action(
        "calls",
        "existing_ui",
        "Human audio calls require configured transport. Recording additionally needs storage and every captured participant's explicit personal audio/transcription/history consent. Emme is absent; post-call analysis requires a separate request.",
        canContribute && configuration.calls,
        false,
      ),
    ],
    boundaries: [
      "This is a bounded map of implemented paths, not authority. available checks only contribution/configuration prerequisites; every command revalidates current access, scope, versions and required consent.",
      "Configuration means required deployment settings are present, never verified connectivity, model support, service health, credits or a connected personal account. Do not expose configuration values or infer private connection state.",
      "Explain and prepare remain possible when execution is unavailable. A conversational promise is not evidence of an applied change; claim execution only from the actual command result.",
    ],
  };
}
