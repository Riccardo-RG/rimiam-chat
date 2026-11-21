"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import { workspaceScheduleSchema } from "../contracts/agenda";
import { api, errorText } from "./api";
import styles from "./workspace-tasks.module.css";
export function WorkspaceSchedule({
  workspace,
  mine,
  onMine,
  onPick,
}: {
  workspace: string;
  mine: boolean;
  onMine: (v: boolean) => void;
  onPick: (id: string) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [limit, setLimit] = useState(20),
    [expanded, setExpanded] = useState(false),
    [view, setView] = useState<ReturnType<
      typeof workspaceScheduleSchema.parse
    > | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      busy = false;
    const c = new AbortController();
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const result = await api<unknown>(
          "/api/v1/workspaces/" +
            workspace +
            "/schedule?mine=" +
            mine +
            "&limit=" +
            limit,
          undefined,
          c.signal,
        );
        if (live) {
          setView(workspaceScheduleSchema.parse(result));
          setError("");
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("rimiam-schedule-changed", refresh);
    return () => {
      live = false;
      c.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rimiam-schedule-changed", refresh);
    };
  }, [workspace, mine, limit]);
  const dated = (view?.entries ?? []).filter((item) => item.at !== null);
  const visible = expanded ? dated : dated.slice(0, 3);
  return (
    <section
      className={styles.schedule}
      aria-label={uiText("Scadenze dello spazio")}
    >
      <header>
        <h2>{uiText("Prossime scadenze")}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setView(null);
              setExpanded(false);
              setLimit(20);
              onMine(e.target.checked);
            }}
          />{" "}
          {uiText("Solo mie")}
        </label>
      </header>
      {error && <p role="alert">{error}</p>}
      {!view && !error && (
        <p role="status">{uiText("Caricamento scadenze…")}</p>
      )}
      {view && !dated.length && (
        <p className="hint">{uiText("Nessuna scadenza in programma.")}</p>
      )}
      {!!visible.length && (
        <ol>
          {visible.map((e) => (
            <li key={e.id}>
              <button className="quiet" onClick={() => onPick(e.id)}>
                <time dateTime={e.at!}>
                  {new Date(e.at!).toLocaleString(uiLocale, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <span>{e.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {dated.length > 3 && (
        <button
          type="button"
          className="quiet"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? uiText("Mostra meno") : uiText("Mostra altre scadenze")}
        </button>
      )}
      {expanded && view?.more && dated.length === view.entries.length && (
        <button className="quiet" onClick={() => setLimit((n) => n + 20)}>
          {uiText("Carica altre scadenze")}
        </button>
      )}
    </section>
  );
}
