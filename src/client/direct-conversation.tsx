"use client";
import { useUiLanguage } from "./ui-language";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { auth } from "./auth-client";
import { api, errorText } from "./api";
import type { DirectView, DirectInput } from "../contracts/direct-chat";
import { WorkspaceCreation } from "./workspace-create";
import { WorkspaceIcon } from "./workspace-icon";
import { encodeAttachment } from "./file-upload";
import {
  MessageAttachmentQueue,
  useMessageAttachments,
} from "./message-attachments";
import { usePersonalReading } from "./personal-reading";
import { useConversationScroll } from "./conversation-scroll";
import { useComposerInteraction } from "./chat-composer-interaction";
import { useChatViewport } from "./chat-viewport";
import { onChatKeyDown } from "./chat-enter-to-send";
import { IdentityImage } from "./identity-photos";
import { ProfileLink } from "./participant-profile";
import { initials } from "./conversation-presentation";
import styles from "./direct-conversation.module.css";
import { FilePreviewButton } from "./file-preview";

export function DirectConversation({ id }: { id: string }) {
  const { t: uiText } = useUiLanguage();
  const session = auth.useSession();
  if (session.isPending)
    return <p role="status">{uiText("Apertura della conversazione…")}</p>;
  if (!session.data)
    return (
      <main>
        <h1>{uiText("Chat privata")}</h1>
        <Link href="/">{uiText("Accedi a RIMIAM")}</Link>
      </main>
    );
  return (
    <DirectRoom
      key={session.data.session.id + id}
      id={id}
      actor={session.data.user.id}
    />
  );
}
function DirectRoom({ id, actor }: { id: string; actor: string }) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [view, setView] = useState<DirectView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingControl, setPendingControl] = useState({
      consent: false,
      recap: false,
    }),
    [creating, setCreating] = useState(false),
    [showRecap, setShowRecap] = useState(false);
  const apiPath = "/api/v1/direct-chats/" + id,
    storageKey = "rimiam:direct-draft:" + actor + ":" + id;

  const [saved] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        text?: string;
        quote?: string;
        attempt?: { id: string; signature: string };
      } | null;
    } catch {
      return null;
    }
  });
  const [text, setText] = useState(
      typeof saved?.text === "string" ? saved.text : "",
    ),
    [quote, setQuote] = useState<string | null>(
      typeof saved?.quote === "string" ? saved.quote : null,
    ),
    [sendError, setSendError] = useState("");
  const page = useRef<HTMLElement>(null);
  useChatViewport(page);
  const writingForm = useRef<HTMLFormElement>(null);
  const interaction = useComposerInteraction(writingForm);
  const composer = useRef<HTMLTextAreaElement>(null),
    root = useRef<HTMLDivElement>(null),
    live = useRef(false),
    attempt = useRef(0),
    pending = useRef<{ signature: string; id: string } | null>(
      saved?.attempt ?? null,
    ),
    active = useRef(false);
  const queue = useMessageAttachments(storageKey),
    files = queue.items;
  const read = useCallback(async () => {
    const num = ++attempt.current;
    try {
      const next = await api<DirectView>(apiPath);
      if (live.current && num === attempt.current && next.me === actor) {
        setView(next);
        setError("");
      }
    } catch (e) {
      if (live.current && num === attempt.current) {
        setError(errorText(e));
        if (
          e instanceof Error &&
          [
            "DIRECT_CHAT_NOT_FOUND",
            "ACCOUNT_INELIGIBLE",
            "AUTHENTICATION_REQUIRED",
          ].includes(e.message)
        )
          setView(null);
      }
    }
  }, [actor, apiPath]);
  useEffect(() => {
    live.current = true;
    const start = window.setTimeout(() => void read(), 0);
    const sync = () => {
      if (!document.hidden) void read();
    };
    const interval = setInterval(sync, 4000);
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      live.current = false;
      clearTimeout(start);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
    };
  }, [read]);
  function saveDraft(value: string, q: string | null) {
    setText(value);
    setQuote(q);
    try {
      if (value || q || pending.current)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ text: value, quote: q, attempt: pending.current }),
        );
      else localStorage.removeItem(storageKey);
    } catch {
      /* Keep the in-memory draft. */
    }
  }
  const keys = view?.messages.map((m) => m.id).join(":") ?? "";
  const scroll = useConversationScroll(
    root,
    id,
    keys,
    false,
    view?.messages[0]?.id,
  );
  const reading = usePersonalReading(
    root,
    id,
    actor,
    view?.reading,
    !creating && !showRecap,
    keys,
    scroll.onScroll,
    true,
  );
  const controlRequests = useRef(new Set<"consent" | "recap">());
  async function run(c: Extract<DirectInput, { type: "consent" | "recap" }>) {
    if (controlRequests.current.has(c.type)) return;
    controlRequests.current.add(c.type);
    setPendingControl((state) => ({ ...state, [c.type]: true }));
    setError("");
    try {
      await api(apiPath, c);
      await read();
    } catch (e) {
      await read();
      setError(errorText(e));
    } finally {
      controlRequests.current.delete(c.type);
      setPendingControl((state) => ({ ...state, [c.type]: false }));
    }
  }
  async function send() {
    if (active.current || (!text.trim() && !files.length)) return;
    active.current = true;
    setBusy(true);
    setSendError("");
    try {
      const attachments = await Promise.all(
        files.map((f) => encodeAttachment(f.file)),
      );
      const message = {
        text: text.trim(),
        ...(quote ? { quoteId: quote } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(message)),
          ),
        ),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (pending.current?.signature !== digest)
        pending.current = { id: crypto.randomUUID(), signature: digest };
      saveDraft(text, quote);
      await api(apiPath, {
        type: "send",
        id: pending.current.id,
        expectedActorId: actor,
        ...message,
      });
      pending.current = null;
      saveDraft("", null);
      queue.clearSent(files);
      scroll.followLatest();
      await read();
    } catch (e) {
      setSendError(uiText("Invio non riuscito · {0}", String(errorText(e))));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function jump(message: string) {
    const el = document.getElementById("source-" + message);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }
  const commands = { expectedActorId: actor };
  const peerPhoto = view?.peer.photoVersion
    ? apiPath + "/photo?v=" + view.peer.photoVersion
    : undefined;
  return (
    <main ref={page} className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label={uiText("Torna alla Home")}>
          <WorkspaceIcon name="arrow" />
        </Link>
        <div>
          <small>{uiText("Chat privata")}</small>
          <h1 aria-label={view?.peer.name}>
            {view ? (
              <ProfileLink
                path={apiPath + "/profile"}
                person={view.peer.id}
                name={view.peer.name}
                photo={peerPhoto}
              >
                <IdentityImage
                  className={styles.avatar}
                  url={peerPhoto}
                  fallback={initials(view.peer.name)}
                />
                {view.peer.name}
              </ProfileLink>
            ) : (
              uiText("Conversazione")
            )}
          </h1>
        </div>
        {view && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setCreating(!creating);
              setShowRecap(false);
            }}
          >
            {creating
              ? uiText("Chiudi")
              : uiText("Crea uno spazio con {0}", String(view.peer.name))}
          </button>
        )}
      </header>
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" className="quiet" onClick={() => void read()}>
            {uiText("Riprova")}
          </button>
        </p>
      )}
      {!view && !error && (
        <p role="status">{uiText("Caricamento della chat…")}</p>
      )}
      {view && (
        <>
          {creating && (
            <section className={styles.panel}>
              <h2>
                {uiText("Nuovo spazio con ")}
                {view.peer.name}
              </h2>
              <p>
                {uiText(
                  "La chat privata e i suoi file restano qui. Scegli solo i materiali da condividere nel nuovo spazio.",
                )}
              </p>
              <WorkspaceCreation
                actor={actor}
                initialRecipient={{
                  label: view.peer.name,
                  target: { contactId: view.peer.id },
                }}
                onCreated={(w) => {
                  const destination = new URL("/", location.origin);
                  destination.searchParams.set("workspace", w.id);
                  location.assign(destination);
                }}
              />
            </section>
          )}
          <nav className={styles.tools}>
            <button
              type="button"
              className="quiet"
              aria-expanded={showRecap}
              onClick={() => {
                setShowRecap(!showRecap);
                setCreating(false);
              }}
            >
              {uiText("Riepilogo personale")}
            </button>
            {reading.away && (
              <button
                type="button"
                className="quiet"
                onClick={() => scroll.followLatest()}
              >
                {uiText("Vai in fondo ↓")}
              </button>
            )}
          </nav>
          {showRecap && (
            <section className={styles.panel}>
              <button
                type="button"
                className="quiet"
                onClick={() => setShowRecap(false)}
              >
                {uiText("Chiudi")}
              </button>
              <h2>{uiText("Il tuo riepilogo")}</h2>
              <p>
                {uiText(
                  "Con il consenso di entrambi, ciascuno può chiedere a Emme una sintesi dell’intera chat, compresi i messaggi precedenti. Ogni sintesi rimane privata per chi la richiede.",
                )}
              </p>
              <button
                type="button"
                disabled={pendingControl.consent}
                onClick={() =>
                  void run({
                    type: "consent",
                    ...commands,
                    id: crypto.randomUUID(),
                    expectedVersion: view.consentVersion,
                    enabled: !view.consent,
                  })
                }
              >
                {view.consent
                  ? uiText("Ritira il tuo consenso")
                  : uiText("Consenti il riepilogo di questa chat")}
              </button>
              <p>
                {view.peerConsent
                  ? uiText("{0} ha dato il consenso.", String(view.peer.name))
                  : uiText("Il consenso di {0} manca.", String(view.peer.name))}
              </p>
              <button
                type="button"
                disabled={
                  pendingControl.recap ||
                  pendingControl.consent ||
                  !view.consent ||
                  !view.peerConsent ||
                  !view.messages.length
                }
                onClick={() =>
                  void run({
                    type: "recap",
                    ...commands,
                    id: crypto.randomUUID(),
                  })
                }
              >
                {pendingControl.recap
                  ? uiText("Preparazione…")
                  : uiText("Riassumi per me")}
              </button>
              {view.recaps.map((r) => (
                <article key={r.id}>
                  <time>{new Date(r.createdAt).toLocaleString(uiLocale)}</time>
                  <p>{r.text}</p>
                  {r.sourceIds.map((source, i) => (
                    <button
                      key={source}
                      className="quiet"
                      type="button"
                      onClick={() => {
                        setShowRecap(false);
                        requestAnimationFrame(() => jump(source));
                      }}
                    >
                      {uiText("Messaggio ")}
                      {i + 1}
                    </button>
                  ))}
                </article>
              ))}
            </section>
          )}
          <div
            className={styles.timeline}
            ref={root}
            onScroll={scroll.onScroll}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              queue.add(Array.from(e.dataTransfer.files));
            }}
          >
            {!view.messages.length && (
              <p>
                {uiText("Scrivi il primo messaggio a ")}
                {view.peer.name}.
              </p>
            )}
            {view.messages.map((m, index) => {
              const origin =
                  m.quoteId && view.messages.find((q) => q.id === m.quoteId),
                date = new Date(m.sentAt),
                prev = view.messages[index - 1];
              return (
                <article
                  key={m.id}
                  id={"source-" + m.id}
                  data-chat-message={m.id}
                  tabIndex={-1}
                >
                  {(!prev ||
                    new Date(prev.sentAt).toDateString() !==
                      date.toDateString()) && (
                    <p className={styles.day}>
                      {date.toLocaleDateString(uiLocale, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}{" "}
                      ·{" "}
                      {date.toLocaleTimeString(uiLocale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  <strong>
                    <ProfileLink
                      path={
                        m.authorId === actor
                          ? "/api/v1/profile"
                          : apiPath + "/profile"
                      }
                      person={m.authorId}
                      name={m.name}
                      photo={m.authorId === actor ? undefined : peerPhoto}
                    >
                      {m.name}
                    </ProfileLink>
                  </strong>{" "}
                  <time className={styles.stamp}>
                    {date.toLocaleTimeString(uiLocale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {origin && (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => jump(origin.id)}
                    >
                      {origin.name} · {origin.text.slice(0, 90)}
                    </button>
                  )}
                  {m.text && <p>{m.text}</p>}
                  {m.files.map((f) => (
                    <FilePreviewButton
                      key={f.id}
                      path={apiPath + "/files/" + f.id}
                      original={apiPath + "/files/" + f.id}
                      name={f.filename}
                      onMessage={() => jump(m.id)}
                    >
                      {f.type.startsWith("image/") && (
                        <Image
                          unoptimized
                          width={320}
                          height={180}
                          className={styles.photo}
                          src={apiPath + "/files/" + f.id}
                          alt={f.filename}
                        />
                      )}{" "}
                      {f.filename}
                    </FilePreviewButton>
                  ))}
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => {
                      saveDraft(text, m.id);
                      composer.current?.focus();
                    }}
                  >
                    {uiText("Rispondi")}
                  </button>
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
            {quote && (
              <p>
                {uiText("In risposta a")}{" "}
                {view.messages.find((m) => m.id === quote)?.text.slice(0, 90)}{" "}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => saveDraft(text, null)}
                >
                  {uiText("Rimuovi citazione")}
                </button>
              </p>
            )}
            <MessageAttachmentQueue
              queue={queue}
              disabled={busy}
              privateExchange
            />
            <div>
              <button
                type="button"
                className="quiet"
                disabled={busy || !queue.ready}
                data-composer-action
                aria-label={uiText("Allega file o foto")}
                onClick={() => queue.openPicker()}
              >
                <WorkspaceIcon name="attach" />
              </button>
              <textarea
                ref={composer}
                aria-label={uiText("Messaggio privato")}
                enterKeyHint="enter"
                rows={1}
                maxLength={12000}
                value={text}
                disabled={busy}
                placeholder={uiText("Scrivi a {0}…", String(view.peer.name))}
                onChange={(e) => saveDraft(e.target.value, quote)}
                onKeyDown={onChatKeyDown}
              />
              <button
                type="submit"
                data-primary-send
                data-composer-action
                disabled={busy || (!text.trim() && !files.length)}
              >
                {sendError ? uiText("Riprova") : uiText("Invia")}
              </button>
            </div>
            {sendError && <p role="alert">{sendError}</p>}
            {/^\s*(?:\/|@?(?:emme|miriam)\b)/i.test(text) && (
              <p>
                {uiText(
                  "Qui Emme può preparare solo un riepilogo personale. Per domande e strumenti crea uno spazio con ",
                )}
                {view.peer.name}.
              </p>
            )}
          </form>
        </>
      )}
    </main>
  );
}
