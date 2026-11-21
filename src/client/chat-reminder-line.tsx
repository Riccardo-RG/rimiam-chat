"use client";
import { useUiLanguage } from "./ui-language";

import { useRef, useState } from "react";
import type { ReminderLineData } from "../contracts/agenda";
import type { Command } from "../contracts/commands";
import { errorText } from "./api";
import {
  newCommand,
  sendCommand,
  type PendingCommand,
} from "./command-journal";
function localField(instant: string) {
  const d = new Date(instant);
  return new Date(+d - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ChatReminderLine({
  reminder: r,
  actor,
  workspace,
  messageId,
  onRefresh,
}: {
  reminder: ReminderLineData;
  actor: string;
  workspace: string;
  messageId: string;
  onRefresh: () => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [editing, edit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<PendingCommand | null>(null),
    locked = useRef(false);
  async function save(w: string, c: Command) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        pending.current?.workspace !== w ||
        JSON.stringify(pending.current.command) !== JSON.stringify(c)
      )
        pending.current = newCommand(actor, w, c);
      await sendCommand(pending.current);
      pending.current = null;
      edit(false);
      onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const scope = r.audience === "space" ? "Per tutti" : "Solo io";
  return (
    <aside aria-label={uiText("Conferma promemoria")}>
      {r.id && r.at ? (
        <p>
          {uiText("Promemoria · ")}
          {scope} · {new Date(r.at).toLocaleString(uiLocale)}
          {r.closed ? (
            uiText(" · Chiuso")
          ) : (
            <button
              type="button"
              className="quiet"
              onClick={() => edit(!editing)}
            >
              {editing ? uiText("Annulla") : uiText("Modifica")}
            </button>
          )}
        </p>
      ) : (
        <p>
          {r.day ? uiText("A che ora?") : uiText("Per quale data e ora?")} ·{" "}
          {scope}
        </p>
      )}
      {(!r.id || editing) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const raw = String(form.get("at"));
            const local = raw.includes("T") ? raw : r.day + "T" + raw;
            const at = new Date(local);
            if (Number.isNaN(+at) || localField(at.toISOString()) !== local) {
              setError(
                uiText("Scegli un orario valido nel fuso del dispositivo."),
              );
              return;
            }
            if (!r.id)
              void save(workspace, {
                type: "reminder.set_time",
                messageId,
                remindAt: at.toISOString(),
              });
            else if (r.destination && r.at && r.version)
              void save(r.destination, {
                type: "followup.occurrence",
                action:
                  form.get("mode") === "following"
                    ? "replace_following"
                    : "replace",
                followupId: r.id,
                expectedVersion: r.version,
                scheduledAt: r.at,
                replacement: {
                  content: String(form.get("title")),
                  remindAt: at.toISOString(),
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
              });
          }}
        >
          {editing && (
            <label>
              {uiText("Cosa ricordare")}
              <input
                name="title"
                required
                defaultValue={r.content}
                maxLength={2000}
              />
            </label>
          )}
          <label>
            {!r.id && r.day
              ? uiText("Ora del {0}", String(r.day))
              : uiText("Data e ora")}
            <input
              name="at"
              required
              type={!r.id && r.day ? "time" : "datetime-local"}
              defaultValue={r.at ? localField(r.at) : undefined}
            />
          </label>
          {editing && r.recurring && (
            <label>
              {uiText("Applica a")}
              <select name="mode">
                <option value="one">{uiText("Solo questa scadenza")}</option>
                <option value="following">
                  {uiText("Da questa scadenza in poi")}
                </option>
              </select>
            </label>
          )}
          <button disabled={busy}>
            {editing ? uiText("Salva modifiche") : uiText("Conferma orario")}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
