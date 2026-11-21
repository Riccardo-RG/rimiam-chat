"use client";
import { useUiLanguage } from "./ui-language";
import { useState } from "react";
import type { CalendarCommand } from "../contracts/calendar";
type Audience = NonNullable<
  Extract<CalendarCommand, { type: "temporal.create" }>["audience"]
>;
export function audienceFromForm(data: FormData): Audience {
  const choice = data.get("audience");
  if (choice === "all") return { kind: "all" };
  if (choice === "people") {
    const people = data.getAll("person").map(String);
    if (!people.length)
      throw new Error("Seleziona almeno una persona da invitare.");
    return { kind: "people", people };
  }
  return { kind: "calendar" };
}
export function CalendarAudienceFields({
  members,
  initial,
}: {
  members: { id: string; name: string }[];
  initial?: Audience;
}) {
  const { t: uiText } = useUiLanguage();
  const [choice, setChoice] = useState<Audience["kind"]>(
    initial?.kind ?? "calendar",
  );
  return (
    <>
      <label>
        {uiText("Invitati")}
        <select
          name="audience"
          value={choice}
          onChange={(e) => setChoice(e.target.value as Audience["kind"])}
        >
          <option value="calendar">
            {uiText("Solo nel calendario dello spazio")}
          </option>
          <option value="all">{uiText("Tutto lo spazio")}</option>
          <option value="people">{uiText("Scegli persone")}</option>
        </select>
      </label>
      {choice === "people" && (
        <fieldset>
          <legend>{uiText("Persone invitate")}</legend>
          {members.map((p) => (
            <label key={p.id}>
              <input
                name="person"
                type="checkbox"
                value={p.id}
                defaultChecked={
                  initial?.kind === "people" && initial.people.includes(p.id)
                }
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
