"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import type { PersonalContacts } from "../contracts/v1";
import { useRouter } from "next/navigation";
import { api, errorText } from "./api";
import { WorkspaceIcon } from "./workspace-icon";
export function DirectContactLauncher({ actor }: { actor: string }) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [open, toggle] = useState(false),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [contacts, setContacts] = useState<PersonalContacts | null>(null),
    [error, setError] = useState(""),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<PersonalContacts>(
      "/api/v1/contacts?" +
        new URLSearchParams({ q: query, offset: String(offset) }),
      undefined,
      controller.signal,
    ).then(
      (data) => {
        if (!controller.signal.aborted) {
          setContacts(data);
          setError("");
        }
      },
      (e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      },
    );
    return () => controller.abort();
  }, [actor, open, offset, query]);
  async function start(contact: string) {
    setOpening(true);
    try {
      const result = await api<{ id: string }>("/api/v1/direct-chats", {
        expectedActorId: actor,
        contactId: contact,
      });
      router.push("/chat/" + result.id);
    } catch (e) {
      setError(errorText(e));
      setOpening(false);
    }
  }
  return (
    <div className="direct-launcher">
      <button
        type="button"
        className="quiet"
        aria-expanded={open}
        onClick={() => toggle(!open)}
      >
        <WorkspaceIcon name="people" />
        {uiText(" Scrivi a un contatto")}
      </button>
      {open && (
        <section aria-label={uiText("Rubrica personale")}>
          <label>
            {uiText("Cerca nei tuoi contatti")}
            <input
              value={query}
              type="search"
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
                setContacts(null);
              }}
            />
          </label>
          {!contacts && !error && (
            <p role="status">{uiText("Caricamento contatti…")}</p>
          )}
          {contacts?.contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              className="quiet"
              disabled={opening || c.nameAmbiguous}
              onClick={() => void start(c.id)}
            >
              {uiText("Scrivi a ")}
              {c.name}
              {c.nameAmbiguous && uiText(" · omonimo")}
            </button>
          ))}
          {contacts && contacts.contacts.length === 0 && (
            <p>
              {uiText(
                "Qui trovi le persone con cui hai già condiviso uno spazio.",
              )}
            </p>
          )}
          {offset > 0 && (
            <button
              type="button"
              className="quiet"
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              {uiText("Precedenti")}
            </button>
          )}
          {contacts?.nextOffset != null && (
            <button
              type="button"
              className="quiet"
              onClick={() => setOffset(contacts.nextOffset!)}
            >
              {uiText("Altri contatti")}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
export function useDirectDirectory(actor: string | undefined, active: boolean) {
  const [items, setItems] = useState<
      import("../contracts/direct-chat").DirectEntry[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!actor || !active) return;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const data = await api<
          import("../contracts/direct-chat").DirectEntry[]
        >("/api/v1/direct-chats", undefined, controller.signal);
        if (!controller.signal.aborted) {
          setItems(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 12000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [actor, active]);
  return { items, error };
}
