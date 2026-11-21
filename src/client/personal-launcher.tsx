"use client";
import { localizedDate } from "../shared/i18n/date";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { personalHomeSchema, personalSpaceResultSchema } from "../contracts/v1";
import { api, errorText } from "./api";
import { WorkspaceIcon, type WorkspaceIconName } from "./workspace-icon";
import styles from "./workspace-entry.module.css";
import { personalChatCommand } from "./personal-chat-controls";
import type { ChatDirectory } from "../contracts/personal-chats";
import type { PersonalTab } from "./personal-utilities";

const shortcuts: {
  tab: PersonalTab;
  label: string;
  icon: WorkspaceIconName;
}[] = [
  { tab: "chat", label: "Tu ed Emme", icon: "chat" },
  { tab: "documents", label: "Documenti", icon: "files" },
  { tab: "reminders", label: "Promemoria", icon: "bell" },
];
const when = localizedDate({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function PersonalLauncher({
  actor,
  onOpen,
  onConfigure,
}: {
  actor: string;
  onConfigure: () => void;
  onOpen: (id: string, tab: PersonalTab) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [home, setHome] = useState<ReturnType<
    typeof personalHomeSchema.parse
  > | null>(null);
  const ready = home?.readyResearch;
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<PersonalTab | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    let read: AbortController | undefined;
    let refreshAtDue: number | undefined;
    function refresh() {
      window.clearTimeout(refreshAtDue);
      if (document.hidden) return;
      read?.abort();
      const controller = new AbortController();
      read = controller;
      void api<unknown>("/api/v1/personal-space", undefined, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            const updated = personalHomeSchema.parse(value);
            setHome(updated);
            setError("");
            const next = updated.reminders[0];
            if (next) {
              const delay = Date.parse(next.nextRemindAt) - Date.now();
              // A due job can still be waiting for the worker.
              refreshAtDue = window.setTimeout(
                refresh,
                delay <= 0 ? 30_000 : Math.min(delay + 1000, 2_147_483_647),
              );
            }
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            setHome(null);
            setError(errorText(cause));
          }
        });
    }
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("rimiam-research-read", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(refreshAtDue);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rimiam-research-read", refresh);
      read?.abort();
      request.current?.abort();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [actor, attempt]);
  async function open(
    tab: PersonalTab,
    hit?: NonNullable<ChatDirectory["ready"]>,
  ) {
    if (request.current) return;
    if (tab !== "chat" && home?.id) {
      onOpen(home.id, tab);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setOpening(tab);
    setError("");
    try {
      if (tab === "chat") {
        const value = await personalChatCommand<{ id: string }>({
          action: "open",
          expectedActorId: actor,
          ...(hit ? { thread: hit.thread } : {}),
        });
        if (!controller.signal.aborted) {
          if (hit)
            try {
              sessionStorage.setItem(
                "rimiam-open-research:" + actor + ":" + hit.thread,
                hit.workId,
              );
            } catch {
              /* The result remains accessible in its chat. */
            }
          onOpen(value.id, "chat");
        }
        return;
      }
      const value = await api<unknown>(
        "/api/v1/personal-space",
        { expectedActorId: actor },
        controller.signal,
      );
      if (!controller.signal.aborted)
        onOpen(personalSpaceResultSchema.parse(value).id, tab);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
    } finally {
      if (!controller.signal.aborted) setOpening(null);
      request.current = null;
    }
  }
  return (
    <section className={styles.personal} aria-label={uiText("Personale")}>
      <div className={styles.personalHeading}>
        <h2>
          {uiText("Personale")} <small>{uiText("Solo io")}</small>
        </h2>
        <button
          type="button"
          className="quiet"
          aria-haspopup="dialog"
          onClick={onConfigure}
        >
          <WorkspaceIcon name="settings" />
          {uiText(" Configura Emme")}
        </button>
      </div>
      <div className={styles.shortcuts}>
        {shortcuts.map(({ tab, label, icon }) => (
          <button
            key={tab}
            type="button"
            disabled={!!opening}
            aria-busy={opening === tab}
            onClick={() => void open(tab)}
          >
            <WorkspaceIcon name={icon} />
            {uiText(label)}
          </button>
        ))}
      </div>
      {ready && (
        <button
          type="button"
          className="quiet"
          disabled={!!opening}
          onClick={() => void open("chat", ready)}
        >
          {uiText("Ricerca pronta · Apri in Tu ed Emme")}
        </button>
      )}
      {!!home?.reminders.length && (
        <div className={styles.nextReminders}>
          <h3>{uiText("Prossimi promemoria")}</h3>
          <ul>
            {home.reminders.map((item) => (
              <li key={item.id}>
                <time dateTime={item.nextRemindAt}>
                  {when(uiLocale).format(new Date(item.nextRemindAt))}
                </time>
                <span>{item.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div role="alert">
          {uiText("Personale non disponibile. ")}
          {error}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => setAttempt((a) => a + 1)}
          >
            {uiText("Riprova")}
          </button>
        </div>
      )}
    </section>
  );
}
