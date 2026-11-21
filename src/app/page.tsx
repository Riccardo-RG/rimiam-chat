"use client";
import { useUiLanguage } from "../client/ui-language";
import { customSpaceAssistantLabels } from "../shared/connection-name";

import { ChatSketch } from "@/client/chat-sketch";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { WorkspaceIcon } from "@/client/workspace-icon";
import {
  ConversationMilestones,
  useConversationMilestones,
} from "@/client/conversation-milestones";
import type { ConversationMilestone } from "@/contracts/conversation-milestones";
import {
  initials,
  messageDay,
  mobileDayLabel,
  chatClock,
  startsReadingInterval,
} from "@/client/conversation-presentation";
import { assistantRequestFailures } from "@/shared/assistant-request-failures";
import { AssistantRequestFeedback } from "@/client/assistant-request-feedback";
import { MessageFile } from "@/client/message-file";
import { WorkspacePeople } from "@/client/workspace-people";
import { WorkspaceLinks } from "@/client/workspace-links";
import { WorkspaceCreation } from "@/client/workspace-create";
import {
  IncomingInvitations,
  InvitationAdmission,
  WorkspaceInvitation,
  type PersonalInvitation,
  type InboxAvailability,
} from "@/client/workspace-invitation";
import { useTabDraft } from "@/client/tab-draft";
import {
  GeneratedDocument,
  generatedDocumentPrompt,
  type DocumentRequest,
} from "@/client/generated-document";
import {
  PrivateWorkspaceReading,
  ConsultationSources,
  ConsultationEvidence,
} from "@/client/private-consultation";
import type { ConsultationRef } from "@/contracts/private-consultation";
import { conversationReferenceSchema } from "@/contracts/activity";
import { WorkspaceContext } from "@/client/workspace-context";
import { WorkspaceGuide } from "@/client/workspace-guide";
import type {
  ComposerActionId,
  ComposerDestination,
} from "@/client/composer-actions";
import { WorkspaceLens, WorkspaceMenu } from "@/client/workspace-lens";
import { WorkspaceBetaFeedback } from "@/client/workspace-beta-feedback";
import { feedbackFromComposer } from "@/shared/beta-feedback";
import {
  IdentityImage,
  IdentityPhotoEditor,
  photoUrl,
  useIdentityPhotos,
} from "@/client/identity-photos";
import { ProfileLink } from "@/client/participant-profile";
import {
  AppearanceControl,
  AppearanceToggle,
} from "@/client/appearance-control";
import { BrandSignature, EmmeMessageMark } from "@/client/brand-signature";
import { BetaNotice } from "@/client/beta-notice";
import { AccountAccess } from "@/client/account-access";
import entryStyles from "@/client/workspace-entry.module.css";
import { useFocusedHistory } from "@/client/focused-history";
import type { ConversationDirectoryEntry } from "@/contracts/conversation-reading";
import {
  DirectContactLauncher,
  useDirectDirectory,
} from "@/client/direct-directory";
import { usePersonalReading } from "@/client/personal-reading";
import { ChatReminderLine } from "@/client/chat-reminder-line";
import { TaskOfferLine } from "@/client/task-offer-line";
import { MessageAddressActions } from "@/client/message-address-actions";
import { resolveMentionIds } from "@/shared/conversation-mentions";
import { useConversationScroll } from "@/client/conversation-scroll";
import {
  ConversationComposerDock,
  ConversationMessageInput,
  ComposerActionShortcut,
  type ComposerInputHandle,
  type ComposerDockHandle,
} from "@/client/conversation-composer-dock";
import {
  WorkspaceActivity,
  ReferenceInspector,
} from "@/client/workspace-activity";
import type { ConversationReference } from "@/contracts/activity";
import type { AttentionView } from "@/contracts/attention";
import {
  addressMiriam,
  askAboutMessage,
  defaultQuotedQuestion,
} from "@/shared/miriam-address";
import { canAskAboutMessage, MessageQuestion } from "@/client/message-question";
import {
  ConversationAudioActions,
  ConversationVoice,
  VoiceMessage,
} from "@/client/conversation-voice";
import {
  useMessageAttachments,
  MessageAttachmentQueue,
} from "@/client/message-attachments";
import { WorkspaceCall } from "@/client/workspace-call";
import { SpokenReply } from "@/client/spoken-reply";
import { WorkspaceAccess } from "@/client/workspace-access";
import { WorkspaceProject } from "@/client/workspace-project";
import {
  WorkspaceAttention,
  type CompactAttention,
} from "@/client/workspace-attention";
import {
  WorkspaceLayer,
  type DocumentExitGuard,
} from "@/client/workspace-layer";
import { useWorkspaceSync } from "@/client/workspace-sync";
import { WorkspaceConnectionNotice } from "@/client/workspace-connection";
import {
  PushIdentityGuard,
  WorkspacePushPrompt,
  WorkspacePushSettings,
  disablePushBeforeLogout,
} from "@/client/workspace-push";
import { WorkspaceTasks } from "@/client/workspace-tasks";
import { HomeToday, type HomeTodayHandle } from "@/client/home-today";
import { personalChatCommand } from "@/client/personal-chat-controls";
import { AccountDisclosure } from "@/client/account-disclosure";
import { AccountMenu } from "@/client/account-menu";
import {
  RailToggleIcon,
  WorkspaceRail,
  useWorkspaceRail,
} from "@/client/workspace-rail";
import railStyles from "@/client/navigation-rail.module.css";
import {
  AssistantSettingsDialog,
  useAssistantSettings,
  type SettingsScope,
} from "@/client/assistant-settings";
import { PersonalLauncher } from "@/client/personal-launcher";
import type { PersonalTab } from "@/client/personal-utilities";
import { WorkspaceActiveWork } from "@/client/workspace-active-work";
import { EmmePresence, useCompactActivity } from "@/client/emme-presence";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  accountReturnFromSearch,
  workspaceEntryFromSearch,
} from "@/shared/account-navigation";
import { auth } from "@/client/auth-client";
import {
  newCommand,
  sendCommand,
  pendingCommands,
  type PendingCommand,
} from "@/client/command-journal";
import { PendingCommands } from "@/client/pending-commands";
import { api, errorText } from "@/client/api";
import type { Command } from "@/contracts/commands";
import type { Candidate, Snapshot } from "@/client/types";
import {
  useConversationHandoffs,
  ConversationHandoffs,
  HandoffContext,
  handoffDestination,
} from "@/client/conversation-handoffs";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
import type { ProductAssistance } from "@/contracts/product-assistance";
import {
  assistanceForMessage,
  type ProductHelpDraft,
} from "@/client/product-help-draft";
import {
  ProductHelpProvider,
  ProductHelp,
  AssistanceReference,
  assistanceQuestion,
} from "@/client/product-help";

import { WorkspaceQuestions } from "@/client/workspace-questions";

function PanelLoading() {
  const { t: uiText } = useUiLanguage();
  return <p role="status">{uiText("Caricamento della vista…")}</p>;
}

function WorkspaceInviteButton({ open }: { open: () => void }) {
  const { t: uiText } = useUiLanguage();
  const anchor = useRef<HTMLSpanElement>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        anchor.current?.matches(":hover, :focus-within")
      )
        setDismissed(true);
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, []);
  return (
    <span
      ref={anchor}
      className="workspace-invite"
      data-dismissed={dismissed || undefined}
      onPointerEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
    >
      <button
        type="button"
        className="invite-trigger"
        aria-label={uiText("Invita")}
        aria-describedby="workspace-invite-tip"
        aria-haspopup="dialog"
        onClick={() => {
          setDismissed(true);
          open();
        }}
      >
        <WorkspaceIcon name="invite" />
      </button>
      <span id="workspace-invite-tip" role="tooltip">
        {uiText("Invita una persona")}
      </span>
    </span>
  );
}
const PersonalUtilities = dynamic(
  () =>
    import("@/client/personal-utilities").then(
      (module) => module.PersonalUtilities,
    ),
  { loading: PanelLoading },
);
const WorkspaceArtifacts = dynamic(
  () =>
    import("@/client/workspace-artifacts").then(
      (module) => module.WorkspaceArtifacts,
    ),
  { loading: PanelLoading },
);
const WorkspaceSources = dynamic(
  () =>
    import("@/client/workspace-sources").then(
      (module) => module.WorkspaceSources,
    ),
  { loading: PanelLoading },
);
const WorkspaceCalendar = dynamic(
  () =>
    import("@/client/workspace-calendar").then(
      (module) => module.WorkspaceCalendar,
    ),
  { loading: PanelLoading },
);
const WorkspaceEmail = dynamic(
  () =>
    import("@/client/workspace-email").then((module) => module.WorkspaceEmail),
  { loading: PanelLoading },
);
type AvailabilityStatus = "loading" | "ready" | "failed";
function WorkspaceListAvailability({
  status,
  error,
  retry,
}: {
  status: AvailabilityStatus;
  error: string;
  retry: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (status === "ready") return null;
  return (
    <section
      aria-label={uiText("Elenco degli spazi")}
      aria-busy={status === "loading"}
    >
      {status === "loading" ? (
        <p role="status">{uiText("Caricamento dei tuoi spazi…")}</p>
      ) : (
        <>
          <p role="alert">
            {uiText("Non riesco a caricare i tuoi spazi. ")}
            {error}
          </p>
          <button type="button" className="quiet" onClick={retry}>
            {uiText("Riprova a caricare gli spazi")}
          </button>
        </>
      )}
    </section>
  );
}

const panelTitles: Record<string, string> = {
  lens: "Dentro il vostro spazio",
  guide: "Guida dello spazio",
  questions: "Domande aperte",
  goal: "La direzione",
  attention: "Attività e argomenti",
  reference: "Il passaggio",
  context: "Contesto condiviso",
  evidence: "Fonte della consultazione",
  recap: "Il tuo riepilogo",
  work: "In programma",
  materials: "Materiali dello spazio",
  tools: "Strumenti",
  people: "Persone e accesso",
  invite: "Invita una persona",
  calendar: "Calendario",
  email: "Email",
  sources: "Fonti e ricerca",
  artifacts: "Condivisi",
  feedback: "Feedback beta",
  notifications: "Notifiche su questo dispositivo",
};

function subscribeNavigation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readAccountReturn = () => accountReturnFromSearch(window.location.search);
const serverAccountReturn = () => "/";
function time(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : "REQUEST_FAILED";
  return errorText(new Error(message));
}

export default function Home() {
  const state = auth.useSession();
  return (
    <>
      <PushIdentityGuard
        actor={state.data?.user.id ?? null}
        sessionId={state.data?.session.id ?? null}
        checking={state.isPending}
      />
      <WorkspaceApp
        key={state.data?.session.id ?? "signed-out"}
        session={state.data}
        isPending={state.isPending}
      />
    </>
  );
}

function WorkspaceApp({
  session,
  isPending,
}: {
  session: ReturnType<typeof auth.useSession>["data"];
  isPending: boolean;
}) {
  const { locale: uiLocale, t: uiText } = useUiLanguage();
  const router = useRouter();
  const [entry, setEntry] = useState(() =>
    workspaceEntryFromSearch(
      typeof window === "undefined" ? "" : window.location.search,
    ),
  );
  const [workspaceId, setWorkspaceId] = useState(entry.workspace);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const draftKey = "rimiam-draft:" + session?.session.id + ":" + workspaceId;
  const [panel, setPanelState] = useState(() => {
    const requested =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("panel");
    return entry.workspace &&
      (requested === "email" || requested === "calendar")
      ? requested
      : "";
  });
  const [panelTrail, setPanelTrail] = useState<string[]>([]);
  const previousPanel = panelTrail.at(-1);
  const [panelEntry, setPanelEntry] = useState<{
    action: ComposerActionId;
    request: number;
  } | null>(null);
  const entryNumber = useRef(0);
  const rail = useWorkspaceRail();
  const compactActivity = useCompactActivity();
  const navigationOpen = rail.drawerOpen;
  const today = useRef<HomeTodayHandle>(null);
  const [agendaPage, setAgendaPage] = useState(
    () =>
      typeof window !== "undefined" &&
      !entry.workspace &&
      !entry.invitation &&
      Boolean(session?.user.emailVerified) &&
      window.location.hash === "#oggi",
  );
  const [agendaTarget, setAgendaTarget] = useState<
    "today" | "calendars" | null
  >(() => (agendaPage ? "today" : null));
  useEffect(() => {
    if (!agendaTarget || !today.current) return;
    if (agendaTarget === "today") today.current.openToday();
    else today.current.openCalendars();
    setAgendaTarget(null);
  }, [agendaTarget, agendaPage, session?.user.emailVerified]);
  const [homeCalendarLinked, setHomeCalendarLinked] = useState<boolean | null>(
    null,
  );
  const [lensLayout, setLensLayout] = useState<"drawer" | "docked" | "wide">(
    "drawer",
  );
  const lensDocked = lensLayout === "docked";
  const [selectedWork, setSelectedWork] = useState("");
  const [selectedCompletion, setSelectedCompletion] = useState<number>();
  const [selectedHandoff, setSelectedHandoff] =
    useState<ConversationHandoff | null>(null);
  const [documentRequest, setDocumentRequest] =
    useState<DocumentRequest | null>(null);
  const [evidence, setEvidence] = useState<ConsultationRef | null>(null);
  const [recap, setRecap] = useState<{ anchor: string; id: string } | null>(
    null,
  );
  const [selectedReference, setSelectedReference] =
    useState<ConversationReference | null>(null);
  const [composerReference, setComposerReference] = useTabDraft<{
    reference: ConversationReference;
    title: string;
  } | null>(draftKey + ":reference", null);
  const composerDock = useRef<ComposerDockHandle>(null);
  const documentExitGuard = useRef<DocumentExitGuard>(null);
  const composerInput = useRef<ComposerInputHandle>(null);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    title: string;
    ask: boolean;
    sourceId?: string;
    scope: string;
  } | null>(null);
  const pendingComposerReceipt = useRef<{
    request: ReturnType<typeof newCommand>;
    draft: { text: string; scope: string };
    apply: () => void;
  } | null>(null);
  const [sendingCommandId, setSendingCommandId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  type SubmittedDraft = {
    text: string;
    scope: string;
    files: string[];
    quoteId: string | null;
    reference: ConversationReference | null;
    mentions: string[];
  };
  function confirmComposerReceipt(commandId: string) {
    const pending = pendingComposerReceipt.current;
    let restored = false;
    try {
      if (sessionStorage.getItem(draftKey + ":receipt") === commandId) {
        const saved = sessionStorage.getItem(draftKey + ":submitted");
        if (saved) {
          const submitted = JSON.parse(saved) as SubmittedDraft;
          if (!pending && submitted.scope === messageScope) {
            const quoteId =
              replyTarget?.scope === messageScope ? replyTarget.id : null;
            if (
              messageDraft.text === submitted.text &&
              quoteId === submitted.quoteId &&
              JSON.stringify(composerReference?.reference ?? null) ===
                JSON.stringify(submitted.reference) &&
              JSON.stringify(chosenMentions) ===
                JSON.stringify(submitted.mentions)
            ) {
              setMessageDraft({ text: "", scope: messageScope });
              setChosenMentions([]);
              setComposerReference(null);
              if (quoteId) clearQuote();
            }
            attachments.clearSent(
              attachments.items.filter((i) => submitted.files.includes(i.id)),
            );
            restored = true;
          }
        }
        sessionStorage.removeItem(draftKey + ":receipt");
        sessionStorage.removeItem(draftKey + ":submitted");
      }
    } catch {
      /* Recovery remains available from the server journal. */
    }
    if (restored) setSendError("");
    if (pending?.request.commandId !== commandId) return;
    pendingComposerReceipt.current = null;
    setSendError("");
    pending.apply();
  }
  const [messageDraft, setMessageDraft] = useTabDraft(draftKey + ":message", {
    text: "",
    scope: "",
  });
  const [chosenMentions, setChosenMentions] = useTabDraft<string[]>(
    draftKey + ":mentions",
    [],
  );
  const [composerAssistance, setComposerAssistance] =
    useState<ProductHelpDraft | null>(null);
  const latestComposer = useRef({
    messageDraft,
    replyTarget,
    composerReference,
    composerAssistance,
  });
  useLayoutEffect(() => {
    latestComposer.current = {
      messageDraft,
      replyTarget,
      composerReference,
      composerAssistance,
    };
  }, [messageDraft, replyTarget, composerReference, composerAssistance]);
  const [helpInConversation, setHelpInConversation] = useState(false);
  function setPanel(next: string, trail: string[] = []) {
    setPanelTrail(trail);
    setPanelEntry(null);
    setHelpInConversation(false);
    setComposerAssistance(null);
    setPanelState(next);
  }
  const [feedbackMessage, setFeedbackMessage] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [requestedSource, setRequestedSource] = useState<{ id: string } | null>(
    null,
  );
  const revealedSource = useRef<object | null>(null);
  const revealedHandoff = useRef("");
  const [focusedStream, setFocusedStream] = useState<
    AttentionView["workstreams"][number] | null
  >(null);
  const readingGeneration = useRef(0);
  const [workstreams, setWorkstreams] = useState<AttentionView["workstreams"]>(
    [],
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [spaces, setSpaces] = useState<
    (Pick<ConversationDirectoryEntry, "id" | "name"> &
      Partial<ConversationDirectoryEntry>)[]
  >([]);
  const [spacesStatus, setSpacesStatus] =
    useState<AvailabilityStatus>("loading");
  const [spacesError, setSpacesError] = useState("");
  const spacesRead = useRef<AbortController | null>(null);

  const [personalTab, setPersonalTab] = useState<PersonalTab>(() => {
    const tab =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("utility");
    return tab === "documents" || tab === "reminders" ? tab : "chat";
  });
  const [snapshotData, setSnapshot] = useState<Snapshot | null>(null);
  const [inviteToken, setInviteToken] = useState(entry.invitation);
  const [inboxAvailability, setInboxAvailability] =
    useState<InboxAvailability>("checking");
  const snapshot =
    snapshotData?.workspace.id === workspaceId ? snapshotData : null;
  const [invitation, setInvitation] = useState<{
    name: string;
    recipient_email: string;
  } | null>(null);
  const [invitationStatus, setInvitationStatus] =
    useState<AvailabilityStatus>("loading");
  const [invitationError, setInvitationError] = useState("");
  const invitationRead = useRef<AbortController | null>(null);
  const [personalInvite, setPersonalInvite] =
    useState<PersonalInvitation | null>(null);
  const [peopleFor, setPeopleFor] = useState<Candidate | null>(null);
  const [correctionFor, setCorrectionFor] = useState<Candidate | null>(null);
  const revision = useRef(-1);
  const selected = useRef(entry.workspace);
  const viewGeneration = useRef(0);
  const actor = session?.user.id;
  const [assistantScope, setAssistantScope] = useState<SettingsScope | null>(
    null,
  );
  const assistantSettings = useAssistantSettings(
    session?.user.emailVerified && !inviteToken && (!workspaceId || snapshot)
      ? actor
      : undefined,
    workspaceId && !snapshot?.workspace.personal ? workspaceId : undefined,
    true,
    snapshot?.workspace.assistant_settings_revision,
  );
  const currentAssistant = assistantSettings.data;
  const assistantName = currentAssistant?.displayName ?? "Emme";
  const customAssistantLabels = useMemo(
    () => customSpaceAssistantLabels(currentAssistant),
    [currentAssistant],
  );
  const activeConnection = currentAssistant?.connections.find(
    (c) => c.id === currentAssistant.connectionId,
  );
  const homeAssistantScope = { name: "Tu ed Emme" };
  const settingsDialog =
    actor && assistantScope ? (
      <AssistantSettingsDialog
        key={actor + (assistantScope.workspaceId ?? "")}
        actor={actor}
        scope={assistantScope}
        personalSettings={
          !workspaceId || snapshot?.workspace.personal
            ? currentAssistant
            : undefined
        }
        close={() => setAssistantScope(null)}
        onSaved={assistantSettings.retry}
        onScope={setAssistantScope}
      />
    ) : null;
  const directDirectory = useDirectDirectory(
    actor,
    !workspaceId && !inviteToken,
  );
  const homeChats = useMemo(
    () =>
      [
        ...spaces.map((room) => ({ ...room, kind: "space" as const })),
        ...directDirectory.items.map((room) => ({
          ...room,
          kind: "direct" as const,
        })),
      ].sort(
        (a, b) =>
          (Date.parse(b.lastActivityAt ?? "") || 0) -
            (Date.parse(a.lastActivityAt ?? "") || 0) ||
          a.id.localeCompare(b.id),
      ),
    [spaces, directDirectory.items],
  );
  const photos = useIdentityPhotos(
    session?.user.emailVerified ? actor : undefined,
    snapshot?.workspace.id,
    snapshot?.workspace.photo_revision,
  );
  const ownPhoto = photoUrl(photos?.own, undefined, actor);
  const roomPhoto = photoUrl(photos?.rooms[workspaceId], workspaceId);
  const handoffView = useConversationHandoffs(
    snapshot && !snapshot.workspace.personal ? workspaceId : "",
    actor,
    snapshot?.workspace.revision ?? 0,
  );
  const handoff = selectedHandoff
    ? (handoffView.handoffs.find((h) => h.id === selectedHandoff.id) ??
      selectedHandoff)
    : null;
  const focusedHistory = useFocusedHistory(
    actor,
    workspaceId,
    focusedStream?.id,
    snapshot?.messages.at(-1)?.sequence ?? 0,
    snapshot?.workspace.revision ?? 0,
  );
  const displayedMessages = focusedStream
    ? focusedHistory.messages
    : (snapshot?.messages ?? []);
  const messagesById = useMemo(
    () => new Map(snapshot?.messages.map((row) => [row.id, row])),
    [snapshot?.messages],
  );
  const milestones = useConversationMilestones(
    actor,
    focusedStream ? undefined : snapshot?.workspace.id,
    displayedMessages[0]?.id,
    displayedMessages.at(-1)?.id,
    snapshot?.workspace.revision ?? 0,
  );
  function milestoneRows(anchor: string) {
    return (
      <ConversationMilestones
        items={milestones?.get(anchor)}
        open={(item: ConversationMilestone) => {
          if (item.kind === "completed")
            openWork(item.objectId, item.completionRevision);
          else
            inspectReference({
              kind: "commitment",
              id: item.objectId,
              version: 1,
            });
        }}
      />
    );
  }
  const documentSources = useMemo(
    () =>
      new Map(
        snapshot?.sources
          .filter((s) => s.kind === "document")
          .map((s) => [s.id, s]),
      ),
    [snapshot?.sources],
  );
  const filesByMessage = useMemo(() => {
    const result = new Map<string, Snapshot["sources"]>();
    for (const file of documentSources.values()) {
      if (!file.shared_message_id) continue;
      const files = result.get(file.shared_message_id) ?? [];
      files.push(file);
      result.set(file.shared_message_id, files);
    }
    for (const files of result.values())
      files.sort(
        (a, b) => (a.attachment_position ?? 0) - (b.attachment_position ?? 0),
      );
    return result;
  }, [documentSources]);
  const chatFailures = useMemo(
    () =>
      assistantRequestFailures(
        snapshot?.messages ?? [],
        snapshot?.interpretations ?? [],
      ),
    [snapshot?.messages, snapshot?.interpretations],
  );
  const messagesElement = useRef<HTMLDivElement>(null);
  const { onScroll: captureConversationScroll, followLatest } =
    useConversationScroll(
      messagesElement,
      `${actor}:${workspaceId}:${focusedStream?.id ?? "all"}`,
      displayedMessages.map((message) => message.id).join(":"),
      !!focusedStream && focusedHistory.historical,
      displayedMessages[0]?.id,
    );
  const personalReading = usePersonalReading(
    messagesElement,
    workspaceId,
    actor,
    focusedStream ? undefined : snapshot?.reading,
    !focusedStream && !panel && !peopleFor && !correctionFor && !navigationOpen,
    displayedMessages.map((m) => m.id).join(":"),
    captureConversationScroll,
    false,
    requestedSource?.id,
  );
  const currentFocus =
    focusedStream && workstreams.find((s) => s.id === focusedStream.id);
  const focusWritable =
    !focusedStream ||
    (!!currentFocus &&
      currentFocus.version === focusedStream.version &&
      currentFocus.state === "active");
  const messageScope = `${workspaceId}:${focusedStream?.id ?? "all"}:${focusedStream?.version ?? ""}`;
  const attachmentScope = JSON.stringify([actor, messageScope]);
  const attachments = useMessageAttachments(attachmentScope);
  const [sketchScope, setSketchScope] = useState<string | null>(null);
  if (sketchScope !== null && sketchScope !== attachmentScope)
    setSketchScope(null);
  const quoteKey =
    actor &&
    snapshot?.reading &&
    "rimiam:quote:" +
      JSON.stringify([actor, messageScope, snapshot.reading.admission]);
  const quoteHistory = useRef(snapshot?.messages);
  useLayoutEffect(() => {
    quoteHistory.current = snapshot?.messages;
  }, [snapshot?.messages]);
  useEffect(() => {
    if (!quoteKey) return;
    const timer = setTimeout(() => {
      try {
        const raw = JSON.parse(localStorage.getItem(quoteKey) ?? "null");
        const m = quoteHistory.current?.find((m) => m.id === raw?.id);
        if (!m || typeof raw.ask !== "boolean") return;
        setReplyTarget({
          id: m.id,
          title: m.author_name + " · " + m.content.slice(0, 100),
          ask: raw.ask,
          sourceId: typeof raw.sourceId === "string" ? raw.sourceId : undefined,
          scope: messageScope,
        });
      } catch {
        /* The composer also works without local storage. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [quoteKey, messageScope]);
  function clearQuote() {
    setReplyTarget(null);
    if (quoteKey)
      try {
        localStorage.removeItem(quoteKey);
      } catch {
        /* Storage is optional. */
      }
  }
  const draftNeedsScope =
    !!messageDraft.text.trim() && messageDraft.scope !== messageScope;
  const feedbackDraft = feedbackFromComposer(messageDraft.text);
  const assistanceContext = assistanceForMessage(
    composerAssistance,
    messageDraft,
    messageScope,
  );
  useEffect(() => {
    if (
      !handoff ||
      panel !== "context" ||
      correctionFor ||
      revealedHandoff.current === handoff.id
    )
      return;
    const element = document.getElementById(`candidate-${handoff.candidateId}`);
    if (element) {
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      revealedHandoff.current = handoff.id;
    }
  }, [handoff, panel, correctionFor, snapshot]);
  useEffect(() => {
    if (
      !requestedSource ||
      focusedStream ||
      revealedSource.current === requestedSource
    )
      return;
    const element = document.getElementById(`source-${requestedSource.id}`);
    if (element) {
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      revealedSource.current = requestedSource;
    }
  }, [requestedSource, focusedStream, snapshot]);
  const [mode, setMode] = useState("");
  const [localMail, setLocalMail] = useState(false);
  const [providerConfig, setProviderConfig] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [configAttempt, setConfigAttempt] = useState(0);
  const [googleSignInAvailable, setGoogleSignInAvailable] = useState(false);
  const [microsoftSignInAvailable, setMicrosoftSignInAvailable] =
    useState(false);
  const accountReturn = useSyncExternalStore(
    subscribeNavigation,
    readAccountReturn,
    serverAccountReturn,
  );
  useEffect(() => {
    const controller = new AbortController();
    void api<{
      interpretationMode: string;
      localMail: boolean;
      googleSignInAvailable: boolean;
      microsoftSignInAvailable: boolean;
    }>("/api/config", undefined, controller.signal)
      .then((c) => {
        if (controller.signal.aborted) return;
        setMode(c.interpretationMode);
        setLocalMail(c.localMail);
        setGoogleSignInAvailable(c.googleSignInAvailable === true);
        setMicrosoftSignInAvailable(c.microsoftSignInAvailable === true);
        setProviderConfig("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setProviderConfig("error");
      });
    return () => controller.abort();
  }, [configAttempt]);
  const report = useCallback((error: unknown) => {
    setError(readableError(error));
  }, []);
  async function action(fn: () => Promise<void>, showError = setError) {
    const generation = viewGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (error) {
      if (generation === viewGeneration.current)
        showError(readableError(error));
    } finally {
      if (generation === viewGeneration.current) setBusy(false);
    }
  }
  const load = useCallback(
    async (w: string, signal?: AbortSignal) => {
      const generation = viewGeneration.current;
      try {
        const next = await api<Snapshot>(
          `/api/workspaces/${w}`,
          undefined,
          signal,
        );
        if (
          !signal?.aborted &&
          selected.current === w &&
          generation === viewGeneration.current &&
          next.workspace.revision >= revision.current
        ) {
          revision.current = next.workspace.revision;
          setSnapshot(next);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        if (selected.current === w && generation === viewGeneration.current) {
          const terminal =
            error instanceof Error &&
            [
              "WORKSPACE_ACCESS_DENIED",
              "AUTHENTICATION_REQUIRED",
              "ACCOUNT_INELIGIBLE",
            ].includes(error.message);
          if (terminal) setSnapshot(null);
          if (terminal || !signal) report(error);
        }
        throw error;
      }
    },
    [report],
  );
  const refreshSpaces = useCallback(() => {
    spacesRead.current?.abort();
    const controller = new AbortController();
    spacesRead.current = controller;
    return api<ConversationDirectoryEntry[]>(
      "/api/workspaces",
      undefined,
      controller.signal,
    )
      .then((items) => {
        if (controller.signal.aborted) return;
        setSpaces(items);
        setSpacesStatus("ready");
        return items;
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSpacesError(errorText(error));
        setSpacesStatus("failed");
      })
      .finally(() => {
        if (spacesRead.current === controller) spacesRead.current = null;
      });
  }, []);
  useEffect(() => {
    if (!actor || workspaceId || inviteToken) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && !spacesRead.current)
        void refreshSpaces();
    };
    refresh();
    const timer = window.setInterval(refresh, 12000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [actor, workspaceId, inviteToken, refreshSpaces]);
  const refreshInvitation = useCallback((token: string) => {
    invitationRead.current?.abort();
    const controller = new AbortController();
    invitationRead.current = controller;
    const generation = viewGeneration.current;
    return api<{ name: string; recipient_email: string }>(
      `/api/invitations/${encodeURIComponent(token)}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted || generation !== viewGeneration.current)
          return;
        setInvitation(value);
        setInvitationStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== viewGeneration.current)
          return;
        setInvitationError(
          error instanceof Error ? error.message : "REQUEST_FAILED",
        );
        setInvitationStatus("failed");
      })
      .finally(() => {
        if (invitationRead.current === controller)
          invitationRead.current = null;
      });
  }, []);
  function retrySpaces() {
    setSpacesStatus("loading");
    setSpacesError("");
    return refreshSpaces();
  }
  function retryInvitation() {
    setInvitationStatus("loading");
    setInvitationError("");
    void refreshInvitation(inviteToken);
  }
  function signOut() {
    void action(async () => {
      await disablePushBeforeLogout(actor);
      const result = await auth.signOut();
      if (result.error) throw new Error("SIGN_OUT_FAILED");
      // Reload this exact route so a different account can resume its personal invitation.
      window.location.reload();
    });
  }
  useEffect(() => {
    if (!actor) return;
    void refreshSpaces();
    if (entry.invitation) void refreshInvitation(entry.invitation);
    return () => {
      spacesRead.current?.abort();
      invitationRead.current?.abort();
    };
  }, [actor, entry.invitation, refreshSpaces, refreshInvitation]);
  useEffect(() => {
    selected.current = workspaceId;
    revision.current = -1;
  }, [workspaceId, actor]);
  const workspaceSync = useWorkspaceSync(actor, workspaceId, load);
  async function command(
    c: Command,
    onReceipt?: () => void,
    replay?: PendingCommand,
    submission?: SubmittedDraft,
  ) {
    const w = workspaceId;
    const generation = viewGeneration.current;
    const reading = readingGeneration.current;
    const previous = pendingComposerReceipt.current;
    let retry =
      onReceipt &&
      previous?.draft === messageDraft &&
      previous.request.actor === actor &&
      previous.request.workspace === w
        ? previous.request
        : null;
    if (!replay && c.type === "interpretation.retry") {
      // Reuse an attempt whose receipt was lost before starting new AI work.
      retry =
        (await pendingCommands(actor!, w)).find(
          (saved) =>
            saved.command.type === "interpretation.retry" &&
            saved.command.interpretationId === c.interpretationId,
        ) ?? null;
    }
    if (onReceipt && !retry && c.type === "message.send") {
      let id = "";
      try {
        id = sessionStorage.getItem(draftKey + ":receipt") ?? "";
      } catch {
        /* Optional fast recovery hint. */
      }
      if (id)
        retry =
          (await pendingCommands(actor!, w)).find(
            (saved) => saved.commandId === id,
          ) ?? null;
    }
    // A missing receipt can mean the previous send committed. Only replay its
    // original ID and payload; changing the destination requires resolving it.
    if (retry && JSON.stringify(retry.command) !== JSON.stringify(c))
      throw new Error(
        "Verifica l’esito dell’invio precedente prima di cambiare il messaggio o il destinatario.",
      );
    const pending = replay ?? retry ?? newCommand(actor!, w, c);
    if (onReceipt) {
      if (c.type === "message.send")
        try {
          if (submission && !retry && !replay)
            sessionStorage.setItem(
              draftKey + ":submitted",
              JSON.stringify(submission),
            );
          sessionStorage.setItem(draftKey + ":receipt", pending.commandId);
        } catch {
          /* The journal still retains the command. */
        }
      setSendingCommandId(pending.commandId);
      pendingComposerReceipt.current = {
        request: pending,
        draft: messageDraft,
        apply: onReceipt,
      };
    }
    let result;
    try {
      result = await sendCommand(pending);
    } finally {
      if (onReceipt)
        setSendingCommandId((id) => (id === pending.commandId ? null : id));
    }
    // The verified receipt is already retained server-side and cleared from the journal.
    // Stop only the old view's continuation; never publish its result in another space.
    if (generation !== viewGeneration.current)
      throw new Error(
        "Operazione confermata nello spazio di origine; la vista è cambiata.",
      );
    if (onReceipt) confirmComposerReceipt(pending.commandId);
    // A confirmed chat send releases the editor even if the next snapshot is slow.
    // Other callers retain their existing read-after-write behavior.
    if (c.type !== "member.leave" && selected.current === w) {
      const refresh = load(w).catch(() => {});
      if (!onReceipt) await refresh;
    }
    if (generation !== viewGeneration.current)
      throw new Error(
        "Operazione confermata nello spazio di origine; la vista è cambiata.",
      );
    if (
      (c.type === "message.send" ||
        c.type === "voice.send" ||
        (c.type === "document.upload" && c.conversationShare)) &&
      reading === readingGeneration.current &&
      (c.type === "document.upload"
        ? c.conversationShare?.workstreamFocus
        : c.workstreamFocus
      )?.workstreamId === focusedStream?.id
    ) {
      followLatest();
      focusedHistory.recent();
    }
    return result;
  }
  function quoteMessage(
    m: Snapshot["messages"][number],
    resolveSource?: () => Promise<string>,
  ) {
    if (!canContribute || !focusWritable) return;
    const generation = viewGeneration.current,
      reading = readingGeneration.current;
    void action(async () => {
      const sourceId = resolveSource ? await resolveSource() : undefined;
      if (
        generation !== viewGeneration.current ||
        reading !== readingGeneration.current
      )
        return;
      setComposerAssistance(null);
      setComposerReference(null);
      const quote = { id: m.id, ask: !!resolveSource, sourceId };
      if (quoteKey)
        try {
          localStorage.setItem(quoteKey, JSON.stringify(quote));
        } catch {
          /* Continue with an in-memory draft. */
        }
      setReplyTarget({
        ...quote,
        title: m.author_name + " · " + m.content.slice(0, 100),
        scope: messageScope,
      });
      if (resolveSource)
        setMessageDraft((d) =>
          d.text ? d : { text: defaultQuotedQuestion, scope: messageScope },
        );
      composerDock.current?.write();
    });
  }
  function openCreation() {
    choose("");
    setCreatingSpace(true);
    requestAnimationFrame(() =>
      document.getElementById("workspace-content")?.focus(),
    );
  }
  function choose(w: string, utility?: PersonalTab) {
    setAgendaPage(false);
    setAgendaTarget(null);
    setCreatingSpace(false);
    setNotice("");
    if (entry.invalidInvitation) setEntry(workspaceEntryFromSearch(""));
    if (navigationOpen) rail.hide();
    if (w && selected.current === w) {
      if (utility) {
        setPersonalTab(utility);
        window.history.replaceState(
          null,
          "",
          `/?workspace=${w}&utility=${utility}`,
        );
      }
      return;
    }
    viewGeneration.current++;
    pendingComposerReceipt.current = null;
    setSendingCommandId(null);
    setReplyTarget(null);
    setDocumentRequest(null);
    setSendError("");
    selected.current = w;
    revision.current = -1;
    setWorkspaceId(w);
    setPersonalTab(utility ?? "chat");
    invitationRead.current?.abort();
    setInviteToken("");
    setInvitation(null);
    setBusy(false);
    setPeopleFor(null);
    setCorrectionFor(null);
    setPanel("");
    setLensLayout("drawer");
    setSelectedWork("");
    setSelectedHandoff(null);
    setSelectedReference(null);
    setComposerAssistance(null);
    setHelpInConversation(false);
    setFeedbackMessage(null);
    chooseFocus(null);
    setWorkstreams([]);
    setRequestedSource(null);
    setPersonalInvite(null);
    setError("");
    window.history.replaceState(
      null,
      "",
      w ? `/?workspace=${w}${utility ? "&utility=" + utility : ""}` : "/",
    );
  }
  function showPanel(next: string, workId = "", completion?: number) {
    setSelectedCompletion(completion);
    if (next === "work") setSelectedWork(workId);
    setPanel(next);
    if (next === "invite") setError("");
    if (next === "feedback") setFeedbackMessage(null);
  }
  function openPanel(next: string, workId = "", completion?: number) {
    if (navigationOpen) rail.hide();
    showPanel(next, workId, completion);
  }
  function openChildPanel(next: string) {
    if (!next) return openPanel("");
    setPanel(next, [...panelTrail, panel]);
    if (next === "invite") setError("");
  }
  function backPanel() {
    if (previousPanel) setPanel(previousPanel, panelTrail.slice(0, -1));
  }
  function openHeaderPanel(next: string) {
    const enter = () => openPanel(next);
    if (
      panel === "artifacts" &&
      next !== panel &&
      documentExitGuard.current?.(enter)
    )
      return;
    enter();
  }
  function leaveFromRail(enter: () => void) {
    if (
      (panel === "artifacts" || !!snapshot?.workspace.personal) &&
      documentExitGuard.current?.(enter)
    )
      return;
    enter();
  }
  function openAgendaFromRail(target: "today" | "calendars") {
    leaveFromRail(() => {
      choose("");
      setAgendaPage(true);
      setAgendaTarget(target);
      window.history.replaceState(null, "", "/#oggi");
    });
  }
  function chooseFromRail(id: string) {
    leaveFromRail(() => {
      choose(id);
      if (id && id === workspaceId) setPanel("");
    });
  }
  function openPersonalChat(trigger: HTMLButtonElement) {
    leaveFromRail(() => {
      if (navigationOpen) rail.hide();
      const generation = viewGeneration.current;
      void action(async () => {
        const chat = await personalChatCommand<{ id: string }>({
          action: "open",
          expectedActorId: actor!,
        });
        if (trigger.isConnected && generation === viewGeneration.current)
          choose(chat.id, "chat");
      });
    });
  }
  function openSidebarTool(next: string, trigger: HTMLButtonElement) {
    const enter = () => {
      trigger.focus({ preventScroll: true });
      setLensLayout("docked");
      showPanel(next);
    };
    leaveFromRail(enter);
  }
  function handleComposerAction(action: ComposerDestination) {
    if (action === "sketch") {
      if (
        canContribute &&
        focusWritable &&
        !draftNeedsScope &&
        attachments.ready
      )
        setSketchScope(attachmentScope);
      return;
    }
    if (action === "invite" && !access?.invitations) return;
    if (
      (action === "upload" || action === "research" || action === "new-task") &&
      !canContribute
    )
      return;
    const destinations = {
      documents: "artifacts",
      upload: "sources",
      research: "sources",
      context: "context",
      work: "work",
      "new-task": "work",
      invite: "invite",
      goal: "goal",
      questions: "questions",
      calendar: "calendar",
      email: "email",
      people: "people",
      activity: "attention",
      notifications: "notifications",
      feedback: "feedback",
      guide: "guide",
    } as const;
    setSelectedHandoff(null);
    openPanel(destinations[action]);
    setPanelEntry({ action, request: ++entryNumber.current });
  }
  function openWork(id: string, completion?: number) {
    if (window.matchMedia("(min-width: 72rem)").matches)
      setLensLayout("docked");
    openPanel("work", id, completion);
  }
  function focusConversation(stream: AttentionView["workstreams"][number]) {
    chooseFocus(stream);
    setPanel("");
  }
  function chooseFocus(stream: AttentionView["workstreams"][number] | null) {
    readingGeneration.current++;
    setComposerAssistance(null);
    setFocusedStream(stream);
  }
  function revealSource(id: string) {
    chooseFocus(null);
    setPanel("");
    setRequestedSource({ id });
  }
  function openSource(id: string) {
    if (snapshot?.messages.some((message) => message.id === id))
      revealSource(id);
    else inspectReference({ kind: "source", id, version: 1 });
  }
  function openConsulted(ref: ConsultationRef) {
    if (ref.kind === "source") {
      openSource(ref.id);
      return;
    }
    const parsed = conversationReferenceSchema.safeParse({
      kind: ref.kind,
      id: ref.id,
      version: ref.version,
    });
    if (parsed.success) {
      inspectReference(parsed.data);
      return;
    }
    setEvidence(ref);
    openPanel("evidence");
  }
  function inspectReference(reference: ConversationReference) {
    setSelectedReference(reference);
    openPanel("reference");
  }
  function openHandoff(handoff: ConversationHandoff) {
    if (handoff.status === "applied" && handoff.application?.resultReference) {
      inspectReference(handoff.application.resultReference);
      return;
    }
    if (handoff.status === "stale" && handoff.target) {
      inspectReference(handoff.target);
      return;
    }
    setSelectedHandoff(handoff);
    openPanel(handoffDestination(handoff));
    if (handoff.kind === "information.correct" && handoff.candidateId) {
      const candidate = snapshot?.candidates.find(
        (c) => c.id === handoff.candidateId,
      );
      if (candidate) setCorrectionFor(candidate);
    }
  }
  function askReference(reference: ConversationReference, title: string) {
    setComposerAssistance(null);
    clearQuote();
    setComposerReference({ reference, title });
    setPanel("");
    requestAnimationFrame(() => composerDock.current?.write());
  }
  function askProduct(context: ProductAssistance) {
    clearQuote();
    setComposerReference(null);
    setComposerAssistance({ context, scope: messageScope });
    setMessageDraft((draft) =>
      draft.text
        ? draft
        : { text: assistanceQuestion(context, uiText), scope: messageScope },
    );
    setHelpInConversation(!!(panel || peopleFor || correctionFor));
    requestAnimationFrame(() => composerDock.current?.write());
  }
  const name = (id: string) =>
    snapshot?.members.find((m) => m.user_id === id)?.name ?? "Membro";
  const access = snapshot?.access.find(
    (a) => a.holder_id === actor && a.active,
  );
  const activeMembers =
    snapshot?.members.filter((member) => member.active) ?? [];
  const goal = snapshot?.goals.find((g) => g.current_primary);
  const emmeUnconfigured = currentAssistant
    ? !activeConnection?.configured || currentAssistant.needsReconfirmation
    : mode === "unconfigured";
  const readingStatus = emmeUnconfigured
    ? null
    : snapshot?.interpretations.some((i) => i.status === "running")
      ? `${assistantName} sta leggendo…`
      : snapshot?.interpretations.some((i) => i.status === "queued")
        ? `Lettura di ${assistantName} in attesa.`
        : null;
  const canContribute = snapshot?.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const chatMembers = (snapshot?.members ?? [])
    .filter((p) => p.active)
    .map((p) => ({ id: p.user_id, name: p.name }));
  if (!isPending && entry.invalidInvitation)
    return (
      <main className="card admission">
        <h1>{uiText("Link d’invito incompleto")}</h1>
        <p>
          {uiText(
            "Apri il link completo ricevuto per email oppure chiedi a chi ti ha invitato di copiarlo di nuovo.",
          )}
        </p>
        <button type="button" className="quiet" onClick={() => choose("")}>
          {uiText("Vai a RIMIAM")}
        </button>
      </main>
    );
  if (!session)
    return (
      <main className={entryStyles.access}>
        <div className={entryStyles.cover}>
          <button
            type="button"
            className={entryStyles.signature}
            aria-label={uiText("RIMIAM — Home")}
            onClick={() => choose("")}
          >
            <BrandSignature />
          </button>
          <div className={entryStyles.coverText}>
            <h1>{uiText("La chat di progetto.")}</h1>
            <p>
              {uiText(
                "Parla con il tuo gruppo. Con Emme puoi ritrovare una decisione, confrontare le fonti e riprendere il lavoro da dove l’avete lasciato.",
              )}
            </p>
          </div>
        </div>
        <div className={entryStyles.accessPane}>
          <div className={entryStyles.appearance}>
            <AppearanceControl />
          </div>
          {isPending && (
            <p role="status">{uiText("Verifica della sessione…")}</p>
          )}
          <div hidden={isPending}>
            <AccountAccess
              returnTo={accountReturn}
              localMail={localMail}
              googleAvailable={googleSignInAvailable}
              microsoftAvailable={microsoftSignInAvailable}
              sessionPending={isPending}
              providerConfig={providerConfig}
              retryConfig={() => {
                setProviderConfig("loading");
                setConfigAttempt((attempt) => attempt + 1);
              }}
            />
          </div>
        </div>
      </main>
    );
  const navigationToggle = (
    <button
      type="button"
      className="rail-icon navigation-toggle"
      id="navigation-toggle"
      aria-label={uiText("Apri navigazione")}
      title={uiText("Apri navigazione")}
      aria-controls="workspace-navigation"
      aria-expanded={rail.compact ? navigationOpen : !rail.collapsed}
      onClick={rail.show}
    >
      <RailToggleIcon />
    </button>
  );
  const personalPage =
    snapshot?.workspace.personal && !inviteToken ? (
      <div className={railStyles.personalPane}>
        <BetaNotice actorId={session.user.id} />
        <WorkspaceConnectionNotice
          state={workspaceSync.connection}
          retry={() => void workspaceSync.refresh()}
        />
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button
              type="button"
              className="quiet"
              onClick={() => setError("")}
            >
              {uiText("Chiudi")}
            </button>
          </div>
        )}
        <PersonalUtilities
          key={workspaceId}
          state={snapshot}
          actor={session.user.id}
          busy={busy}
          action={action}
          command={command}
          refreshed={() => load(workspaceId)}
          tab={personalTab}
          navigationToggle={navigationToggle}
          exitGuard={documentExitGuard}
          navigate={choose}
          onHome={() => choose("")}
          offline={workspaceSync.connection === "offline"}
          aiUnavailable={emmeUnconfigured}
          assistantName={assistantName}
          onConfigure={() => setAssistantScope(homeAssistantScope)}
          onTab={(tab) => {
            setPersonalTab(tab);
            window.history.replaceState(
              null,
              "",
              `/?workspace=${workspaceId}&utility=${tab}`,
            );
          }}
          notifications={
            <details>
              <summary aria-label={uiText("Notifiche personali")}>
                <WorkspaceIcon name="bell" />
                <span>{uiText("Notifiche personali")}</span>
              </summary>
              <WorkspacePushSettings
                workspaceId={workspaceId}
                actor={session.user.id}
                sessionId={session.session.id}
              />
            </details>
          }
        />
      </div>
    ) : null;
  const readingNeedsReview = Boolean(
    snapshot?.interpretations.some(
      (item) => item.status === "failed" || item.status === "stale",
    ),
  );
  function presence(attention?: CompactAttention) {
    if (!snapshot) return null;
    return (
      <EmmePresence
        assistantName={assistantName}
        key={`presence:${actor}:${workspaceId}`}
        workspace={workspaceId}
        actor={actor!}
        revision={snapshot.workspace.revision}
        openWork={openWork}
        overview={
          attention && {
            attention,
            goal: goal?.content,
            emmeUnconfigured,
            reading: readingStatus,
            readingNeedsReview,
            open: openHeaderPanel,
          }
        }
      />
    );
  }
  const compactAttention = snapshot && (
    <WorkspaceAttention
      key={`attention:${actor}:${workspaceId}`}
      workspace={workspaceId}
      actor={actor!}
      compact
      renderSummary={compactActivity ? presence : undefined}
      open={openPanel}
      command={command}
      action={action}
      busy={busy}
      canContribute={!!canContribute}
      name={name}
      onWorkstreams={setWorkstreams}
    />
  );
  const shell = (
    <div
      className="app-shell"
      data-navigation={navigationOpen ? "open" : "closed"}
      data-rail-collapsed={rail.collapsed || undefined}
    >
      <a className="skip-link" href="#workspace-content">
        {uiText("Vai alla conversazione")}
      </a>
      <WorkspaceRail layout={rail}>
        <div className="rail-brand-row">
          <button
            type="button"
            className="rail-brand"
            onClick={() => chooseFromRail("")}
            aria-label={uiText("RIMIAM — Home")}
          >
            <BrandSignature />
          </button>
          <button
            type="button"
            className="rail-icon"
            aria-label={uiText("Chiudi navigazione")}
            title={uiText("Chiudi navigazione")}
            onClick={rail.hide}
          >
            <RailToggleIcon />
          </button>
        </div>
        <div className="rail-body">
          <div className={railStyles.spaces}>
            <div className={railStyles.spacesHeading}>
              <button
                type="button"
                className="rail-link"
                aria-current={
                  !workspaceId && !inviteToken && !agendaPage
                    ? "page"
                    : undefined
                }
                onClick={() => chooseFromRail("")}
              >
                <WorkspaceIcon name="home" />
                {uiText(" I tuoi spazi")}
              </button>

              {!inviteToken && (
                <button
                  type="button"
                  className="rail-icon rail-create"
                  aria-label={uiText("Apri il modulo per creare uno spazio")}
                  title={uiText("Apri il modulo per creare uno spazio")}
                  disabled={spacesStatus !== "ready"}
                  onClick={() => leaveFromRail(openCreation)}
                >
                  <WorkspaceIcon name="plus" />
                </button>
              )}
            </div>
            <nav
              className={railStyles.spacesList}
              aria-label={uiText("I tuoi spazi")}
            >
              {spaces.map((w) => {
                const photo = photoUrl(photos?.rooms[w.id], w.id);
                return (
                  <button
                    type="button"
                    className="rail-link"
                    key={w.id}
                    title={w.name}
                    aria-current={w.id === workspaceId ? "location" : undefined}
                    onClick={() => chooseFromRail(w.id)}
                  >
                    {photo ? (
                      <IdentityImage
                        className="rail-space-photo"
                        url={photo}
                        fallback={<WorkspaceIcon name="space" />}
                      />
                    ) : (
                      <WorkspaceIcon name="space" />
                    )}
                    <span className="rail-space-name">{w.name}</span>
                  </button>
                );
              })}
            </nav>
            {(workspaceId || inviteToken) && (
              <WorkspaceListAvailability
                status={spacesStatus}
                error={spacesError}
                retry={() => void retrySpaces()}
              />
            )}
          </div>
          <nav aria-label={uiText("Navigazione personale")}>
            {session.user.emailVerified && (
              <>
                <button
                  type="button"
                  className="rail-link"
                  disabled={busy}
                  aria-current={
                    snapshot?.workspace.personal && personalTab === "chat"
                      ? "page"
                      : undefined
                  }
                  onClick={(event) => openPersonalChat(event.currentTarget)}
                >
                  <WorkspaceIcon name="mark" />
                  {uiText(" Tu ed Emme")}
                </button>
                <button
                  type="button"
                  className="rail-link"
                  aria-haspopup="dialog"
                  onClick={() =>
                    setAssistantScope(
                      workspaceId && snapshot && !snapshot.workspace.personal
                        ? { workspaceId, name: snapshot.workspace.name }
                        : homeAssistantScope,
                    )
                  }
                >
                  <WorkspaceIcon name="settings" />
                  <span className="rail-settings-label">
                    {uiText("Configura Emme")}
                  </span>
                </button>
                <button
                  type="button"
                  className="rail-link"
                  aria-current={agendaPage ? "page" : undefined}
                  onClick={() => openAgendaFromRail("today")}
                >
                  <WorkspaceIcon name="today" />
                  {uiText(" Oggi")}
                </button>
              </>
            )}
          </nav>
          {snapshot && !snapshot.workspace.personal && (
            <div className="rail-group rail-tools-group">
              <p className="rail-group-heading">{uiText("In questo spazio")}</p>
              <WorkspaceMenu
                key={workspaceId}
                selected={panel}
                open={openSidebarTool}
              />
            </div>
          )}
          <div className={railStyles.signature} aria-hidden="true">
            <WorkspaceIcon name="mark" size={40} />
          </div>
        </div>
        <div className="rail-account">
          {ownPhoto && (
            <IdentityImage
              className="account-avatar"
              url={ownPhoto}
              fallback={initials(session.user.name)}
              profileName={session.user.name}
            />
          )}
          <AccountDisclosure>
            <summary
              className="rail-account-name"
              title={uiText("Account personale")}
            >
              {!ownPhoto && (
                <IdentityImage
                  className="account-avatar"
                  fallback={initials(session.user.name)}
                />
              )}
              <span>{session.user.name}</span>
              <span className="sr-only">{uiText("Account personale")}</span>
            </summary>
            <AccountMenu
              user={session.user}
              returnTo={accountReturn}
              photo={ownPhoto}
              photos={photos}
              busy={busy}
              onSignOut={signOut}
              calendarLinked={
                workspaceId
                  ? snapshot?.workspace.has_linked_calendar
                  : homeCalendarLinked
              }
              onCalendars={() => {
                if (workspaceId && snapshot && !snapshot.workspace.personal)
                  openHeaderPanel("calendar");
                else openAgendaFromRail("calendars");
              }}
            />
          </AccountDisclosure>
          <AppearanceToggle className="rail-icon" />
        </div>
      </WorkspaceRail>
      {personalPage ?? (
        <main
          className={
            workspaceId ? "workspace" : `workspace ${entryStyles.homeShell}`
          }
          id="workspace-content"
          tabIndex={-1}
          data-view={workspaceId ? "conversation" : "home"}
        >
          <header className="workspace-header">
            {navigationToggle}
            <div className="workspace-heading">
              {roomPhoto && (
                <IdentityImage className="workspace-photo" url={roomPhoto} />
              )}
              <div className="workspace-title-stack">
                <h1 title={snapshot?.workspace.name}>
                  {inviteToken
                    ? uiText("Invito allo spazio")
                    : (snapshot?.workspace.name ??
                      (workspaceId
                        ? uiText("Apertura dello spazio…")
                        : creatingSpace
                          ? uiText("Nuovo spazio")
                          : agendaPage
                            ? uiText("Oggi")
                            : uiText("I tuoi spazi")))}
                </h1>
              </div>
            </div>
            {snapshot && (
              <div className="workspace-header-tools">
                {!inviteToken && (
                  <nav
                    className="workspace-tabs"
                    aria-label={uiText("Viste dello spazio")}
                  >
                    <button
                      type="button"
                      aria-current={panel !== "artifacts" ? "page" : undefined}
                      onClick={() => openHeaderPanel("")}
                    >
                      {uiText("Chat")}
                    </button>
                    <button
                      type="button"
                      aria-current={panel === "artifacts" ? "page" : undefined}
                      onClick={() => {
                        openPanel("artifacts");
                        if (window.matchMedia("(min-width: 72rem)").matches)
                          setLensLayout("docked");
                      }}
                    >
                      {uiText("Condivisi")}
                    </button>
                  </nav>
                )}
                <div className="workspace-header-activity">
                  {compactActivity ? compactAttention : presence()}
                  <button
                    className="quiet notification-shortcut"
                    type="button"
                    onClick={() => openHeaderPanel("notifications")}
                    aria-label={uiText("Notifiche di questo spazio")}
                    title={uiText("Notifiche di questo spazio")}
                  >
                    <WorkspaceIcon name="bell" />
                  </button>
                  {!inviteToken && (
                    <WorkspacePushPrompt
                      key={`${session.user.id}:${session.session.id}:${workspaceId}`}
                      workspaceId={workspaceId}
                      actor={session.user.id}
                      sessionId={session.session.id}
                      hidden={Boolean(panel) || navigationOpen}
                      openSettings={() => openHeaderPanel("notifications")}
                    />
                  )}
                </div>
              </div>
            )}
            <div className="workspace-header-actions">
              {!workspaceId &&
                !inviteToken &&
                !creatingSpace &&
                !agendaPage &&
                spacesStatus === "ready" && (
                  <button
                    type="button"
                    className={entryStyles.newSpace}
                    aria-label={uiText("Crea un nuovo spazio")}
                    onClick={openCreation}
                  >
                    <WorkspaceIcon name="plus" />
                    {uiText("Nuovo spazio")}
                  </button>
                )}
              {snapshot && !inviteToken && (
                <button
                  type="button"
                  className="workspace-member-count quiet"
                  onClick={() => openHeaderPanel("people")}
                  aria-haspopup="dialog"
                  title={uiText("Persone e accesso")}
                >
                  <span className="workspace-member-stack" aria-hidden="true">
                    {activeMembers.slice(0, 2).map((member) => (
                      <IdentityImage
                        key={member.user_id}
                        url={photoUrl(
                          photos?.members[member.user_id],
                          workspaceId,
                          member.user_id,
                        )}
                        fallback={initials(member.name)}
                      />
                    ))}
                  </span>
                  {activeMembers.length}{" "}
                  {activeMembers.length === 1
                    ? uiText("persona")
                    : uiText("persone")}
                </button>
              )}
              {access?.invitations && (
                <WorkspaceInviteButton open={() => openHeaderPanel("invite")} />
              )}
              {snapshot && !inviteToken && (
                <AppearanceToggle className="workspace-mobile-theme" />
              )}
            </div>
          </header>
          {snapshot && (
            <WorkspaceConnectionNotice
              state={workspaceSync.connection}
              retry={() => void workspaceSync.refresh()}
            />
          )}
          <BetaNotice actorId={session.user.id} />
          {!creatingSpace && !inviteToken && session.user.emailVerified && (
            <IncomingInvitations
              key={workspaceId}
              onAvailability={setInboxAvailability}
              showSingle={
                !workspaceId && spacesStatus === "ready" && spaces.length === 0
              }
              accepted={(id) => {
                choose(id);
                void retrySpaces();
              }}
              refreshSpaces={() => void refreshSpaces()}
            />
          )}
          {error && panel !== "invite" && (
            <div className="banner error" role="alert">
              {error}
              <button className="quiet" onClick={() => setError("")}>
                {uiText("Chiudi")}
              </button>
            </div>
          )}
          {notice && (
            <div className="banner" role="status">
              {notice}
            </div>
          )}
          <PendingCommands
            actor={actor!}
            workspace={workspaceId || undefined}
            sendingCommandId={sendingCommandId}
            action={action}
            confirmed={confirmComposerReceipt}
            refreshed={async () => {
              const generation = viewGeneration.current;
              const available = await retrySpaces();
              if (!available || generation !== viewGeneration.current) return;
              if (
                selected.current &&
                available.some((w) => w.id === selected.current)
              )
                await load(selected.current);
              else if (!inviteToken && available[0]) choose(available[0].id);
            }}
          />
          {inviteToken && invitationStatus !== "ready" && (
            <section
              className="card admission"
              aria-label={uiText("Invito allo spazio")}
              aria-busy={invitationStatus === "loading"}
            >
              {invitationStatus === "loading" ? (
                <p role="status">{uiText("Caricamento dell’invito…")}</p>
              ) : (
                <>
                  <p role="alert">
                    {uiText("Non riesco ad aprire l’invito. ")}
                    {errorText(invitationError)}
                  </p>
                  <button type="button" onClick={retryInvitation}>
                    {uiText("Riprova ad aprire l’invito")}
                  </button>
                  {invitationError === "INVITATION_INVALID" && (
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={signOut}
                    >
                      {uiText("Accedi con un altro account")}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => choose("")}
              >
                {uiText("Vai ai tuoi spazi")}
              </button>
            </section>
          )}
          {inviteToken && invitationStatus === "ready" && invitation && (
            <section
              className="card admission"
              aria-label={uiText("Invito allo spazio")}
            >
              <p className="eyebrow">
                {uiText("INVITO PER ")}
                {invitation.recipient_email}
              </p>
              <InvitationAdmission
                workspaceName={invitation.name}
                busy={busy}
                accept={() => {
                  void action(async () => {
                    const generation = viewGeneration.current;
                    const r = await api<{ workspaceId: string }>(
                      `/api/invitations/${encodeURIComponent(inviteToken)}`,
                      { fullHistoryAccepted: true },
                    );
                    if (generation !== viewGeneration.current) return;
                    choose(r.workspaceId);
                    void retrySpaces();
                  });
                }}
              />
            </section>
          )}
          {!workspaceId && !inviteToken && (
            <WorkspaceListAvailability
              status={spacesStatus}
              error={spacesError}
              retry={() => void retrySpaces()}
            />
          )}
          {!workspaceId && !inviteToken && creatingSpace && (
            <section
              className={entryStyles.create}
              aria-label={uiText("Creazione spazio")}
            >
              <WorkspaceCreation
                key={actor}
                actor={actor!}
                assistantCatalog={assistantSettings}
                onCancel={() => choose("")}
                onCreated={(workspace, invited) => {
                  spacesRead.current?.abort();
                  setSpacesStatus("ready");
                  setSpacesError("");
                  setSpaces((current) => [
                    ...current.filter((item) => item.id !== workspace.id),
                    workspace,
                  ]);
                  choose(workspace.id);
                  if (invited)
                    setNotice(
                      uiText(
                        "Spazio creato. Le persone invitate possono accettare dalla Home, in Inviti ricevuti.",
                      ),
                    );
                }}
              />
            </section>
          )}
          {!workspaceId &&
            !inviteToken &&
            !creatingSpace &&
            !agendaPage &&
            spacesStatus === "ready" && (
              <section
                className={entryStyles.directory}
                aria-label={uiText("Elenco degli spazi disponibili")}
              >
                <h2>{uiText("Conversazioni")}</h2>
                <DirectContactLauncher actor={actor!} />
                {directDirectory.error && (
                  <p role="status">
                    {uiText("Chat private non disponibili. ")}
                    {directDirectory.error}
                  </p>
                )}
                {homeChats.length > 0 ? (
                  <ul className={entryStyles.list}>
                    {homeChats.map((w) => (
                      <li
                        key={w.id}
                        className={
                          w.kind === "direct" && w.photoVersion
                            ? entryStyles.withProfile
                            : undefined
                        }
                      >
                        {w.kind === "direct" && !!w.photoVersion && (
                          <IdentityImage
                            className={entryStyles.directoryPhoto}
                            profileName={w.name}
                            url={`/api/v1/direct-chats/${w.id}/photo?v=${w.photoVersion}`}
                            fallback={initials(w.name)}
                          />
                        )}
                        <button
                          className={entryStyles.space}
                          type="button"
                          onClick={() =>
                            w.kind === "direct"
                              ? router.push("/chat/" + w.id)
                              : choose(w.id)
                          }
                        >
                          {w.kind === "direct" ? (
                            !w.photoVersion && (
                              <IdentityImage
                                className="direct-avatar"
                                fallback={initials(w.name)}
                              />
                            )
                          ) : (
                            <span
                              className="space-thumb directory-thumb"
                              aria-hidden="true"
                            >
                              <IdentityImage
                                url={photoUrl(photos?.rooms[w.id], w.id)}
                                fallback={<WorkspaceIcon name="space" />}
                              />
                            </span>
                          )}
                          <span className={entryStyles.roomCopy}>
                            <strong title={w.name}>{w.name}</strong>
                            <small className={entryStyles.roomMeta}>
                              {w.kind === "direct"
                                ? uiText("Chat privata")
                                : uiText("Spazio")}
                              {w.kind === "space" &&
                                customAssistantLabels.has(w.id) && (
                                  <> · {customAssistantLabels.get(w.id)}</>
                                )}
                            </small>
                            {w.preview && (
                              <small className={entryStyles.roomPreview}>
                                {w.preview}
                              </small>
                            )}
                          </span>
                          {!!w.unreadCount && (
                            <small
                              className={entryStyles.roomUnread}
                              aria-label={uiText(
                                "{0} messaggi non letti",
                                String(w.unreadCount),
                              )}
                            >
                              {w.unreadCount}
                              {uiText(" non letti")}
                            </small>
                          )}
                          <WorkspaceIcon name="arrow" />
                        </button>
                        {w.kind === "space" && !!w.firstMentionId && (
                          <button
                            type="button"
                            className="quiet"
                            aria-label={uiText(
                              "Apri la prima menzione in {0}",
                              String(w.name),
                            )}
                            onClick={() => {
                              choose(w.id);
                              setRequestedSource({ id: w.firstMentionId! });
                            }}
                          >
                            @ {w.mentionCount}
                          </button>
                        )}
                        {w.kind === "space" && !!w.firstRequestId && (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => {
                              choose(w.id);
                              setRequestedSource({ id: w.firstRequestId! });
                            }}
                          >
                            {uiText("Da decidere · ")}
                            {w.requestCount}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : inboxAvailability === "pending" ? null : (
                  <p className={entryStyles.empty}>
                    {uiText(
                      "Non hai ancora spazi. Per entrare in quello di un’altra persona, apri il suo invito.",
                    )}
                  </p>
                )}
              </section>
            )}
          {!workspaceId &&
            !inviteToken &&
            !creatingSpace &&
            session.user.emailVerified && (
              <>
                {!agendaPage && (
                  <PersonalLauncher
                    key={session.user.id}
                    actor={session.user.id}
                    onOpen={choose}
                    onConfigure={() => setAssistantScope(homeAssistantScope)}
                  />
                )}
                <HomeToday
                  ref={today}
                  key={"agenda:" + session.user.id}
                  actor={session.user.id}
                  calendarLinked={homeCalendarLinked}
                  onCalendarLinked={setHomeCalendarLinked}
                  spaces={spaces}
                />
              </>
            )}
          {workspaceId && !snapshot && !inviteToken && (
            <section
              className="empty"
              aria-busy={["loading", "reconnecting"].includes(
                workspaceSync.connection,
              )}
            >
              <p role="status">
                {workspaceSync.connection === "offline"
                  ? uiText(
                      "Sei offline. Lo spazio si aprirà quando tornerà la connessione.",
                    )
                  : workspaceSync.connection === "failed"
                    ? uiText("Non riesco ad aprire lo spazio. Puoi riprovare.")
                    : uiText("Sto aprendo lo spazio…")}
              </p>
              {workspaceSync.connection === "failed" && (
                <button
                  className="quiet"
                  onClick={() => void workspaceSync.refresh()}
                >
                  {uiText("Riprova ad aprire lo spazio")}
                </button>
              )}
            </section>
          )}
          {snapshot && (
            <>
              {!compactActivity && (
                <div className="workspace-orientation">
                  {goal && (
                    <button
                      type="button"
                      className="goal-compass"
                      onClick={() => openPanel("goal")}
                    >
                      <WorkspaceIcon name="goal" />
                      <span className="goal-compass-label">
                        {uiText("Goal")}
                      </span>
                      <span className="goal-compass-content">
                        {goal.content}
                      </span>
                      <WorkspaceIcon name="chevron" />
                    </button>
                  )}
                  <div className="activity-bar">{compactAttention}</div>
                </div>
              )}
              <div
                className={
                  panel &&
                  panel !== "invite" &&
                  lensDocked &&
                  !helpInConversation
                    ? "workspace-stage with-layer"
                    : "workspace-stage"
                }
              >
                <section
                  className="card conversation"
                  aria-labelledby="conversation-heading"
                >
                  <h2 className="sr-only" id="conversation-heading">
                    {uiText("Conversazione")}
                  </h2>
                  {focusedStream && (
                    <div className="focus-strip">
                      <div>
                        <strong>{focusedStream.title}</strong>
                        <small>
                          {uiText(
                            "Stessa conversazione condivisa · vista per argomento",
                          )}
                        </small>
                      </div>
                      <button
                        className="quiet"
                        onClick={() => chooseFocus(null)}
                      >
                        {uiText("Tutta la conversazione")}
                      </button>
                      {!focusWritable && (
                        <p role="status">
                          {uiText("L’argomento è cambiato o non è attivo.")}{" "}
                          <button
                            className="quiet"
                            onClick={() => openPanel("attention")}
                          >
                            {uiText("Verifica l’argomento")}
                          </button>
                          {currentFocus?.state === "active" && (
                            <button
                              className="quiet"
                              onClick={() => chooseFocus(currentFocus)}
                            >
                              {uiText("Usa la versione aggiornata")}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {!compactActivity && (
                    <div className="conversation-reading-state">
                      {readingStatus && <p role="status">{readingStatus}</p>}
                      {readingNeedsReview && (
                        <button
                          className="quiet"
                          onClick={() => openPanel("context")}
                        >
                          {uiText("Verifica lettura di ")}
                          {assistantName} ↗
                        </button>
                      )}
                    </div>
                  )}
                  <ConversationVoice
                    key={`voice:${actor}:${workspaceId}`}
                    workspace={workspaceId}
                    actor={actor!}
                    disabled={!canContribute}
                    command={command}
                    messages={snapshot.messages}
                    workstreamFocus={
                      focusedStream
                        ? {
                            workstreamId: focusedStream.id,
                            version: focusedStream.version,
                          }
                        : undefined
                    }
                    focusLabel={focusedStream?.title}
                    focusWritable={focusWritable}
                    reference={composerReference ?? undefined}
                    tools={
                      <WorkspaceCall
                        key={`call:${actor}:${workspaceId}`}
                        workspace={workspaceId}
                        actor={actor!}
                        disabled={!canContribute}
                        command={command}
                      />
                    }
                  >
                    {!focusedStream &&
                      (personalReading.away ||
                        personalReading.mentions.length > 0) && (
                        <div className="conversation-navigation">
                          {personalReading.mentions.length > 0 && (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() =>
                                revealSource(personalReading.mentions[0])
                              }
                            >
                              {uiText("Menzione successiva ·")}{" "}
                              {personalReading.mentions.length}
                            </button>
                          )}
                          {personalReading.away && (
                            <button
                              type="button"
                              className="quiet"
                              onClick={followLatest}
                            >
                              {uiText("Vai in fondo ↓")}
                            </button>
                          )}
                        </div>
                      )}
                    <div
                      className="messages"
                      ref={messagesElement}
                      onDragOver={(event) => {
                        if (
                          canContribute &&
                          event.dataTransfer.types.includes("Files")
                        )
                          event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!event.dataTransfer.files.length) return;
                        event.preventDefault();
                        if (canContribute && !busy && focusWritable) {
                          composerDock.current?.write();
                          attachments.add(Array.from(event.dataTransfer.files));
                        }
                      }}
                      onScroll={captureConversationScroll}
                    >
                      {focusedStream && (
                        <div className="history-navigation">
                          {focusedHistory.loading && (
                            <p role="status">
                              {uiText("Caricamento dell’argomento…")}
                            </p>
                          )}
                          {focusedHistory.error && (
                            <p role="alert">
                              {focusedHistory.error}
                              <button
                                className="quiet"
                                onClick={focusedHistory.retry}
                              >
                                {uiText("Riprova")}
                              </button>
                            </p>
                          )}
                          {focusedHistory.hasOlder && (
                            <button
                              className="quiet"
                              onClick={() => {
                                readingGeneration.current++;
                                focusedHistory.older();
                              }}
                            >
                              {uiText("Messaggi precedenti")}
                            </button>
                          )}
                          {focusedHistory.historical && (
                            <button
                              className="quiet"
                              onClick={() => {
                                readingGeneration.current++;
                                followLatest();
                                focusedHistory.recent();
                              }}
                            >
                              {uiText("Torna ai messaggi recenti")}
                            </button>
                          )}
                        </div>
                      )}
                      {focusedStream &&
                        displayedMessages.length === 0 &&
                        !focusedHistory.loading &&
                        !focusedHistory.error && (
                          <p className="muted">
                            {uiText(
                              "Non ci sono messaggi collegati a questo argomento.",
                            )}
                          </p>
                        )}
                      {displayedMessages.map((m, index) => {
                        const previous = displayedMessages[index - 1];
                        const day = messageDay(m.created_at, uiLocale);
                        const newDay =
                          !previous ||
                          messageDay(previous.created_at, uiLocale) !== day;
                        const newInterval =
                          !!previous &&
                          !newDay &&
                          startsReadingInterval(
                            previous.created_at,
                            m.created_at,
                          );
                        const intervalHeader = (
                          <>
                            {!focusedStream &&
                              (snapshot.joins ?? [])
                                .filter(
                                  (j) =>
                                    Date.parse(j.created_at) <=
                                      Date.parse(m.created_at) &&
                                    (!previous ||
                                      Date.parse(j.created_at) >
                                        Date.parse(previous.created_at)),
                                )
                                .map((j) => (
                                  <p key={j.id} className="conversation-system">
                                    {uiText("Ingresso nello spazio · ")}
                                    {j.name}
                                  </p>
                                ))}
                            {!focusedStream &&
                              personalReading.firstUnreadAtEntry === m.id && (
                                <button
                                  data-recap-from={m.id}
                                  type="button"
                                  className="quiet"
                                  onClick={() => {
                                    setRecap({
                                      anchor: m.id,
                                      id: crypto.randomUUID(),
                                    });
                                    openPanel("recap");
                                  }}
                                >
                                  {uiText("Riassumi da qui")}
                                </button>
                              )}
                            {newDay && (
                              <div className="conversation-day">
                                <span className="day-desktop">{day}</span>
                                <span className="day-mobile">
                                  {mobileDayLabel(
                                    m.created_at,
                                    undefined,
                                    uiLocale,
                                  )}{" "}
                                  · {chatClock(m.created_at, uiLocale)}
                                </span>
                              </div>
                            )}
                            {newInterval && (
                              <div className="mobile-time-break">
                                <time dateTime={m.created_at}>
                                  {chatClock(m.created_at, uiLocale)}
                                </time>
                              </div>
                            )}
                          </>
                        );
                        if (
                          m.purpose === "workstream_event" ||
                          m.purpose === "goal_event"
                        )
                          return (
                            <div
                              key={m.id}
                              id={`source-${m.id}`}
                              data-chat-message={m.id}
                              tabIndex={-1}
                            >
                              {intervalHeader}
                              <div className="timeline-milestone">
                                <button
                                  type="button"
                                  onClick={() =>
                                    m.reference && inspectReference(m.reference)
                                  }
                                >
                                  <WorkspaceIcon
                                    name={
                                      m.purpose === "goal_event"
                                        ? "goal"
                                        : "branch"
                                    }
                                  />
                                  <span>
                                    {m.author_name} {m.content}
                                  </span>
                                </button>
                              </div>
                              {milestoneRows(m.id)}
                            </div>
                          );
                        if (m.taskOffer)
                          return (
                            <div
                              key={m.id}
                              id={`source-${m.id}`}
                              tabIndex={-1}
                              data-chat-message={m.id}
                            >
                              {intervalHeader}
                              <TaskOfferLine
                                offer={m.taskOffer}
                                actor={session.user.id}
                                busy={busy}
                                onCommand={(c) =>
                                  void action(async () => {
                                    await command(c);
                                  })
                                }
                              />
                              {milestoneRows(m.id)}
                            </div>
                          );
                        const assistant = m.actor_kind === "miriam";
                        const quoted = m.quoteMessageId
                          ? messagesById.get(m.quoteMessageId)
                          : undefined;
                        const sharedFile =
                          !assistant && m.reference?.kind === "source"
                            ? documentSources.get(m.reference.id)
                            : undefined;
                        const attachedFiles = filesByMessage.get(m.id) ?? [];
                        const filenameOnly =
                          attachedFiles.length > 0 &&
                          m.content ===
                            attachedFiles
                              .map((file) => file.filename)
                              .join(", ");
                        const failure = chatFailures.get(m.id);
                        const questionProps =
                          canContribute &&
                          !failure &&
                          canAskAboutMessage(m, assistantName)
                            ? {
                                message: m,
                                latest: false,
                                disabled: busy || !focusWritable,
                              }
                            : null;
                        const author = m.author_name;
                        const authorPhoto = m.author_id
                          ? photoUrl(
                              photos?.members[m.author_id],
                              workspaceId,
                              m.author_id,
                            )
                          : undefined;
                        const continuation =
                          !newDay &&
                          !newInterval &&
                          m.purpose !== "followup_reminder" &&
                          previous.purpose !== "followup_reminder" &&
                          previous.actor_kind === m.actor_kind &&
                          ((assistant && previous.author_name === author) ||
                            (!!m.author_id &&
                              previous.author_id === m.author_id));
                        return (
                          <Fragment key={m.id}>
                            {intervalHeader}
                            <article
                              data-chat-message={m.id}
                              id={`source-${m.id}`}
                              tabIndex={-1}
                              aria-label={author}
                              data-continuation={continuation}
                              data-self={
                                m.actor_kind === "human" &&
                                m.author_id === actor
                              }
                              className={
                                assistant ? "message miriam-message" : "message"
                              }
                            >
                              <div className="message-main">
                                {!continuation && (
                                  <strong className="message-author">
                                    {assistant ? (
                                      <>
                                        <EmmeMessageMark />
                                        {author}
                                      </>
                                    ) : m.author_id &&
                                      chatMembers.some(
                                        (p) => p.id === m.author_id,
                                      ) ? (
                                      <ProfileLink
                                        path={`/api/v1/workspaces/${workspaceId}/profiles/${encodeURIComponent(m.author_id)}`}
                                        person={m.author_id}
                                        name={author}
                                        photo={authorPhoto}
                                      >
                                        <IdentityImage
                                          className="byline-photo"
                                          url={authorPhoto}
                                          fallback={initials(author)}
                                        />
                                        {author}
                                      </ProfileLink>
                                    ) : (
                                      <>
                                        <IdentityImage
                                          className="byline-photo"
                                          fallback={initials(author)}
                                        />
                                        {author}
                                      </>
                                    )}
                                    <time
                                      className="byline-time"
                                      dateTime={m.created_at}
                                    >
                                      {time(m.created_at, uiLocale)}
                                    </time>
                                    {assistant && (
                                      <span className="sr-only">
                                        {uiText(", assistente AI")}
                                      </span>
                                    )}
                                  </strong>
                                )}
                                {quoted && (
                                  <button
                                    type="button"
                                    className="message-quote quiet"
                                    onClick={() => revealSource(quoted.id)}
                                  >
                                    {quoted.author_name} ·{" "}
                                    {quoted.content.slice(0, 120)}
                                  </button>
                                )}
                                {snapshot.reading?.requestIds.includes(
                                  m.id,
                                ) && (
                                  <small>
                                    {uiText("In attesa della tua risposta")}
                                  </small>
                                )}
                                {!filenameOnly && (
                                  <p className="message-body">{m.content}</p>
                                )}
                                {m.reminder && (
                                  <ChatReminderLine
                                    workspace={workspaceId}
                                    actor={session.user.id}
                                    messageId={m.id}
                                    reminder={m.reminder}
                                    onRefresh={() => void load(workspaceId)}
                                  />
                                )}
                                {attachedFiles.map((file) => (
                                  <MessageFile
                                    key={file.id}
                                    workspace={snapshot.workspace.id}
                                    source={file}
                                  />
                                ))}
                                {!!m.consultationReferences?.length && (
                                  <ConsultationSources
                                    entries={m.consultationReferences}
                                    open={openConsulted}
                                  />
                                )}
                                {failure && (
                                  <AssistantRequestFeedback
                                    failure={failure}
                                    canRetry={
                                      !!canContribute &&
                                      focusWritable &&
                                      (failure.reason !== "unconfigured" ||
                                        !emmeUnconfigured)
                                    }
                                    disabled={
                                      busy ||
                                      workspaceSync.connection === "offline"
                                    }
                                    retry={(interpretationId) =>
                                      command({
                                        type: "interpretation.retry",
                                        interpretationId,
                                      })
                                    }
                                  />
                                )}
                                {m.content === askAboutMessage &&
                                  m.reference?.kind === "source" && (
                                    <button
                                      type="button"
                                      className="quiet"
                                      onClick={() =>
                                        openSource(m.reference!.id)
                                      }
                                    >
                                      {sharedFile
                                        ? uiText("Apri la fonte")
                                        : uiText("Vai al messaggio")}
                                    </button>
                                  )}
                                {m.operationResult?.workstreamId && (
                                  <button
                                    type="button"
                                    className="quiet"
                                    disabled={
                                      !workstreams.some(
                                        (item) =>
                                          item.id ===
                                          m.operationResult?.workstreamId,
                                      )
                                    }
                                    onClick={() => {
                                      const stream = workstreams.find(
                                        (item) =>
                                          item.id ===
                                          m.operationResult?.workstreamId,
                                      );
                                      if (stream) focusConversation(stream);
                                    }}
                                  >
                                    {uiText("Apri l’argomento ")}
                                    {m.operationResult.title} ↗
                                  </button>
                                )}
                                <ConversationHandoffs
                                  items={handoffView.handoffs.filter(
                                    (h) => h.sourceMessageId === m.id,
                                  )}
                                  open={openHandoff}
                                />
                                <VoiceMessage id={m.id} />
                                <details className="message-details">
                                  <summary
                                    aria-label={uiText(
                                      "Opzioni del messaggio {0}",
                                      String(m.sequence),
                                    )}
                                    title={uiText("Opzioni del messaggio")}
                                  >
                                    <WorkspaceIcon name="more" />
                                  </summary>
                                  <div className="message-inspector">
                                    {(canContribute ||
                                      snapshot.reading?.requestIds.includes(
                                        m.id,
                                      )) && (
                                      <MessageAddressActions
                                        id={m.id}
                                        canPost={!!canContribute}
                                        members={snapshot.members.filter(
                                          (p) =>
                                            p.active && p.user_id !== actor,
                                        )}
                                        pending={
                                          !!snapshot.reading?.requestIds.includes(
                                            m.id,
                                          )
                                        }
                                        disabled={busy || !focusWritable}
                                        onReply={() => quoteMessage(m)}
                                        run={async (c) => {
                                          try {
                                            return await command(c);
                                          } catch (e) {
                                            report(e);
                                            throw e;
                                          }
                                        }}
                                      />
                                    )}
                                    {questionProps && (
                                      <MessageQuestion
                                        assistantName={assistantName}
                                        {...questionProps}
                                        onAsk={(resolve) =>
                                          quoteMessage(
                                            m,
                                            filenameOnly &&
                                              attachedFiles.length === 1
                                              ? async () => attachedFiles[0].id
                                              : resolve,
                                          )
                                        }
                                      />
                                    )}
                                    <small>
                                      <time dateTime={m.created_at}>
                                        {time(m.created_at, uiLocale)}
                                      </time>
                                      {" · "}
                                      {uiText("Messaggio ")}
                                      {m.sequence} ·{" "}
                                      {m.purpose === "followup_reminder"
                                        ? uiText(
                                            "Promemoria programmato nello spazio",
                                          )
                                        : m.purpose === "workspace_welcome"
                                          ? uiText(
                                              "Introduzione deterministica, nessuna inferenza AI",
                                            )
                                          : m.operationResult
                                            ? uiText(
                                                "Riscontro deterministico del server, nessuna inferenza AI",
                                              )
                                            : m.actor_kind === "miriam"
                                              ? uiText(
                                                  "Contributo AI, non stato adottato",
                                                )
                                              : uiText("Atto umano originale")}
                                      <br />
                                      {uiText("Conservato senza riscritture.")}
                                    </small>
                                    {m.reference && (
                                      <button
                                        className="message-reference quiet"
                                        onClick={() =>
                                          inspectReference(m.reference!)
                                        }
                                      >
                                        {uiText(
                                          "Riferimento di questo messaggio ↗",
                                        )}
                                      </button>
                                    )}
                                    {m.actor_kind === "miriam" && (
                                      <SpokenReply
                                        id={`${actor}:${snapshot.workspace.id}:${m.id}`}
                                        text={m.content}
                                      />
                                    )}

                                    {m.assistanceContext && (
                                      <AssistanceReference
                                        context={m.assistanceContext}
                                      />
                                    )}
                                    {m.operationResult?.workstreamVersion && (
                                      <span>
                                        {" "}
                                        {uiText(
                                          "· Argomento alla versione",
                                        )}{" "}
                                        {m.operationResult.workstreamVersion}
                                      </span>
                                    )}
                                    {canContribute && (
                                      <button
                                        className="quiet"
                                        aria-label={uiText(
                                          "Feedback sul messaggio {0}",
                                          String(m.sequence),
                                        )}
                                        onClick={() => {
                                          openPanel("feedback");
                                          setFeedbackMessage({
                                            id: m.id,
                                            content: m.content,
                                          });
                                        }}
                                      >
                                        {uiText("Feedback")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="quiet"
                                      onClick={() =>
                                        handoffView.loadSource(m.id)
                                      }
                                    >
                                      {uiText(
                                        "Carica i passi proposti per questo messaggio",
                                      )}
                                    </button>
                                    {handoffView.sourceRead === m.id && (
                                      <span role="status">
                                        {handoffView.handoffs.some(
                                          (h) => h.sourceMessageId === m.id,
                                        )
                                          ? uiText(
                                              "Passi disponibili sotto il messaggio.",
                                            )
                                          : uiText(
                                              "Nessun passo proposto per questo messaggio.",
                                            )}
                                      </span>
                                    )}
                                    {m.purpose === "workspace_welcome" &&
                                      m.reply_to_source_id && (
                                        <button
                                          type="button"
                                          className="quiet"
                                          onClick={() =>
                                            revealSource(m.reply_to_source_id!)
                                          }
                                        >
                                          {uiText(
                                            "Descrizione iniziale di riferimento",
                                          )}
                                        </button>
                                      )}
                                    {m.citation_source_ids?.map((id) => {
                                      const source = snapshot.sources.find(
                                          (s) => s.id === id,
                                        ),
                                        message = snapshot.messages.find(
                                          (s) => s.id === id,
                                        );
                                      return (
                                        <span className="citation" key={id}>
                                          <strong>
                                            {source?.title ??
                                              message?.author_name ??
                                              uiText("Fonte")}
                                          </strong>
                                          <span>
                                            {source?.qualification ??
                                              (message?.actor_kind === "miriam"
                                                ? uiText(
                                                    "Messaggio generato da {0}",
                                                    String(message.author_name),
                                                  )
                                                : message
                                                  ? uiText(
                                                      "Messaggio umano originale",
                                                    )
                                                  : uiText("Fonte citata"))}
                                          </span>
                                          <span>
                                            {source?.content ??
                                              message?.content}
                                          </span>
                                          {message && (
                                            <button
                                              type="button"
                                              className="quiet"
                                              onClick={() => revealSource(id)}
                                            >
                                              {uiText("Vai al messaggio ↗")}
                                            </button>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </details>
                              </div>
                            </article>
                            {milestoneRows(m.id)}
                          </Fragment>
                        );
                      })}
                      {!focusedStream &&
                        (snapshot.joins ?? [])
                          .filter(
                            (j) =>
                              !displayedMessages.length ||
                              Date.parse(j.created_at) >
                                Date.parse(
                                  displayedMessages.at(-1)!.created_at,
                                ),
                          )
                          .map((j) => (
                            <p key={j.id} className="conversation-system">
                              {uiText("Ingresso nello spazio · ")}
                              {j.name}
                            </p>
                          ))}
                      {!focusedStream &&
                        !displayedMessages.some(
                          (m) =>
                            m.actor_kind === "human" &&
                            m.purpose === "conversation",
                        ) &&
                        canContribute && (
                          <div className="conversation-empty">
                            <span className="conversation-empty-icon">
                              <WorkspaceIcon name="chat" />
                            </span>
                            <h3>{uiText("Di cosa volete parlare?")}</h3>
                            <p>
                              {uiText(
                                "Scrivi al gruppo o fai una domanda. Per chiedere una risposta direttamente a ",
                              )}
                              {assistantName}
                              {uiText(", usa @Emme.")}
                            </p>
                            <div className="conversation-prompts">
                              {[
                                [
                                  "Facciamo il punto",
                                  "@Emme aiutaci a fare il punto su ciò che abbiamo condiviso.",
                                ],
                                [
                                  "Troviamo il prossimo passo",
                                  "@Emme quali aspetti dovremmo chiarire per trovare il prossimo passo?",
                                ],
                              ].map(([label, text]) => (
                                <button
                                  type="button"
                                  key={label}
                                  className="prompt-button"
                                  disabled={
                                    busy ||
                                    !!messageDraft.text.trim() ||
                                    !focusWritable
                                  }
                                  onClick={() => {
                                    setMessageDraft({
                                      text,
                                      scope: messageScope,
                                    });
                                    requestAnimationFrame(() =>
                                      composerDock.current?.write(),
                                    );
                                  }}
                                >
                                  {label}
                                  <WorkspaceIcon name="arrow" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                    {documentRequest && (
                      <GeneratedDocument
                        key={documentRequest.id}
                        initial={documentRequest}
                        workspace={workspaceId}
                        actor={actor!}
                        destination={
                          canContribute ? snapshot.workspace.name : undefined
                        }
                        close={() => setDocumentRequest(null)}
                        refresh={() => void load(workspaceId)}
                      />
                    )}
                    <ConversationComposerDock ref={composerDock}>
                      <form
                        className="conversation-composer"
                        noValidate
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes("Files")) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect =
                              canContribute && focusWritable && !busy
                                ? "copy"
                                : "none";
                          }
                        }}
                        onDrop={(e) => {
                          if (e.dataTransfer.types.includes("Files")) {
                            e.preventDefault();
                            if (canContribute && focusWritable && !busy)
                              attachments.add(Array.from(e.dataTransfer.files));
                          }
                        }}
                        aria-busy={!!sendingCommandId}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (e.currentTarget.querySelector("dialog[open]"))
                            return;
                          if (
                            busy ||
                            !canContribute ||
                            draftNeedsScope ||
                            !focusWritable
                          )
                            return;
                          const sentReply =
                            replyTarget?.scope === messageScope
                              ? replyTarget
                              : null;
                          const sentDraft = messageDraft;
                          const sentReference = composerReference;
                          const sentHelp = composerAssistance;
                          const sentAssistance = assistanceContext;
                          const form = e.currentTarget;
                          const raw = new FormData(form).get(
                            "message",
                          ) as string;
                          if (
                            attachments.preparing ||
                            (!raw.trim() && !attachments.items.length)
                          )
                            return;
                          const sentFiles = attachments.items;
                          const sentGeneration = viewGeneration.current,
                            sentFocus = readingGeneration.current;
                          setSendError("");
                          const feedback = feedbackFromComposer(raw);
                          function clearSubmitted() {
                            if (sentFiles.length)
                              attachments.clearSent(sentFiles);
                            const latest = latestComposer.current;
                            if (
                              latest.messageDraft !== sentDraft ||
                              latest.composerReference !== sentReference ||
                              (latest.replyTarget?.scope === messageScope
                                ? latest.replyTarget
                                : null) !== sentReply ||
                              latest.composerAssistance !== sentHelp
                            )
                              return;
                            setMessageDraft((current) =>
                              current === sentDraft
                                ? { text: "", scope: messageScope }
                                : current,
                            );
                            setChosenMentions([]);
                            if (feedback === null) {
                              if (sentReply) clearQuote();
                              setComposerReference((current) =>
                                current === sentReference ? null : current,
                              );
                            }
                            setComposerAssistance((current) =>
                              current === sentHelp ? null : current,
                            );
                          }
                          if (feedback !== null) {
                            if (sentFiles.length) {
                              setSendError(
                                uiText(
                                  "Rimuovi gli allegati prima di inviare un feedback.",
                                ),
                              );
                              return;
                            }
                            if (!feedback || feedback.length > 6000) return;
                            void action(async () => {
                              await command(
                                {
                                  type: "beta.feedback.add",
                                  content: feedback,
                                },
                                clearSubmitted,
                              );
                              setNotice(
                                uiText(
                                  "Feedback salvato. Lo ritrovi in Feedback beta, con il report da scaricare.",
                                ),
                              );
                            }, setSendError);
                            return;
                          }
                          const addressed =
                            (
                              e.nativeEvent as SubmitEvent
                            ).submitter?.getAttribute("data-target") ===
                            "miriam";
                          const requestedDocument = generatedDocumentPrompt(
                            raw,
                            addressed,
                          );
                          if (
                            requestedDocument &&
                            !sentReply &&
                            !sentReference &&
                            !sentAssistance &&
                            !sentFiles.length
                          ) {
                            setDocumentRequest({
                              id: crypto.randomUUID(),
                              question: requestedDocument,
                            });
                            clearSubmitted();
                            return;
                          }
                          const content =
                            sentReply?.ask &&
                            raw.trim() === defaultQuotedQuestion
                              ? askAboutMessage
                              : addressed ||
                                  sentAssistance ||
                                  sentReference ||
                                  sentReply?.ask
                                ? addressMiriam(raw)
                                : raw;
                          void action(async () => {
                            const encoded = sentFiles.length
                              ? await attachments.encode()
                              : undefined;
                            if (
                              sentGeneration !== viewGeneration.current ||
                              sentFocus !== readingGeneration.current
                            )
                              return;
                            await command(
                              {
                                type: "message.send",
                                clientTimeZone:
                                  Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone,
                                content,
                                ...(chosenMentions.length
                                  ? {
                                      mentionIds: resolveMentionIds(
                                        raw,
                                        chatMembers,
                                        chosenMentions,
                                      ).filter((id) =>
                                        chosenMentions.includes(id),
                                      ),
                                    }
                                  : {}),
                                ...(sentReply
                                  ? {
                                      quoteMessageId: sentReply.id,
                                      ...(sentReply.sourceId
                                        ? {
                                            reference: {
                                              kind: "source" as const,
                                              id: sentReply.sourceId,
                                              version: 1,
                                            },
                                          }
                                        : {}),
                                    }
                                  : {}),
                                ...(encoded ? { attachments: encoded } : {}),
                                ...(sentAssistance
                                  ? { assistanceContext: sentAssistance }
                                  : {}),
                                ...(sentReference
                                  ? { reference: sentReference.reference }
                                  : {}),
                                ...(focusedStream
                                  ? {
                                      workstreamFocus: {
                                        workstreamId: focusedStream.id,
                                        version: focusedStream.version,
                                      },
                                    }
                                  : {}),
                              },
                              clearSubmitted,
                              undefined,
                              {
                                text: sentDraft.text,
                                scope: messageScope,
                                files: sentFiles.map((i) => i.id),
                                quoteId: sentReply?.id ?? null,
                                reference: sentReference?.reference ?? null,
                                mentions: chosenMentions,
                              },
                            );
                          }, setSendError);
                        }}
                      >
                        <div className="composer-extras">
                          {helpInConversation &&
                            (panel || peopleFor || correctionFor) && (
                              <button
                                type="button"
                                className="quiet"
                                onClick={() => setHelpInConversation(false)}
                              >
                                {uiText("Torna al modulo")}
                              </button>
                            )}
                          {composerAssistance && feedbackDraft === null && (
                            <AssistanceReference
                              context={composerAssistance.context}
                              remove={() => setComposerAssistance(null)}
                            />
                          )}
                          {replyTarget?.scope === messageScope &&
                            feedbackDraft === null && (
                              <div className="composer-reference">
                                <span>
                                  {replyTarget.ask
                                    ? uiText(
                                        "Chiedi a {0}",
                                        String(assistantName),
                                      )
                                    : uiText("Risposta a")}{" "}
                                  · {replyTarget.title}
                                </span>
                                <button
                                  type="button"
                                  className="quiet"
                                  onClick={clearQuote}
                                >
                                  {uiText("Rimuovi citazione")}
                                </button>
                              </div>
                            )}
                          {composerReference && feedbackDraft === null && (
                            <div className="composer-reference">
                              <span>
                                {uiText("Su: ")}
                                {composerReference.title} ·{" "}
                                {composerReference.reference.kind ===
                                "active_work"
                                  ? uiText("rev.")
                                  : uiText("v")}
                                {composerReference.reference.version}
                              </span>
                              <button
                                className="quiet"
                                type="button"
                                onClick={() => setComposerReference(null)}
                                aria-label={uiText(
                                  "Rimuovi il riferimento dal messaggio",
                                )}
                              >
                                {uiText("Rimuovi")}
                              </button>
                            </div>
                          )}
                          {sketchScope === attachmentScope &&
                            canContribute &&
                            focusWritable &&
                            !draftNeedsScope && (
                              <ChatSketch
                                onClose={() => {
                                  setSketchScope(null);
                                  requestAnimationFrame(() =>
                                    composerDock.current?.write(),
                                  );
                                }}
                                onAttach={(file) => attachments.add([file])}
                              />
                            )}
                          <MessageAttachmentQueue
                            queue={attachments}
                            disabled={busy || !canContribute || !focusWritable}
                          />
                          {feedbackDraft !== null && (
                            <p role="status">
                              {uiText(
                                "Il feedback è visibile ai membri dello spazio. Non viene inviato a {0} né aggiunto al contesto condiviso. Non include messaggi o fonti. Massimo 6.000 caratteri.",
                                assistantName,
                              )}
                            </p>
                          )}
                          {draftNeedsScope && (
                            <p className="draft-scope-warning">
                              {uiText(
                                "La bozza appartiene alla vista precedente.",
                              )}{" "}
                              <button
                                type="button"
                                className="quiet"
                                disabled={!focusWritable}
                                onClick={() =>
                                  setMessageDraft((draft) => ({
                                    ...draft,
                                    scope: messageScope,
                                  }))
                                }
                              >
                                {uiText("Usa la bozza")}{" "}
                                {focusedStream
                                  ? uiText("in questo argomento")
                                  : uiText("nella conversazione completa")}
                              </button>
                            </p>
                          )}
                        </div>
                        <span id="message-audience" className="sr-only">
                          {uiText("Visibile a tutto lo spazio")}
                        </span>
                        <div className="composer-row">
                          <div className="composer-field">
                            <label className="sr-only" htmlFor="message">
                              {uiText("Messaggio")}
                            </label>
                            <ConversationMessageInput
                              assistantName={assistantName}
                              ref={composerInput}
                              mentions={
                                canContribute &&
                                !draftNeedsScope &&
                                focusWritable
                                  ? {
                                      people: chatMembers.filter(
                                        (p) => p.id !== actor,
                                      ),
                                      select: (id) =>
                                        setChosenMentions((prior) => [
                                          ...new Set([...prior, id]),
                                        ]),
                                    }
                                  : undefined
                              }
                              allowEmpty={attachments.items.length > 0}
                              permissions={{
                                fieldHelpActive: !!composerAssistance,
                                canInvite: !!access?.invitations,
                                canContribute:
                                  !!canContribute &&
                                  focusWritable &&
                                  !draftNeedsScope,
                              }}
                              onAction={handleComposerAction}
                              value={messageDraft.text}
                              onChange={(text) => {
                                if (chosenMentions.length) {
                                  const named = resolveMentionIds(
                                    text,
                                    chatMembers,
                                    chosenMentions,
                                  );
                                  const retained = chosenMentions.filter((id) =>
                                    named.includes(id),
                                  );
                                  if (retained.length !== chosenMentions.length)
                                    setChosenMentions(retained);
                                }
                                if (
                                  !text.trim() ||
                                  feedbackFromComposer(text) !== null
                                )
                                  setComposerAssistance(null);
                                setMessageDraft((current) => ({
                                  text,
                                  scope:
                                    current.text && text
                                      ? current.scope
                                      : messageScope,
                                }));
                              }}
                            />
                          </div>
                          {canContribute && (
                            <button
                              type="button"
                              className="quiet composer-attach"
                              aria-label={uiText("Allega un file o una foto")}
                              title={uiText("Allega un file o una foto")}
                              disabled={
                                busy || !focusWritable || !attachments.ready
                              }
                              onClick={() => attachments.openPicker()}
                            >
                              <WorkspaceIcon name="attach" />
                            </button>
                          )}
                          {canContribute && (
                            <button
                              type="button"
                              className="quiet composer-camera"
                              aria-label={uiText("Scatta una foto")}
                              title={uiText("Scatta una foto")}
                              disabled={
                                busy ||
                                !focusWritable ||
                                !attachments.ready ||
                                attachments.preparing
                              }
                              onClick={() => attachments.openPicker(true)}
                            >
                              <WorkspaceIcon name="camera" />
                            </button>
                          )}
                          <ComposerActionShortcut
                            open={() => composerInput.current?.showActions()}
                          />
                          <ConversationAudioActions />
                          {emmeUnconfigured && !compactActivity && (
                            <span
                              className="composer-availability"
                              role="status"
                            >
                              {assistantName}
                              {uiText(" non disponibile")}
                            </span>
                          )}
                          <div className="composer-delivery">
                            {" "}
                            <button
                              type="submit"
                              className="quiet ask-miriam composer-ask"
                              data-target="miriam"
                              title={uiText(
                                "Chiedi a {0}",
                                String(assistantName),
                              )}
                              disabled={
                                busy ||
                                attachments.preparing ||
                                !canContribute ||
                                !focusWritable ||
                                draftNeedsScope ||
                                feedbackDraft !== null ||
                                !messageDraft.text.trim()
                              }
                            >
                              <WorkspaceIcon name="spark" />
                              <span>
                                {uiText("Chiedi a ")}
                                {assistantName}
                              </span>
                            </button>
                            <button
                              type="submit"
                              data-primary-send
                              className="composer-send"
                              disabled={
                                busy ||
                                attachments.preparing ||
                                !canContribute ||
                                !focusWritable ||
                                draftNeedsScope ||
                                (!messageDraft.text.trim() &&
                                  !attachments.items.length) ||
                                (feedbackDraft !== null &&
                                  (!feedbackDraft ||
                                    feedbackDraft.length > 6000))
                              }
                            >
                              <span className="sr-only">
                                {sendingCommandId
                                  ? uiText("Invio…")
                                  : feedbackDraft === null
                                    ? uiText("Invia")
                                    : uiText("Salva feedback")}
                              </span>
                              <WorkspaceIcon name="send" />
                            </button>
                          </div>
                        </div>
                      </form>
                    </ConversationComposerDock>

                    {sendError && (
                      <p className="composer-error" role="alert">
                        {sendError}
                      </p>
                    )}
                    {handoffView.error && (
                      <p className="hint" role="status">
                        {uiText("I passi proposti non sono disponibili: ")}
                        {handoffView.error}{" "}
                        <button className="quiet" onClick={handoffView.retry}>
                          {uiText("Riprova")}
                        </button>
                      </p>
                    )}
                  </ConversationVoice>
                </section>
                {panel && (
                  <WorkspaceLayer
                    suspended={helpInConversation}
                    documentExitGuard={
                      panel === "artifacts" ? documentExitGuard : undefined
                    }
                    title={uiText(panelTitles[panel] ?? "Dettagli")}
                    contextName={
                      panel === "artifacts"
                        ? snapshot.workspace.name
                        : undefined
                    }
                    back={
                      previousPanel
                        ? {
                            label: uiText(
                              "Torna a {0}",
                              uiText(panelTitles[previousPanel] ?? "Dettagli"),
                            ),
                            open: backPanel,
                          }
                        : undefined
                    }
                    close={() => setPanel("")}
                    openDirectory={
                      panel === "lens" ||
                      panel === "invite" ||
                      panel === "artifacts" ||
                      previousPanel
                        ? undefined
                        : () => openPanel("lens")
                    }
                    docked={panel !== "invite" && lensDocked}
                    setDocked={
                      panel === "invite"
                        ? undefined
                        : (value) => setLensLayout(value ? "docked" : "drawer")
                    }
                    expanded={
                      ["artifacts", "work", "reference"].includes(panel) &&
                      lensLayout === "wide"
                    }
                    setExpanded={
                      ["artifacts", "work", "reference"].includes(panel)
                        ? (value) => setLensLayout(value ? "wide" : "drawer")
                        : undefined
                    }
                    invitation={panel === "invite"}
                  >
                    {panel === "lens" && (
                      <WorkspaceLens open={openChildPanel} />
                    )}
                    {panel === "guide" && (
                      <WorkspaceGuide
                        permissions={{
                          fieldHelpActive: !!composerAssistance,
                          canInvite: !!access?.invitations,
                          canContribute:
                            !!canContribute &&
                            focusWritable &&
                            !draftNeedsScope,
                        }}
                      />
                    )}
                    {panel === "invite" &&
                      (access?.invitations ? (
                        <WorkspaceInvitation
                          key={personalInvite?.id ?? "new"}
                          receipt={personalInvite}
                          record={snapshot.invitations.find(
                            (item) => item.id === personalInvite?.id,
                          )}
                          busy={busy}
                          error={error}
                          create={(email, sendEmail) =>
                            void action(async () => {
                              const r = await command({
                                type: "invitation.create",
                                email,
                                fullHistoryDisclosed: true,
                                sendEmail,
                              });
                              if (
                                typeof r.invitationId !== "string" ||
                                typeof r.token !== "string"
                              )
                                throw new Error("INVALID_RECEIPT");
                              const url = new URL("/", window.location.origin);
                              url.searchParams.set("invite", r.token);
                              setPersonalInvite({
                                id: r.invitationId,
                                recipient: email,
                                link: url.href,
                                emailRequested: sendEmail,
                              });
                            })
                          }
                          another={() => setPersonalInvite(null)}
                        />
                      ) : (
                        <p role="status">
                          {uiText(
                            "Il tuo accesso attuale non consente di invitare persone.",
                          )}
                        </p>
                      ))}
                    {panel === "notifications" && (
                      <WorkspacePushSettings
                        key={`${actor}:${workspaceId}`}
                        workspaceId={workspaceId}
                        actor={session.user.id}
                        sessionId={session.session.id}
                      />
                    )}
                    {panel === "feedback" && (
                      <WorkspaceBetaFeedback
                        key={`feedback:${actor}:${workspaceId}:${feedbackMessage?.id ?? "general"}`}
                        workspace={workspaceId}
                        actor={actor!}
                        revision={snapshot.workspace.revision}
                        message={feedbackMessage}
                        canContribute={!!canContribute}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                    )}
                    {handoff && handoffDestination(handoff) === panel && (
                      <HandoffContext
                        handoff={handoff}
                        source={() => revealSource(handoff.sourceMessageId)}
                        close={() => setSelectedHandoff(null)}
                      />
                    )}
                    {panel === "reference" && selectedReference && (
                      <ReferenceInspector
                        key={`${actor}:${workspaceId}:${JSON.stringify(selectedReference)}`}
                        workspace={workspaceId}
                        actor={actor!}
                        reference={selectedReference}
                        ask={askReference}
                        open={openPanel}
                        inspect={inspectReference}
                      />
                    )}
                    {panel === "goal" && (
                      <WorkspaceProject
                        canContribute={!!canContribute}
                        key={`project:${actor}:${workspaceId}:${handoff?.id ?? "direct"}`}
                        handoff={
                          handoff && handoffDestination(handoff) === "goal"
                            ? handoff
                            : undefined
                        }
                        workspace={workspaceId}
                        actor={actor!}
                        revision={snapshot.workspace.revision}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                    )}
                    {panel === "attention" && (
                      <>
                        <WorkspaceActivity
                          key={`activity:${actor}:${workspaceId}`}
                          workspace={workspaceId}
                          actor={actor!}
                          revision={snapshot.workspace.revision}
                          inspect={inspectReference}
                        />
                        <WorkspaceAttention
                          key={`attention-detail:${actor}:${workspaceId}`}
                          workspace={workspaceId}
                          actor={actor!}
                          open={openPanel}
                          command={command}
                          action={action}
                          busy={busy}
                          canContribute={!!canContribute}
                          name={name}
                          focus={focusConversation}
                          onWorkstreams={setWorkstreams}
                          showChanges={false}
                        />
                      </>
                    )}
                    {panel === "evidence" && evidence && (
                      <ConsultationEvidence
                        entry={evidence}
                        state={snapshot}
                        openSource={openSource}
                      />
                    )}
                    {panel === "recap" && recap && (
                      <PrivateWorkspaceReading
                        key={recap.id}
                        actor={actor!}
                        workspace={workspaceId}
                        canShare={!!canContribute}
                        open={openConsulted}
                        anchor={recap.anchor}
                        startId={recap.id}
                      />
                    )}
                    {panel === "context" && (
                      <WorkspaceContext
                        key={`context:${actor}:${workspaceId}:${handoff?.id ?? "direct"}`}
                        openConsulted={openConsulted}
                        state={snapshot}
                        actor={actor!}
                        busy={busy}
                        handoff={
                          handoff && handoffDestination(handoff) === "context"
                            ? handoff
                            : null
                        }
                        command={command}
                        action={action}
                        chatFailures={chatFailures}
                        aiUnavailable={mode === "unconfigured"}
                        openSource={openSource}
                        openDirection={() => openPanel("goal")}
                        correct={setCorrectionFor}
                        proposeCommitment={setPeopleFor}
                      />
                    )}
                    {panel === "questions" && (
                      <WorkspaceQuestions
                        openSource={openSource}
                        state={snapshot}
                        command={command}
                        action={action}
                        busy={busy}
                        actor={actor!}
                      />
                    )}
                    {panel === "work" && (
                      <>
                        <WorkspaceTasks
                          createRequest={
                            panelEntry?.action === "new-task"
                              ? panelEntry.request
                              : undefined
                          }
                          canContribute={!!canContribute}
                          key={`tasks:${session.user.id}:${snapshot.workspace.id}:${handoff?.id ?? "direct"}`}
                          handoff={
                            handoff && handoffDestination(handoff) === "work"
                              ? handoff
                              : undefined
                          }
                          workspace={snapshot.workspace.id}
                          actor={session.user.id}
                          command={command}
                          action={action}
                          busy={busy}
                        />
                        <WorkspaceActiveWork
                          inspectReference={inspectReference}
                          askInChat={askReference}
                          savedContributions={snapshot.artifactVersions
                            .filter((v) => v.contribution_id)
                            .map((v) => v.contribution_id!)}
                          key={`work:${actor}:${workspaceId}:${selectedWork}:${selectedCompletion ?? ""}`}
                          workspace={workspaceId}
                          actor={actor!}
                          name={name}
                          command={command}
                          action={action}
                          busy={busy}
                          selectedWork={selectedWork}
                          selectedCompletion={selectedCompletion}
                          showAllWork={() => openWork("")}
                        />
                      </>
                    )}
                    {panel === "materials" && (
                      <div className="destination-list">
                        <p>
                          {uiText(
                            "Le fonti da comprendere e ciò che state costruendo, nello stesso spazio.",
                          )}
                        </p>
                        <button
                          className="destination"
                          onClick={() => openChildPanel("sources")}
                        >
                          <strong>{uiText("Fonti e ricerca ↗")}</strong>
                          <span>
                            {uiText(
                              "File condivisi, riferimenti e ricerche sul web.",
                            )}
                          </span>
                        </button>
                        <button
                          className="destination"
                          onClick={() => openChildPanel("artifacts")}
                        >
                          <strong>{uiText("Condivisi ↗")}</strong>
                          <span>
                            {uiText("Bozze, versioni e contenuti adottati.")}
                          </span>
                        </button>
                      </div>
                    )}
                    {panel === "tools" && (
                      <div className="destination-list">
                        <p>
                          {uiText(
                            "Collega i tuoi strumenti quando servono. Ogni azione mantiene i propri confini.",
                          )}
                        </p>
                        <button
                          className="destination"
                          onClick={() => openChildPanel("calendar")}
                        >
                          <strong>{uiText("Calendario ↗")}</strong>
                          <span>
                            {uiText(
                              "Tempi condivisi e il tuo calendario personale.",
                            )}
                          </span>
                        </button>
                        <button
                          className="destination"
                          onClick={() => openChildPanel("email")}
                        >
                          <strong>{uiText("Email ↗")}</strong>
                          <span>
                            {uiText("La tua posta, bozze e invii espliciti.")}
                          </span>
                        </button>
                      </div>
                    )}
                    {panel === "sources" && (
                      <>
                        <WorkspaceSources
                          researchRequest={
                            panelEntry?.action === "research"
                              ? panelEntry.request
                              : undefined
                          }
                          uploadRequest={
                            panelEntry?.action === "upload"
                              ? panelEntry.request
                              : undefined
                          }
                          openSource={openSource}
                          key={`${actor}:${workspaceId}`}
                          state={snapshot}
                          actor={actor!}
                          command={command}
                          action={action}
                          reload={() => load(workspaceId)}
                          busy={busy}
                        />
                      </>
                    )}
                    {panel === "artifacts" && (
                      <>
                        <WorkspaceArtifacts
                          documentExitGuard={documentExitGuard}
                          openSource={openSource}
                          key={`artifacts:${actor}:${workspaceId}:${handoff?.id ?? "direct"}`}
                          handoff={
                            handoff?.kind === "artifact.prepare"
                              ? handoff
                              : undefined
                          }
                          state={snapshot}
                          actor={actor!}
                          busy={busy}
                          command={command}
                          action={action}
                        />
                      </>
                    )}
                    {panel === "calendar" && (
                      <>
                        <WorkspaceCalendar
                          canConnect={Boolean(canContribute)}
                          key={`${session.user.id}:${snapshot.workspace.id}`}
                          workspace={snapshot.workspace.id}
                          revision={snapshot.workspace.revision}
                          actor={session.user.id}
                          command={command}
                          action={action}
                          busy={busy}
                        />
                      </>
                    )}
                    {panel === "email" && (
                      <>
                        <WorkspaceEmail
                          key={`email:${session.user.id}:${snapshot.workspace.id}`}
                          canConnect={Boolean(canContribute)}
                          workspace={snapshot.workspace.id}
                          actor={session.user.id}
                          email={session.user.email}
                          command={command}
                          action={action}
                          busy={busy}
                        />
                      </>
                    )}
                    {panel === "people" && (
                      <>
                        <WorkspacePeople
                          state={snapshot}
                          actor={session.user.id}
                          photos={photos}
                          access={access}
                          busy={busy}
                          invite={() => openChildPanel("invite")}
                          submit={(c) =>
                            void action(async () => {
                              await command(c);
                            })
                          }
                        />
                        {activeMembers.some(
                          (m) => m.user_id === actor && m.contributes,
                        ) &&
                          !snapshot.workspace.personal && (
                            <IdentityPhotoEditor
                              key={workspaceId}
                              actor={session.user.id}
                              workspace={workspaceId}
                              version={photos?.rooms[workspaceId]?.version ?? 0}
                              present={!!roomPhoto}
                              available={!!photos}
                            />
                          )}
                        <details className="people-secondary">
                          <summary>{uiText("La mia partecipazione")}</summary>
                          <div className="actions">
                            {access && (
                              <button
                                className="quiet"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      uiText(
                                        "Rinunciare alla tua gestione degli accessi? Lo spazio può restare senza chi possa gestirlo. La partecipazione continua e non viene nominato un successore.",
                                      ),
                                    )
                                  )
                                    void action(async () => {
                                      await command({
                                        type: "access.relinquish",
                                        confirmed: true,
                                      });
                                    });
                                }}
                              >
                                {uiText("Rinuncia alla gestione degli accessi")}
                              </button>
                            )}
                            <button
                              className="quiet danger"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    uiText(
                                      "Uscire dallo spazio? Perderai accesso e partecipazione al governo degli accessi. Storia e impegni restano. Non occorre un successore.",
                                    ),
                                  )
                                )
                                  void action(async () => {
                                    await command({
                                      type: "member.leave",
                                      confirmed: true,
                                    });
                                    choose("");
                                    void retrySpaces();
                                  });
                              }}
                            >
                              {uiText("Lascia lo spazio")}
                            </button>
                          </div>
                        </details>
                        <details className="people-secondary">
                          <summary>
                            {uiText("Accordi e deleghe di accesso")}
                          </summary>
                          <ProductHelp screen="people" />
                          <WorkspaceAccess
                            workspace={workspaceId}
                            actor={actor!}
                            revision={snapshot.workspace.revision}
                            command={command}
                            action={action}
                            busy={busy}
                          />
                        </details>
                        <details className="people-secondary">
                          <summary>{uiText("Spazi collegati")}</summary>
                          <WorkspaceLinks
                            key={workspaceId}
                            id={workspaceId}
                            spaces={spaces}
                            links={snapshot.links ?? []}
                            open={choose}
                            busy={busy}
                            change={(c) => {
                              void action(async () => {
                                await command(c);
                              });
                            }}
                          />
                        </details>
                      </>
                    )}
                  </WorkspaceLayer>
                )}
              </div>
              {peopleFor && (
                <WorkspaceLayer
                  title={uiText("Proponi impegno")}
                  suspended={helpInConversation}
                  close={() => setPeopleFor(null)}
                >
                  <h2>{uiText("Chi riguarda questo impegno?")}</h2>
                  <ProductHelp screen="commitments" field="people" />
                  <p>{peopleFor.content}</p>
                  <p>
                    {uiText(
                      "Il tuo atto proporrà il testo. Ciascuna persona nominata dovrà approvarlo per sé; nessuno sarà rappresentato per silenzio.",
                    )}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const people = new FormData(e.currentTarget).getAll(
                        "people",
                      ) as string[];
                      void action(async () => {
                        await command({
                          type: "commitment.propose",
                          candidateId: peopleFor.id,
                          people: [...new Set([...people, actor!])],
                        });
                        setPeopleFor(null);
                      });
                    }}
                  >
                    {snapshot.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <label className="check" key={m.user_id}>
                          <input
                            type="checkbox"
                            name="people"
                            value={m.user_id}
                            defaultChecked={m.user_id === actor}
                            disabled={m.user_id === actor}
                          />
                          {m.name}
                          {m.user_id === actor ? uiText(" (tu)") : ""}
                        </label>
                      ))}
                    <button disabled={busy}>
                      {uiText("Proponi il testo a queste persone")}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setPeopleFor(null)}
                    >
                      {uiText("Annulla")}
                    </button>
                  </form>
                </WorkspaceLayer>
              )}
              {correctionFor && (
                <WorkspaceLayer
                  title={uiText("Correzione")}
                  suspended={helpInConversation}
                  close={() => setCorrectionFor(null)}
                >
                  <h2>{uiText("Correggi il riferimento di lavoro")}</h2>
                  <ProductHelp screen="information" field="reason" />
                  <p>
                    {uiText("Prima:")}{" "}
                    {
                      snapshot.information.find((i) =>
                        handoff?.kind === "information.correct" &&
                        handoff.candidateId === correctionFor.id
                          ? i.id === handoff.target?.id
                          : i.subject === correctionFor.subject,
                      )?.content
                    }
                  </p>
                  <p>
                    {uiText("Nuova versione: ")}
                    {correctionFor.content}
                  </p>
                  {handoff?.kind === "information.correct" &&
                    handoff.candidateId === correctionFor.id && (
                      <p className="hint">
                        {uiText(
                          "Richiesta dalla conversazione, riferita alla versione",
                        )}{" "}
                        {handoff.target?.version}
                        {uiText(
                          ". Il contenuto del candidato resta attribuito alle sue fonti.",
                        )}
                      </p>
                    )}
                  <p>
                    {uiText(
                      "Le versioni e le fonti precedenti resteranno consultabili. La correzione non modifica impegni, vincoli o permessi.",
                    )}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const reason = new FormData(e.currentTarget).get(
                        "reason",
                      ) as string;
                      const info = snapshot.information.find((i) =>
                        handoff?.kind === "information.correct" &&
                        handoff.candidateId === correctionFor.id
                          ? i.id === handoff.target?.id
                          : i.subject === correctionFor.subject,
                      )!;
                      void action(async () => {
                        if (!info)
                          throw new Error(
                            "Il riferimento da correggere non è disponibile.",
                          );
                        await command({
                          type: "information.correct",
                          informationId: info.id,
                          expectedVersion: info.current_version,
                          candidateId: correctionFor.id,
                          reason,
                          descriptiveOnly: true,
                          ...(handoff?.kind === "information.correct" &&
                          handoff.candidateId === correctionFor.id
                            ? { conversationOrigin: { handoffId: handoff.id } }
                            : {}),
                        });
                        setCorrectionFor(null);
                      });
                    }}
                  >
                    <label>
                      {uiText("Motivo della correzione")}
                      <input name="reason" required maxLength={12000} />
                    </label>
                    <button disabled={busy}>
                      {uiText("Accetta la nuova versione descrittiva")}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setCorrectionFor(null)}
                    >
                      {uiText("Annulla")}
                    </button>
                  </form>
                </WorkspaceLayer>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
  return (
    <ProductHelpProvider
      ask={canContribute && !personalPage ? askProduct : null}
    >
      {shell}
      {settingsDialog}
    </ProductHelpProvider>
  );
}
