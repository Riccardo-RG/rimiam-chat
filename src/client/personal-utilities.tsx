"use client";
import { localizedDate } from "../shared/i18n/date";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Command } from "@/contracts/commands";
import {
  referenceDetailSchema,
  type ReferenceDetail,
} from "@/contracts/activity";
import { addressMiriam, isAssistantAddress } from "../shared/miriam-address";
import { api, errorText } from "./api";
import { assistantRequestFailures } from "../shared/assistant-request-failures";
import { AssistantRequestFeedback } from "./assistant-request-feedback";
import { usePersonalReading } from "./personal-reading";
import {
  historyRequest,
  PersonalChatControls,
  PrivateResearchResult,
  personalChatCommand,
  useChatState,
} from "./personal-chat-controls";
import {
  ConsultationEvidence,
  ConsultationSources,
} from "./private-consultation";
import type { ConsultationRef } from "../contracts/private-consultation";
import {
  GeneratedDocument,
  generatedDocumentPrompt,
  type DocumentRequest,
} from "./generated-document";
import { ChatReminderLine } from "./chat-reminder-line";
import { EmmeMessageMark } from "./brand-signature";
import {
  newCommand,
  pendingCommands,
  type PendingCommand,
} from "./command-journal";
import {
  ConversationAttachment,
  type AttachmentPicker,
} from "./conversation-attachment";
import { useComposerInteraction } from "./chat-composer-interaction";
import { ConversationMessageInput } from "./conversation-composer-dock";
import { useConversationScroll } from "./conversation-scroll";
import { PendingCommands } from "./pending-commands";
import { MessageFile } from "./message-file";
import type { Snapshot } from "./types";
import { WorkspaceArtifacts } from "./workspace-artifacts";
import { WorkspaceIcon } from "./workspace-icon";
import type { DocumentExitGuard } from "./workspace-layer";
import { WorkspaceTasks } from "./workspace-tasks";
import styles from "./personal-utilities.module.css";

export type PersonalTab = "chat" | "documents" | "reminders";
type Props = {
  state: Snapshot;
  actor: string;
  busy: boolean;
  aiUnavailable: boolean;
  offline: boolean;
  assistantName: string;
  onConfigure: () => void;
  tab: PersonalTab;
  onTab: (tab: PersonalTab) => void;
  onHome: () => void;
  navigate: (thread: string, tab: PersonalTab) => void;
  notifications?: ReactNode;
  navigationToggle: ReactNode;
  exitGuard: RefObject<DocumentExitGuard | null>;
  refreshed: () => Promise<void>;
  action: (work: () => Promise<void>) => Promise<void>;
  command: (
    c: Command,
    onReceipt?: () => void,
    replay?: PendingCommand,
  ) => Promise<unknown>;
};
const tabs = {
  chat: ["Tu ed Emme", "chat"],
  documents: ["Documenti", "files"],
  reminders: ["Promemoria", "bell"],
} as const;
type MessageRequest = PendingCommand & {
  command: Extract<Command, { type: "message.send" }>;
};
const time = localizedDate({
  hour: "2-digit",
  minute: "2-digit",
});
const date = localizedDate({ dateStyle: "medium" });

function PrivateSource({
  workspace,
  id,
  file,
  reference,
  openOrigin,
  close,
}: {
  workspace: string;
  id: string;
  file?: Snapshot["sources"][number];
  reference?: ConsultationRef;
  openOrigin?: (id: string) => void;
  close: () => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [candidates, setCandidates] = useState<Snapshot["candidates"] | null>(
    null,
  );
  const temporal = reference?.kind === "temporal_commitment";
  const candidate = reference?.kind === "candidate";
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (temporal) return;
    const controller = new AbortController();
    if (candidate) {
      void api<Snapshot>(
        "/api/workspaces/" + workspace,
        undefined,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted)
            setCandidates(value.candidates.filter((rec) => rec.id === id));
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(errorText(cause));
        });
      return () => controller.abort();
    }
    const params = new URLSearchParams({
      kind: reference?.kind ?? "source",
      id,
      version: String(reference?.version ?? 1),
    });
    void api<unknown>(
      `/api/v1/workspaces/${workspace}/reference?${params}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setDetail(referenceDetailSchema.parse(value));
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [workspace, id, attempt, reference, candidate, temporal]);
  return (
    <dialog
      ref={dialog}
      className={styles.source}
      aria-label={uiText("Fonte originale")}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{uiText("Fonte originale")}</h2>
        <button type="button" className="quiet" onClick={close}>
          {uiText("Chiudi")}
        </button>
      </header>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            {uiText("Riprova")}
          </button>
        </p>
      ) : reference && openOrigin && (temporal || (candidate && candidates)) ? (
        <ConsultationEvidence
          state={{ workspace: { id: workspace }, candidates: candidates ?? [] }}
          entry={reference}
          openSource={openOrigin}
        />
      ) : file?.withdrawn ? (
        <p>{uiText("File ritirato")}</p>
      ) : detail ? (
        <>
          <h3>
            {detail.provenance.actorKind
              ? reference
                ? uiText("Messaggio dello spazio")
                : uiText("Messaggio nella tua chat")
              : detail.title}
          </h3>
          <small>{date(uiLocale).format(new Date(detail.createdAt))}</small>
          {file &&
            (file.media_type === "text/plain" ? (
              <p>
                <a
                  download={file.filename ?? file.title}
                  href={`/api/workspaces/${workspace}/sources/${file.id}`}
                >
                  {uiText("Scarica originale")}
                </a>
              </p>
            ) : (
              <MessageFile workspace={workspace} source={file} />
            ))}
          {detail.content && (
            <p className={styles.original}>{detail.content}</p>
          )}
        </>
      ) : (
        <p role="status">{uiText("Caricamento della fonte…")}</p>
      )}
    </dialog>
  );
}

export function PersonalUtilities({
  state,
  actor,
  busy,
  action,
  command,
  tab,
  onTab,
  onHome,
  navigate,
  aiUnavailable,
  offline,
  assistantName,
  onConfigure,
  notifications,
  navigationToggle,
  exitGuard,
  refreshed,
}: Props) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const workspace = state.workspace.id;
  const archive = state.workspace.personal_archive_id ?? workspace;
  const chat = useChatState(
    workspace,
    state.workspace.revision,
    tab === "chat",
  );
  useEffect(() => {
    if (tab !== "chat" && archive !== workspace) navigate(archive, tab);
  }, [archive, workspace, navigate, tab]);
  const [documentPrompt, setDocumentPrompt] = useState<
    (DocumentRequest & { origin: string; destination?: string }) | null
  >(null);
  const [researchDraft, setResearchDraft] = useState<{
    id: string;
    query: string;
  } | null>(null);
  const [searchHistory, setSearchHistory] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{
    target: string;
    ref: ConsultationRef;
    answerId: string;
  } | null>(null);
  const consultationRequest = useRef<{
    question: string;
    target: string;
    version: number;
    id: string;
  } | null>(null);

  const canContribute = state.members.some(
    (m) => m.active && m.contributes && m.user_id === actor,
  );
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MessageRequest | null>(null);
  const [journalReady, setJournalReady] = useState(false);
  const [journalError, setJournalError] = useState("");
  const [readAttempt, readAgain] = useState(0);
  const [sendError, setSendError] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const sending = !!sendingId;
  const lastSent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const attachment = useRef<AttachmentPicker>(null);
  const writingForm = useRef<HTMLFormElement>(null);
  const interaction = useComposerInteraction(writingForm);
  const [source, setSource] = useState<string | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const messages = useMemo(
    () => state.messages.filter((m) => m.purpose !== "workspace_welcome"),
    [state.messages],
  );
  const files = useMemo(
    () =>
      new Map(state.sources.filter((s) => s.filename).map((s) => [s.id, s])),
    [state.sources],
  );
  const reads = useMemo(
    () => new Map(state.interpretations.map((i) => [i.source_id, i])),
    [state.interpretations],
  );
  const chatFailures = useMemo(
    () => assistantRequestFailures(state.messages, state.interpretations),
    [state.messages, state.interpretations],
  );
  const answered = useMemo(
    () => new Set(state.messages.map((m) => m.reply_to_source_id)),
    [state.messages],
  );
  const ids = messages.map((m) => m.id).join(",");
  const scroll = useConversationScroll(
    timeline,
    workspace,
    tab === "chat" ? ids : "",
    false,
    messages[0]?.id,
  );
  usePersonalReading(
    timeline,
    tab === "chat" ? workspace : "",
    actor,
    state.reading,
    tab === "chat",
    ids,
    scroll.onScroll,
  );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [tab]);
  useEffect(() => {
    let current = true;
    let generation = 0;
    const read = async () => {
      const readGeneration = ++generation;
      try {
        const list = await pendingCommands(actor, workspace);
        if (!current || inFlight.current || readGeneration !== generation)
          return;
        const first = list
          .filter(
            (item): item is MessageRequest =>
              item.command.type === "message.send" &&
              !item.command.reference &&
              isAssistantAddress(item.command.content, assistantName),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        setPending(first ?? null);
        setJournalError("");
        setJournalReady(true);
      } catch (cause) {
        if (current && readGeneration === generation) {
          setJournalError(errorText(cause));
          setJournalReady(false);
        }
      }
    };
    void read();
    window.addEventListener("miriam-pending-commands", read);
    return () => {
      current = false;
      window.removeEventListener("miriam-pending-commands", read);
    };
  }, [actor, workspace, readAttempt, assistantName]);

  function leave(next: () => void) {
    if (!exitGuard.current?.(next)) next();
  }
  function inspect(id: string) {
    sourceTrigger.current = document.activeElement as HTMLElement;
    setSource(id);
  }
  async function send() {
    if (
      inFlight.current ||
      busy ||
      !canContribute ||
      !journalReady ||
      (!pending && !draft.trim())
    )
      return;
    if (!pending) {
      if (!chat.state) {
        setSendError(chat.error || uiText("Caricamento della conversazione…"));
        return;
      }
      const question = draft.trim(),
        prior = historyRequest(question);
      if (prior) {
        setSearchHistory(prior);
        setDraft("");
        return;
      }
      const selected = chat.state.selection;
      const doc = generatedDocumentPrompt(question, true);
      if (doc) {
        setDocumentPrompt({
          id: crypto.randomUUID(),
          question: doc,
          origin: selected.id ?? workspace,
          destination: chat.state.targets.find(
            (t) => t.id === selected.id && t.contributes,
          )?.name,
        });
        setDraft("");
        return;
      }
      const research = question.match(
        /^(?:@?(?:emme|miriam)[ ,:]*)?(?:(?:fai|avvia|prepara|fammi)\s+(?:una\s+)?)?ricerca approfondita(?:\s+(?:su|sul|sulla|riguardo a))?\s*[:,-]?\s*(.*)$/iu,
      );
      if (research) {
        setResearchDraft({ id: crypto.randomUUID(), query: research[1] });
        setDraft("");
        return;
      }
      if (selected.id) {
        const prev = consultationRequest.current,
          id =
            prev?.target === selected.id &&
            prev.version === selected.version &&
            prev.question === question
              ? prev.id
              : crypto.randomUUID();
        consultationRequest.current = {
          question,
          target: selected.id,
          version: selected.version,
          id,
        };
        inFlight.current = true;
        setSendingId(id);
        setSendError("");
        try {
          await personalChatCommand({
            action: "ask",
            expectedActorId: actor,
            thread: workspace,
            target: selected.id,
            id,
            expectedVersion: selected.version,
            question,
          });
          setDraft("");
          consultationRequest.current = null;
          scroll.followLatest();
        } catch (e) {
          setSendError(errorText(e));
        } finally {
          inFlight.current = false;
          setSendingId(null);
          chat.reload();
          await refreshed();
        }
        return;
      }
    }
    const request =
      pending ??
      newCommand(actor, workspace, {
        type: "message.send",
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        content: addressMiriam(draft.trim()),
      });
    if (request.command.type !== "message.send") return;
    inFlight.current = true;
    setSendingId(request.commandId);
    lastSent.current = request.commandId;
    setSendError("");
    try {
      await command(request.command, undefined, request);
      setPending(null);
      setDraft("");
      scroll.followLatest();
    } catch (cause) {
      setPending({ ...request, command: request.command });
      setSendError(errorText(cause));
    } finally {
      inFlight.current = false;
      setSendingId(null);
    }
  }
  if (tab !== "chat" && archive !== workspace)
    return <p role="status">{uiText("Apro il tuo archivio personale…")}</p>;
  return (
    <main
      className={styles.shell}
      id="workspace-content"
      tabIndex={-1}
      aria-label={uiText("Area personale")}
    >
      <header className={styles.head}>
        <div className={styles.personalHeading}>
          {navigationToggle}
          <button
            type="button"
            aria-label={uiText("Torna a tutti gli spazi")}
            className={`quiet ${styles.back}`}
            onClick={() => leave(onHome)}
          >
            <WorkspaceIcon name="arrow" />
            <span>{uiText("Torna a tutti gli spazi")}</span>
          </button>
          <h1>{uiText("Area personale")}</h1>
        </div>
        <button
          type="button"
          className="quiet"
          aria-haspopup="dialog"
          aria-label={uiText("Configura Emme")}
          onClick={onConfigure}
        >
          <WorkspaceIcon name="settings" />{" "}
          <span>{uiText("Configura Emme")}</span>
        </button>
        {notifications}
      </header>
      <nav className={styles.nav} aria-label={uiText("Utility personali")}>
        {(Object.keys(tabs) as PersonalTab[]).map((key) => (
          <button
            type="button"
            key={key}
            className="quiet"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              if (tab !== key)
                leave(() => {
                  if (key === "chat") {
                    void action(async () => {
                      const r = await personalChatCommand<{ id: string }>({
                        action: "open",
                        expectedActorId: actor,
                      });
                      if (r.id === workspace) onTab("chat");
                      else navigate(r.id, "chat");
                    });
                  } else if (archive !== workspace) navigate(archive, key);
                  else onTab(key);
                });
            }}
          >
            <WorkspaceIcon name={tabs[key][1]} />
            {tabs[key][0]}
          </button>
        ))}
      </nav>
      <PendingCommands
        actor={actor}
        workspace={workspace}
        sendingCommandId={sendingId}
        inlineRetryId={tab === "chat" ? pending?.commandId : undefined}
        action={action}
        refreshed={refreshed}
        confirmed={(id) => {
          if (id === lastSent.current || id === pending?.commandId) {
            lastSent.current = null;
            setPending(null);
            setDraft("");
            setSendError("");
          }
        }}
      />
      <section className={styles.content} aria-labelledby="personal-heading">
        <h2 tabIndex={-1} id="personal-heading" ref={heading}>
          {tabs[tab][0]}
        </h2>
        {tab === "chat" && (
          <>
            {chat.state && (
              <PersonalChatControls
                key={researchDraft?.id ?? "default"}
                researchPrompt={researchDraft?.query}
                actor={actor}
                thread={workspace}
                state={chat.state}
                reload={chat.reload}
                command={command}
                refreshWorkspace={refreshed}
                search={searchHistory}
                changeSearch={setSearchHistory}
                navigate={(id) => {
                  if (id !== workspace) navigate(id, "chat");
                }}
              />
            )}
            {chat.error && (
              <p role="alert">
                {chat.error}{" "}
                <button type="button" className="quiet" onClick={chat.reload}>
                  {uiText("Riprova")}
                </button>
              </p>
            )}
            {!messages.length && (
              <p className={styles.empty}>
                {uiText("Questa conversazione con ")}
                {assistantName}
                {uiText(" è solo tua.")}
              </p>
            )}
            <div
              ref={timeline}
              className={styles.timeline}
              onScroll={scroll.onScroll}
              aria-label={uiText("Messaggi con {0}", String(assistantName))}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              {messages.map((m, i) => {
                const stamp = new Date(m.created_at),
                  day = date(uiLocale).format(stamp);
                const assistant = m.actor_kind === "miriam",
                  file =
                    m.reference?.kind === "source"
                      ? files.get(m.reference.id)
                      : undefined;
                const failure = chatFailures.get(m.id);
                const reading =
                  !assistant &&
                  isAssistantAddress(m.content, assistantName) &&
                  !answered.has(m.id)
                    ? reads.get(m.id)
                    : undefined;
                return (
                  <article
                    key={m.id}
                    id={"source-" + m.id}
                    data-chat-message={m.id}
                    className={styles.turn}
                    aria-label={assistant ? m.author_name : uiText("Tu")}
                  >
                    {(i === 0 ||
                      date(uiLocale).format(
                        new Date(messages[i - 1].created_at),
                      ) !== day) && <p className={styles.day}>{day}</p>}
                    <div className={styles.byline}>
                      <strong>
                        {assistant && <EmmeMessageMark />}
                        {assistant ? m.author_name : uiText("Tu")}
                      </strong>
                      <time dateTime={m.created_at}>
                        {time(uiLocale).format(stamp)}
                      </time>
                    </div>
                    {(!file || m.content !== file.filename) && (
                      <p
                        className={
                          assistant ? `${styles.body} emme-reply` : styles.body
                        }
                      >
                        {m.content}
                      </p>
                    )}
                    {chat.state &&
                      chat.state.research
                        .filter((r) => r.messageId === m.id)
                        .map((r) => (
                          <PrivateResearchResult
                            key={r.id}
                            item={r}
                            thread={workspace}
                            actor={actor}
                            state={chat.state!}
                            reload={chat.reload}
                            command={command}
                          />
                        ))}
                    {chat.state?.turns
                      .filter((t) => t.messageId === m.id)
                      .map((t) => (
                        <div key={t.id} className={styles.research}>
                          {t.status === "ready" ? (
                            <>
                              <strong>
                                <EmmeMessageMark />
                                {uiText(" Emme · Solo tu")}
                              </strong>
                              <p className={`${styles.body} emme-reply`}>
                                {t.answer}
                              </p>
                              <ConsultationSources
                                entries={t.references}
                                open={(ref) =>
                                  setInspected({
                                    ref,
                                    target: t.target,
                                    answerId: t.id,
                                  })
                                }
                              />
                            </>
                          ) : t.status === "unavailable" ? (
                            <small>
                              {uiText(
                                "Questa consultazione non è più accessibile.",
                              )}
                            </small>
                          ) : t.status === "failed" ||
                            t.status === "pending" ? (
                            <>
                              <small>
                                {uiText("La consultazione non si è conclusa.")}
                              </small>
                              {chat.state!.selection.id === t.target &&
                                chat.state!.selection.version ===
                                  t.selectionVersion && (
                                  <button
                                    type="button"
                                    className="quiet"
                                    disabled={sending}
                                    onClick={() =>
                                      void action(async () => {
                                        try {
                                          await personalChatCommand({
                                            action: "ask",
                                            thread: workspace,
                                            id: t.id,
                                            expectedActorId: actor,
                                            expectedVersion: t.selectionVersion,
                                            question: t.question,
                                            target: t.target,
                                          });
                                        } finally {
                                          chat.reload();
                                        }
                                      })
                                    }
                                  >
                                    {uiText("Riprova consultazione")}
                                  </button>
                                )}
                            </>
                          ) : (
                            <small>
                              {uiText("Emme sta consultando lo spazio…")}
                            </small>
                          )}
                        </div>
                      ))}
                    {m.reminder && (
                      <ChatReminderLine
                        workspace={workspace}
                        actor={actor}
                        messageId={m.id}
                        reminder={m.reminder}
                        onRefresh={() => void refreshed()}
                      />
                    )}
                    {file && (
                      <MessageFile workspace={workspace} source={file} />
                    )}
                    {m.citation_source_ids.length > 0 && (
                      <details>
                        <summary>{uiText("Fonti")}</summary>
                        {m.citation_source_ids.map((id, n) => (
                          <button
                            type="button"
                            className="quiet"
                            key={id}
                            onClick={() => inspect(id)}
                          >
                            {uiText("Fonte ")}
                            {n + 1}
                          </button>
                        ))}
                      </details>
                    )}
                    {failure && (
                      <AssistantRequestFeedback
                        failure={failure}
                        canRetry={
                          canContribute &&
                          (failure.reason !== "unconfigured" || !aiUnavailable)
                        }
                        disabled={busy || offline}
                        retry={(interpretationId) =>
                          command({
                            type: "interpretation.retry",
                            interpretationId,
                          })
                        }
                      />
                    )}
                    {!aiUnavailable &&
                      (reading?.status === "queued" ||
                        reading?.status === "running") && (
                        <small className={styles.meta}>
                          {reading.status === "running"
                            ? uiText(
                                "{0} sta elaborando la risposta…",
                                String(assistantName),
                              )
                            : uiText("Risposta in attesa.")}
                        </small>
                      )}
                  </article>
                );
              })}
            </div>
            <form
              className={styles.compose}
              ref={writingForm}
              {...interaction}
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="message">
                {uiText("Messaggio")}
              </label>
              <span className="sr-only" id="message-audience">
                {uiText("Chat privata con ")}
                {assistantName}
              </span>
              <ConversationMessageInput
                assistantName={assistantName}
                personal
                value={pending?.command.content ?? draft}
                onChange={setDraft}
                readOnly={sending || !!pending || !canContribute}
              />
              <div className={styles.controls} data-composer-action>
                {canContribute && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy || sending}
                    onClick={(e) => attachment.current?.open(e.currentTarget)}
                  >
                    <WorkspaceIcon name="attach" />
                    {uiText(" Allega file")}
                  </button>
                )}
                <button
                  type="submit"
                  data-primary-send
                  disabled={
                    busy ||
                    sending ||
                    !canContribute ||
                    !journalReady ||
                    (!pending && (!chat.state || !draft.trim()))
                  }
                >
                  {sending
                    ? uiText("Invio…")
                    : pending
                      ? uiText("Riprova invio")
                      : uiText("Invia a {0}", String(assistantName))}{" "}
                  <WorkspaceIcon name="send" />
                </button>
              </div>
              {aiUnavailable && (
                <small className={styles.meta}>
                  {uiText(
                    "Il modello non è collegato. I messaggi che invii restano nella tua chat.",
                  )}
                </small>
              )}
              {pending && !sending && !sendError && (
                <p role="status">
                  {uiText(
                    "Un invio è in attesa di conferma. Puoi riprendere lo stesso invio.",
                  )}
                </p>
              )}
              {(sendError || journalError) && (
                <p role="alert">
                  {sendError || journalError}
                  {journalError && (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => readAgain((n) => n + 1)}
                    >
                      {uiText("Rileggi gli invii")}
                    </button>
                  )}
                </p>
              )}
            </form>
            {canContribute && (
              <ConversationAttachment
                personal
                ref={attachment}
                workspace={workspace}
                actor={actor}
                disabled={busy || sending}
                submit={(r) => command(r.command, undefined, r)}
              />
            )}
          </>
        )}
        {tab === "documents" && (
          <WorkspaceArtifacts
            personal
            documentExitGuard={exitGuard}
            state={state}
            actor={actor}
            command={command}
            action={action}
            busy={busy}
            openSource={inspect}
          />
        )}
        {tab === "reminders" && (
          <WorkspaceTasks
            personal
            workspace={workspace}
            actor={actor}
            command={command}
            action={action}
            busy={busy}
            canContribute={canContribute}
          />
        )}
      </section>
      {documentPrompt && (
        <GeneratedDocument
          key={documentPrompt.id}
          workspace={documentPrompt.origin}
          actor={actor}
          initial={documentPrompt}
          destination={documentPrompt.destination}
          close={() => setDocumentPrompt(null)}
          refresh={() => void refreshed()}
        />
      )}
      {inspected &&
        chat.state?.turns.some(
          (t) => t.id === inspected.answerId && t.status === "ready",
        ) && (
          <PrivateSource
            key={inspected.target + inspected.ref.id}
            workspace={inspected.target}
            id={inspected.ref.id}
            reference={inspected.ref}
            openOrigin={(id) =>
              setInspected({
                ...inspected,
                ref: {
                  kind: "source",
                  id,
                  version: 1,
                  label: "Fonte originale",
                },
              })
            }
            close={() => setInspected(null)}
          />
        )}
      {source && (
        <PrivateSource
          key={source}
          workspace={workspace}
          id={source}
          file={files.get(source)}
          close={() => {
            setSource(null);
            requestAnimationFrame(() => sourceTrigger.current?.focus());
          }}
        />
      )}
    </main>
  );
}
