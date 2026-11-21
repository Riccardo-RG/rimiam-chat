"use client";
import { useUiLanguage } from "./ui-language";

import { mentionAtCaret, insertMention } from "../shared/conversation-mentions";
import {
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useComposerInteraction } from "./chat-composer-interaction";
import { useChatViewport } from "./chat-viewport";
import { onChatKeyDown } from "./chat-enter-to-send";
import { flushSync } from "react-dom";
import { addressMiriam } from "../shared/miriam-address";
import {
  launcherQuery,
  analysisDraft,
  type ComposerDestination,
  type ComposerActionPermissions,
} from "./composer-actions";
import {
  ComposerActionPicker,
  type PickerRequest,
} from "./composer-action-picker";
import styles from "./composer-actions.module.css";

export interface ComposerDockHandle {
  write: () => void;
}
export interface ComposerInputHandle {
  showActions: () => void;
}

export function ComposerActionShortcut({ open }: { open: () => void }) {
  const { t: uiText } = useUiLanguage();
  return (
    <button
      type="button"
      className={styles.shortcut}
      aria-label={uiText("Azioni")}
      title={uiText("Azioni disponibili")}
      aria-haspopup="dialog"
      onClick={open}
    >
      <kbd aria-hidden="true">/</kbd>
      <span aria-hidden="true">{uiText("Azioni")}</span>
    </button>
  );
}

export function ConversationMessageInput({
  ref,
  value,
  onChange,
  allowEmpty = false,
  assistantName = "Emme",
  personal = false,
  readOnly = false,
  mentions,
  permissions,
  onAction,
}: {
  ref?: Ref<ComposerInputHandle>;
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  allowEmpty?: boolean;
  assistantName?: string;
  mentions?: {
    people: { id: string; name: string }[];
    select: (id: string) => void;
  };
} & (
  | { personal: true; permissions?: never; onAction?: never }
  | {
      personal?: false;
      permissions: ComposerActionPermissions;
      onAction: (action: ComposerDestination) => void;
    }
)) {
  const { locale, t: uiText } = useUiLanguage();
  const field = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const token =
    mentions && caret !== null ? mentionAtCaret(value, caret) : null;
  const query = token?.query.toLocaleLowerCase("it-IT");
  const suggestions =
    query === undefined
      ? []
      : mentions!.people
          .filter(
            (p) =>
              p.name.toLocaleLowerCase("it-IT") !== "emme" &&
              p.name.toLocaleLowerCase("it-IT").startsWith(query),
          )
          .slice(0, 8);
  function selectMention(person: { id: string; name: string }) {
    if (!token || caret === null || !mentions) return;
    const inserted = insertMention(value, caret, person.name);
    if (!inserted) return;
    flushSync(() => {
      onChange(inserted.text);
      mentions.select(person.id);
      setCaret(null);
    });
    field.current?.focus({ preventScroll: true });
    field.current?.setSelectionRange(inserted.caret, inserted.caret);
  }
  function openPicker(fromSlash: boolean, query = "") {
    // Keep the focus change inside the initiating keystroke/tap on mobile.
    flushSync(() => setPicker({ fromSlash, query }));
  }
  useImperativeHandle(
    ref,
    () => ({ showActions: () => openPicker(false) }),
    [],
  );

  return (
    <>
      <textarea
        ref={field}
        id="message"
        name="message"
        aria-describedby="message-audience"
        placeholder={
          personal
            ? uiText("Scrivi a {0}…", String(assistantName))
            : uiText("Scrivi al gruppo o chiedi a {0}…", String(assistantName))
        }
        required={!allowEmpty}
        readOnly={readOnly}
        maxLength={personal ? 12000 - "@Emme ".length : 12000}
        rows={1}
        enterKeyHint="enter"
        value={value}
        onSelect={(event) => {
          if (mentions) setCaret(event.currentTarget.selectionStart);
        }}
        onChange={(event) => {
          const text = event.currentTarget.value;
          if (mentions) setCaret(event.currentTarget.selectionStart);
          const query = personal ? null : launcherQuery(value, text);
          if (
            query !== null &&
            !(event.nativeEvent as InputEvent).isComposing
          ) {
            openPicker(true, query);
            return;
          }
          onChange(text);
        }}
        onKeyDown={onChatKeyDown}
      />
      {suggestions.length > 0 && (
        <div
          className={styles.mentions}
          role="group"
          aria-label={uiText("Menziona una persona")}
        >
          {suggestions.map((person) => (
            <button
              className="quiet"
              type="button"
              key={person.id}
              onClick={() => selectMention(person)}
            >
              {person.name}
            </button>
          ))}
        </div>
      )}
      {!personal && picker && permissions && onAction && (
        <ComposerActionPicker
          assistantName={assistantName}
          initial={picker}
          permissions={permissions}
          restoreFocus={field}
          dismiss={() => setPicker(null)}
          restoreText={(text) => {
            setPicker(null);
            onChange(text);
          }}
          select={(action) => {
            setPicker(null);
            if (action === "ask-emme" || action === "analyze") {
              onChange(
                action === "analyze"
                  ? analysisDraft(value, locale)
                  : addressMiriam(value),
              );
              field.current?.focus({ preventScroll: true });
            } else {
              onAction(action);
            }
          }}
        />
      )}
    </>
  );
}

export function ConversationComposerDock({
  ref,
  children,
}: {
  ref: Ref<ComposerDockHandle>;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      write: () =>
        wrapper.current
          ?.querySelector("textarea")
          ?.focus({ preventScroll: true }),
    }),
    [],
  );
  useChatViewport(wrapper);
  const interaction = useComposerInteraction(wrapper);

  return (
    <div className="composer-dock" ref={wrapper} {...interaction}>
      {children}
    </div>
  );
}
