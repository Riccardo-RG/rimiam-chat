"use client";
import { useUiLanguage } from "./ui-language";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ActiveWorkPresence } from "@/contracts/active-work";
import { api } from "./api";
import { WorkspaceIcon } from "./workspace-icon";
import { EmmeMessageMark } from "./brand-signature";
import type { CompactAttention } from "./workspace-attention";
import styles from "./emme-presence.module.css";

const compactQuery =
  "(max-width: 760px), (max-width: 1050px) and (max-height: 500px)";

function subscribeLayout(notify: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export function useCompactActivity() {
  return useSyncExternalStore(
    subscribeLayout,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
}

function workStatus(work: ActiveWorkPresence["ongoing"][number]) {
  switch (work.phase) {
    case "working":
      return "In corso";
    case "queued":
      return "In attesa";
    case "paused":
      return "In pausa";
    case "needs_input":
      return work.blocked ? "Lavoro da verificare" : "Serve un chiarimento";
  }
}

function resultStatus(work: ActiveWorkPresence["results"][number]) {
  return work.validity === "potentially_outdated"
    ? "Risultato da ricontrollare"
    : "Risultato pronto";
}

export function EmmePresence({
  workspace,
  assistantName = "Emme",
  actor,
  revision,
  openWork,
  connectionUsage,
  overview,
}: {
  workspace: string;
  assistantName?: string;
  actor: string;
  revision: number;
  openWork: (id: string) => void;
  connectionUsage?: string;
  overview?: {
    attention: CompactAttention;
    goal?: string;
    emmeUnconfigured: boolean;
    reading: string | null;
    readingNeedsReview: boolean;
    open: (section: string) => void;
  };
}) {
  const { t: uiText } = useUiLanguage();
  const [view, setView] = useState<ActiveWorkPresence | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const indicatorId = useId();
  const root = useRef<HTMLDivElement>(null);
  const avatar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let request: AbortController | undefined;
    function read() {
      request?.abort();
      if (document.hidden) return;
      const controller = new AbortController();
      request = controller;
      void api<ActiveWorkPresence>(
        `/api/v1/workspaces/${workspace}/active-work-presence`,
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setView(data);
          setFailed(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setView(null);
          setFailed(true);
        });
    }
    read();
    document.addEventListener("visibilitychange", read);
    window.addEventListener("online", read);
    return () => {
      request?.abort();
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("online", read);
    };
  }, [workspace, actor, revision, attempt]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const running = view?.ongoing.find((item) => item.phase !== "paused");
  const status = running ? uiText(workStatus(running)) : "";
  const title = overview
    ? uiText("Attività dello spazio")
    : uiText("Attività di {0}", assistantName);
  const attentionSignal =
    overview &&
    (overview.attention.count > 0 ||
      overview.attention.unavailable ||
      overview.reading ||
      overview.readingNeedsReview ||
      running ||
      failed);
  const indicatorDescription = [
    overview?.emmeUnconfigured && uiText("{0} non disponibile.", assistantName),
    attentionSignal && uiText("Ci sono attività da consultare."),
  ]
    .filter(Boolean)
    .join(" ");
  function dismiss() {
    setOpen(false);
    avatar.current?.focus({ preventScroll: true });
  }
  function inspect(workId: string) {
    dismiss();
    openWork(workId);
  }
  function showSection(name: string) {
    dismiss();
    overview?.open(name);
  }

  return (
    <div
      ref={root}
      className={styles.presence}
      onKeyDown={(event) => {
        if (open && event.key === "Tab") {
          const container = event.currentTarget;
          requestAnimationFrame(() => {
            if (!container.contains(document.activeElement)) setOpen(false);
          });
        }
        if (open && event.key === "Escape") {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <button
        ref={avatar}
        className={styles.avatar}
        type="button"
        aria-label={title}
        title={
          overview?.emmeUnconfigured
            ? uiText("{0} · {1} non disponibile", title, assistantName)
            : title
        }
        aria-describedby={indicatorDescription ? indicatorId : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(!open);
        }}
      >
        <EmmeMessageMark />
        {overview && (
          <span className={styles.buttonText}>{uiText("Attività")}</span>
        )}
        {indicatorDescription && (
          <>
            <span
              aria-hidden="true"
              className={
                overview?.emmeUnconfigured ? styles.unavailableMark : styles.dot
              }
            />
            <span className="sr-only" id={indicatorId}>
              {indicatorDescription}
            </span>
          </>
        )}
      </button>
      {running && !overview && (
        <button
          type="button"
          className={styles.signal}
          data-work-signal
          aria-label={`${status} · ${running.objective}`}
          title={`${status} · ${running.objective}`}
          onClick={() => inspect(running.id)}
        >
          <span>
            {status} <span aria-hidden="true">·</span> {running.objective}
          </span>
          <WorkspaceIcon name="chevron" />
        </button>
      )}
      <section
        className={styles.panel}
        id={panelId}
        aria-label={title}
        hidden={!open}
      >
        <div className={styles.panelHeading}>
          <h2>{title}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label={uiText("Chiudi attività")}
            title={uiText("Chiudi")}
          >
            <WorkspaceIcon name="close" />
          </button>
        </div>
        {connectionUsage && <p>{connectionUsage}</p>}
        {overview && (
          <>
            {overview.emmeUnconfigured && (
              <p role="status" className={styles.availability}>
                <strong>
                  {assistantName}
                  {uiText(" non disponibile")}
                </strong>
                {uiText(
                  "Il servizio AI non è configurato. Puoi continuare a scrivere al gruppo.",
                )}
              </p>
            )}
            {overview.goal && (
              <button
                type="button"
                className={styles.entry}
                onClick={() => showSection("goal")}
              >
                <span>
                  <small>{uiText("Obiettivo dello spazio")}</small>
                  {overview.goal}
                </span>
                <WorkspaceIcon name="chevron" />
              </button>
            )}
            <button
              type="button"
              className={styles.entry}
              onClick={() => showSection("attention")}
            >
              <span>
                {uiText("Attività e argomenti")}
                {overview.attention.count > 0 && (
                  <small>
                    {overview.attention.count}
                    {uiText(" da seguire")}
                  </small>
                )}
              </span>
              <WorkspaceIcon name="chevron" />
            </button>
            {overview.attention.unavailable && (
              <p role="status">{uiText("Aggiornamento non disponibile.")}</p>
            )}
            {overview.reading && <p role="status">{overview.reading}</p>}
            {overview.readingNeedsReview && (
              <button
                type="button"
                className={styles.entry}
                onClick={() => showSection("context")}
              >
                {uiText("Verifica lettura di ")}
                {assistantName} <WorkspaceIcon name="chevron" />
              </button>
            )}
            <h3>{uiText("Lavoro di {0}", assistantName)}</h3>
          </>
        )}
        {failed ? (
          <p role="status">
            {uiText("Attività non disponibile.")}{" "}
            <button
              type="button"
              className="quiet"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {uiText("Riprova")}
            </button>
          </p>
        ) : !view ? (
          <p role="status">{uiText("Caricamento…")}</p>
        ) : (
          <>
            {view.ongoing.length > 0 ? (
              <ul>
                {view.ongoing.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => inspect(item.id)}>
                      <span>
                        {item.objective}
                        <small>{uiText(workStatus(item))}</small>
                      </span>
                      <WorkspaceIcon name="chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{uiText("Nessun lavoro in corso.")}</p>
            )}
            {view.results.length > 0 && (
              <>
                <h3>{uiText("Ultimi risultati")}</h3>
                <ul>
                  {view.results.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => inspect(item.id)}>
                        <span>
                          {item.objective}
                          <small>{uiText(resultStatus(item))}</small>
                        </span>
                        <WorkspaceIcon name="chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              className={styles.all}
              onClick={() => inspect("")}
            >
              {uiText("Tutti i lavori ")}
              <WorkspaceIcon name="arrow" />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
