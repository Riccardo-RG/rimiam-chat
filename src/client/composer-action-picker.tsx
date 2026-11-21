"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  availableComposerActions,
  type ComposerActionId,
  type ComposerActionPermissions,
} from "./composer-actions";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./composer-actions.module.css";

export type PickerRequest = { fromSlash: boolean; query: string };
export function ComposerActionPicker({
  assistantName = "Emme",
  initial,
  permissions,
  select,
  dismiss,
  restoreText,
  restoreFocus,
}: {
  initial: PickerRequest;
  assistantName?: string;
  permissions: ComposerActionPermissions;
  select: (id: ComposerActionId) => void;
  dismiss: () => void;
  restoreText: (text: string) => void;
  restoreFocus: RefObject<HTMLTextAreaElement | null>;
}) {
  const { locale, t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState(initial.query);
  const [index, setIndex] = useState(0);
  const matches = availableComposerActions(permissions, query, locale);
  const selected = matches[Math.min(index, matches.length - 1)];
  useEffect(() => {
    const element = dialog.current;
    const search = input.current;
    element?.showModal();
    search?.focus({ preventScroll: true });
    function softReturn(event: InputEvent) {
      if (
        !element?.open ||
        event.isComposing ||
        !event.cancelable ||
        !["insertLineBreak", "insertParagraph"].includes(event.inputType)
      )
        return;
      event.preventDefault();
      list.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.click();
    }
    search?.addEventListener("beforeinput", softReturn);
    return () => {
      search?.removeEventListener("beforeinput", softReturn);
      if (element?.open) element.close();
    };
  }, []);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);
  function leave(next: () => void) {
    dialog.current?.close();
    restoreFocus.current?.focus({ preventScroll: true });
    next();
  }
  function cancel() {
    leave(dismiss);
  }
  function replaceSearch(text: string, composing: boolean) {
    if (
      initial.fromSlash &&
      !composing &&
      (text.includes("/") || /^feedback\s/i.test(text))
    ) {
      leave(() => restoreText("/" + text));
      return;
    }
    setQuery(text);
    setIndex(0);
  }
  return (
    <dialog
      ref={dialog}
      className={styles.picker}
      aria-labelledby={id}
      data-composer-launcher
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <header className={styles.header}>
        <h3 id={id}>{uiText("Azioni dello spazio")}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label={uiText("Chiudi azioni")}
          onClick={cancel}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <label className={styles.search}>
        <span aria-hidden="true">/</span>
        <input
          ref={input}
          type="text"
          form={id + "-search-only"}
          inputMode="search"
          enterKeyHint="go"
          placeholder={uiText("Cerca un’azione…")}
          aria-label={uiText("Cerca un’azione")}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls={id + "-list"}
          aria-autocomplete="list"
          aria-activedescendant={selected ? id + "-" + selected.id : undefined}
          value={query}
          onChange={(event) =>
            replaceSearch(
              event.target.value,
              (event.nativeEvent as InputEvent).isComposing,
            )
          }
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (selected && !event.repeat) leave(() => select(selected.id));
            } else if (
              matches.length &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setIndex(
                (current) =>
                  (current + direction + matches.length) % matches.length,
              );
            }
          }}
        />
      </label>
      <div
        className={styles.options}
        id={id + "-list"}
        ref={list}
        role="listbox"
        aria-label={uiText("Azioni disponibili")}
      >
        {matches.map((item) => (
          <button
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={selected?.id === item.id}
            id={id + "-" + item.id}
            key={item.id}
            onClick={() => leave(() => select(item.id))}
          >
            <WorkspaceIcon name={item.icon} />
            <span>{item.label.replace(/Emme/g, () => assistantName)}</span>
            <small>{item.shortcuts.join(" · ")}</small>
          </button>
        ))}
      </div>
      {!matches.length && (
        <p role="status">{uiText("Nessuna azione trovata.")}</p>
      )}
      {initial.fromSlash && (
        <button
          type="button"
          className={styles.literal}
          onClick={() => leave(() => restoreText(`/${query}`))}
        >
          {uiText("Usa come testo del messaggio")}
        </button>
      )}
    </dialog>
  );
}
