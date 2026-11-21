"use client";
import { useUiLanguage } from "./ui-language";
import { translateUi, type UiLocale } from "../shared/i18n";
import { useId } from "react";
import type { FollowupItem } from "@/contracts/tasks";
import styles from "./workspace-tasks.module.css";

const days = [
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
  "Domenica",
] as const;
const daily = days.map((_, index) => index + 1);

export type RepeatDraft = {
  mode: "once" | "daily" | "weekly";
  weekdays: number[];
  until: string;
};

export const once: RepeatDraft = { mode: "once", weekdays: [], until: "" };

export function repeatDraft(rule: FollowupItem["recurrence"]): RepeatDraft {
  if (!rule) return once;
  return {
    mode: rule.weekdays.length === 7 ? "daily" : "weekly",
    weekdays: rule.weekdays,
    until: rule.until ?? "",
  };
}

export function repeatRule(draft: RepeatDraft) {
  if (draft.mode === "once") return null;
  return {
    weekdays: draft.mode === "daily" ? daily : draft.weekdays,
    ...(draft.until ? { until: draft.until } : {}),
  };
}

export { reminderState } from "../shared/followup-order";

export function describeRepeat(f: FollowupItem, locale: UiLocale = "it") {
  const rule = f.recurrence;
  if (!rule) return "";
  const frequency =
    rule.weekdays.length === 7
      ? translateUi(locale, "Ogni giorno")
      : rule.weekdays
          .map((day) => translateUi(locale, days[day - 1]))
          .join(", ");
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: f.timeZone,
  }).format(new Date(f.remindAt));
  const until = rule.until ? rule.until.split("-").reverse().join("/") : "";
  if (locale === "en")
    return (
      frequency +
      " at " +
      time +
      " (" +
      f.timeZone +
      ")" +
      (rule.until ? " · Through " + rule.until : "")
    );
  return `${frequency} alle ${time} (${f.timeZone})${until ? ` · Fino al ${until} incluso` : ""}`;
}

export function ReminderRepeatFields({
  draft,
  onChange,
  startDay,
}: {
  draft: RepeatDraft;
  onChange: (draft: RepeatDraft) => void;
  startDay?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const frequencyId = useId();
  return (
    <>
      <div>
        <label htmlFor={frequencyId}>{uiText("Ripeti")}</label>
        <select
          id={frequencyId}
          value={draft.mode}
          onChange={(event) =>
            onChange({
              ...draft,
              mode: event.target.value as RepeatDraft["mode"],
            })
          }
        >
          <option value="once">{uiText("Una volta")}</option>
          <option value="daily">{uiText("Ogni giorno")}</option>
          <option value="weekly">
            {uiText("Alcuni giorni della settimana")}
          </option>
        </select>
      </div>
      {draft.mode === "weekly" && (
        <fieldset className={styles.repeatDays}>
          <legend>{uiText("Giorni della settimana")}</legend>
          {days.map((label, index) => {
            const day = index + 1;
            return (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={draft.weekdays.includes(day)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      weekdays: event.target.checked
                        ? [...draft.weekdays, day].sort((a, b) => a - b)
                        : draft.weekdays.filter((d) => d !== day),
                    })
                  }
                />
                {uiText(label)}
              </label>
            );
          })}
        </fieldset>
      )}
      {draft.mode !== "once" && (
        <label>
          {uiText("Fino al giorno incluso (facoltativo)")}
          <input
            type="date"
            min={startDay || undefined}
            value={draft.until}
            onChange={(event) =>
              onChange({ ...draft, until: event.target.value })
            }
          />
        </label>
      )}
    </>
  );
}
