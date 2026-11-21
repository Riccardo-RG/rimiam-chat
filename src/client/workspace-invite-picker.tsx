"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { PersonalContacts } from "../contracts/v1";
import { MAX_WORKSPACE_INVITE_RECIPIENTS } from "../contracts/workspace-invitations";
import {
  recipientKey,
  type SelectedRecipient,
} from "../shared/invitation-selection";
import { api } from "./api";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-entry.module.css";

export {
  invitationSelection,
  type SelectedRecipient,
} from "../shared/invitation-selection";

function ContactMatches({
  query,
  selected,
  add,
}: {
  query: string;
  selected: SelectedRecipient[];
  add: (recipient: SelectedRecipient) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [contacts, setContacts] = useState<PersonalContacts["contacts"]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [request, setRequest] = useState({ offset: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const read = new AbortController();
    const params = new URLSearchParams({
      q: query,
      offset: String(request.offset),
    });
    const delay = window.setTimeout(
      () => {
        void api<PersonalContacts>(
          `/api/v1/contacts?${params}`,
          undefined,
          read.signal,
        )
          .then((page) => {
            if (read.signal.aborted) return;
            setContacts((prior) => {
              const ids = new Set(prior.map((person) => person.id));
              return [
                ...prior,
                ...page.contacts.filter((person) => !ids.has(person.id)),
              ];
            });
            setNextOffset(page.nextOffset);
            setStatus("ready");
          })
          .catch(() => {
            if (!read.signal.aborted) setStatus("error");
          });
      },
      query && !request.offset ? 180 : 0,
    );
    return () => {
      window.clearTimeout(delay);
      read.abort();
    };
  }, [query, request]);

  const load = (offset: number) => {
    setStatus("loading");
    setRequest({ offset });
  };

  return (
    <>
      {contacts.length > 0 && (
        <ul
          className={styles.matches}
          aria-label={uiText("Contatti personali")}
        >
          {contacts.map((person) => {
            const picked = selected.some(
              ({ target }) =>
                "contactId" in target && target.contactId === person.id,
            );
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-label={
                    person.nameAmbiguous
                      ? uiText(
                          "{0}, più contatti con questo nome. Inserisci l’email.",
                          String(person.name),
                        )
                      : picked
                        ? uiText("{0} già in lista", String(person.name))
                        : uiText("Aggiungi {0}", String(person.name))
                  }
                  disabled={picked || person.nameAmbiguous}
                  onClick={() =>
                    add({
                      label: person.name,
                      target: { contactId: person.id },
                    })
                  }
                >
                  <span>{person.name}</span>
                  {person.nameAmbiguous ? (
                    <small>{uiText("Omonimo · inserisci l’email")}</small>
                  ) : picked ? (
                    <small>{uiText("Già in lista")}</small>
                  ) : (
                    <WorkspaceIcon name="plus" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {status === "ready" && !contacts.length && (
        <p className="hint" role="status">
          {query
            ? uiText(
                "Nessun contatto con questo nome. Puoi usare il suo indirizzo email.",
              )
            : uiText(
                "Qui troverai le persone con cui hai già condiviso uno spazio. Per il primo invito usa un indirizzo email.",
              )}
        </p>
      )}
      {status === "loading" && (
        <p className="hint" role="status">
          {uiText("Caricamento contatti…")}
        </p>
      )}
      {status === "error" && (
        <>
          <p className="hint" role="status">
            {uiText(
              "Rubrica non disponibile. Puoi comunque invitare via email.",
            )}
          </p>
          <button
            type="button"
            className="quiet"
            onClick={() => load(request.offset)}
          >
            {uiText("Riprova a caricare i contatti")}
          </button>
        </>
      )}
      {status === "ready" && nextOffset !== null && (
        <button
          type="button"
          className="quiet"
          onClick={() => load(nextOffset)}
        >
          {uiText("Mostra altri contatti")}
        </button>
      )}
    </>
  );
}

export function WorkspaceInvitePicker({
  selected,
  onChange,
  draft,
  setDraft,
  recipients,
}: {
  selected: SelectedRecipient[];
  onChange: (next: SelectedRecipient[]) => void;
  draft: string;
  setDraft: (value: string) => void;
  recipients: SelectedRecipient[];
}) {
  const { t: uiText } = useUiLanguage();
  const container = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const term = draft.trim();
  const isAddress = term.includes("@");
  const email = z.email().safeParse(term.toLowerCase());
  const atLimit = selected.length >= MAX_WORKSPACE_INVITE_RECIPIENTS;
  const emailPicked =
    email.success &&
    selected.some(
      ({ target }) => "email" in target && target.email === email.data,
    );
  const add = (recipient: SelectedRecipient) => {
    if (atLimit) return;
    if (
      !selected.some((item) => recipientKey(item) === recipientKey(recipient))
    )
      onChange([...selected, recipient]);
    setDraft("");
    input.current?.setCustomValidity("");
    input.current?.focus();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    // WebKit may move focus out of a text field before activating an in-panel
    // button. Closing on blur would remove the recipient before its click.
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open]);

  return (
    <section
      ref={container}
      className={styles.invite}
      aria-labelledby="workspace-invite-label"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        setDraft("");
        input.current?.setCustomValidity("");
        input.current?.focus();
        setOpen(false);
      }}
    >
      <label id="workspace-invite-label" htmlFor="workspace-invite-query">
        <WorkspaceIcon name="invite" />
        {uiText(" Invita persone")} <span>{uiText("(facoltativo)")}</span>
      </label>
      <input
        id="workspace-invite-query"
        ref={input}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={atLimit}
        placeholder={uiText("Nome di un contatto o indirizzo email")}
        aria-describedby="workspace-invite-hint"
        value={draft}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft(value);
          setOpen(true);
          event.currentTarget.setCustomValidity(
            value.trim() &&
              !z.email().safeParse(value.trim().toLowerCase()).success
              ? "Scegli un contatto dalla lista o inserisci un indirizzo email completo."
              : "",
          );
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (email.success)
              add({ label: email.data, target: { email: email.data } });
            else setOpen(true);
          }
        }}
      />
      <p id="workspace-invite-hint" className="hint">
        {atLimit
          ? uiText(
              "Puoi invitare fino a {0} persone alla creazione dello spazio.",
              String(MAX_WORKSPACE_INVITE_RECIPIENTS),
            )
          : uiText(
              "La tua rubrica comprende le persone con cui hai condiviso uno spazio.",
            )}
      </p>
      {open && !atLimit && (
        <div className={styles.suggestions}>
          {isAddress ? (
            email.success ? (
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  add({ label: email.data, target: { email: email.data } })
                }
              >
                {emailPicked
                  ? uiText("Già in lista · chiudi")
                  : uiText("Aggiungi {0}", String(email.data))}
              </button>
            ) : (
              <p className="hint">
                {uiText("Completa l’indirizzo email per aggiungerlo.")}
              </p>
            )
          ) : term.length <= 120 ? (
            <ContactMatches
              key={term}
              query={term}
              selected={selected}
              add={add}
            />
          ) : (
            <p className="hint">
              {uiText("Cerca un nome più breve o inserisci l’indirizzo email.")}
            </p>
          )}
        </div>
      )}
      {recipients.length > 0 && (
        <>
          {selected.length > 0 && (
            <ul
              className={styles.recipients}
              aria-label={uiText("Persone da invitare")}
            >
              {selected.map((person) => (
                <li key={recipientKey(person)}>
                  <button
                    type="button"
                    aria-label={uiText("Rimuovi {0}", String(person.label))}
                    onClick={() => {
                      onChange(
                        selected.filter(
                          (item) => recipientKey(item) !== recipientKey(person),
                        ),
                      );
                      input.current?.focus();
                    }}
                  >
                    {person.label} <WorkspaceIcon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {uiText(
              "Chi inviti trova l’invito nella Home del proprio account. Richiederemo anche un link via email. Chi accetta potrà scrivere in chat.",
            )}
          </p>
          <label
            className="check"
            key={JSON.stringify(recipients.map(recipientKey))}
          >
            <input type="checkbox" name="historyDisclosure" required />
            {uiText(
              "Confermo che chi accetta potrà leggere tutta la storia condivisa conservata.",
            )}
          </label>
        </>
      )}
    </section>
  );
}
