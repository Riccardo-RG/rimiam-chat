"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { taskCommentsSchema } from "@/contracts/tasks";
import { api, errorText } from "./api";
import {
  forgetCommand,
  newCommand,
  pendingCommands,
  sendCommand,
} from "./command-journal";
import styles from "./workspace-tasks.module.css";

type Comments = ReturnType<typeof taskCommentsSchema.parse>;

export function TaskComments({
  workspace,
  actor,
  taskId,
  version,
  active,
  canContribute,
}: {
  workspace: string;
  actor: string;
  taskId: string;
  version: number;
  active: boolean;
  canContribute: boolean;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [page, setPage] = useState<Comments | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [draftVersion, setDraftVersion] = useState(version);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let reading = false;
    const query = new URLSearchParams({ id: taskId });
    if (before) query.set("before", before);
    const read = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const next = taskCommentsSchema.parse(
          await api<unknown>(
            `/api/v1/workspaces/${workspace}/task-comments?${query}`,
            undefined,
            controller.signal,
          ),
        );
        if (!controller.signal.aborted) {
          setPage(next);
          setLoadError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setPage(null);
          setLoadError(errorText(cause));
        }
      } finally {
        reading = false;
      }
    };
    void read();
    // Watch new comments only while their detail is visible, on the newest page.
    const timer = before ? undefined : window.setInterval(read, 5000);
    window.addEventListener("focus", read);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [active, workspace, taskId, before, refresh]);

  async function submit() {
    const body = draft.trim();
    if (inFlight.current || !canContribute || !body || draftVersion !== version)
      return;
    inFlight.current = true;
    setSending(true);
    setSendError("");
    try {
      const pending =
        (await pendingCommands(actor, workspace)).find(
          (item) =>
            item.command.type === "task.comment" &&
            item.command.taskId === taskId &&
            item.command.body === body,
        ) ??
        newCommand(actor, workspace, {
          type: "task.comment",
          taskId,
          expectedVersion: draftVersion,
          body,
        });
      try {
        await sendCommand(pending);
      } catch (cause) {
        if (cause instanceof Error && cause.message === "TASK_VERSION_STALE")
          await forgetCommand(pending.commandId);
        throw cause;
      }
      setDraft("");
      setBefore(null);
      setRefresh((n) => n + 1);
    } catch (cause) {
      setSendError(
        cause instanceof Error && cause.message === "TASK_VERSION_STALE"
          ? uiText(
              "L’attività è cambiata. Rileggi i dettagli prima di pubblicare.",
            )
          : errorText(cause),
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  if (!active) return null;
  return (
    <section className={styles.comments} aria-label={uiText("Commenti")}>
      <h3>{uiText("Commenti")}</h3>
      {loadError && (
        <p role="alert">
          {loadError}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => setRefresh((n) => n + 1)}
          >
            {uiText("Riprova")}
          </button>
        </p>
      )}
      {!page && !loadError && (
        <p className="hint" role="status">
          {uiText("Caricamento commenti…")}
        </p>
      )}
      {page &&
        (page.comments.length ? (
          <ol>
            {[...page.comments].reverse().map((c) => (
              <li key={c.id}>
                <header>
                  <strong>{c.authorName}</strong>
                  <time dateTime={c.createdAt}>
                    {new Date(c.createdAt).toLocaleString(uiLocale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                <p>{c.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">{uiText("Nessun commento.")}</p>
        ))}
      {(before || page?.next) && (
        <div className={styles.formActions}>
          {page?.next && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setPage(null);
                setBefore(page.next);
              }}
            >
              {uiText("Commenti precedenti")}
            </button>
          )}
          {before && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setPage(null);
                setBefore(null);
              }}
            >
              {uiText("Torna ai più recenti")}
            </button>
          )}
        </div>
      )}
      {canContribute && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            <span className="sr-only">{uiText("Scrivi un commento")}</span>
            <textarea
              rows={2}
              maxLength={2000}
              placeholder={uiText("Scrivi un commento…")}
              value={draft}
              disabled={sending}
              onChange={(e) => {
                if (!draft.trim()) setDraftVersion(version);
                setDraft(e.currentTarget.value);
              }}
            />
          </label>
          {sendError && <p role="alert">{sendError}</p>}
          {draft.trim() && draftVersion !== version && (
            <p role="status">
              {uiText("L’attività è cambiata.")}{" "}
              <button
                className="quiet"
                type="button"
                onClick={() => {
                  setDraftVersion(version);
                  setSendError("");
                }}
              >
                {uiText("Commenta la versione ")}
                {version}
              </button>
            </p>
          )}
          <button
            type="submit"
            disabled={sending || !draft.trim() || draftVersion !== version}
          >
            {sending ? uiText("Pubblicazione…") : uiText("Pubblica commento")}
          </button>
        </form>
      )}
    </section>
  );
}
