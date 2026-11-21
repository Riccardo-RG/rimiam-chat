import { useUiLanguage } from "../i18n";
import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type {
  activitySchema,
  ConversationReference,
} from "../../../src/contracts/activity";
import { useResource } from "../useResource";
import type { NativeRequest } from "../api";
import { Action, usePalette } from "../ui";
import { ToolRow } from "./ToolLayout";

export function ActivityRegister({
  request,
  path,
  onReference,
}: {
  request: NativeRequest;
  path: string;
  onReference: (r: ConversationReference) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [before, setBefore] = useState<string | null>(null),
    [open, setOpen] = useState<string | null>(null);
  const p = usePalette(),
    view = useResource<z.infer<typeof activitySchema>>(
      request,
      path +
        "/activity?limit=12" +
        (before ? "&before=" + encodeURIComponent(before) : ""),
    );
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: p.muted }}>
        {uiText("Obiettivi, decisioni e altri aggiornamenti dello spazio.")}
      </Text>
      {view.error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: p.text }}>
            {view.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={view.refresh} />
        </>
      ) : !view.value ? (
        <Text style={{ color: p.muted }}>
          {uiText("Caricamento del registro…")}
        </Text>
      ) : !view.value.events.length ? (
        <Text style={{ color: p.muted }}>
          {uiText("Nessun aggiornamento da mostrare.")}
        </Text>
      ) : null}
      {view.value?.events.map((e) => (
        <View key={e.eventId}>
          <ToolRow
            label={e.title}
            expanded={open === e.eventId}
            onPress={() => setOpen(open === e.eventId ? null : e.eventId)}
          />
          {open === e.eventId && (
            <View style={{ paddingVertical: 8, gap: 5 }}>
              <Text style={{ color: p.muted }}>
                {e.actorName} · {new Date(e.occurredAt).toLocaleString(locale)}
              </Text>
              <Text style={{ color: p.text }}>{e.summary}</Text>
              <Text style={{ color: p.muted }}>{e.qualification}</Text>
              <Action
                label={uiText("Apri il passaggio")}
                variant="quiet"
                onPress={() => onReference(e.reference)}
              />
            </View>
          )}
        </View>
      ))}
      {view.value?.next && (
        <Action
          label={uiText("Attività precedenti")}
          onPress={() => {
            setOpen(null);
            setBefore(view.value!.next);
          }}
        />
      )}
      {before && (
        <Action
          label={uiText("Torna alle più recenti")}
          onPress={() => {
            setOpen(null);
            setBefore(null);
          }}
        />
      )}
    </View>
  );
}
