import { useUiLanguage } from "../i18n";
import { useEffect, useState } from "react";
import * as Browser from "expo-web-browser";
import { View } from "react-native";
import { post, problem, type NativeRequest } from "../api";
import { Action } from "../ui";
import { Label, Section } from "./parts";
import { launchUrl } from "./inputs";

type Provider = "google" | "microsoft";
type Status = { configured: boolean; capabilities: string[] };
const providers = ["google", "microsoft"] as const;

export function Connections({
  request,
  origin,
  workspaceId,
  kind,
  canContribute,
  connections,
  onReturn,
}: {
  request: NativeRequest;
  origin: string;
  workspaceId: string;
  kind: "calendar" | "email";
  canContribute: boolean;
  connections: { active: boolean; provider?: string; label: string }[];
  onReturn: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [revision, setRevision] = useState(0);
  const [statuses, setStatuses] = useState<
    Partial<Record<Provider, Status | null>>
  >({});
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    for (const provider of providers) {
      void request<Status>("/api/v1/integrations/" + provider + "/status", {
        signal: controller.signal,
      }).then(
        (status) => {
          if (!controller.signal.aborted)
            setStatuses((prior) => ({ ...prior, [provider]: status }));
        },
        () => {
          if (!controller.signal.aborted)
            setStatuses((prior) => ({ ...prior, [provider]: null }));
        },
      );
    }
    return () => controller.abort();
  }, [request, revision]);
  async function connect(provider: Provider) {
    setLaunching(true);
    setError("");
    try {
      const result = await request<{ authorizationUrl: string }>(
        "/api/v1/workspaces/" + workspaceId + "/" + provider + "-connect",
        post({ capability: kind }),
      );
      await Browser.openBrowserAsync(
        launchUrl(result.authorizationUrl, origin, provider),
      );
      onReturn();
    } catch (e) {
      setError(problem(e));
    } finally {
      setLaunching(false);
    }
  }
  const calendar = kind === "calendar";
  return (
    <Section
      title={calendar ? uiText("I tuoi calendari") : uiText("Le tue caselle")}
    >
      <Label>
        {uiText(
          "Collega il tuo indirizzo verificato in RIMIAM. Le letture rimangono private.",
        )}
      </Label>
      {providers.map((id) => {
        const provider =
          id === "google"
            ? calendar
              ? "google-calendar"
              : "google-gmail"
            : calendar
              ? "microsoft-calendar"
              : "microsoft-outlook";
        const name =
          id === "google"
            ? calendar
              ? "Google Calendar"
              : "Gmail"
            : calendar
              ? uiText("Calendario Outlook")
              : "Outlook";
        const linked = connections.find(
          (c) => c.provider === provider && c.active,
        );
        const status = statuses[id];
        if (linked)
          return (
            <Label key={id}>
              {name} · {linked.label}
            </Label>
          );
        if (
          canContribute &&
          status?.configured &&
          status.capabilities.includes(kind)
        )
          return (
            <Action
              key={id}
              label={uiText("Collega {0}", String(name))}
              disabled={launching}
              onPress={() => void connect(id)}
            />
          );
        const message = !canContribute
          ? "Richiede il permesso di contribuire"
          : status === undefined
            ? "Verifica…"
            : status === null
              ? "Stato non disponibile"
              : !status.capabilities.includes(kind)
                ? "Non abilitato su questa installazione"
                : "In attesa di configurazione dal gestore";
        return (
          <Label key={id}>
            {name} · {uiText(message)}
          </Label>
        );
      })}
      {!!error && <Label>{error}</Label>}
      {Object.values(statuses).includes(null) && (
        <Action
          label={uiText("Ricontrolla disponibilità")}
          onPress={() => setRevision((n) => n + 1)}
        />
      )}
      <View>
        <Action
          label={
            calendar
              ? uiText("Dati e permessi del calendario")
              : uiText("Come collegare la posta")
          }
          onPress={() => {
            void Browser.openBrowserAsync(
              origin + "/connessioni-e-dati" + (calendar ? "" : "#posta"),
            ).catch((e) => setError(problem(e)));
          }}
        />
      </View>
    </Section>
  );
}
