import { PRODUCT_GUIDE_VERSION } from "../shared/product-guide.ts";
import type { Tx } from "./db.ts";
import { callConfigured, recordingConfigured } from "./call-provider.ts";
import { googleConfiguration } from "./google-credentials.ts";
import { isStructuredModelConfigured } from "./structured-llm.ts";

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
  let googleConfigured = false;
  try {
    googleConfigured = Boolean(googleConfiguration());
  } catch {
    // Invalid deployment configuration is not evidence of a usable integration.
  }
  const configuration = {
    assistant: isStructuredModelConfigured(),
    webResearch: Boolean(
      process.env.RESEARCH_PROVIDER === "brave" &&
      process.env.BRAVE_SEARCH_API_KEY?.trim(),
    ),
    calendar: googleConfigured,
    email: googleConfigured,
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
    audioTranscription: Boolean(
      process.env.TRANSCRIPTION_PROVIDER === "openai" &&
      process.env.OPENAI_API_KEY &&
      process.env.TRANSCRIPTION_MODEL,
    ),
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
  return {
    guideVersion: PRODUCT_GUIDE_VERSION,
    participation: {
      hasHumanActor: actor !== null,
      activeEligibleMember: Boolean(participation),
      canContribute,
    },
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
        "Supported by an explicit authenticated text request naming a shared workstream, or Crea filone. Missing/ambiguous names need clarification. No creation from quoted text, sources or model inference.",
      ),
      action(
        "workstream.manage",
        "existing_ui",
        "Rename, describe, link shared sources and change lifecycle through existing controls. No history movement, sub-goal or permission changes.",
      ),
      action(
        "goal",
        "commit_point",
        "Prepare and open initial intent or versioned Goal proposals. The existing UI applies explicit establishment, adherence and authorized change; no inferred adherence or transferred obligations.",
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
        "Create and maintain personal reminders in Tasks. Reminders and closure do not change commitments, responsibility or external calendars.",
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
        "The mailbox owner reviews and authorizes the exact version/envelope in Email. Private connection state is unknown here; disclosure is separate, and unknown sends must be reconciled rather than blindly retried.",
        canContribute && configuration.email,
      ),
      action(
        "people.access",
        "commit_point",
        "Existing invitation and protected access-governance UI validates current authority. Admission includes retained shared history; no creator override or governance inferred from membership.",
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
        "Human audio calls require configured transport. Recording additionally needs storage and every captured participant's explicit personal audio/transcription/history consent. Miriam is absent; post-call analysis requires a separate request.",
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
