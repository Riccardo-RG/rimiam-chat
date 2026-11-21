import {
  appendAssistantSettings,
  bindAssistantTurn,
  conversationScope,
  readConversationSetting,
} from "./assistant-settings.ts";
import { privateResearchAction } from "./personal-research.ts";
import {
  parseReminderRequest,
  recordReminderRequest,
  completeReminderRequest,
} from "./conversation-reminder.ts";
import {
  validateHandoffOrigin,
  recordHandoffApplication,
} from "./conversation-handoffs.ts";
import { applyCall } from "./calls.ts";
import { addBetaFeedback } from "./beta-feedback.ts";
import {
  acknowledgeMessage,
  recordConversationAddressing,
  requestMessageAnswer,
} from "./conversation-reading.ts";
import { sendVoice } from "./voice.ts";
import { draftArtifact, reviewArtifact, approveArtifact } from "./artifacts.ts";
import { artifactDocumentCommandSchema } from "../contracts/artifact-document.ts";
import { composeArtifact } from "./artifact-document.ts";
import { applyCalendar } from "./calendar-commands.ts";
import { calendarCommandSchema } from "../contracts/calendar.ts";
import { emailCommandSchema } from "../contracts/email.ts";
import { applyEmail } from "./email-commands.ts";
import { taskCommandSchema } from "../contracts/tasks.ts";
import { applyTasks } from "./tasks-commands.ts";
import {
  workSuggestionCommandSchema,
  activeWorkCommandSchema,
} from "../contracts/active-work.ts";
import {
  applyActiveWork,
  createActiveWork,
  startObjective,
} from "./active-work-commands.ts";
import { applyWorkSuggestion } from "./work-suggestions.ts";
import { reassessActiveWork } from "./active-work-worker.ts";
import { accessCommandSchema } from "../contracts/access.ts";
import { applyAccess } from "./access-commands.ts";
import { projectCommandSchema } from "../contracts/project.ts";
import { attentionCommandSchema } from "../contracts/attention.ts";
import { attentionCommand } from "./attention.ts";
import { recordMessageFocus } from "./workstream-focus.ts";
import { recordMessageReference } from "./conversation-reference.ts";
import { requestedWorkstreamTitle } from "../shared/workstream-intent.ts";
import { recordProductAssistance } from "./product-assistance.ts";
import { createConversationWorkstream } from "./conversation-workstreams.ts";
import {
  collaborationMode,
  legacyAddressTargetsMember,
} from "./participation.ts";
import {
  isAssistantAddress,
  isSourceQuestion,
} from "../shared/miriam-address.ts";
import { recordWorkspaceNotice } from "./workspace-notice.ts";
import { applyProject } from "./project-commands.ts";
import {
  eligible,
  authenticatedSession,
  noDepartureSinceInvitation,
  member,
  lockWorkspace,
  changed,
  enqueue,
  type WorkspaceRow,
} from "./workspace-state.ts";
export {
  eligible,
  member,
  lockWorkspace,
  changed,
  enqueue,
} from "./workspace-state.ts";
export type { WorkspaceRow } from "./workspace-state.ts";
import { changeQuestion } from "./questions.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { requireThat, DomainError } from "./errors.ts";
import {
  uploadDocument,
  retryDocument,
  markOrdinaryUpload,
  changeDocumentVisibility,
  requireAvailableDocuments,
} from "./sources.ts";
import { requestResearch, controlResearch } from "./research.ts";
import { enqueueInvitationMail } from "./invitation-delivery.ts";
import { resolvePersonalContactEmails } from "./personal-contacts.ts";
import {
  workspaceInvitationsSchema,
  type WorkspaceInvitations,
} from "../contracts/workspace-invitations.ts";
import { applyWorkspaceLink } from "./workspace-links.ts";

import {
  commandSchema,
  messageAttachmentsSchema,
} from "../contracts/commands.ts";
import type { Command } from "../contracts/commands.ts";
export { commandSchema } from "../contracts/commands.ts";
export type { Command } from "../contracts/commands.ts";
const id = z.uuid();
async function membershipHistory(
  tx: Tx,
  w: string,
  person: string,
  actor: string,
  basis: string,
  accepted = false,
) {
  await tx.query(
    "INSERT INTO membership_history(id,workspace_id,user_id,version,active,actor_id,basis,full_history_accepted,created_at) SELECT $1,workspace_id,user_id,version,active,$4,$5,$6,clock_timestamp() FROM membership WHERE workspace_id=$2 AND user_id=$3",
    [randomUUID(), w, person, actor, basis, accepted],
  );
}
async function accessHistory(
  tx: Tx,
  w: string,
  person: string,
  actor: string,
  basis: string,
) {
  await tx.query(
    "INSERT INTO access_history(id,workspace_id,relationship_id,version,active,invitations,remove_members,change_access,protected,actor_id,basis) SELECT $1,workspace_id,id,version,active,invitations,remove_members,change_access,protected,$4,$5 FROM access_relationship WHERE workspace_id=$2 AND holder_id=$3 AND NOT EXISTS(SELECT 1 FROM access_history h WHERE h.relationship_id=access_relationship.id AND h.version=access_relationship.version)",
    [randomUUID(), w, person, actor, basis],
  );
}
async function capability(
  tx: Tx,
  w: string,
  actor: string,
  operation: "invitations" | "remove_members",
) {
  const r = await tx.query(
    `SELECT id FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2 AND active AND ${operation}=true`,
    [w, actor],
  );
  requireThat(r.rowCount, "ACCESS_AUTHORITY_REQUIRED", 403);
  return r.rows[0].id as string;
}
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function issueInvitation(
  tx: Tx,
  w: string,
  actor: string,
  relationship: string,
  email: string,
  sendEmail: boolean,
  contactId: string | null = null,
) {
  const token = randomBytes(32).toString("base64url");
  const inviteId = randomUUID();
  await tx.query(
    "INSERT INTO invitation(id,workspace_id,recipient_email,token_hash,issuer_id,relationship_id,expires_at,history_disclosed,created_at,recipient_contact_id) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '7 days',true,clock_timestamp(),$7)",
    [inviteId, w, email, tokenHash(token), actor, relationship, contactId],
  );
  await changed(tx, w, "invitation.create");
  const invitationUrl = new URL(
    "/",
    process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000",
  );
  invitationUrl.searchParams.set("invite", token);
  if (sendEmail)
    await enqueueInvitationMail(tx, w, inviteId, invitationUrl.href);
  return { invitationId: inviteId, token, invitationUrl: invitationUrl.href };
}

async function initializeWorkspace(
  tx: Tx,
  w: string,
  actor: string,
  name: string,
  description: string,
  personal: boolean,
  archiveId?: string,
) {
  await tx.query(
    "INSERT INTO workspace(id,name,created_by,personal_owner_id,personal_archive_id) VALUES($1,$2,$3,$4,$5)",
    [w, name, actor, personal ? actor : null, archiveId ?? null],
  );
  await tx.query("INSERT INTO membership(workspace_id,user_id) VALUES($1,$2)", [
    w,
    actor,
  ]);
  await membershipHistory(
    tx,
    w,
    actor,
    actor,
    "workspace_initialization",
    true,
  );
  if (!personal) {
    await tx.query(
      "INSERT INTO access_relationship(id,workspace_id,holder_id,invitations,remove_members,change_access,basis) VALUES($1,$2,$3,true,true,true,'workspace_initialization')",
      [randomUUID(), w, actor],
    );
    await accessHistory(tx, w, actor, actor, "workspace_initialization");
  }
  // Same transaction as creation/receipt. No inference, Goal or adoption command
  // is run. The human introduction is available through the ordinary source view.
  const introductionId = description ? randomUUID() : null;
  if (introductionId)
    await tx.query(
      "INSERT INTO message(id,workspace_id,sequence,author_id,content,purpose) VALUES($1,$2,1,$3,$4,'workspace_introduction')",
      [introductionId, w, actor, description],
    );
  const welcomeSequence = introductionId ? 2 : 1;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,actor_kind,content,purpose,reply_to_source_id) VALUES($1,$2,$3,NULL,'miriam',$4,'workspace_welcome',$5)",
    [
      randomUUID(),
      w,
      welcomeSequence,
      personal
        ? "Qui puoi conservare appunti e file, impostare promemoria o fare una domanda a Emme."
        : introductionId
          ? "Benvenuti. La descrizione che hai condiviso è il punto di partenza della conversazione: potete aggiungere idee, domande o materiali. Non stabilisce da sola un Goal o un accordo del gruppo."
          : "Benvenuti. Questo è il vostro spazio per confrontarvi e raccogliere idee, domande e materiali. Potete iniziare dalla conversazione, anche senza un Goal già stabilito.",
      introductionId,
    ],
  );
  await tx.query("UPDATE workspace SET next_message=$2 WHERE id=$1", [
    w,
    welcomeSequence,
  ]);
  await changed(tx, w, "workspace.created", false, true);
}

export async function openPersonalSpace(actor: string, sessionId: string) {
  return transaction((tx) => personalInTransaction(tx, actor, sessionId));
}
async function personalInTransaction(tx: Tx, actor: string, sessionId: string) {
  await eligible(tx, actor, true);
  // Other tabs/devices cannot create another private archive for the same account.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `personal-space:${actor}`,
  ]);
  await authenticatedSession(tx, actor, sessionId);
  const existing = (
    await tx.query<{ id: string }>(
      "SELECT id FROM workspace WHERE personal_owner_id=$1 AND personal_archive_id IS NULL",
      [actor],
    )
  ).rows[0];
  if (existing) {
    await member(tx, existing.id, actor);
    return existing;
  }
  const id = randomUUID();
  await initializeWorkspace(tx, id, actor, "Il mio spazio", "", true);
  return { id };
}

export async function openPersonalThread(
  tx: Tx,
  actor: string,
  session: string,
  thread?: string,
  fresh = false,
) {
  const archive = await personalInTransaction(tx, actor, session);
  const id =
    thread ??
    (
      await tx.query(
        "SELECT thread_id FROM personal_chat_resume WHERE actor_id=$1",
        [actor],
      )
    ).rows[0]?.thread_id ??
    archive.id;
  const prior = (
    await tx.query("SELECT personal_owner_id FROM workspace WHERE id=$1", [id])
  ).rows[0];
  if (!prior && fresh)
    await initializeWorkspace(
      tx,
      id,
      actor,
      "Conversazione personale",
      "",
      true,
      archive.id,
    );
  else
    requireThat(
      prior?.personal_owner_id === actor,
      "PERSONAL_CHAT_UNAVAILABLE",
      404,
    );
  await member(tx, id, actor, true, true);
  await tx.query(
    "INSERT INTO personal_chat_resume(actor_id,thread_id) VALUES($1,$2) ON CONFLICT(actor_id) DO UPDATE SET thread_id=excluded.thread_id",
    [actor, id],
  );
  return { id, archiveId: archive.id };
}

export async function createWorkspace(
  actor: string,
  name: string,
  commandId: string,
  description = "",
  sessionId?: string,
  invitations?: WorkspaceInvitations,
  attachments?: z.infer<typeof messageAttachmentsSchema>,
  assistantConnectionId?: string,
  assistantConnectionRevision?: string,
) {
  requireThat(
    (assistantConnectionId === undefined) ===
      (assistantConnectionRevision === undefined),
    "ASSISTANT_CONNECTION_CHANGED",
    400,
  );
  id.parse(commandId);
  name = z.string().trim().min(1).max(120).parse(name);
  description = z.string().trim().max(2000).parse(description);
  const batch =
    invitations === undefined
      ? undefined
      : workspaceInvitationsSchema.parse(invitations);
  const files =
    attachments === undefined
      ? undefined
      : messageAttachmentsSchema.parse(attachments);
  const emails = new Set<string>();
  const contacts = new Set<string>();
  for (const recipient of batch?.recipients ?? []) {
    if ("email" in recipient) emails.add(recipient.email);
    else contacts.add(recipient.contactId);
  }
  // Preserve hashes of existing name-only commands and normalize empty descriptions.
  const requestHash = tokenHash(
    JSON.stringify({
      type: "workspace.create",
      ...(assistantConnectionId
        ? { assistantConnectionId, assistantConnectionRevision }
        : {}),
      name,
      ...(description ? { description } : {}),
      ...(files
        ? {
            files: files.map((f) => [
              f.filename,
              tokenHash(f.bytesBase64),
              !!f.allowModelProcessing,
            ]),
          }
        : {}),
      ...(batch
        ? {
            invitations: {
              emails: [...emails].sort(),
              contacts: [...contacts].sort(),
              fullHistoryDisclosed: true,
            },
          }
        : {}),
    }),
  );
  return transaction(async (tx) => {
    const issuer = await eligible(tx, actor, true);
    // Serialize retries of creation before there is a Workspace row to lock.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${actor}:${commandId}`,
    ]);
    // HTTP adapters always supply their captured session; trusted internal
    // invocations may omit it. Validate after waiting for creation serialization.
    if (sessionId || files) await authenticatedSession(tx, actor, sessionId);
    const prior = await tx.query(
      "SELECT w.id,w.name,w.created_by,r.request_hash FROM workspace w LEFT JOIN command_receipt r ON (r.workspace_id,r.command_id,r.actor_id)=(w.id,w.id,w.created_by) WHERE w.id=$1",
      [commandId],
    );
    if (prior.rowCount) {
      requireThat(
        prior.rows[0].created_by === actor &&
          prior.rows[0].request_hash === requestHash,
        "COMMAND_ID_REUSED",
      );
      return { id: commandId };
    }
    const w = commandId;
    await initializeWorkspace(tx, w, actor, name, description, false);
    if (assistantConnectionId && assistantConnectionRevision)
      await appendAssistantSettings(
        tx,
        actor,
        { workspaceId: w },
        {
          connectionId: assistantConnectionId,
          connectionRevision: assistantConnectionRevision,
          expectedRevision: 0,
          displayName: "Emme",
          instructions: "",
        },
      );
    if (files)
      await apply(
        tx,
        await lockWorkspace(tx, w),
        actor,
        { type: "message.send", content: "", attachments: files },
        { streamTitle: null },
      );
    if (batch) {
      const relationship = await capability(tx, w, actor, "invitations");
      const resolved = await resolvePersonalContactEmails(tx, actor, [
        ...contacts,
      ]);
      // When a person was selected both ways, keep the stronger account binding.
      const recipients = new Map<string, string | null>();
      for (const email of emails) recipients.set(email, null);
      for (const [contactId, email] of resolved)
        recipients.set(email, contactId);
      requireThat(
        !recipients.has(issuer.email.toLowerCase()),
        "CANNOT_INVITE_SELF",
        400,
      );
      for (const [email, contactId] of recipients)
        await issueInvitation(
          tx,
          w,
          actor,
          relationship,
          email,
          true,
          contactId,
        );
    }
    await tx.query(
      "INSERT INTO command_receipt(workspace_id,actor_id,command_id,request_hash,result) VALUES($1,$2,$1,$3,$4)",
      [w, actor, requestHash, JSON.stringify({ id: w })],
    );
    return { id: w };
  });
}

export async function acceptInvitation(
  actor: string,
  invitation: string | { recipientInvitationId: string },
  fullHistoryAccepted: boolean,
  sessionId?: string,
) {
  requireThat(fullHistoryAccepted, "HISTORY_ACCEPTANCE_REQUIRED", 400);
  return transaction(async (tx) => {
    const user = await eligible(tx, actor, true);
    // Links retain their original token check. Inbox references identify an
    // invitation only together with the authenticated recipient's verified email.
    const lookup =
      typeof invitation === "string"
        ? await tx.query(
            "SELECT id,workspace_id FROM invitation WHERE token_hash=$1",
            [tokenHash(invitation)],
          )
        : await tx.query(
            "SELECT id,workspace_id FROM invitation WHERE id=$1 AND recipient_email=$2 AND (recipient_contact_id IS NULL OR recipient_contact_id=$3)",
            [invitation.recipientInvitationId, user.email.toLowerCase(), actor],
          );
    requireThat(lookup.rowCount, "INVITATION_INVALID", 404);
    const w = lookup.rows[0].workspace_id;
    const ws = await lockWorkspace(tx, w);
    requireThat(!ws.personal_owner_id, "INVITATION_INVALID", 404);
    if (sessionId || typeof invitation !== "string")
      await authenticatedSession(tx, actor, sessionId);
    const r = await tx.query(
      `SELECT i.* FROM invitation i WHERE i.id=$1 AND ${noDepartureSinceInvitation} FOR UPDATE`,
      [lookup.rows[0].id, actor],
    );
    requireThat(r.rowCount, "INVITATION_INVALID", 404);
    const invite = r.rows[0];
    requireThat(
      invite.recipient_email === user.email.toLowerCase() &&
        (invite.recipient_contact_id === null ||
          invite.recipient_contact_id === actor),
      "INVITATION_RECIPIENT_MISMATCH",
      403,
    );
    requireThat(
      !invite.accepted_at &&
        !invite.revoked_at &&
        new Date(invite.expires_at) > new Date(),
      "INVITATION_INVALID",
    );
    await member(tx, w, invite.issuer_id, false, true);
    const authority = await capability(tx, w, invite.issuer_id, "invitations");
    requireThat(
      authority === invite.relationship_id,
      "INVITATION_AUTHORITY_ENDED",
      403,
    );
    const existing = await tx.query(
      "SELECT active FROM membership WHERE workspace_id=$1 AND user_id=$2",
      [w, actor],
    );
    requireThat(!existing.rows[0]?.active, "ALREADY_A_MEMBER");
    await tx.query(
      "INSERT INTO membership(workspace_id,user_id) VALUES($1,$2) ON CONFLICT(workspace_id,user_id) DO UPDATE SET active=true,version=membership.version+1",
      [w, actor],
    );
    await membershipHistory(
      tx,
      w,
      actor,
      actor,
      `invitation:${invite.id}`,
      true,
    );
    await tx.query(
      "UPDATE invitation SET accepted_at=now(),accepted_by=$2 WHERE id=$1",
      [invite.id, actor],
    );
    await changed(tx, w, "member.joined", false, true);
    return { workspaceId: w };
  });
}

export async function execute(
  actor: string,
  w: string,
  commandId: string,
  input: unknown,
  sessionId?: string,
) {
  id.parse(w);
  id.parse(commandId);
  const c = commandSchema.parse(input);
  return transaction(async (tx) => {
    if (
      c.type === "workspace.link" ||
      c.type === "library.copy" ||
      c.type === "research.private_publish"
    ) {
      const other =
        c.type === "workspace.link" ? c.otherWorkspaceId : c.destinationId;
      for (const workspace of [...new Set([w, other])].sort())
        await lockWorkspace(tx, workspace);
    }
    const ws = await lockWorkspace(tx, w);
    await member(tx, w, actor, false, true);
    if (
      sessionId ||
      ws.personal_owner_id ||
      c.type === "conversation.requestAnswer" ||
      c.type === "conversation.answered"
    )
      await authenticatedSession(tx, actor, sessionId);
    if (c.type === "library.copy") {
      await authenticatedSession(tx, actor, sessionId);
      requireThat(c.destinationId !== w, "COPY_DESTINATION_INVALID", 400);
      await member(tx, c.destinationId, actor, true, true);
    }
    if (c.type === "document.withdraw" || c.type === "document.restore")
      await member(tx, w, actor, true, true);
    if (ws.personal_archive_id)
      requireThat(
        [
          "message.send",
          "interpretation.retry",
          "document.upload",
          "document.withdraw",
          "document.restore",
          "research.private_request",
          "research.private_publish",
          "research.brief_retry",
          "research.retry",
          "research.cancel",
          "reminder.set_time",
        ].includes(c.type),
        "PERSONAL_SPACE_UNSUPPORTED",
        403,
      );
    if (ws.personal_owner_id) {
      requireThat(
        c.type === "message.send" ||
          c.type === "interpretation.retry" ||
          c.type === "document.upload" ||
          c.type === "document.withdraw" ||
          c.type === "document.restore" ||
          c.type === "library.favorite" ||
          c.type === "library.copy" ||
          c.type === "artifact.compose" ||
          c.type === "research.private_request" ||
          c.type === "research.private_publish" ||
          c.type === "research.brief_retry" ||
          c.type === "research.retry" ||
          c.type === "research.cancel" ||
          c.type === "reminder.set_time" ||
          c.type === "followup.create" ||
          c.type === "calendar.read" ||
          c.type === "calendar.disconnect" ||
          c.type === "temporal.create" ||
          c.type === "temporal.revise" ||
          c.type === "followup.previous" ||
          c.type === "followup.occurrence" ||
          c.type === "followup.revise" ||
          c.type === "followup.close",
        "PERSONAL_SPACE_UNSUPPORTED",
        403,
      );
    }
    const displayName =
      c.type === "message.send"
        ? (await readConversationSetting(tx, w, ws.personal_owner_id))
            .displayName
        : "Emme";
    let streamTitle: string | null = null;
    let objective: string | undefined;
    if (
      c.type === "message.send" &&
      !c.assistanceContext &&
      !isSourceQuestion(
        c.content,
        c.reference?.kind,
        !!c.quoteMessageId,
        displayName,
      ) &&
      !ws.personal_owner_id
    ) {
      streamTitle = requestedWorkstreamTitle(c.content, displayName);
      objective = startObjective(c.content, displayName);
      if (streamTitle || objective) {
        // An imperative between people is ordinary Conversation in discreet mode.
        const called = isAssistantAddress(c.content, displayName);
        if (
          (called &&
            (await legacyAddressTargetsMember(
              tx,
              w,
              actor,
              c.content,
              undefined,
              displayName,
            ))) ||
          (!called && (await collaborationMode(tx, w)) === "discreet")
        ) {
          streamTitle = null;
          objective = undefined;
        } else {
          await authenticatedSession(tx, actor, sessionId);
        }
      }
    }
    const hash = tokenHash(JSON.stringify(c));
    const previous = await tx.query(
      "SELECT request_hash,result FROM command_receipt WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3",
      [w, actor, commandId],
    );
    if (previous.rowCount) {
      requireThat(previous.rows[0].request_hash === hash, "COMMAND_ID_REUSED");
      return previous.rows[0].result;
    }
    const conversationOrigin = await validateHandoffOrigin(
      tx,
      w,
      actor,
      c,
      sessionId,
    );
    const calendar = calendarCommandSchema.safeParse(c);
    const email = emailCommandSchema.safeParse(c);
    const tasks = taskCommandSchema.safeParse(c);
    const work = activeWorkCommandSchema.safeParse(c);
    const access = accessCommandSchema.safeParse(c);
    const project = projectCommandSchema.safeParse(c);
    const attention = attentionCommandSchema.safeParse(c);
    const document = artifactDocumentCommandSchema.safeParse(c);
    const suggestion = workSuggestionCommandSchema.safeParse(c);
    const result = suggestion.success
      ? await applyWorkSuggestion(tx, w, actor, suggestion.data, sessionId)
      : document.success
        ? await composeArtifact(tx, ws, actor, document.data)
        : attention.success
          ? await attentionCommand(tx, w, actor, attention.data)
          : project.success
            ? await applyProject(tx, ws, actor, project.data, sessionId)
            : access.success
              ? await applyAccess(tx, ws, actor, access.data, sessionId)
              : work.success
                ? await applyActiveWork(tx, w, actor, work.data, sessionId)
                : tasks.success
                  ? await applyTasks(tx, ws, actor, tasks.data, sessionId)
                  : email.success
                    ? await applyEmail(tx, ws, actor, email.data, sessionId)
                    : calendar.success
                      ? await applyCalendar(
                          tx,
                          ws,
                          actor,
                          calendar.data,
                          sessionId,
                        )
                      : await apply(
                          tx,
                          ws,
                          actor,
                          c,
                          {
                            streamTitle,
                            objective,
                            displayName,
                          },
                          sessionId,
                        );
    if (
      !ws.personal_owner_id &&
      c.type !== "beta.feedback.add" &&
      c.type !== "library.favorite" &&
      c.type !== "library.copy"
    )
      await reassessActiveWork(tx, w);
    await tx.query(
      "INSERT INTO command_receipt(workspace_id,actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [w, actor, commandId, hash, JSON.stringify(result)],
    );
    if (conversationOrigin)
      await recordHandoffApplication(
        tx,
        w,
        actor,
        commandId,
        c,
        conversationOrigin,
        result,
      );
    return result;
  });
}

async function candidateFor(tx: Tx, ws: WorkspaceRow, candidateId: string) {
  const r = await tx.query(
    "SELECT * FROM candidate WHERE workspace_id=$1 AND id=$2",
    [ws.id, candidateId],
  );
  requireThat(r.rowCount, "CANDIDATE_NOT_FOUND", 404);
  requireThat(
    r.rows[0].context_revision === ws.context_revision,
    "CANDIDATE_STALE",
  );
  return r.rows[0];
}

async function apply(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: Command,
  messageIntent: {
    streamTitle: string | null;
    objective?: string;
    displayName?: string;
  },
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  if (c.type.startsWith("call."))
    return applyCall(tx, w, actor, c as Parameters<typeof applyCall>[3]);
  switch (c.type) {
    case "library.copy": {
      const to = await lockWorkspace(tx, c.destinationId);
      requireThat(
        !to.personal_archive_id &&
          !!ws.personal_owner_id !== !!to.personal_owner_id,
        "COPY_DESTINATION_INVALID",
        400,
      );
      const record = (
        await tx.query<{
          filename: string;
          original_bytes: Buffer;
          qualification: string;
        }>(
          "SELECT filename,original_bytes,qualification FROM available_external_source WHERE workspace_id=$1 AND id=$2 AND kind='document'",
          [w, c.sourceId],
        )
      ).rows[0];
      requireThat(record, "SOURCE_NOT_FOUND", 404);
      const result = await uploadDocument(
        tx,
        to.id,
        actor,
        {
          type: "document.upload",
          filename: record.filename,
          bytesBase64: record.original_bytes.toString("base64"),
        },
        record.qualification.startsWith("Documento preparato da Emme")
          ? "Documento preparato da Emme e condiviso da una persona; contenuto non adottato."
          : undefined,
        !to.personal_owner_id,
      );
      await tx.query(
        "INSERT INTO library_copy_origin(workspace_id,source_id,origin_workspace_id,origin_source_id,copied_by) VALUES($1,$2,$3,$4,$5)",
        [to.id, result.sourceId, w, c.sourceId, actor],
      );
      if (to.personal_owner_id) return result;
      const messageId = randomUUID();
      await tx.query(
        `WITH seq AS (UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message)
        INSERT INTO message(id,workspace_id,sequence,author_id,content) SELECT $2,$1,next_message,$3,$4 FROM seq`,
        [to.id, messageId, actor, record.filename],
      );
      await tx.query(
        "INSERT INTO message_attachment(workspace_id,message_id,position,source_id) VALUES($1,$2,0,$3)",
        [to.id, messageId, result.sourceId],
      );
      await changed(tx, to.id, "message.send", false, false, {
        kind: "message",
        id: messageId,
      });
      return { ...result, messageId };
    }
    case "library.favorite": {
      if (c.starred) await requireAvailableDocuments(tx, w, [c.sourceId]);
      requireThat(
        (
          await tx.query(
            "SELECT 1 FROM source_identity WHERE workspace_id=$1 AND id=$2",
            [w, c.sourceId],
          )
        ).rowCount,
        "SOURCE_NOT_FOUND",
        404,
      );
      if (c.starred)
        await tx.query(
          "INSERT INTO library_favorite(workspace_id,user_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [w, actor, c.sourceId],
        );
      else
        await tx.query(
          "DELETE FROM library_favorite WHERE workspace_id=$1 AND user_id=$2 AND source_id=$3",
          [w, actor, c.sourceId],
        );
      return { starred: c.starred };
    }
    case "beta.feedback.add":
      return addBetaFeedback(tx, w, actor, c);
    case "workspace.link":
      return applyWorkspaceLink(tx, w, actor, c);
    case "artifact.draft":
    case "artifact.revise":
      return draftArtifact(tx, ws, actor, c);
    case "artifact.review":
      return reviewArtifact(tx, ws, actor, c);
    case "artifact.approve":
      return approveArtifact(tx, ws, actor, c);
    case "question.open":
    case "question.answer":
    case "question.reopen":
      return changeQuestion(tx, ws, actor, c);
    case "voice.send":
      return sendVoice(tx, w, actor, c);
    case "document.upload": {
      const source = await uploadDocument(
        tx,
        w,
        actor,
        c,
        undefined,
        !ws.personal_owner_id,
      );
      await markOrdinaryUpload(tx, w, actor, source.sourceId);
      if (!c.conversationShare) return source;
      const messageId = randomUUID();
      await tx.query(
        `WITH next AS (UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message)
         INSERT INTO message(id,workspace_id,sequence,author_id,content)
         SELECT $2,$1,next_message,$3,$4 FROM next`,
        [w, messageId, actor, c.filename],
      );
      // A source reference identifies the exact retained file version. The
      // filename is presentation, never another request or interpretation.
      await recordMessageReference(tx, w, messageId, {
        kind: "source",
        id: source.sourceId,
        version: 1,
      });
      const focus = c.conversationShare.workstreamFocus;
      if (focus) {
        await recordMessageFocus(tx, w, messageId, actor, focus);
        await tx.query(
          "INSERT INTO workstream_source(workspace_id,workstream_id,source_id,version,included,actor_id,origin) VALUES($1,$2,$3,1,true,$4,'human')",
          [w, focus.workstreamId, source.sourceId, actor],
        );
      }
      await tx.query(
        "INSERT INTO message_attachment(workspace_id,message_id,position,source_id) VALUES($1,$2,0,$3)",
        [w, messageId, source.sourceId],
      );
      await changed(tx, w, "message.send", false, false, {
        kind: "message",
        id: messageId,
      });
      return { ...source, messageId };
    }
    case "document.withdraw":
    case "document.restore":
      return changeDocumentVisibility(tx, w, actor, c);
    case "document.retry":
      return retryDocument(tx, w, actor, c);
    case "research.private_request": {
      requireThat(
        ws.personal_owner_id === actor,
        "PERSONAL_CHAT_UNAVAILABLE",
        403,
      );
      if (c.originId) {
        await member(tx, c.originId, actor);
        requireThat(
          (
            await tx.query(
              "SELECT 1 FROM personal_chat_consultation p JOIN conversation_reading r ON r.workspace_id=p.target_id AND r.user_id=$2 AND r.admission=p.admission WHERE p.thread_id=$1 AND p.target_id=$3",
              [w, actor, c.originId],
            )
          ).rowCount,
          "CONSULTATION_SELECTION_CHANGED",
          409,
        );
      }
      const work = await requestResearch(tx, ws, actor, {
        type: "research.request",
        query: c.query,
        discloseQuery: true,
      });
      await tx.query(
        "INSERT INTO personal_research_preference(workspace_id,work_id,actor_id,notify,origin_id) VALUES($1,$2,$3,$4,$5)",
        [w, work.workId, actor, c.notify, c.originId ?? null],
      );
      return work;
    }
    case "research.private_publish":
    case "research.brief_retry":
      return privateResearchAction(tx, ws, actor, c);
    case "research.request":
      return requestResearch(tx, ws, actor, c);
    case "research.retry":
    case "research.cancel":
      return controlResearch(tx, ws, actor, c);
    case "goal.establish": {
      await member(tx, w, actor, true);
      requireThat(
        !(await tx.query("SELECT 1 FROM goal WHERE workspace_id=$1", [w]))
          .rowCount,
        "GOAL_CHANGE_REQUIRES_SEPARATE_TRANSITION",
      );
      const goalId = randomUUID();
      await tx.query(
        "INSERT INTO goal(id,workspace_id,current_version) VALUES($1,$2,1)",
        [goalId, w],
      );
      const source = await recordWorkspaceNotice(
        tx,
        w,
        actor,
        "ha impostato l’obiettivo dello spazio.",
        { kind: "goal", id: goalId, version: 1 },
      );
      await tx.query(
        "INSERT INTO goal_version(workspace_id,goal_id,version,content,established_by,source_id) VALUES($1,$2,1,$3,$4,$5)",
        [w, goalId, c.content, actor, source],
      );
      await tx.query("INSERT INTO goal_intent_participant VALUES($1,$2,1,$3)", [
        w,
        goalId,
        actor,
      ]);
      // Establishing intent does not manufacture a separate adherence act, even for its author.
      await changed(tx, w, c.type, true);
      return { goalId };
    }
    case "goal.adhere": {
      const g = await tx.query(
        "SELECT current_version FROM goal WHERE workspace_id=$1 AND id=$2 AND status='active'",
        [w, c.goalId],
      );
      requireThat(
        g.rows[0]?.current_version === c.version,
        "GOAL_VERSION_STALE",
      );
      await tx.query(
        "INSERT INTO goal_adherence(id,workspace_id,goal_id,goal_version,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [randomUUID(), w, c.goalId, c.version, actor],
      );
      await changed(tx, w, c.type);
      return {};
    }
    case "conversation.requestAnswer":
      await requestMessageAnswer(tx, w, actor, c.messageId, c.recipients);
      return {};
    case "conversation.answered":
      await acknowledgeMessage(tx, w, actor, c.messageId);
      return {};
    case "reminder.set_time": {
      requireThat(sessionId, "SESSION_REQUIRED", 401);
      const result = await completeReminderRequest(
        tx,
        ws,
        actor,
        c.messageId,
        c.remindAt,
        sessionId,
        personalInTransaction,
      );
      await changed(tx, w, "reminder.confirmed");
      return result;
    }
    case "message.send": {
      await member(tx, w, actor, true);
      const messageId = randomUUID(),
        interpretationId = randomUUID();
      const seq = await tx.query(
        "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
        [w],
      );
      await tx.query(
        "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
        [
          messageId,
          w,
          seq.rows[0].next_message,
          actor,
          c.content || c.attachments!.map((file) => file.filename).join(", "),
        ],
      );
      if (c.workstreamFocus)
        await recordMessageFocus(tx, w, messageId, actor, c.workstreamFocus);
      await recordConversationAddressing(tx, w, actor, messageId, c.content, c);
      if (c.reference)
        await recordMessageReference(tx, w, messageId, c.reference);
      if (c.assistanceContext)
        await recordProductAssistance(tx, w, messageId, c.assistanceContext);
      if (c.attachments) {
        for (const [position, file] of c.attachments.entries()) {
          const source = await uploadDocument(
            tx,
            w,
            actor,
            { type: "document.upload", ...file },
            undefined,
            !ws.personal_owner_id,
          );
          await markOrdinaryUpload(tx, w, actor, source.sourceId);
          await tx.query(
            "INSERT INTO message_attachment(workspace_id,message_id,position,source_id) VALUES($1,$2,$3,$4)",
            [w, messageId, position, source.sourceId],
          );
          if (c.workstreamFocus)
            await tx.query(
              "INSERT INTO workstream_source(workspace_id,workstream_id,source_id,version,included,actor_id,origin) VALUES($1,$2,$3,1,true,$4,'human')",
              [w, c.workstreamFocus.workstreamId, source.sourceId, actor],
            );
        }
        if (!c.content) {
          await changed(tx, w, c.type, false, false, {
            kind: "message",
            id: messageId,
          });
          return { messageId };
        }
      }
      const reminder =
        c.clientTimeZone &&
        !c.assistanceContext &&
        !c.attachments &&
        !c.quoteMessageId &&
        !c.reference
          ? parseReminderRequest(
              c.content,
              !!ws.personal_owner_id,
              messageIntent.displayName,
            )
          : null;
      if (
        reminder &&
        c.clientTimeZone &&
        !(await legacyAddressTargetsMember(
          tx,
          w,
          actor,
          c.content,
          undefined,
          messageIntent.displayName,
        ))
      ) {
        requireThat(sessionId, "SESSION_REQUIRED", 401);
        await recordReminderRequest(
          tx,
          ws,
          actor,
          messageId,
          reminder,
          c.clientTimeZone,
          sessionId,
          personalInTransaction,
        );
        await changed(tx, w, c.type, false, false, {
          kind: "message",
          id: messageId,
        });
        return { messageId };
      }
      if (
        ws.personal_owner_id &&
        !isAssistantAddress(c.content, messageIntent.displayName)
      ) {
        await changed(tx, w, c.type);
        return { messageId };
      }
      const { streamTitle, objective } = messageIntent;
      if (streamTitle) {
        const operation = await createConversationWorkstream(
          tx,
          w,
          actor,
          messageId,
          streamTitle,
        );
        return { messageId, ...operation };
      }
      await tx.query(
        "INSERT INTO interpretation(id,workspace_id,source_id,status) VALUES($1,$2,$3,'queued')",
        [interpretationId, w, messageId],
      );
      await bindAssistantTurn(
        tx,
        conversationScope(w, ws.personal_owner_id),
        interpretationId,
        0,
      );
      await enqueue(tx, interpretationId);
      await changed(tx, w, c.type, false, false, {
        kind: "message",
        id: messageId,
      });
      const work = objective
        ? await createActiveWork(tx, w, objective, messageId, actor)
        : undefined;
      return { messageId, interpretationId, ...work };
    }
    case "invitation.create": {
      const relationship = await capability(tx, w, actor, "invitations");
      const contactId = c.contactId ?? null;
      const email = contactId
        ? (await resolvePersonalContactEmails(tx, actor, [contactId])).get(
            contactId,
          )
        : c.email;
      requireThat(email, "PERSONAL_CONTACT_UNAVAILABLE", 409);
      return issueInvitation(
        tx,
        w,
        actor,
        relationship,
        email,
        c.sendEmail === true,
        contactId,
      );
    }
    case "invitation.revoke": {
      await capability(tx, w, actor, "invitations");
      const r = await tx.query(
        "UPDATE invitation SET revoked_at=now() WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
        [w, c.invitationId],
      );
      requireThat(r.rowCount, "INVITATION_INVALID");
      await changed(tx, w, c.type);
      return {};
    }
    case "member.remove":
    case "member.leave":
    case "access.relinquish": {
      const person = c.type === "member.remove" ? c.personId : actor;
      if (c.type === "member.remove") {
        requireThat(
          c.expectedAccessRevision === ws.access_revision,
          "AUTHORITY_STALE",
        );
        requireThat(person !== actor, "USE_VOLUNTARY_LEAVE");
        await capability(tx, w, actor, "remove_members");
        // Revocable invitation delegation has no peer protection; stewardship changes use its own conditions.
        const protectedTarget = await tx.query(
          "SELECT 1 FROM access_relationship WHERE workspace_id=$1 AND holder_id=$2 AND active AND (protected OR kind='stewardship')",
          [w, person],
        );
        requireThat(
          !protectedTarget.rowCount,
          "GOVERNANCE_CHANGE_REQUIRES_OWN_CONDITIONS",
          403,
        );
      }
      if (c.type !== "access.relinquish") {
        const r = await tx.query(
          "UPDATE membership SET active=false,version=version+1 WHERE workspace_id=$1 AND user_id=$2 AND active RETURNING user_id",
          [w, person],
        );
        requireThat(r.rowCount, "MEMBER_NOT_ACTIVE");
        await membershipHistory(tx, w, person, actor, c.type);
      }
      await tx.query(
        "UPDATE access_relationship SET active=false,version=version+1 WHERE workspace_id=$1 AND holder_id=$2 AND active",
        [w, person],
      );
      await accessHistory(tx, w, person, actor, c.type);
      // Named conditions survive. No last-governor veto, implicit successor or creator override.
      await changed(tx, w, c.type, false, true);
      return {};
    }
    case "information.accept":
    case "information.correct": {
      await member(tx, w, actor, true);
      const candidate = await candidateFor(tx, ws, c.candidateId);
      requireThat(
        candidate.classification === "descriptive",
        "DESCRIPTIVE_CLARIFICATION_REQUIRED",
      );
      let informationId: string, version: number;
      if (c.type === "information.accept") {
        requireThat(
          !(
            await tx.query(
              "SELECT 1 FROM accepted_information WHERE workspace_id=$1 AND subject=$2",
              [w, candidate.subject],
            )
          ).rowCount,
          "INFORMATION_EXISTS_USE_CORRECTION",
        );
        informationId = randomUUID();
        version = 1;
        await tx.query(
          "INSERT INTO accepted_information(id,workspace_id,subject,current_version) VALUES($1,$2,$3,1)",
          [informationId, w, candidate.subject],
        );
      } else {
        const r = await tx.query(
          "SELECT current_version,subject FROM accepted_information WHERE workspace_id=$1 AND id=$2",
          [w, c.informationId],
        );
        requireThat(
          r.rows[0]?.current_version === c.expectedVersion,
          "INFORMATION_VERSION_STALE",
        );
        requireThat(
          r.rows[0].subject === candidate.subject,
          "CORRECTION_SUBJECT_MISMATCH",
        );
        informationId = c.informationId;
        version = c.expectedVersion + 1;
        await tx.query(
          "UPDATE accepted_information SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
          [w, informationId, version],
        );
      }
      await tx.query(
        "INSERT INTO information_version(workspace_id,information_id,version,content,qualification,candidate_id,accepted_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          w,
          informationId,
          version,
          candidate.content,
          candidate.qualification,
          c.candidateId,
          actor,
          c.type === "information.correct"
            ? c.reason
            : "Explicit editorial acceptance",
        ],
      );
      await changed(tx, w, c.type, true);
      return { informationId, version };
    }
    case "commitment.propose": {
      await member(tx, w, actor, true);
      const candidate = await candidateFor(tx, ws, c.candidateId);
      const people = [...new Set(c.people)].sort();
      requireThat(people.includes(actor), "MUST_REPRESENT_SELF");
      for (const person of people) await member(tx, w, person);
      const goal = await tx.query(
        "SELECT id,current_version FROM goal WHERE workspace_id=$1 AND current_primary",
        [w],
      );
      const proposalId = randomUUID();
      await tx.query(
        "INSERT INTO normative_proposal(id,workspace_id,candidate_id,content,kind,proposed_by,goal_id,goal_version,context_revision) VALUES($1,$2,$3,$4,'commitment',$5,$6,$7,$8)",
        [
          proposalId,
          w,
          candidate.id,
          candidate.content,
          actor,
          goal.rows[0]?.id ?? null,
          goal.rows[0]?.current_version ?? null,
          ws.context_revision,
        ],
      );
      for (const person of people)
        await tx.query(
          "INSERT INTO required_project_approval(workspace_id,proposal_id,person_id) VALUES($1,$2,$3)",
          [w, proposalId, person],
        );
      await changed(tx, w, c.type);
      return { proposalId };
    }
    case "commitment.approve": {
      await member(tx, w, actor, true);
      requireThat(
        c.expectedContextRevision === ws.context_revision,
        "CONTEXT_STALE",
      );
      requireThat(
        c.expectedAccessRevision === ws.access_revision,
        "AUTHORITY_STALE",
      );
      const p = await tx.query(
        "SELECT * FROM normative_proposal WHERE workspace_id=$1 AND id=$2",
        [w, c.proposalId],
      );
      requireThat(p.rowCount, "PROPOSAL_NOT_FOUND", 404);
      requireThat(!p.rows[0].source_id, "USE_PROJECT_APPROVAL");
      requireThat(
        p.rows[0].context_revision === ws.context_revision,
        "PROPOSAL_STALE",
      );
      requireThat(
        !(
          await tx.query(
            "SELECT 1 FROM project_act WHERE workspace_id=$1 AND proposal_id=$2",
            [w, c.proposalId],
          )
        ).rowCount,
        "ALREADY_ADOPTED",
      );
      const people = await tx.query<{ person_id: string }>(
        "SELECT person_id FROM required_project_approval WHERE workspace_id=$1 AND proposal_id=$2",
        [w, c.proposalId],
      );
      requireThat(
        people.rows.some((p) => p.person_id === actor),
        "NOT_A_NAMED_APPROVER",
        403,
      );
      await tx.query(
        "INSERT INTO project_approval(id,workspace_id,proposal_id,person_id,context_revision,access_revision) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          w,
          c.proposalId,
          actor,
          ws.context_revision,
          ws.access_revision,
        ],
      );
      const approvals = await tx.query<{ id: string; person_id: string }>(
        "SELECT DISTINCT ON(person_id) id,person_id FROM project_approval WHERE workspace_id=$1 AND proposal_id=$2 AND context_revision=$3 AND access_revision=$4 ORDER BY person_id,created_at DESC",
        [w, c.proposalId, ws.context_revision, ws.access_revision],
      );
      let adopted = false;
      if (approvals.rowCount === people.rowCount) {
        for (const p of people.rows)
          await member(tx, w, p.person_id, true, true);
        const actId = randomUUID();
        await tx.query(
          "INSERT INTO project_act(id,workspace_id,proposal_id) VALUES($1,$2,$3)",
          [actId, w, c.proposalId],
        );
        for (const a of approvals.rows)
          await tx.query(
            "INSERT INTO act_approval(workspace_id,act_id,approval_id) VALUES($1,$2,$3)",
            [w, actId, a.id],
          );
        adopted = true;
      }
      await changed(tx, w, c.type, adopted);
      return { adopted };
    }
    case "interpretation.retry": {
      await member(tx, w, actor, true);
      const r = await tx.query(
        "UPDATE interpretation SET status='queued',generation=generation+1,routing_epoch=routing_epoch+1,lease_until=NULL,error_code=NULL,failed_explicit_request=NULL WHERE workspace_id=$1 AND id=$2 AND (status IN ('completed','stale','failed') OR (status='running' AND lease_until<now())) RETURNING id,source_id,routing_epoch",
        [w, c.interpretationId],
      );
      requireThat(r.rowCount, "INTERPRETATION_NOT_RETRYABLE");
      await requireAvailableDocuments(tx, w, [r.rows[0].source_id]);
      await bindAssistantTurn(
        tx,
        conversationScope(w, ws.personal_owner_id),
        c.interpretationId,
        r.rows[0].routing_epoch,
      );
      await enqueue(tx, c.interpretationId);
      await changed(tx, w, c.type);
      return {};
    }
  }
  throw new DomainError("INVALID_COMMAND", 400);
}
