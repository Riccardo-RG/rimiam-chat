"use client";
import { useUiLanguage } from "./ui-language";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { calendarConnectionLabel } from "./calendar-connection-label";
import type { EmailView } from "../contracts/email";
import styles from "./mailbox-connections.module.css";

const mailboxServices = [
  { id: "google", provider: "google-gmail", name: "Gmail" },
  { id: "microsoft", provider: "microsoft-outlook", name: "Outlook" },
] as const;

const calendarServices = [
  { id: "google", provider: "google-calendar", name: "Google Calendar" },
  {
    id: "microsoft",
    provider: "microsoft-calendar",
    name: "Calendario Outlook",
  },
] as const;
type Service =
  (typeof mailboxServices)[number] | (typeof calendarServices)[number];
type Availability = Partial<
  Record<Service["id"], "ready" | "unconfigured" | "not-offered" | "failed">
>;

export function MailboxConnections({
  workspace,
  connections,
  canConnect,
}: {
  workspace: string;
  connections: EmailView["connections"];
  canConnect: boolean;
}) {
  return (
    <IntegrationConnections
      workspace={workspace}
      canConnect={canConnect}
      capability="email"
      connections={connections.map((c) => ({
        provider: c.provider,
        active: c.active,
        label: c.sender,
      }))}
    />
  );
}

export function IntegrationConnections({
  workspace,
  connections,
  canConnect,
  capability,
}: {
  workspace: string;
  connections: { provider?: string; active: boolean; label: string }[];
  canConnect: boolean;
  capability: "calendar" | "email";
}) {
  const { t: uiText } = useUiLanguage();
  const calendar = capability === "calendar";
  const services = calendar ? calendarServices : mailboxServices;
  const [availability, setAvailability] = useState<Availability>({});
  const [pending, setPending] = useState<Service["id"] | null>(null);
  const [failure, setFailure] = useState("");
  const [fallback, setFallback] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    for (const { id } of services) {
      void api<{ configured: boolean; capabilities: string[] }>(
        `/api/v1/integrations/${id}/status`,
        undefined,
        abort.signal,
      )
        .then((status) => {
          if (!abort.signal.aborted)
            setAvailability((current) => ({
              ...current,
              [id]: !status.capabilities.includes(capability)
                ? "not-offered"
                : status.configured
                  ? "ready"
                  : "unconfigured",
            }));
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setAvailability((current) => ({ ...current, [id]: "failed" }));
        });
    }
    return () => abort.abort();
  }, [attempt, capability, services]);

  async function connect(service: Service) {
    // Open during the user's gesture. The draft remains in this tab on mobile too.
    const browser = window.open("about:blank", "_blank");
    if (browser) browser.opener = null;
    setPending(service.id);
    setFailure("");
    setFallback(null);
    try {
      const handoff = await api<{ authorizationUrl: string }>(
        `/api/v1/workspaces/${workspace}/${service.id}-connect`,
        { capability },
      );
      const url = new URL(handoff.authorizationUrl);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== `/api/v1/integrations/${service.id}/launch`
      )
        throw new Error("INVALID_RESPONSE");
      if (browser && !browser.closed) browser.location.replace(url.href);
      else setFallback({ url: url.href, name: service.name });
    } catch (e) {
      browser?.close();
      setFailure(errorText(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className={styles.section}
      aria-label={
        calendar
          ? uiText("Collega un calendario")
          : uiText("Collega una casella")
      }
    >
      <h3>
        {calendar
          ? uiText(calendarConnectionLabel(connections.some((c) => c.active)))
          : uiText("Le tue caselle")}
      </h3>
      <p className="hint">
        {calendar
          ? uiText(
              "Usa lo stesso indirizzo email di RIMIAM. Solo tu puoi vedere gli eventi che sincronizzi.",
            )
          : uiText(
              "Collega la casella con il tuo indirizzo RIMIAM per leggere la posta in privato e autorizzare gli invii.",
            )}
      </p>
      <div className={styles.choices}>
        {services.map((service) => {
          const linked = connections.find(
            (c) => c.active && c.provider === service.provider,
          );
          const status = availability[service.id];
          return (
            <div key={service.id} className={styles.choice}>
              <strong>{uiText(service.name)}</strong>
              {linked ? (
                <small>{linked.label}</small>
              ) : !canConnect ? (
                <small>{uiText("Richiede il permesso di contribuire")}</small>
              ) : status === "ready" ? (
                <button
                  type="button"
                  disabled={pending !== null}
                  aria-label={uiText("Collega {0}", uiText(service.name))}
                  onClick={() => void connect(service)}
                >
                  {pending === service.id
                    ? uiText("Apertura…")
                    : uiText("Collega")}
                </button>
              ) : (
                <small>
                  {status === "not-offered"
                    ? uiText("Non abilitato su questa installazione")
                    : status === "unconfigured"
                      ? calendar
                        ? uiText("Da configurare")
                        : uiText("In attesa di configurazione dal gestore")
                      : status === "failed"
                        ? uiText("Stato non disponibile")
                        : uiText("Verifica…")}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {Object.values(availability).includes("failed") && (
        <button
          type="button"
          className="quiet"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {uiText("Ricontrolla disponibilità")}
        </button>
      )}
      {fallback && (
        <p role="status">
          <a href={fallback.url} target="_blank" rel="noopener noreferrer">
            {uiText("Continua su ")}
            {uiText(fallback.name)}
          </a>
        </p>
      )}
      <Link
        href={calendar ? "/connessioni-e-dati" : "/connessioni-e-dati#posta"}
        target="_blank"
        rel="noopener noreferrer"
      >
        {calendar
          ? uiText("Come vengono usati i dati del calendario ↗")
          : uiText("Come collegare la posta ↗")}
      </Link>
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
}
