"use client";
import { useUiLanguage } from "./ui-language";

import { useState } from "react";
import type { Command } from "../contracts/commands";
export function MessageAddressActions({
  id,
  members,
  pending,
  canPost,
  disabled,
  onReply,
  run,
}: {
  id: string;
  members: { user_id: string; name: string }[];
  pending: boolean;
  canPost: boolean;
  disabled: boolean;
  onReply: () => void;
  run: (c: Command) => Promise<unknown>;
}) {
  const { t: uiText } = useUiLanguage();
  const [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [working, setWorking] = useState(false),
    [sent, setSent] = useState(false);
  async function submit(command: Command) {
    setWorking(true);
    try {
      await run(command);
      setChoosing(false);
      setSelected([]);
      setSent(true);
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      {canPost && (
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          onClick={onReply}
        >
          {uiText("Rispondi")}
        </button>
      )}
      {canPost && members.length > 0 && (
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          {uiText("Richiedi una risposta")}
        </button>
      )}
      {canPost && choosing && (
        <fieldset>
          <legend>{uiText("Da chi aspetti una risposta?")}</legend>
          {members.map((m) => (
            <label key={m.user_id}>
              <input
                type="checkbox"
                checked={selected.includes(m.user_id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, m.user_id]
                      : s.filter((id) => id !== m.user_id),
                  )
                }
              />
              {m.name}
            </label>
          ))}
          <button
            type="button"
            disabled={disabled || working || !selected.length}
            onClick={() =>
              void submit({
                type: "conversation.requestAnswer",
                messageId: id,
                recipients: selected,
              }).catch(() => {})
            }
          >
            {uiText("Richiedi risposta")}
          </button>
        </fieldset>
      )}
      {pending && (
        <button
          type="button"
          className="quiet"
          disabled={working}
          onClick={() =>
            void submit({ type: "conversation.answered", messageId: id }).catch(
              () => {},
            )
          }
        >
          {uiText("Già risposto")}
        </button>
      )}
      {sent && !choosing && <small role="status">{uiText("Registrato")}</small>}
    </>
  );
}
