"use client";
import { connectionName } from "../shared/connection-name";
import { useUiLanguage } from "./ui-language";

import { useEffect, useId, useRef, useState } from "react";
import {
  assistantSettingsSchema,
  type AssistantSettings,
} from "../contracts/assistant-settings";
import { api, errorText } from "./api";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./assistant-settings.module.css";

const endpoint = "/api/v1/assistant-settings";
export type SettingsScope = { workspaceId?: string; name: string };
type Connection = AssistantSettings["connections"][number];

export function useAssistantSettings(
  actor?: string,
  workspaceId?: string,
  refreshOnReturn = false,
  revision?: number,
) {
  const { t: uiText } = useUiLanguage();
  const key = actor ? actor + "/" + (workspaceId ?? "") : "";
  const [result, setResult] = useState<{
    key: string;
    loadId: number;
    data?: AssistantSettings;
    failure?: { cause: unknown };
  } | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!key) return;
    let current: AbortController | undefined;
    async function read() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const path = workspaceId
          ? endpoint + "?" + new URLSearchParams({ workspaceId })
          : endpoint;
        const data = assistantSettingsSchema.parse(
          await api(path, undefined, controller.signal),
        );
        if (!controller.signal.aborted)
          setResult({ key, loadId: attempt, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({ key, loadId: attempt, failure: { cause: error } });
      }
    }
    void read();
    function resume() {
      if (refreshOnReturn && !document.hidden) void read();
    }
    document.addEventListener("visibilitychange", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      current?.abort();
    };
  }, [key, workspaceId, attempt, refreshOnReturn, revision]);
  return {
    data: result?.key === key ? result.data : undefined,
    loadId: result?.key === key ? result.loadId : undefined,
    error:
      result?.key === key && result.failure
        ? settingsError(result.failure.cause, uiText)
        : undefined,
    retry: () => retry((n) => n + 1),
  };
}

function settingsError(error: unknown, t: (source: string) => string) {
  const code = error instanceof Error ? error.message : "";
  if (/STALE|REVISION_CONFLICT/.test(code))
    return t(
      "Queste impostazioni sono cambiate. Rileggi la versione salvata prima di riprovare.",
    );
  if (/CONNECTION/.test(code))
    return t(
      "La connessione scelta non è più disponibile. Rileggi le impostazioni e scegli un’altra connessione.",
    );
  if (/FORBIDDEN|NOT_ALLOWED|DENIED|CREATOR_REQUIRED/.test(code))
    return t(
      "Il tuo account non può modificare la configurazione di questo spazio.",
    );
  if (/INVALID_INPUT|INVALID_REQUEST/.test(code))
    return t(
      "Usa lettere o numeri per iniziare il nome. Sono ammessi anche spazi, punti, apostrofi e trattini.",
    );
  const message = errorText(error);
  return (error instanceof Error && error.name === "ZodError") ||
    /^[A-Z_0-9]+$/.test(message)
    ? t("Impossibile leggere o salvare la configurazione. Riprova.")
    : message;
}

export function connectionLabel(
  connection: Connection | undefined,
  t: (source: string, ...values: string[]) => string,
) {
  if (!connection) return t("Connessione non disponibile");
  return (
    (connection.kind === "agent" ? t("Agente · ") : t("Modello · ")) +
    connectionName(connection, t)
  );
}

export function ConnectionOptions({
  connections,
}: {
  connections: Connection[];
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <>
      {(["model", "agent"] as const).map((kind) => {
        const options = connections.filter((option) => option.kind === kind);
        return options.length ? (
          <optgroup
            key={kind}
            label={kind === "agent" ? uiText("Agenti") : uiText("Modelli")}
          >
            {options.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.id !== "default" && !option.configured}
              >
                {connectionName(option, uiText)}
                {option.configured ? "" : uiText(" · non configurato")}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

export function AssistantSettingsDialog({
  actor,
  scope,
  personalSettings,
  close,
  onSaved,
  onScope,
}: {
  actor: string;
  scope: SettingsScope;
  personalSettings?: AssistantSettings;
  close: () => void;
  onSaved: () => void;
  onScope: (scope: SettingsScope) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const read = useAssistantSettings(actor, scope.workspaceId);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    el.showModal();
    return () => {
      el.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      className={styles.dialog}
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        )
          close();
      }}
    >
      <header className={styles.header}>
        <h2 id={title}>{uiText("Configura Emme")}</h2>
        <button type="button" className="quiet dialog-close" onClick={close}>
          {uiText("Chiudi ")}
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className={styles.body}>
        {read.error ? (
          <div role="alert">
            {read.error}{" "}
            <button type="button" className="quiet" onClick={read.retry}>
              {uiText("Riprova")}
            </button>
          </div>
        ) : read.data ? (
          <SettingsForm
            key={read.loadId}
            actor={actor}
            settings={read.data}
            personalSettings={personalSettings}
            scope={scope}
            reload={read.retry}
            onSaved={onSaved}
            onScope={onScope}
          />
        ) : (
          <p role="status">{uiText("Caricamento delle impostazioni…")}</p>
        )}
      </div>
    </dialog>
  );
}

function SettingsForm({
  actor,
  settings,
  personalSettings,
  scope,
  reload,
  onSaved,
  onScope,
}: {
  actor: string;
  settings: AssistantSettings;
  personalSettings?: AssistantSettings;
  scope: SettingsScope;
  reload: () => void;
  onSaved: () => void;
  onScope: (scope: SettingsScope) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [saved, setSaved] = useState(settings);
  const [connectionId, setConnection] = useState(settings.connectionId);
  const [displayName, setName] = useState(settings.displayName);
  const [instructions, setInstructions] = useState(settings.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useRef(false);
  const selected = saved.connections.find((c) => c.id === connectionId);
  const editable = saved.canManage;
  const modified =
    connectionId !== saved.connectionId ||
    displayName.trim() !== saved.displayName ||
    instructions.trim() !== saved.instructions;
  const dirty = saved.needsReconfirmation || modified;
  const overview = scope.workspaceId ? personalSettings : saved;
  const isShared = Boolean(scope.workspaceId);
  const guideLabel = isShared
    ? uiText("Istruzioni dello spazio")
    : uiText("Istruzioni personali");
  const field = useId();
  async function save() {
    if (
      guard.current ||
      !editable ||
      !dirty ||
      !displayName.trim() ||
      !selected
    )
      return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = assistantSettingsSchema.parse(
        await api(endpoint, {
          expectedActorId: actor,
          expectedRevision: saved.revision,
          workspaceId: scope.workspaceId,
          connectionId,
          connectionRevision: selected.revision,
          displayName: displayName.trim(),
          instructions: instructions.trim(),
        }),
      );
      setSaved(next);
      setConnection(next.connectionId);
      setName(next.displayName);
      setInstructions(next.instructions);
      setNotice(uiText("Impostazioni salvate."));
      onSaved();
    } catch (cause) {
      setError(settingsError(cause, uiText));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {overview?.managedSpaces.length ? (
        <label className={styles.scope}>
          {uiText("Conversazione da configurare")}
          <select
            value={scope.workspaceId ?? ""}
            disabled={busy}
            onChange={(e) => {
              const next = overview.managedSpaces.find(
                (s) => s.workspaceId === e.target.value,
              );
              if (
                modified &&
                !window.confirm(uiText("Uscire senza salvare le modifiche?"))
              )
                return;
              onScope(
                next
                  ? { workspaceId: next.workspaceId, name: next.workspaceName }
                  : { name: "Tu ed Emme" },
              );
            }}
          >
            <option value="">{uiText("Tu ed Emme · Chat personale")}</option>
            <optgroup label={uiText("I tuoi spazi")}>
              {overview.managedSpaces.map((s) => (
                <option key={s.workspaceId} value={s.workspaceId}>
                  {s.workspaceName} · {s.displayName} ·{" "}
                  {connectionLabel(
                    overview.connections.find((c) => c.id === s.connectionId),
                    uiText,
                  )}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ) : (
        <p className={styles.scope}>
          {isShared ? uiText("Spazio") : uiText("Chat personale")} ·{" "}
          <strong>{scope.name}</strong>
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onChange={() => setNotice("")}
      >
        {editable ? (
          <>
            <label htmlFor={field + "guide"}>{guideLabel}</label>
            <p id={field + "guideHelp"} className={styles.hint}>
              {isShared
                ? uiText(
                    "Scrivi in inglese come vuoi che risponda in questo spazio.",
                  )
                : uiText(
                    "Scrivi in inglese come vuoi che risponda in «Tu ed Emme».",
                  )}{" "}
              {uiText(
                "Se lasci vuoto, si applicano le istruzioni predefinite di RIMIAM.",
              )}
            </p>
            <textarea
              id={field + "guide"}
              lang="en"
              aria-describedby={field + "guideHelp"}
              rows={3}
              maxLength={5000}
              readOnly={busy}
              value={instructions}
              placeholder={uiText(
                "Start with the next step. Keep replies short.",
              )}
              onChange={(e) => setInstructions(e.target.value)}
            />
            {instructions.trim() && (
              <button
                type="button"
                className={`quiet ${styles.restoreGuide}`}
                disabled={busy}
                onClick={() => {
                  setInstructions("");
                  setNotice("");
                }}
              >
                {uiText("Usa le istruzioni predefinite")}
              </button>
            )}
          </>
        ) : (
          <>
            <h3 className={styles.sectionTitle}>{guideLabel}</h3>
            <p className={styles.hint}>
              {uiText("Solo chi ha creato lo spazio può modificarle.")}
            </p>
            {saved.instructions ? (
              <p className={styles.guidanceText} lang="en">
                {saved.instructions}
              </p>
            ) : (
              <p className={styles.hint}>
                {uiText("Lo spazio usa le istruzioni predefinite di RIMIAM.")}
              </p>
            )}
          </>
        )}
        <details className={styles.details}>
          <summary>{uiText("Istruzioni predefinite di RIMIAM")}</summary>
          <p className={styles.guidanceText} lang="en">
            {saved.defaultInstructions}
          </p>
        </details>
        <label htmlFor={field + "conn"}>{uiText("Modello o agente")}</label>
        <select
          id={field + "conn"}
          value={connectionId}
          disabled={!editable || busy}
          onChange={(e) => setConnection(e.target.value)}
        >
          {!selected && (
            <option value={connectionId} disabled>
              {uiText("Connessione non disponibile")}
            </option>
          )}
          <ConnectionOptions connections={saved.connections} />
        </select>
        {selected && (
          <p className={styles.hint}>
            {selected.configured
              ? uiText("Destinazione: {0}", String(selected.destination))
              : uiText("Connessione non configurata su questa installazione.")}
          </p>
        )}
        {(connectionId !== saved.connectionId || saved.needsReconfirmation) &&
          selected?.configured && (
            <p className={styles.hint}>
              {uiText(
                "Salvando, le nuove richieste e il contesto necessario saranno inviati a ",
              )}
              {selected.destination}.
            </p>
          )}
        {saved.needsReconfirmation && (
          <p role="status">
            {editable
              ? uiText(
                  "La destinazione è cambiata. Controllala e salva per autorizzare le nuove richieste.",
                )
              : uiText(
                  "La destinazione è cambiata. Chi ha creato lo spazio deve confermarla.",
                )}
          </p>
        )}
        {editable &&
          !saved.connections.some(
            (c) => c.kind === "agent" && c.configured,
          ) && (
            <p className={styles.hint}>
              {uiText(
                "Nessun agente collegato. Chi gestisce RIMIAM può collegarne uno locale o esterno.",
              )}
            </p>
          )}
        {editable && (
          <details className={styles.details}>
            <summary>{uiText("Come collegare un modello o un agente")}</summary>
            <p>
              {uiText(
                "Chi gestisce l’installazione registra le connessioni sul server, nella variabile ",
              )}
              <code>RIMIAM_ASSISTANT_CONNECTIONS</code>
              {uiText(
                ", e riavvia Web e worker. Le chiavi restano sul server.",
              )}
            </p>
            <p>
              {uiText(
                "Puoi usare modelli OpenAI, Anthropic e Ollama o un agente HTTP compatibile. Gli esempi e il formato richiesto sono nel file",
              )}{" "}
              <code>{uiText("docs/development/ASSISTANT_CONNECTIONS.md")}</code>
              {uiText(" del progetto.")}
            </p>
            <p>
              {uiText(
                "La scelta riguarda le risposte in chat. Ricerca, trascrizioni e posta usano le rispettive integrazioni.",
              )}
            </p>
          </details>
        )}
        <label htmlFor={field + "name"}>{uiText("Nome dell’assistente")}</label>
        <input
          id={field + "name"}
          value={displayName}
          required
          maxLength={48}
          readOnly={!editable || busy}
          onChange={(e) => setName(e.target.value)}
        />
        <details className={styles.details}>
          <summary>{uiText("Regole fisse di RIMIAM")}</summary>
          <pre lang="en">{saved.baseInstructions}</pre>
        </details>
        <a
          className={styles.download}
          href={
            "data:text/markdown;charset=utf-8," +
            encodeURIComponent(saved.effectiveInstructions)
          }
          download="assistant-instructions.md"
        >
          {uiText("Scarica le istruzioni salvate (.md)")}
        </a>
        {error && (
          <div role="alert">
            {error}{" "}
            <button type="button" className="quiet" onClick={reload}>
              {uiText("Carica la versione salvata")}
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {editable && modified && (
          <p className={styles.hint}>
            {uiText("Modifiche da salvare in «")}
            {scope.name}».
          </p>
        )}
        {editable && (
          <div className={styles.actions}>
            <button
              type="submit"
              disabled={
                busy ||
                !dirty ||
                !displayName.trim() ||
                !selected ||
                (selected.id !== "default" && !selected.configured)
              }
            >
              {busy ? uiText("Salvataggio…") : uiText("Salva impostazioni")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={
                busy ||
                (connectionId === "default" &&
                  displayName === "Emme" &&
                  !instructions)
              }
              onClick={() => {
                setConnection("default");
                setName("Emme");
                setInstructions("");
                setError("");
                setNotice("");
              }}
            >
              {uiText("Ripristina tutte le impostazioni")}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
