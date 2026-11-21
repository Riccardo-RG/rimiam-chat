import { useUiLanguage } from "../i18n";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { PersonalContacts } from "../../../src/contracts/v1";
import type { NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import { useResource } from "../useResource";
import { Panel } from "./SharedFiles";

export type ContactChoice = Pick<
  PersonalContacts["contacts"][number],
  "id" | "name"
>;
export function ContactPicker({
  request,
  excluded,
  onSelect,
  onClose,
}: {
  request: NativeRequest;
  excluded?: ReadonlySet<string>;
  onSelect: (contact: ContactChoice) => void;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [query, setQuery] = useState("");
  return (
    <Panel title={uiText("I tuoi contatti")} onClose={onClose}>
      <Field
        label={uiText("Cerca un contatto")}
        value={query}
        onChangeText={setQuery}
      />
      <ScrollView keyboardShouldPersistTaps="handled">
        <ContactResults
          request={request}
          excluded={excluded}
          query={query}
          onSelect={onSelect}
        />
      </ScrollView>
    </Panel>
  );
}

export function ContactResults({
  request,
  excluded,
  query,
  onSelect,
}: {
  request: NativeRequest;
  excluded?: ReadonlySet<string>;
  query: string;
  onSelect: (contact: ContactChoice) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const [search, setSearch] = useState(query.trim());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useResource<PersonalContacts>(
    request,
    "/api/v1/contacts?q=" + encodeURIComponent(search) + "&offset=" + offset,
  );
  const visible =
    query.trim() === search
      ? result.value?.contacts.filter((person) => !excluded?.has(person.id))
      : undefined;
  return (
    <View style={{ gap: 2, alignItems: "flex-start" }}>
      {visible?.map((person) => (
        <Action
          key={person.id}
          variant="quiet"
          icon="people"
          label={
            person.name +
            (person.nameAmbiguous ? " · omonimo, usa l’email" : "")
          }
          disabled={person.nameAmbiguous}
          onPress={() => onSelect({ id: person.id, name: person.name })}
        />
      ))}
      {result.error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: c.text }}>
            {result.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={result.refresh} />
        </>
      ) : visible === undefined ? (
        <Text style={{ color: c.muted }}>
          {uiText("Caricamento contatti…")}
        </Text>
      ) : visible.length === 0 ? (
        <Text style={{ color: c.muted }}>
          {uiText("Nessun contatto disponibile in questa pagina.")}
        </Text>
      ) : null}
      {offset > 0 && (
        <Action
          label={uiText("Precedenti")}
          onPress={() => setOffset(Math.max(0, offset - 30))}
        />
      )}
      {visible && result.value?.nextOffset != null && (
        <Action
          label={uiText("Altri contatti")}
          onPress={() => setOffset(result.value!.nextOffset!)}
        />
      )}
    </View>
  );
}
