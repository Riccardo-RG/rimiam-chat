"use client";
import { useUiLanguage } from "./ui-language";
import type { TaskOffer } from "../contracts/agenda";
import type { Command } from "../contracts/commands";
export function TaskOfferLine({
  offer,
  actor,
  busy,
  onCommand,
}: {
  offer: TaskOffer;
  actor: string;
  busy: boolean;
  onCommand: (command: Command) => void;
}) {
  const { locale: uiLocale, t: uiText } = useUiLanguage();
  const label =
    offer.status === "accepted"
      ? offer.acceptedBy
        ? uiText("{0} ha accettato", offer.acceptedBy)
        : uiText("Incarico accettato")
      : offer.status === "declined"
        ? uiText("{0} ha rifiutato", offer.personName)
        : offer.status === "outdated"
          ? uiText("Proposta superata")
          : uiText("Proposta per {0}", offer.personName);
  return (
    <details className="task-offer-line">
      <summary>
        {offer.title} · {label}
      </summary>
      <p>{offer.description}</p>
      {offer.due && (
        <p>
          {uiText("Scadenza: ")}
          {new Date(offer.due).toLocaleString(uiLocale)}
        </p>
      )}
      {offer.status === "pending" && actor === offer.person && (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onCommand({
                type: "task.accept",
                taskId: offer.taskId,
                expectedVersion: offer.version,
                reason: "Accettazione personale dalla conversazione",
                representSelf: true,
              })
            }
          >
            {uiText("Accetta")}
          </button>{" "}
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              onCommand({
                type: "task.decline",
                taskId: offer.taskId,
                expectedVersion: offer.version,
                reason: "Proposta rifiutata dalla conversazione",
              })
            }
          >
            {uiText("Rifiuta")}
          </button>
        </div>
      )}
    </details>
  );
}
