"use client";
import { useUiLanguage } from "./ui-language";

import { useState } from "react";
import { isSourceQuestion } from "@/shared/miriam-address";
import type { Snapshot } from "./types";
import { useMessageQuestionSource } from "./conversation-voice";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./message-question.module.css";

type Message = Snapshot["messages"][number];

export function canAskAboutMessage(message: Message, assistantName = "Emme") {
  return (
    message.actor_kind === "human" &&
    message.purpose === "conversation" &&
    !isSourceQuestion(
      message.content,
      message.reference?.kind,
      !!message.quoteMessageId,
      assistantName,
    )
  );
}

export function MessageQuestion({
  message,
  assistantName = "Emme",
  inline,
  latest,
  disabled,
  onAsk,
}: {
  message: Message;
  assistantName?: string;
  inline?: boolean;
  latest: boolean;
  disabled: boolean;
  onAsk: (resolveSource: () => Promise<string>) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [held, setHeld] = useState(false);
  const { waitingForTranscript, resolve } = useMessageQuestionSource(
    message.id,
    message.sequence,
  );
  // Voice turns have a separate transcript Source. Wait for its qualified
  // content instead of sending the audio placeholder to the interpreter.
  if (inline ? !latest && !held : latest) return null;
  return (
    <button
      type="button"
      className={inline ? styles.inline : "quiet"}
      aria-label={uiText(
        "Chiedi a {0} di rispondere al messaggio {1}",
        String(assistantName),
        String(message.sequence),
      )}
      disabled={disabled || waitingForTranscript}
      title={
        waitingForTranscript
          ? uiText("La trascrizione del vocale non è ancora disponibile")
          : undefined
      }
      onPointerDown={() => setHeld(true)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onClick={() => {
        setHeld(false);
        onAsk(resolve);
      }}
    >
      <WorkspaceIcon name="spark" />
      {uiText("Chiedi a ")}
      {assistantName}
    </button>
  );
}
