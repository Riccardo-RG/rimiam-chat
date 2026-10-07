"use client";
import Link from "next/link";
import { WorkspaceIcon } from "@/client/workspace-icon";
import {
  initials,
  messageDay,
  messageTime,
} from "@/client/conversation-presentation";
import { invitationDeliveryLabel } from "@/shared/invitation-delivery";
import { WorkspaceLinks } from "@/client/workspace-links";
import { WorkspaceCreation } from "@/client/workspace-create";
import { WorkspaceLens } from "@/client/workspace-lens";
import { WorkspaceBetaFeedback } from "@/client/workspace-beta-feedback";
import { feedbackFromComposer } from "@/shared/beta-feedback";
import { AppearanceControl } from "@/client/appearance-control";
import { BrandSignature } from "@/client/brand-signature";
import { BetaNotice } from "@/client/beta-notice";
import { AccountAccess } from "@/client/account-access";
import { useFocusedHistory } from "@/client/focused-history";
import { useConversationScroll } from "@/client/conversation-scroll";
import {
  WorkspaceActivity,
  ReferenceInspector,
} from "@/client/workspace-activity";
import type { ConversationReference } from "@/contracts/activity";
import type { AttentionView } from "@/contracts/attention";
import { addressMiriam } from "@/shared/miriam-address";
import { ConversationVoice, VoiceMessage } from "@/client/conversation-voice";
import { WorkspaceCall } from "@/client/workspace-call";
import { SpokenReply } from "@/client/spoken-reply";
import { WorkspaceAccess } from "@/client/workspace-access";
import { WorkspaceProject } from "@/client/workspace-project";
import { WorkspaceAttention } from "@/client/workspace-attention";
import { WorkspaceLayer } from "@/client/workspace-layer";
import { WorkspaceArtifacts } from "@/client/workspace-artifacts";
import { WorkspaceCalendar } from "@/client/workspace-calendar";
import { WorkspaceEmail } from "@/client/workspace-email";
import { WorkspaceTasks } from "@/client/workspace-tasks";
import { WorkspaceActiveWork } from "@/client/workspace-active-work";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { accountReturnFromSearch } from "@/shared/account-navigation";
import { auth } from "@/client/auth-client";
import { newCommand, sendCommand } from "@/client/command-journal";
import { PendingCommands } from "@/client/pending-commands";
import { api, errors } from "@/client/api";
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
import { WorkspaceSources } from "@/client/workspace-sources";

function subscribeNavigation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readAccountReturn = () => accountReturnFromSearch(window.location.search);
const serverAccountReturn = () => "/";
const historyNotice =
  "Entrando potrai leggere tutti i contenuti condivisi conservati nello spazio, comprese conversazioni, fonti e versioni precedenti al tuo ingresso o ai periodi di assenza. Anche i futuri membri avranno questa visibilità. Uscire interrompe l’accesso successivo, ma non ritira quanto è già stato condiviso.";
function time(value: string) {
  return new Date(value).toLocaleString("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function Home() {
  const state = auth.useSession();
  return (
    <WorkspaceApp
      key={state.data?.session.id ?? "signed-out"}
      session={state.data}
      isPending={state.isPending}
    />
  );
}

function WorkspaceApp({
  session,
  isPending,
}: {
  session: ReturnType<typeof auth.useSession>["data"];
  isPending: boolean;
}) {
  const [panel, setPanelState] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [lensDocked, setLensDocked] = useState(false);
  const [lensSection, setLensSection] = useState("lens");
  const [selectedWork, setSelectedWork] = useState("");
  const [createdWorkspace, setCreatedWorkspace] = useState("");
  const [selectedHandoff, setSelectedHandoff] =
    useState<ConversationHandoff | null>(null);
  const [selectedReference, setSelectedReference] =
    useState<ConversationReference | null>(null);
  const [composerReference, setComposerReference] = useState<{
    reference: ConversationReference;
    title: string;
  } | null>(null);
  const [messageDraft, setMessageDraft] = useState({ text: "", scope: "" });
  const [composerAssistance, setComposerAssistance] =
    useState<ProductHelpDraft | null>(null);
  const [helpInConversation, setHelpInConversation] = useState(false);
  function setPanel(next: string) {
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
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [snapshotData, setSnapshot] = useState<Snapshot | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const snapshot =
    snapshotData?.workspace.id === workspaceId ? snapshotData : null;
  const [invitation, setInvitation] = useState<{
    name: string;
    recipient_email: string;
  } | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [peopleFor, setPeopleFor] = useState<Candidate | null>(null);
  const [correctionFor, setCorrectionFor] = useState<Candidate | null>(null);
  const revision = useRef(-1);
  const selected = useRef("");
  const viewGeneration = useRef(0);
  const actor = session?.user.id;
  const handoffView = useConversationHandoffs(
    workspaceId,
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
  const messagesElement = useRef<HTMLDivElement>(null);
  const { onScroll: captureConversationScroll, followLatest } =
    useConversationScroll(
      messagesElement,
      `${actor}:${workspaceId}:${focusedStream?.id ?? "all"}`,
      displayedMessages.map((message) => message.id).join(":"),
      !!focusedStream && focusedHistory.historical,
      displayedMessages[0]?.id,
    );
  const currentFocus =
    focusedStream && workstreams.find((s) => s.id === focusedStream.id);
  const focusWritable =
    !focusedStream ||
    (!!currentFocus &&
      currentFocus.version === focusedStream.version &&
      currentFocus.state === "active");
  const messageScope = `${workspaceId}:${focusedStream?.id ?? "all"}:${focusedStream?.version ?? ""}`;
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
  const [googleSignInAvailable, setGoogleSignInAvailable] = useState(false);
  const accountReturn = useSyncExternalStore(
    subscribeNavigation,
    readAccountReturn,
    serverAccountReturn,
  );
  useEffect(() => {
    void api<{
      interpretationMode: string;
      localMail: boolean;
      googleSignInAvailable: boolean;
    }>("/api/config")
      .then((c) => {
        setMode(c.interpretationMode);
        setLocalMail(c.localMail);
        setGoogleSignInAvailable(c.googleSignInAvailable === true);
      })
      .catch(() => {});
  }, []);
  const report = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "REQUEST_FAILED";
    setError(errors[message] ?? message);
  }, []);
  async function action(fn: () => Promise<void>) {
    const generation = viewGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (error) {
      if (generation === viewGeneration.current) report(error);
    } finally {
      if (generation === viewGeneration.current) setBusy(false);
    }
  }
  const load = useCallback(
    async (w: string) => {
      const generation = viewGeneration.current;
      try {
        const next = await api<Snapshot>(`/api/workspaces/${w}`);
        if (
          selected.current === w &&
          generation === viewGeneration.current &&
          next.workspace.revision >= revision.current
        ) {
          revision.current = next.workspace.revision;
          setSnapshot(next);
        }
      } catch (error) {
        if (selected.current === w && generation === viewGeneration.current) {
          if (
            error instanceof Error &&
            [
              "WORKSPACE_ACCESS_DENIED",
              "AUTHENTICATION_REQUIRED",
              "ACCOUNT_INELIGIBLE",
            ].includes(error.message)
          )
            setSnapshot(null);
          report(error);
        }
        throw error;
      }
    },
    [report],
  );
  useEffect(() => {
    if (!actor) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    void api<{ id: string; name: string }[]>("/api/workspaces")
      .then((items) => {
        setSpaces(items);
        const w = params.get("workspace") ?? "";
        setWorkspaceId(w);
      })
      .catch(report);
    if (token) {
      void api<{ name: string; recipient_email: string }>(
        `/api/invitations/${token}`,
      )
        .then((value) => {
          setInviteToken(token);
          setInvitation(value);
        })
        .catch(report);
    }
  }, [actor, report]);
  useEffect(() => {
    selected.current = workspaceId;
    revision.current = -1;
    if (!actor || !workspaceId) return;
    let active = true;
    const events = new EventSource(`/api/workspaces/${workspaceId}/events`);
    const refresh = () => {
      if (active) void load(workspaceId).catch(() => {});
    };
    refresh();
    events.onmessage = refresh;
    events.onerror = refresh;
    return () => {
      active = false;
      events.close();
    };
  }, [workspaceId, actor, load]);
  async function command(c: Command) {
    const w = workspaceId;
    const generation = viewGeneration.current;
    const reading = readingGeneration.current;
    const result = await sendCommand(newCommand(actor!, w, c));
    // The verified receipt is already retained server-side and cleared from the journal.
    // Stop only the old view's continuation; never publish its result in another space.
    if (generation !== viewGeneration.current)
      throw new Error(
        "Operazione confermata nello spazio di origine; la vista è cambiata.",
      );
    // A failed projection refresh cannot turn a verified commit into a failed operation.
    if (c.type !== "member.leave" && selected.current === w)
      await load(w).catch(() => {});
    if (generation !== viewGeneration.current)
      throw new Error(
        "Operazione confermata nello spazio di origine; la vista è cambiata.",
      );
    if (
      (c.type === "message.send" || c.type === "voice.send") &&
      reading === readingGeneration.current &&
      c.workstreamFocus?.workstreamId === focusedStream?.id
    ) {
      followLatest();
      focusedHistory.recent();
    }
    return result;
  }
  function choose(w: string) {
    setNavigationOpen(false);
    viewGeneration.current++;
    selected.current = w;
    revision.current = -1;
    setWorkspaceId(w);
    setBusy(false);
    setPeopleFor(null);
    setCorrectionFor(null);
    setPanel("");
    setLensDocked(false);
    setLensSection("lens");
    setSelectedWork("");
    setCreatedWorkspace("");
    setSelectedHandoff(null);
    setSelectedReference(null);
    setComposerReference(null);
    setComposerAssistance(null);
    setHelpInConversation(false);
    setFeedbackMessage(null);
    chooseFocus(null);
    setWorkstreams([]);
    setMessageDraft({ text: "", scope: "" });
    setRequestedSource(null);
    setInviteLink("");
    setError("");
    window.history.replaceState(null, "", w ? `/?workspace=${w}` : "/");
  }
  function openPanel(next: string) {
    setNavigationOpen(false);
    setPanel(next);
    if (next === "feedback") setFeedbackMessage(null);
    if (next) setLensSection(next);
  }
  function openWork(id: string) {
    setSelectedWork(id);
    openPanel("work");
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
    setComposerReference({ reference, title });
    setMessageDraft((draft) =>
      draft.text
        ? draft
        : {
            text: "@RIMIAM, aiutaci a capire questo passaggio.",
            scope: messageScope,
          },
    );
    setPanel("");
    requestAnimationFrame(() => document.getElementById("message")?.focus());
  }
  function askProduct(context: ProductAssistance) {
    setComposerReference(null);
    setComposerAssistance({ context, scope: messageScope });
    setMessageDraft((draft) =>
      draft.text
        ? draft
        : { text: assistanceQuestion(context), scope: messageScope },
    );
    setHelpInConversation(!!(panel || peopleFor || correctionFor));
    requestAnimationFrame(() => document.getElementById("message")?.focus());
  }
  const name = (id: string) =>
    snapshot?.members.find((m) => m.user_id === id)?.name ?? "Membro";
  const access = snapshot?.access.find(
    (a) => a.holder_id === actor && a.active,
  );
  const goal = snapshot?.goals.find((g) => g.current_primary);
  const canContribute = snapshot?.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  if (isPending && !busy)
    return (
      <main className="welcome">
        <AppearanceControl />
        <p>Caricamento…</p>
      </main>
    );
  if (!session)
    return (
      <main className="welcome">
        <div className="welcome-intro">
          <button
            className="wordmark brand-home"
            onClick={() => choose("")}
            aria-label="RIMIAM — Home"
          >
            <BrandSignature />
          </button>
          <div className="welcome-story">
            <p className="eyebrow">IL VOSTRO PROSSIMO PASSO, INSIEME</p>
            <h1>
              Le idee hanno bisogno
              <br />
              di uno spazio.
            </h1>
            <p>
              Parlate, chiarite, costruite. Miriam tiene il filo, così potete
              concentrarvi su ciò che conta.
            </p>
            <div className="welcome-principles">
              <span>
                <WorkspaceIcon name="chat" /> Una conversazione condivisa
              </span>
              <span>
                <WorkspaceIcon name="context" /> Il contesto, sempre ritrovabile
              </span>
              <span>
                <WorkspaceIcon name="spark" /> Miriam, al vostro fianco
              </span>
            </div>
          </div>
          <div className="welcome-footer">
            <span>Uno spazio. Le vostre persone. Più continuità.</span>
            <AppearanceControl />
          </div>
        </div>
        <div className="welcome-access">
          <AccountAccess
            returnTo={accountReturn}
            localMail={localMail}
            googleAvailable={googleSignInAvailable}
          />
        </div>
      </main>
    );
  const shell = (
    <div
      className="app-shell"
      data-navigation={navigationOpen ? "open" : "closed"}
    >
      <a className="skip-link" href="#workspace-content">
        Vai alla conversazione
      </a>
      <aside
        className="sidebar"
        id="workspace-navigation"
        aria-label="Navigazione principale"
        onKeyDown={(event) => {
          if (event.key === "Escape" && navigationOpen) {
            setNavigationOpen(false);
            document.getElementById("navigation-toggle")?.focus();
          }
        }}
      >
        <div className="sidebar-brand-row">
          <button
            className="wordmark brand-home"
            onClick={() => choose("")}
            aria-label="RIMIAM — Home"
          >
            <BrandSignature />
          </button>
          <button
            type="button"
            className="mobile-navigation-close quiet"
            aria-label="Chiudi navigazione"
            onClick={() => {
              setNavigationOpen(false);
              document.getElementById("navigation-toggle")?.focus();
            }}
          >
            <WorkspaceIcon name="close" />
          </button>
        </div>
        <button
          className={workspaceId ? "space" : "space selected"}
          onClick={() => choose("")}
        >
          <WorkspaceIcon name="home" /> <span>Tutti gli spazi</span>
        </button>
        <p className="sidebar-section-heading">I tuoi spazi</p>
        <nav aria-label="I tuoi spazi">
          {spaces.map((w) => (
            <button
              className={w.id === workspaceId ? "space selected" : "space"}
              key={w.id}
              aria-current={w.id === workspaceId ? "page" : undefined}
              onClick={() => choose(w.id)}
            >
              <span className="space-initial" aria-hidden="true">
                {initials(w.name).slice(0, 1)}
              </span>
              <span>{w.name}</span>
            </button>
          ))}
        </nav>
        <button
          className="quiet create-space"
          onClick={() => {
            choose("");
            requestAnimationFrame(() => {
              const input = document.getElementById("new-workspace-name");
              const details = input?.closest("details");
              if (details) details.open = true;
              input?.focus();
            });
          }}
        >
          <WorkspaceIcon name="plus" /> Nuovo spazio
        </button>
        {snapshot && (
          <div className="workspace-sidebar-context">
            <p className="sidebar-section-heading">Nello spazio</p>
            <nav
              className="workspace-navigation"
              aria-label="Viste dello spazio"
            >
              <button
                className={!panel ? "space selected" : "space"}
                aria-current={!panel ? "page" : undefined}
                onClick={() => {
                  setPanel("");
                  setNavigationOpen(false);
                }}
              >
                <WorkspaceIcon name="chat" /> Conversazione
              </button>
              {(
                [
                  ["context", "Contesto", "context"],
                  ["work", "Lavoro", "work"],
                  ["artifacts", "Documenti", "files"],
                  ["attention", "Attività e filoni", "branch"],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  key={id}
                  className={panel === id ? "space selected" : "space"}
                  aria-current={panel === id ? "page" : undefined}
                  onClick={() => openPanel(id)}
                >
                  <WorkspaceIcon name={icon} />
                  {label}
                </button>
              ))}
            </nav>
            <details
              className="sidebar-tools"
              open={[
                "sources",
                "people",
                "calendar",
                "email",
                "feedback",
              ].includes(panel)}
            >
              <summary>
                <WorkspaceIcon name="settings" /> Strumenti e persone
              </summary>
              <nav aria-label="Strumenti dello spazio">
                {(
                  [
                    ["sources", "Fonti e ricerca", "files"],
                    ["people", "Persone e accesso", "people"],
                    ["calendar", "Calendario", "calendar"],
                    ["email", "Email", "mail"],
                    ["feedback", "Feedback beta", "chat"],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    className={panel === id ? "space selected" : "space"}
                    aria-current={panel === id ? "page" : undefined}
                    onClick={() => openPanel(id)}
                  >
                    <WorkspaceIcon name={icon} />
                    {label}
                  </button>
                ))}
              </nav>
            </details>
          </div>
        )}
        <div className="account">
          <div className="account-identity">
            <span className="account-avatar" aria-hidden="true">
              {initials(session.user.name)}
            </span>
            <div>
              <strong>{session.user.name}</strong>
              <small>Account personale</small>
            </div>
          </div>
          <AppearanceControl />
          <Link href="/beta" target="_blank" rel="noopener noreferrer">
            Regole della beta ↗
          </Link>
          <button
            className="quiet"
            onClick={() =>
              void auth.signOut().then(() => window.location.reload())
            }
          >
            Esci dall’account
          </button>
        </div>
      </aside>
      <main
        className="workspace"
        id="workspace-content"
        tabIndex={-1}
        data-view={workspaceId ? "conversation" : "home"}
      >
        <header className="workspace-header">
          <button
            type="button"
            className="mobile-navigation-toggle quiet"
            id="navigation-toggle"
            aria-label={
              navigationOpen ? "Chiudi navigazione" : "Apri navigazione"
            }
            aria-controls="workspace-navigation"
            aria-expanded={navigationOpen}
            onClick={() => {
              setNavigationOpen(!navigationOpen);
              if (!navigationOpen)
                requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLButtonElement>(
                      "#workspace-navigation button",
                    )
                    ?.focus();
                });
            }}
          >
            <WorkspaceIcon name={navigationOpen ? "close" : "menu"} />
          </button>
          <div className="workspace-heading">
            <p className="eyebrow">
              {workspaceId ? "LO SPAZIO CONDIVISO" : "RIMIAM"}
            </p>
            <h1>
              {snapshot?.workspace.name ??
                (workspaceId ? "Apertura dello spazio…" : "I tuoi spazi")}
            </h1>
          </div>
          <div className="workspace-header-actions">
            {snapshot && (
              <button
                type="button"
                className="people-trigger quiet"
                onClick={() => openPanel("people")}
                aria-label="Apri persone e accesso"
              >
                <span className="participant-stack" aria-hidden="true">
                  {snapshot.members
                    .filter((m) => m.active)
                    .slice(0, 3)
                    .map((m) => (
                      <span key={m.user_id}>{initials(m.name)}</span>
                    ))}
                </span>
                <span>
                  {snapshot.members.filter((m) => m.active).length}{" "}
                  {snapshot.members.filter((m) => m.active).length === 1
                    ? "persona"
                    : "persone"}
                </span>
              </button>
            )}
            {workspaceId && (
              <button
                className="lens-trigger"
                aria-expanded={!!panel && !helpInConversation}
                onClick={() => openPanel(panel ? "" : lensSection)}
              >
                <WorkspaceIcon name="context" /> <span>Esplora lo spazio</span>
              </button>
            )}
          </div>
        </header>
        <BetaNotice actorId={session.user.id} />
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="quiet" onClick={() => setError("")}>
              Chiudi
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
          action={action}
          refreshed={async () => {
            const available =
              await api<{ id: string; name: string }[]>("/api/workspaces");
            setSpaces(available);
            if (workspaceId && available.some((w) => w.id === workspaceId))
              await load(workspaceId);
            else if (available[0]) choose(available[0].id);
          }}
        />
        {invitation && (
          <section className="card admission">
            <p className="eyebrow">INVITO PER {invitation.recipient_email}</p>
            <h2>Entra in {invitation.name}</h2>
            <p>{historyNotice}</p>
            <p>
              Partecipare non significa aderire al Goal, accettare decisioni o
              ricevere autorità.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const r = await api<{ workspaceId: string }>(
                    `/api/invitations/${inviteToken}`,
                    { fullHistoryAccepted: true },
                  );
                  setInvitation(null);
                  setSpaces(await api("/api/workspaces"));
                  choose(r.workspaceId);
                });
              }}
            >
              <label className="check">
                <input type="checkbox" required />
                Accetto esplicitamente di entrare con questa visibilità della
                storia.
              </label>
              <button disabled={busy}>Accetta invito ed entra</button>
            </form>
          </section>
        )}
        {!workspaceId && !invitation && (
          <section className="product-home">
            <div className="home-heading">
              <p className="eyebrow">
                BENTORNATO, {session.user.name.split(" ")[0]}
              </p>
              <h2>Riprendi da qui.</h2>
              <p>
                Le tue persone, le conversazioni e ciò che state costruendo.
                Ogni progetto ha il suo spazio.
              </p>
            </div>
            <div className="home-spaces">
              <div className="section-title">
                <h2>I tuoi spazi</h2>
                <span>
                  {spaces.length} {spaces.length === 1 ? "spazio" : "spazi"}
                </span>
              </div>
              <div className="space-grid">
                {spaces.map((w) => (
                  <button
                    className="workspace-tile"
                    key={w.id}
                    onClick={() => choose(w.id)}
                  >
                    <span className="tile-symbol" aria-hidden="true">
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{w.name}</strong>
                    <small>
                      Apri la conversazione <WorkspaceIcon name="arrow" />
                    </small>
                  </button>
                ))}
              </div>
              {spaces.length === 0 && (
                <p className="muted">
                  Il tuo primo spazio può nascere da un’idea, una domanda o
                  qualcosa da costruire insieme.
                </p>
              )}
            </div>
            <details className="home-create" open={spaces.length === 0}>
              <summary>Crea un nuovo spazio</summary>{" "}
              <WorkspaceCreation
                key={actor}
                actor={actor!}
                onCreated={(workspace) => {
                  setSpaces((current) => [
                    ...current.filter((item) => item.id !== workspace.id),
                    workspace,
                  ]);
                  choose(workspace.id);
                  setCreatedWorkspace(workspace.id);
                }}
              />
            </details>
            <p className="hint">
              Hai ricevuto un invito? Apri il link con l’account a cui è
              destinato.
            </p>
          </section>
        )}
        {workspaceId && !snapshot && !invitation && (
          <section className="empty" aria-busy={!error}>
            <p>
              {error
                ? "Lo spazio non è disponibile in questo momento."
                : "Sto aprendo lo spazio…"}
            </p>
            {error && (
              <button
                className="quiet"
                onClick={() => void load(workspaceId).catch(() => {})}
              >
                Riprova ad aprire lo spazio
              </button>
            )}
          </section>
        )}
        {snapshot && (
          <>
            {createdWorkspace === workspaceId && (
              <div className="creation-next" role="status">
                <div>
                  <strong>Lo spazio è pronto.</strong>
                  <p>
                    Puoi iniziare a scrivere oppure invitare le persone con cui
                    vuoi costruirlo.
                  </p>
                </div>
                <button
                  className="quiet"
                  onClick={() => {
                    openPanel("people");
                    setCreatedWorkspace("");
                  }}
                >
                  Invita una persona
                </button>
                <button
                  className="quiet"
                  onClick={() => setCreatedWorkspace("")}
                >
                  Più tardi
                </button>
              </div>
            )}
            <button
              type="button"
              className="goal-compass"
              onClick={() => openPanel("goal")}
            >
              <WorkspaceIcon name="goal" />
              <span className="goal-compass-label">
                {goal ? "Goal" : "Un punto di partenza"}
              </span>
              <span className="goal-compass-content">
                {goal?.content ??
                  "Il Goal può emergere dalla conversazione. Definiscilo quando siete pronti."}
              </span>
              <WorkspaceIcon name="chevron" />
            </button>
            <div className="activity-bar">
              <WorkspaceActiveWork
                inspectReference={inspectReference}
                key={`presence:${actor}:${workspaceId}`}
                workspace={workspaceId}
                actor={actor!}
                name={name}
                command={command}
                action={action}
                busy={busy}
                compact
                openWork={openWork}
              />
              <WorkspaceAttention
                key={`attention:${actor}:${workspaceId}`}
                workspace={workspaceId}
                actor={actor!}
                compact
                open={openPanel}
                command={command}
                action={action}
                busy={busy}
                canContribute={!!canContribute}
                name={name}
                onWorkstreams={setWorkstreams}
              />
            </div>
            <div
              className={
                panel && lensDocked && !helpInConversation
                  ? "workspace-stage with-layer"
                  : "workspace-stage"
              }
            >
              <section className="card conversation">
                {focusedStream && (
                  <div className="focus-strip">
                    <div>
                      <strong>{focusedStream.title}</strong>
                      <small>
                        Stessa conversazione condivisa · vista per filone
                      </small>
                    </div>
                    <button className="quiet" onClick={() => chooseFocus(null)}>
                      Tutta la conversazione
                    </button>
                    {!focusWritable && (
                      <p role="status">
                        Il filone è cambiato o non è attivo.{" "}
                        <button
                          className="quiet"
                          onClick={() => openPanel("attention")}
                        >
                          Verifica il filone
                        </button>
                        {currentFocus?.state === "active" && (
                          <button
                            className="quiet"
                            onClick={() => chooseFocus(currentFocus)}
                          >
                            Usa la versione aggiornata
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                )}
                <div className="section-title">
                  <h2>Conversazione</h2>
                  <span>
                    {displayedMessages.length}{" "}
                    {displayedMessages.length === 1 ? "messaggio" : "messaggi"}
                  </span>
                </div>
                {mode === "unconfigured" ? (
                  <p className="miriam-live-state" role="status">
                    Le risposte AI non sono disponibili: il modello non è ancora
                    collegato. La conversazione tra le persone rimane attiva.
                  </p>
                ) : snapshot.interpretations.some(
                    (i) => i.status === "queued" || i.status === "running",
                  ) ? (
                  <p className="miriam-live-state" role="status">
                    Miriam sta leggendo il contesto pertinente…
                  </p>
                ) : snapshot.interpretations.some(
                    (i) => i.status === "failed" || i.status === "stale",
                  ) ? (
                  <button className="quiet" onClick={() => setPanel("context")}>
                    Una lettura di Miriam richiede attenzione ↗
                  </button>
                ) : null}
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
                >
                  <div
                    className="messages"
                    ref={messagesElement}
                    onScroll={captureConversationScroll}
                  >
                    {focusedStream && (
                      <div className="history-navigation">
                        {focusedHistory.loading && (
                          <p role="status">Caricamento del filone…</p>
                        )}
                        {focusedHistory.error && (
                          <p role="alert">
                            {focusedHistory.error}
                            <button
                              className="quiet"
                              onClick={focusedHistory.retry}
                            >
                              Riprova
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
                            Messaggi precedenti
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
                            Torna ai messaggi recenti
                          </button>
                        )}
                      </div>
                    )}
                    {focusedStream &&
                      displayedMessages.length === 0 &&
                      !focusedHistory.loading &&
                      !focusedHistory.error && (
                        <p className="muted">
                          Non ci sono messaggi collegati a questo filone.
                        </p>
                      )}
                    {displayedMessages.map((m, index) => (
                      <Fragment key={m.id}>
                        {(index === 0 ||
                          messageDay(
                            displayedMessages[index - 1].created_at,
                          ) !== messageDay(m.created_at)) && (
                          <div className="conversation-day">
                            <span>{messageDay(m.created_at)}</span>
                          </div>
                        )}
                        <article
                          key={m.id}
                          id={`source-${m.id}`}
                          tabIndex={-1}
                          className={
                            m.actor_kind === "miriam"
                              ? "message miriam-message"
                              : m.author_id === actor
                                ? "message own"
                                : "message"
                          }
                        >
                          <span className="message-avatar" aria-hidden="true">
                            {m.actor_kind === "miriam" ? (
                              <WorkspaceIcon name="spark" />
                            ) : (
                              initials(m.author_name)
                            )}
                          </span>
                          <div className="message-main">
                            <div className="message-meta">
                              <strong>
                                {m.author_name}{" "}
                                <span className="author-kind">
                                  {m.purpose === "workspace_welcome"
                                    ? "introduzione automatica"
                                    : m.purpose === "workspace_introduction"
                                      ? "descrizione iniziale"
                                      : m.operationResult
                                        ? "riscontro dell’operazione"
                                        : m.actor_kind === "miriam"
                                          ? "AI"
                                          : m.author_id === actor
                                            ? "tu"
                                            : null}
                                </span>
                              </strong>
                              <time
                                dateTime={m.created_at}
                                title={time(m.created_at)}
                              >
                                {messageTime(m.created_at)}
                              </time>
                            </div>
                            <p className="message-body">{m.content}</p>
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
                                Apri il filone {m.operationResult.title} ↗
                              </button>
                            )}
                            <ConversationHandoffs
                              items={handoffView.handoffs.filter(
                                (h) => h.sourceMessageId === m.id,
                              )}
                              open={openHandoff}
                            />
                            {m.reference && (
                              <button
                                className="message-reference quiet"
                                onClick={() => inspectReference(m.reference!)}
                              >
                                Riferimento di questo messaggio ↗
                              </button>
                            )}
                            <VoiceMessage id={m.id} />
                            {m.actor_kind === "miriam" && (
                              <SpokenReply
                                id={`${actor}:${snapshot.workspace.id}:${m.id}`}
                                text={m.content}
                              />
                            )}
                            <details>
                              <summary>
                                {m.actor_kind === "miriam"
                                  ? "Fonti e origine"
                                  : "Fonte originale"}
                              </summary>
                              <small>
                                Messaggio {m.sequence} ·{" "}
                                {m.purpose === "workspace_welcome"
                                  ? "Introduzione deterministica, nessuna inferenza AI"
                                  : m.operationResult
                                    ? "Riscontro deterministico del server, nessuna inferenza AI"
                                    : m.actor_kind === "miriam"
                                      ? "Contributo AI, non stato adottato"
                                      : "Atto umano originale"}
                                <br />
                                Conservato senza riscritture.
                                {m.assistanceContext && (
                                  <AssistanceReference
                                    context={m.assistanceContext}
                                  />
                                )}
                                {m.operationResult?.workstreamVersion && (
                                  <span>
                                    {" "}
                                    · Filone alla versione{" "}
                                    {m.operationResult.workstreamVersion}
                                  </span>
                                )}
                                {canContribute && (
                                  <button
                                    className="quiet"
                                    aria-label={`Feedback sul messaggio ${m.sequence}`}
                                    onClick={() => {
                                      openPanel("feedback");
                                      setFeedbackMessage({
                                        id: m.id,
                                        content: m.content,
                                      });
                                    }}
                                  >
                                    Feedback
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="quiet"
                                  onClick={() => handoffView.loadSource(m.id)}
                                >
                                  Carica i passi proposti per questo messaggio
                                </button>
                                {handoffView.sourceRead === m.id && (
                                  <span role="status">
                                    {handoffView.handoffs.some(
                                      (h) => h.sourceMessageId === m.id,
                                    )
                                      ? "Passi disponibili sotto il messaggio."
                                      : "Nessun passo proposto per questo messaggio."}
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
                                      Descrizione iniziale di riferimento
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
                                          "Fonte"}
                                      </strong>
                                      <span>
                                        {source?.qualification ??
                                          "Messaggio umano originale"}
                                      </span>
                                      <span>
                                        {source?.content ?? message?.content}
                                      </span>
                                      {message && (
                                        <button
                                          type="button"
                                          className="quiet"
                                          onClick={() => revealSource(id)}
                                        >
                                          Vai al messaggio ↗
                                        </button>
                                      )}
                                    </span>
                                  );
                                })}
                              </small>
                            </details>
                          </div>
                        </article>
                      </Fragment>
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
                          <h3>Cominciamo da una conversazione.</h3>
                          <p>
                            Condividi un’idea con il gruppo, oppure chiedi a
                            Miriam una mano per il prossimo passo.
                          </p>
                          <div className="conversation-prompts">
                            {[
                              [
                                "Facciamo il punto",
                                "@Miriam aiutaci a fare il punto su ciò che abbiamo condiviso.",
                              ],
                              [
                                "Troviamo il prossimo passo",
                                "@Miriam quali aspetti dovremmo chiarire per trovare il prossimo passo?",
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
                                    document.getElementById("message")?.focus(),
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
                  <form
                    className="conversation-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draftNeedsScope || !focusWritable) return;
                      const sentDraft = messageDraft;
                      const sentReference = composerReference;
                      const sentHelp = composerAssistance;
                      const sentAssistance = assistanceContext;
                      const form = e.currentTarget;
                      const raw = new FormData(form).get("message") as string;
                      const feedback = feedbackFromComposer(raw);
                      if (feedback !== null) {
                        if (!feedback || feedback.length > 6000) return;
                        void action(async () => {
                          await command({
                            type: "beta.feedback.add",
                            content: feedback,
                          });
                          setMessageDraft((current) =>
                            current.text === sentDraft.text &&
                            current.scope === sentDraft.scope
                              ? { text: "", scope: messageScope }
                              : current,
                          );
                          setNotice(
                            "Feedback salvato. Lo ritrovi in Feedback beta, con il report da scaricare.",
                          );
                          setComposerAssistance((current) =>
                            current === sentHelp ? null : current,
                          );
                        });
                        return;
                      }
                      const addressed =
                        (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                          "data-target",
                        ) === "miriam";
                      const content =
                        addressed || sentAssistance ? addressMiriam(raw) : raw;
                      void action(async () => {
                        await command({
                          type: "message.send",
                          content,
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
                        });
                        setMessageDraft((current) =>
                          current.text === sentDraft.text &&
                          current.scope === sentDraft.scope
                            ? { text: "", scope: messageScope }
                            : current,
                        );
                        setComposerReference((current) =>
                          current === sentReference ? null : current,
                        );
                        setComposerAssistance((current) =>
                          current === sentHelp ? null : current,
                        );
                      });
                    }}
                  >
                    {helpInConversation &&
                      (panel || peopleFor || correctionFor) && (
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setHelpInConversation(false)}
                        >
                          Torna al modulo
                        </button>
                      )}
                    {composerAssistance && feedbackDraft === null && (
                      <AssistanceReference
                        context={composerAssistance.context}
                        remove={() => setComposerAssistance(null)}
                      />
                    )}
                    {composerReference && feedbackDraft === null && (
                      <div className="composer-reference">
                        <span>
                          Su: {composerReference.title} ·{" "}
                          {composerReference.reference.kind === "active_work"
                            ? "rev."
                            : "v"}
                          {composerReference.reference.version}
                        </span>
                        <button
                          className="quiet"
                          type="button"
                          onClick={() => setComposerReference(null)}
                          aria-label="Rimuovi il riferimento dal messaggio"
                        >
                          Rimuovi
                        </button>
                      </div>
                    )}
                    <label className="sr-only" htmlFor="message">
                      Messaggio
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      placeholder="Scrivi al gruppo o chiedi a Miriam…"
                      required
                      maxLength={12000}
                      rows={2}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey) &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          const submit =
                            event.currentTarget.form?.querySelector<HTMLButtonElement>(
                              "[data-primary-send]",
                            );
                          if (submit && !submit.disabled)
                            event.currentTarget.form?.requestSubmit(submit);
                        }
                      }}
                      value={messageDraft.text}
                      onChange={(event) => {
                        const text = event.target.value;
                        if (!text.trim() || feedbackFromComposer(text) !== null)
                          setComposerAssistance(null);
                        setMessageDraft((current) => ({
                          text,
                          scope:
                            current.text && text ? current.scope : messageScope,
                        }));
                      }}
                    />
                    {feedbackDraft !== null && (
                      <p role="status">
                        Feedback generale condiviso: non è un messaggio a RIMIAM
                        e non entra nel Context. Nessun messaggio o riferimento
                        è allegato. Massimo 6.000 caratteri.
                      </p>
                    )}
                    {draftNeedsScope && (
                      <p className="draft-scope-warning">
                        La bozza appartiene alla vista precedente.{" "}
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
                          Usa la bozza{" "}
                          {focusedStream
                            ? "in questo filone"
                            : "nella conversazione completa"}
                        </button>
                      </p>
                    )}
                    <div className="composer-toolbar">
                      <span className="composer-hint">
                        Visibile a tutto lo spazio{" "}
                        <span aria-hidden="true">·</span> Ctrl / ⌘ + Invio
                      </span>
                      <div className="composer-actions">
                        <button
                          type="submit"
                          className="quiet ask-miriam composer-ask"
                          data-target="miriam"
                          disabled={
                            busy ||
                            !canContribute ||
                            !focusWritable ||
                            draftNeedsScope ||
                            feedbackDraft !== null ||
                            !messageDraft.text.trim()
                          }
                        >
                          <WorkspaceIcon name="spark" />
                          Chiedi a Miriam
                        </button>
                        <button
                          type="submit"
                          data-primary-send
                          className="composer-send"
                          disabled={
                            busy ||
                            !canContribute ||
                            !focusWritable ||
                            draftNeedsScope ||
                            !messageDraft.text.trim() ||
                            (feedbackDraft !== null &&
                              (!feedbackDraft || feedbackDraft.length > 6000))
                          }
                        >
                          {feedbackDraft === null ? "Invia" : "Salva feedback"}
                          <WorkspaceIcon name="send" />
                        </button>
                      </div>
                    </div>
                  </form>
                  <ProductHelp screen="conversation" />
                  {handoffView.error && (
                    <p className="hint" role="status">
                      I passi proposti non sono disponibili: {handoffView.error}{" "}
                      <button className="quiet" onClick={handoffView.retry}>
                        Riprova
                      </button>
                    </p>
                  )}
                </ConversationVoice>
                <WorkspaceCall
                  key={`call:${actor}:${workspaceId}`}
                  workspace={workspaceId}
                  actor={actor!}
                  disabled={!canContribute}
                  command={command}
                />
              </section>
              {panel && (
                <WorkspaceLayer
                  suspended={helpInConversation}
                  title={
                    {
                      lens: "Dentro il vostro spazio",
                      goal: "La direzione",
                      attention: "Attività e filoni",
                      reference: "Il passaggio",
                      context: "Contesto condiviso",
                      work: "Lavoro e follow-up",
                      materials: "Materiali dello spazio",
                      tools: "Strumenti",
                      people: "Persone e accesso",
                      calendar: "Calendario",
                      email: "Email",
                      sources: "Fonti e ricerca",
                      artifacts: "Documenti",
                      feedback: "Feedback beta",
                    }[panel] ?? "Dettagli"
                  }
                  close={() => setPanel("")}
                  docked={lensDocked}
                  setDocked={setLensDocked}
                >
                  <WorkspaceLens selected={panel} open={openPanel} />
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
                  {panel === "lens" && (
                    <p className="lens-intro">
                      La conversazione continua qui accanto. Apri ciò che serve
                      per ritrovare la direzione, capire un’informazione o
                      portare avanti il lavoro.
                    </p>
                  )}
                  {panel === "goal" && (
                    <WorkspaceProject
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
                  {panel === "context" && (
                    <>
                      <div className="context-column">
                        <section className="card">
                          <p className="eyebrow">SHARED CONTEXT</p>
                          <h2>Riferimenti accettati</h2>
                          <ProductHelp screen="information" />
                          <p className="hint">
                            Informazioni descrittive adottate come riferimento
                            di lavoro. Non sono verità garantite o impegni del
                            gruppo.
                          </p>
                          {snapshot.information.length === 0 && (
                            <p className="muted">
                              Nessun riferimento accettato. Le proposte di
                              Miriam restano separate.
                            </p>
                          )}
                          {snapshot.information.map((info) => (
                            <article className="information" key={info.id}>
                              <span className="tag">
                                Accettata · v{info.current_version}
                              </span>
                              <h3>{info.subject}</h3>
                              <p>{info.content}</p>
                              <p className="hint">{info.qualification}</p>
                              <small>
                                Accettata da {name(info.accepted_by)}
                              </small>
                              <details>
                                <summary>
                                  Fonti e storia delle correzioni
                                </summary>
                                {snapshot.versions
                                  .filter((v) => v.information_id === info.id)
                                  .map((v) => (
                                    <div className="version" key={v.version}>
                                      <strong>
                                        Versione {v.version} ·{" "}
                                        {v.accepted_by_name}
                                      </strong>
                                      <p>{v.content}</p>
                                      <p className="hint">{v.qualification}</p>
                                      <small>
                                        {v.reason} · {time(v.created_at)}
                                      </small>
                                      <Provenance
                                        candidate={snapshot.candidates.find(
                                          (c) => c.id === v.candidate_id,
                                        )}
                                      />
                                    </div>
                                  ))}
                              </details>
                            </article>
                          ))}
                        </section>
                        <section className="card">
                          <div className="section-title">
                            <h2>Miriam propone</h2>
                            <span className="tag">Da valutare</span>
                          </div>
                          <p className="hint">
                            Interpretazioni attribuite alle fonti. Nessuna
                            accettazione o autorità automatica.
                          </p>
                          {mode === "unconfigured" && (
                            <p className="processing">
                              Il modello AI non è ancora collegato.
                              Conversazione e fonti restano disponibili; la
                              lettura AI richiede il collegamento del servizio e
                              un nuovo tentativo.
                            </p>
                          )}
                          {snapshot.interpretations
                            .filter((i) => i.status !== "completed")
                            .map((i) => (
                              <div className="processing" key={i.id}>
                                {i.status === "queued" || i.status === "running"
                                  ? "Miriam sta leggendo una nuova fonte…"
                                  : i.status === "stale"
                                    ? "Il contesto è cambiato durante la lettura."
                                    : (errors[i.error_code ?? ""] ??
                                      "Lettura non completata: serve un nuovo tentativo o più contesto.")}
                                {["failed", "stale"].includes(i.status) && (
                                  <button
                                    className="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await command({
                                          type: "interpretation.retry",
                                          interpretationId: i.id,
                                        });
                                      })
                                    }
                                  >
                                    Riprova lettura
                                  </button>
                                )}
                              </div>
                            ))}
                          {snapshot.candidates
                            .filter(
                              (c) =>
                                !c.uses.information.length &&
                                !c.uses.questions.length &&
                                !c.uses.proposals.length,
                            )
                            .map((c) => (
                              <article
                                id={`candidate-${c.id}`}
                                tabIndex={-1}
                                className={`proposal${handoff?.candidateId === c.id ? " linked-handoff-target" : ""}`}
                                key={c.id}
                              >
                                <span className="tag">
                                  {c.classification === "descriptive"
                                    ? "Informazione proposta"
                                    : c.classification === "question"
                                      ? "Domanda proposta"
                                      : c.classification === "normative"
                                        ? "Possibile impegno"
                                        : "Da chiarire"}
                                </span>
                                <h3>{c.subject}</h3>
                                <p>{c.content}</p>
                                <p className="hint">{c.qualification}</p>
                                {snapshot.information.some(
                                  (i) =>
                                    i.subject === c.subject &&
                                    i.content !== c.content,
                                ) && (
                                  <p className="processing">
                                    Esiste un riferimento diverso per questo
                                    argomento. La nuova affermazione non lo
                                    sostituisce automaticamente.
                                  </p>
                                )}
                                <Provenance candidate={c} />
                                {c.context_revision !==
                                snapshot.workspace.context_revision ? (
                                  <button
                                    className="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await command({
                                          type: "interpretation.retry",
                                          interpretationId: c.interpretation_id,
                                        });
                                      })
                                    }
                                  >
                                    Rileggi alla luce degli aggiornamenti
                                  </button>
                                ) : (
                                  <div className="actions">
                                    {c.classification === "question" && (
                                      <button
                                        disabled={busy || !canContribute}
                                        onClick={() =>
                                          void action(async () => {
                                            await command({
                                              type: "question.open",
                                              sourceId: c.source_id,
                                              candidateId: c.id,
                                              content: c.content,
                                            });
                                          })
                                        }
                                      >
                                        Conserva come domanda aperta
                                      </button>
                                    )}
                                    {c.classification === "descriptive" &&
                                      (snapshot.information.some(
                                        (i) => i.subject === c.subject,
                                      ) ? (
                                        <button
                                          disabled={busy || !canContribute}
                                          onClick={() => setCorrectionFor(c)}
                                        >
                                          Valuta come correzione
                                        </button>
                                      ) : (
                                        <button
                                          disabled={busy || !canContribute}
                                          onClick={() =>
                                            void action(async () => {
                                              await command({
                                                type: "information.accept",
                                                candidateId: c.id,
                                                descriptiveOnly: true,
                                                ...(handoff?.kind ===
                                                  "information.accept" &&
                                                handoff.candidateId === c.id
                                                  ? {
                                                      conversationOrigin: {
                                                        handoffId: handoff.id,
                                                      },
                                                    }
                                                  : {}),
                                              });
                                            })
                                          }
                                        >
                                          Accetta come riferimento descrittivo
                                        </button>
                                      ))}
                                    {["normative", "uncertain"].includes(
                                      c.classification,
                                    ) && (
                                      <p className="hint">
                                        Se intendi descrivere un dato,
                                        chiariscilo in un nuovo messaggio. Per
                                        un impegno preciso, raccogli gli atti
                                        delle persone interessate.
                                      </p>
                                    )}
                                    <button
                                      className="quiet"
                                      disabled={busy || !canContribute}
                                      onClick={() => setPeopleFor(c)}
                                    >
                                      Proponi come impegno esplicito
                                    </button>
                                  </div>
                                )}
                              </article>
                            ))}
                        </section>
                      </div>
                      <WorkspaceQuestions
                        state={snapshot}
                        command={command}
                        action={action}
                        busy={busy}
                        actor={actor!}
                      />
                    </>
                  )}
                  {panel === "work" && (
                    <>
                      <WorkspaceActiveWork
                        inspectReference={inspectReference}
                        key={`work:${actor}:${workspaceId}`}
                        workspace={workspaceId}
                        actor={actor!}
                        name={name}
                        command={command}
                        action={action}
                        busy={busy}
                        selectedWork={selectedWork}
                      />
                      <WorkspaceTasks
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
                    </>
                  )}
                  {panel === "materials" && (
                    <div className="destination-list">
                      <p>
                        Le fonti da comprendere e ciò che state costruendo,
                        nello stesso spazio.
                      </p>
                      <button
                        className="destination"
                        onClick={() => setPanel("sources")}
                      >
                        <strong>Fonti e ricerca ↗</strong>
                        <span>
                          File condivisi, riferimenti e ricerche sul web.
                        </span>
                      </button>
                      <button
                        className="destination"
                        onClick={() => setPanel("artifacts")}
                      >
                        <strong>Documenti e risultati ↗</strong>
                        <span>Bozze, versioni e contenuti adottati.</span>
                      </button>
                    </div>
                  )}
                  {panel === "tools" && (
                    <div className="destination-list">
                      <p>
                        Collega i tuoi strumenti quando servono. Ogni azione
                        mantiene i propri confini.
                      </p>
                      <button
                        className="destination"
                        onClick={() => setPanel("calendar")}
                      >
                        <strong>Calendario ↗</strong>
                        <span>
                          Tempi condivisi e il tuo calendario personale.
                        </span>
                      </button>
                      <button
                        className="destination"
                        onClick={() => setPanel("email")}
                      >
                        <strong>Email ↗</strong>
                        <span>La tua posta, bozze e invii espliciti.</span>
                      </button>
                    </div>
                  )}
                  {panel === "sources" && (
                    <>
                      <WorkspaceSources
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
                      <WorkspaceActiveWork
                        inspectReference={inspectReference}
                        key={`results:${actor}:${workspaceId}`}
                        workspace={workspaceId}
                        actor={actor!}
                        name={name}
                        command={command}
                        action={action}
                        busy={busy}
                        resultsOnly
                      />
                      <WorkspaceArtifacts
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
                      <WorkspaceAccess
                        workspace={workspaceId}
                        actor={actor!}
                        revision={snapshot.workspace.revision}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                      <details className="card">
                        <summary>Partecipanti e accesso</summary>
                        <ProductHelp screen="people" />
                        <p className="hint">
                          Partecipazione, adesione al Goal e poteri di gestione
                          degli accessi sono distinti.
                        </p>
                        {snapshot.members.map((m) => (
                          <div className="member" key={m.user_id}>
                            <span>
                              {m.name} ·{" "}
                              {m.active ? "Partecipante" : "Non ha più accesso"}
                              {snapshot.access.some(
                                (a) => a.holder_id === m.user_id && a.active,
                              )
                                ? " · Gestione accessi esplicitamente attribuita"
                                : ""}
                            </span>
                            {access?.remove_members &&
                              m.active &&
                              m.user_id !== actor &&
                              !snapshot.access.some(
                                (a) => a.holder_id === m.user_id && a.active,
                              ) && (
                                <button
                                  className="quiet"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Rimuovere l’accesso di ${m.name}? Storia e impegni restano conservati.`,
                                      )
                                    )
                                      void action(async () => {
                                        await command({
                                          type: "member.remove",
                                          personId: m.user_id,
                                          expectedAccessRevision:
                                            snapshot.workspace.access_revision,
                                          confirmed: true,
                                        });
                                      });
                                  }}
                                >
                                  Rimuovi accesso
                                </button>
                              )}
                          </div>
                        ))}
                        {access?.invitations && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const data = new FormData(e.currentTarget);
                              const email = data.get("email") as string;
                              void action(async () => {
                                const r = await command({
                                  type: "invitation.create",
                                  email,
                                  fullHistoryDisclosed: true,
                                  sendEmail: data.get("sendEmail") === "on",
                                });
                                setInviteLink(
                                  `${window.location.origin}/?invite=${r.token}`,
                                );
                              });
                            }}
                          >
                            <h3>Invita una persona</h3>
                            <p>{historyNotice}</p>
                            <label>
                              Email del destinatario
                              <input name="email" type="email" required />
                            </label>
                            <label className="check">
                              <input type="checkbox" required />
                              Confermo che l’invito concede accesso all’intera
                              storia condivisa conservata.
                            </label>
                            <label className="check">
                              <input type="checkbox" name="sendEmail" />
                              Invia anche un’email al destinatario
                            </label>
                            <button disabled={busy}>
                              Crea invito personale
                            </button>
                            {inviteLink && (
                              <label>
                                Condividi questo link solo con il destinatario
                                <input
                                  readOnly
                                  value={inviteLink}
                                  aria-label="Link invito"
                                />
                              </label>
                            )}
                          </form>
                        )}
                        {snapshot.invitations
                          .filter((i) => !i.accepted_at && !i.revoked_at)
                          .map((i) => (
                            <div className="member" key={i.id}>
                              <span>
                                Invito a {i.recipient_email} · scade{" "}
                                {time(i.expires_at)} ·{" "}
                                {invitationDeliveryLabel(i.delivery_status)}
                              </span>
                              <button
                                className="quiet"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await command({
                                      type: "invitation.revoke",
                                      invitationId: i.id,
                                    });
                                  })
                                }
                              >
                                Revoca invito
                              </button>
                            </div>
                          ))}
                        <div className="actions">
                          {access && (
                            <button
                              className="quiet"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Rinunciare alla tua gestione degli accessi? Lo spazio può restare senza chi possa gestirlo. La partecipazione continua e non viene nominato un successore.",
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
                              Rinuncia alla gestione degli accessi
                            </button>
                          )}
                          <button
                            className="quiet danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Uscire dallo spazio? Perderai accesso e partecipazione al governo degli accessi. Storia e impegni restano. Non occorre un successore.",
                                )
                              )
                                void action(async () => {
                                  await command({
                                    type: "member.leave",
                                    confirmed: true,
                                  });
                                  setSpaces(await api("/api/workspaces"));
                                  choose("");
                                });
                            }}
                          >
                            Lascia lo spazio
                          </button>
                        </div>
                      </details>
                    </>
                  )}
                </WorkspaceLayer>
              )}
            </div>
            {peopleFor && (
              <WorkspaceLayer
                title="Proponi impegno"
                suspended={helpInConversation}
                close={() => setPeopleFor(null)}
              >
                <h2>Chi riguarda questo impegno?</h2>
                <ProductHelp screen="commitments" field="people" />
                <p>{peopleFor.content}</p>
                <p>
                  Il tuo atto proporrà il testo. Ciascuna persona nominata dovrà
                  approvarlo per sé; nessuno sarà rappresentato per silenzio.
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
                        {m.user_id === actor ? " (tu)" : ""}
                      </label>
                    ))}
                  <button disabled={busy}>
                    Proponi il testo a queste persone
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setPeopleFor(null)}
                  >
                    Annulla
                  </button>
                </form>
              </WorkspaceLayer>
            )}
            {correctionFor && (
              <WorkspaceLayer
                title="Correzione"
                suspended={helpInConversation}
                close={() => setCorrectionFor(null)}
              >
                <h2>Correggi il riferimento di lavoro</h2>
                <ProductHelp screen="information" field="reason" />
                <p>
                  Prima:{" "}
                  {
                    snapshot.information.find((i) =>
                      handoff?.kind === "information.correct" &&
                      handoff.candidateId === correctionFor.id
                        ? i.id === handoff.target?.id
                        : i.subject === correctionFor.subject,
                    )?.content
                  }
                </p>
                <p>Nuova versione: {correctionFor.content}</p>
                {handoff?.kind === "information.correct" &&
                  handoff.candidateId === correctionFor.id && (
                    <p className="hint">
                      Richiesta dalla conversazione, riferita alla versione{" "}
                      {handoff.target?.version}. Il contenuto del candidato
                      resta attribuito alle sue fonti.
                    </p>
                  )}
                <p>
                  Le versioni e le fonti precedenti resteranno consultabili. La
                  correzione non modifica impegni, vincoli o permessi.
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
                    Motivo della correzione
                    <input name="reason" required maxLength={12000} />
                  </label>
                  <button disabled={busy}>
                    Accetta la nuova versione descrittiva
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setCorrectionFor(null)}
                  >
                    Annulla
                  </button>
                </form>
              </WorkspaceLayer>
            )}
          </>
        )}
      </main>
    </div>
  );
  return (
    <ProductHelpProvider ask={canContribute ? askProduct : null}>
      {shell}
    </ProductHelpProvider>
  );
}

function Provenance({ candidate }: { candidate?: Candidate }) {
  if (!candidate) return null;
  return (
    <details>
      <summary>Fonte e attribuzione</summary>
      <p>
        {candidate.origin === "inferred"
          ? "Deduzione proposta da Miriam, non dichiarazione esplicita."
          : `Interpretazione attribuita a ${candidate.author_name}.`}
      </p>
      <blockquote>{candidate.source_content}</blockquote>
      {candidate.source_ids.map((id) => (
        <a className="source-link" href={`#source-${id}`} key={id}>
          Apri la fonte originale
        </a>
      ))}
      <small>{candidate.qualification}</small>
    </details>
  );
}
