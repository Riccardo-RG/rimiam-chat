"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import type {
  ChatDirectory,
  ChatState,
  PersonalChatInput,
} from "../contracts/personal-chats";
import type { Command } from "../contracts/commands";
import { newCommand, type PendingCommand } from "./command-journal";
import { api, errorText } from "./api";
import styles from "./personal-utilities.module.css";

const endpoint = "/api/v1/personal-chats";
export function personalChatCommand<T = unknown>(input: PersonalChatInput) {
  return api<T>(endpoint, input);
}
export function useChatState(
  thread: string,
  revision: number,
  enabled: boolean,
) {
  const [state, setState] = useState<ChatState | null>(null),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let generation = 0;
    async function load() {
      const request = ++generation;
      try {
        const value = await api<ChatState>(
          endpoint + "?thread=" + thread,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted && generation === request) {
          setState(value);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted && generation === request) {
          setState(null);
          setError(errorText(cause));
        }
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [thread, revision, refresh, enabled]);
  return { state, error, reload: () => setRefresh((n) => n + 1) };
}
export function historyRequest(text: string) {
  const matched = text
    .trim()
    .match(
      /^(?:@?(?:emme|miriam)[, :]+)?(?:riprendi|ritrova|riapri|cerca nella cronologia)\s+(?:(?:la|il|lo)\s+|l[’'])?(?:(?:conversazione|chat)\s+(?:sul(?:la)?|di|del|su)\s+)?(.{2,100}?)\s*[?!.]*$/i,
    );
  return matched
    ? matched[1]
        .replace(/\s+(?:di ieri|di oggi|dell[’']altra volta)$/i, "")
        .trim()
    : null;
}
type Exec = (
  command: Command,
  onReceipt?: () => void,
  replay?: PendingCommand,
) => Promise<unknown>;
type Scope = {
  actor: string;
  thread: string;
  state: ChatState;
  reload: () => void;
};
export function PersonalChatControls({
  actor,
  thread,
  state,
  reload,
  navigate,
  command,
  search,
  changeSearch,
  refreshWorkspace,
  researchPrompt,
}: Scope & {
  navigate: (id: string) => void;
  command: Exec;
  search: string | null;
  changeSearch: (s: string | null) => void;
  refreshWorkspace: () => Promise<void>;
  researchPrompt?: string;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [mode, setMode] = useState<"research" | "select" | null>(
      researchPrompt !== undefined ? "research" : null,
    ),
    [q, setQ] = useState(researchPrompt ?? ""),
    [notify, setNotify] = useState(false),
    [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0);
  const [results, setResults] = useState<ChatDirectory | null>(null),
    [searchError, setSearchError] = useState("");
  const fresh = useRef<string | null>(null);
  const researchReceipt = useRef<PendingCommand | null>(null);
  useEffect(() => {
    if (search === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<ChatDirectory>(
        endpoint +
          "?" +
          new URLSearchParams({ q: search, offset: String(offset) }),
        undefined,
        controller.signal,
      )
        .then((v) => {
          if (!controller.signal.aborted) {
            setResults(v);
            setSearchError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setResults(null);
            setSearchError(errorText(e));
          }
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, offset]);
  async function work(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
      reload();
    } finally {
      setBusy(false);
    }
  }
  const select = async (id: string | null) => {
    await personalChatCommand({
      action: "select",
      thread,
      target: id,
      expectedActorId: actor,
      expectedVersion: state.selection.version,
    });
    setMode(null);
    reload();
  };
  function pickMode(m: typeof mode) {
    changeSearch(null);
    setError("");
    setMode((old) => (old === m ? null : m));
  }
  return (
    <div className={styles.tools}>
      {state.selection.id && (
        <div className={styles.selection}>
          <span>
            {uiText("Stai consultando ")}
            <strong>{state.selection.label}</strong>
          </span>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void work(() => select(null))}
          >
            {uiText("Termina")}
          </button>
        </div>
      )}
      <div className={styles.toolbar}>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              fresh.current ??= crypto.randomUUID();
              const r = await personalChatCommand<{ id: string }>({
                action: "new",
                thread: fresh.current,
                expectedActorId: actor,
              });
              fresh.current = null;
              navigate(r.id);
            })
          }
        >
          {uiText("Nuova conversazione")}
        </button>
        <button
          type="button"
          className="quiet"
          aria-expanded={search !== null}
          onClick={() => {
            setMode(null);
            setOffset(0);
            changeSearch(search === null ? "" : null);
          }}
        >
          {uiText("Conversazioni precedenti")}
        </button>
        {state.targets.length > 0 && (
          <button
            type="button"
            className="quiet"
            aria-expanded={mode === "select"}
            onClick={() => pickMode("select")}
          >
            {state.selection.id
              ? uiText("Cambia spazio")
              : uiText("Consulta uno spazio")}
          </button>
        )}
        <button
          type="button"
          className="quiet"
          aria-expanded={mode === "research"}
          onClick={() => pickMode("research")}
        >
          {uiText("Ricerca approfondita")}
        </button>
      </div>
      {search !== null && (
        <section aria-label={uiText("Cronologia personale")}>
          <label>
            {uiText("Cerca nelle tue conversazioni")}
            <input
              type="search"
              value={search}
              maxLength={160}
              onChange={(e) => {
                setResults(null);
                setOffset(0);
                changeSearch(e.target.value);
              }}
            />
          </label>
          {searchError && <p role="alert">{searchError}</p>}
          {results?.threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await personalChatCommand({
                    action: "open",
                    expectedActorId: actor,
                    thread: t.id,
                  });
                  changeSearch(null);
                  navigate(t.id);
                })
              }
            >
              {t.label} · {new Date(t.at).toLocaleDateString(uiLocale)}
            </button>
          ))}
          {results?.threads.length === 0 && (
            <p>{uiText("Nessuna conversazione trovata.")}</p>
          )}
          {offset > 0 && (
            <button
              type="button"
              className="quiet"
              onClick={() => setOffset((v) => Math.max(0, v - 25))}
            >
              {uiText("Precedenti")}
            </button>
          )}
          {results?.more && (
            <button
              type="button"
              className="quiet"
              onClick={() => setOffset((v) => v + 25)}
            >
              {uiText("Altre conversazioni")}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            onClick={() => changeSearch(null)}
          >
            {uiText("Chiudi cronologia")}
          </button>
        </section>
      )}
      {mode === "select" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void work(() => select(target));
          }}
        >
          <label>
            {uiText("Conversazione da consultare")}
            <select
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{uiText("Scegli lo spazio")}</option>
              {state.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !target}>{uiText("Consulta")}</button>
          <button type="button" className="quiet" onClick={() => setMode(null)}>
            {uiText("Chiudi")}
          </button>
        </form>
      )}
      {mode === "research" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void work(async () => {
              const input: Command = {
                type: "research.private_request",
                query: q.trim(),
                analyzeExcerpts: true,
                discloseQuery: true,
                notify,
                ...(state.selection.id ? { originId: state.selection.id } : {}),
              };
              if (
                !researchReceipt.current ||
                JSON.stringify(researchReceipt.current.command) !==
                  JSON.stringify(input)
              )
                researchReceipt.current = newCommand(actor, thread, input);
              await command(input, undefined, researchReceipt.current);
              researchReceipt.current = null;
              setQ("");
              setNotify(false);
              setMode(null);
              reload();
              await refreshWorkspace();
            });
          }}
        >
          <label>
            {uiText("Cosa vuoi approfondire?")}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={500}
              required
            />
          </label>
          <small>
            {uiText(
              "Invii questa domanda al motore di ricerca. Emme analizzerà gli estratti trovati. Il risultato sarà visibile solo a te.",
            )}
          </small>
          <label>
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />{" "}
            {uiText("Avvisami sul telefono per questa ricerca")}
          </label>
          {notify && (
            <small>
              {uiText(
                "Per ricevere l’avviso, abilita anche le notifiche personali su questo dispositivo.",
              )}
            </small>
          )}
          <button disabled={busy || !q.trim()}>
            {uiText("Avvia ricerca privata")}
          </button>
          <button type="button" className="quiet" onClick={() => setMode(null)}>
            {uiText("Annulla")}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function PrivateResearchResult({
  actor,
  thread,
  state,
  reload,
  item,
  command,
}: Scope & { item: ChatState["research"][number]; command: Exec }) {
  const { t: uiText } = useUiLanguage();
  const [opened, setOpened] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [choice, setChoice] = useState(item.origin ?? "");
  const destinations = state.targets.filter((t) => t.contributes);
  const ready = item.status === "ready",
    failed = ["failed", "needs_configuration"].includes(item.status);
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ready) return;
    let jump = false;
    try {
      const key = "rimiam-open-research:" + actor + ":" + thread;
      jump = sessionStorage.getItem(key) === item.id;
      if (jump) sessionStorage.removeItem(key);
    } catch {
      /* Temporary browser storage may be unavailable. */
    }
    if (jump) {
      queueMicrotask(() => setOpened(true));
      el.current?.scrollIntoView({ block: "center" });
    }
  }, [actor, thread, item.id, ready]);
  useEffect(() => {
    if (!opened || !ready || item.read) return;
    let active = true;
    void personalChatCommand({
      action: "research_read",
      thread,
      expectedActorId: actor,
      workId: item.id,
    })
      .then(() => {
        if (active) window.dispatchEvent(new Event("rimiam-research-read"));
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [actor, thread, item.id, opened, ready, item.read]);
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={el} className={styles.research}>
      {ready ? (
        <button
          type="button"
          className="quiet"
          aria-expanded={opened}
          onClick={() => setOpened((v) => !v)}
        >
          {uiText("Ricerca pronta · ")}
          {opened ? uiText("Chiudi risultato") : uiText("Apri risultato")}
        </button>
      ) : (
        <p role="status">
          {failed
            ? uiText("Ricerca da riprendere")
            : item.status === "cancelled"
              ? uiText("Ricerca annullata")
              : uiText("Ricerca privata in corso")}
        </p>
      )}
      {failed && (
        <>
          <small>
            {item.error
              ? errorText(new Error(item.error))
              : uiText("Il risultato richiede un nuovo tentativo.")}
          </small>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(() =>
                command(
                  item.brief
                    ? {
                        type: "research.brief_retry",
                        workId: item.id,
                        generation: item.generation,
                      }
                    : { type: "research.retry", workId: item.id },
                ),
              )
            }
          >
            {uiText("Riprova ricerca")}
          </button>
        </>
      )}
      {ready && opened && (
        <>
          <p className={styles.body}>{item.summary}</p>
          {!!item.citations.length && (
            <details>
              <summary>
                {uiText("Fonti · ")}
                {item.citations.length}
              </summary>
              {item.citations.map((s) => (
                <p key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                </p>
              ))}
            </details>
          )}
          {!!destinations.length && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  command({
                    type: "research.private_publish",
                    workId: item.id,
                    generation: item.generation,
                    destinationId: choice,
                  }),
                );
              }}
            >
              <label>
                {uiText("Condividi il risultato in")}
                <select
                  required
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">{uiText("Scegli uno spazio")}</option>
                  {destinations.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={
                  busy ||
                  !destinations.some((t) => t.id === choice) ||
                  item.shared.includes(choice)
                }
              >
                {item.shared.includes(choice)
                  ? uiText("Già condiviso")
                  : choice
                    ? uiText(
                        "Condividi in {0}",
                        String(
                          destinations.find((t) => t.id === choice)?.name ??
                            "questo spazio",
                        ),
                      )
                    : uiText("Condividi")}
              </button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
