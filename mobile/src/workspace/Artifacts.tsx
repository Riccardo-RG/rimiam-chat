import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ConversationHandoff } from "../../../src/contracts/conversation-handoff";
import type { ArtifactBlock } from "../../../src/contracts/artifact-document";
import { artifactBlockSchema } from "../../../src/contracts/artifact-document";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationReference } from "../../../src/contracts/activity";
import { documentMarkdown } from "../../../src/shared/document-markdown";
import { Action, Field, usePalette } from "../ui";
import { Brief } from "./Brief";
import { shareBytes } from "../sharedFile";
import { describe, type Commands } from "./useCommands";
type Doc = Snapshot["artifactVersions"][number];
type Props = {
  state: Snapshot;
  actor: string;
  commands: Commands;
  canWrite: boolean;
  startNew?: boolean;
  onRef: (ref: ConversationReference) => void;
};
function next<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((i) => i !== v) : [...list, v];
}
const blockLabels: Record<ArtifactBlock["type"], string> = {
  paragraph: "Testo",
  heading: "Sezione",
  checklist: "Checklist",
  table: "Tabella",
  image: "Immagine",
};
type Choice = { type: ArtifactBlock["type"]; text: string; source: string };
function blockValue(d: Choice): ArtifactBlock | null {
  const text = d.text.trim();
  let value: ArtifactBlock;
  switch (d.type) {
    case "heading":
    case "paragraph":
      value = { type: d.type, text };
      break;
    case "image":
      value = { type: "image", sourceId: d.source, alt: text, caption: "" };
      break;
    case "table": {
      const [columns, ...rows] = text
        .split("\n")
        .map((r) => r.split("|").map((s) => s.trim()));
      if (
        !columns?.some(Boolean) ||
        rows.some((r) => r.length !== columns.length)
      )
        return null;
      value = { type: "table", columns, rows };
      break;
    }
    case "checklist":
      value = {
        type: "checklist",
        items: text
          .split("\n")
          .filter((s) => s.trim())
          .map((s) => ({
            text: s.replace(/^\[[xX ]\]\s*/, "").trim(),
            checked: /^\[[xX]\]/.test(s),
          })),
      };
      break;
  }
  return artifactBlockSchema.safeParse(value).success ? value : null;
}
export function Artifacts({
  state,
  actor,
  commands,
  canWrite,
  onRef,
  startNew = false,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    [selected, setSelected] = useState<{ id: string; version: number } | null>(
      null,
    ),
    [create, setCreate] = useState(canWrite && startNew),
    [brief, setBrief] = useState<{ base?: Doc } | null>(null),
    [review, setReview] = useState(false),
    [people, setPeople] = useState<string[]>([]),
    [error, setError] = useState("");
  const busy = commands.working || !commands.ready || !!commands.pending;
  const doc = state.artifacts.find((a) => a.id === selected?.id),
    v = state.artifactVersions.find(
      (x) => x.artifact_id === selected?.id && x.version === selected?.version,
    );
  const adoption = state.artifactAdoptions.find(
      (x) => x.id === doc?.current_adoption_id,
    ),
    adoptedReview = state.artifactReviews.find(
      (x) => x.id === adoption?.review_id,
    );
  const reviews = state.artifactReviews.filter(
    (x) =>
      x.artifact_id === doc?.id &&
      x.artifact_version === v?.version &&
      x.previous_adoption_id === doc?.current_adoption_id,
  );
  const isCurrent =
    !!v &&
    doc?.current_draft_version === v.version &&
    !v.outdated_reasons.length;
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante storico";
  const effectivePeople = adoptedReview?.people ?? people;
  function choose(v: Doc) {
    setSelected({ id: v.artifact_id, version: v.version });
    setReview(false);
    setPeople([]);
    setError("");
  }
  async function exportCopy(v: Doc) {
    try {
      await shareBytes(
        new TextEncoder().encode(documentMarkdown(v.title, v.body, v.blocks)),
        v.title + "-v" + v.version + ".md",
        "text/markdown",
      );
    } catch (e) {
      setError(describe(e));
    }
  }
  if (brief)
    return (
      <Brief
        state={state}
        commands={commands}
        base={brief.base}
        onClose={() => {
          setBrief(null);
          setSelected(null);
        }}
      />
    );
  if (create)
    return (
      <Composer
        state={state}
        commands={commands}
        onClose={() => setCreate(false)}
      />
    );
  if (!v || !doc)
    return (
      <View style={{ gap: 7 }}>
        {canWrite && (
          <Action
            label={uiText("Nuovo documento")}
            onPress={() => setCreate(true)}
          />
        )}
        {canWrite &&
          state.questions.length > 0 &&
          state.information.length > 0 && (
            <Action
              label={uiText("Prepara un brief")}
              onPress={() => setBrief({})}
            />
          )}
        {!state.artifacts.length && (
          <Text style={{ color: p.muted }}>
            {uiText("Nessun documento di lavoro.")}
          </Text>
        )}
        {state.artifacts.map((a) => {
          const current = state.artifactVersions.find(
            (v) =>
              v.artifact_id === a.id && v.version === a.current_draft_version,
          );
          return (
            current && (
              <Action
                key={a.id}
                label={uiText(
                  "{0} · v{1}",
                  String(current.title),
                  String(current.version),
                )}
                onPress={() => choose(current)}
              />
            )
          );
        })}
      </View>
    );
  return (
    <View style={{ gap: 7 }}>
      <Action label={uiText("‹ Documenti")} onPress={() => setSelected(null)} />
      <Text style={{ color: p.text, fontSize: 20, fontWeight: "700" }}>
        {v.title}
      </Text>
      <Text style={{ color: p.muted }}>
        {uiText("v")}
        {v.version} · {name(v.authored_by)} ·{" "}
        {adoptedReview?.artifact_version === v.version
          ? uiText("Adottato come documento di lavoro")
          : uiText("Bozza")}
        {v.outdated_reasons.length ? uiText(" · Da rivalutare") : ""}
      </Text>
      {canWrite && v.question_id && v.version === doc.current_draft_version && (
        <Action
          label={uiText("Prepara nuova versione del brief")}
          onPress={() => setBrief({ base: v })}
        />
      )}
      {v.purpose && <Text style={{ color: p.muted }}>{v.purpose}</Text>}
      <Text selectable style={{ color: p.text, fontSize: 17 }}>
        {v.blocks?.length
          ? documentMarkdown(v.title, v.body, v.blocks)
              .split("\n")
              .slice(2)
              .join("\n")
          : v.body}
      </Text>
      {(v.blocks ?? [])
        .filter((b) => b.type === "image")
        .map((b, i) => (
          <Action
            key={i}
            label={uiText("Apri immagine · {0}", String(b.alt))}
            onPress={() =>
              onRef({ kind: "source", id: b.sourceId, version: 1 })
            }
          />
        ))}
      <Action
        label={uiText("Esporta copia modificabile")}
        onPress={() => void exportCopy(v)}
      />
      {!!error && <Text style={{ color: p.muted }}>{error}</Text>}
      {state.artifactInformation
        .filter(
          (i) => i.artifact_id === doc.id && i.artifact_version === v.version,
        )
        .map((i) => (
          <Action
            key={i.information_id}
            label={uiText(
              "{0} · v{1}",
              String(
                state.information.find((x) => x.id === i.information_id)
                  ?.subject ?? "Riferimento",
              ),
              String(i.information_version),
            )}
            onPress={() =>
              onRef({
                kind: "information",
                id: i.information_id,
                version: i.information_version,
              })
            }
          />
        ))}
      {state.artifactSources
        .filter(
          (s) => s.artifact_id === doc.id && s.artifact_version === v.version,
        )
        .map((s) => (
          <Action
            key={s.source_id}
            label={
              state.sources.find((x) => x.id === s.source_id)?.title ??
              uiText("Fonte originale")
            }
            onPress={() =>
              onRef({ kind: "source", id: s.source_id, version: 1 })
            }
          />
        ))}
      {state.artifactVersions
        .filter(
          (other) =>
            other.artifact_id === doc.id && other.version !== v.version,
        )
        .map((other) => (
          <Action
            key={other.version}
            label={uiText("Apri versione {0}", String(other.version))}
            onPress={() => choose(other)}
          />
        ))}
      {canWrite &&
        isCurrent &&
        !state.workspace.personal &&
        adoptedReview?.artifact_version !== v.version && (
          <Action
            label={
              review
                ? uiText("Chiudi richiesta")
                : uiText("Richiedi adozione di questa versione")
            }
            onPress={() => setReview(!review)}
          />
        )}
      {review && isCurrent && (
        <>
          {adoptedReview ? (
            <Text style={{ color: p.text }}>
              {uiText("Persone della versione adottata ·")}{" "}
              {effectivePeople.map(name).join(", ")}
            </Text>
          ) : (
            state.members
              .filter((m) => m.active && m.contributes)
              .map((m) => (
                <Action
                  key={m.user_id}
                  label={m.name}
                  primary={people.includes(m.user_id)}
                  onPress={() => setPeople(next(people, m.user_id))}
                />
              ))
          )}
          <Action
            label={uiText("Invia richiesta di adozione")}
            disabled={busy || !effectivePeople.length}
            onPress={() =>
              Alert.alert(
                uiText(
                  "Proporre l’adozione della versione {0}?",
                  String(v.version),
                ),
                uiText(
                  "{0}\n{1}\nCiascuno dovrà confermare l’uso di questo documento di lavoro.",
                  String(v.title),
                  String(effectivePeople.map(name).join(", ")),
                ),
                [
                  { text: uiText("Annulla"), style: "cancel" },
                  {
                    text: uiText("Proponi"),
                    onPress: () =>
                      void commands
                        .send({
                          kind: "command",
                          label: "Richiedi adozione",
                          command: {
                            type: "artifact.review",
                            artifactId: doc.id,
                            version: v.version,
                            people: effectivePeople,
                            nonOperative: true,
                          },
                        })
                        .then((ok) => {
                          if (ok) setReview(false);
                        }),
                  },
                ],
              )
            }
          />
        </>
      )}
      {reviews.map((r) => {
        const approvals = state.artifactApprovals.filter(
          (a) =>
            a.review_id === r.id &&
            a.access_revision === state.workspace.access_revision,
        );
        return (
          <View style={{ gap: 4 }} key={r.id}>
            <Text style={{ color: p.muted }}>
              {uiText("Richiesta di ")}
              {name(r.proposed_by)}
            </Text>
            {r.people.map((person) => (
              <Text key={person} style={{ color: p.text }}>
                {name(person)} ·{" "}
                {approvals.some((a) => a.person_id === person)
                  ? uiText("ha approvato")
                  : uiText("in attesa")}
              </Text>
            ))}
            {canWrite &&
              isCurrent &&
              r.people.includes(actor) &&
              !approvals.some((a) => a.person_id === actor) && (
                <Action
                  label={uiText("Approva per te la v{0}", String(v.version))}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      uiText("Adottare questa versione?"),
                      uiText(
                        "{0} · v{1}\nQuesta approvazione personale riguarda il documento di lavoro.",
                        String(v.title),
                        String(v.version),
                      ),
                      [
                        { text: uiText("Annulla"), style: "cancel" },
                        {
                          text: uiText("Approvo"),
                          onPress: () =>
                            void commands.send({
                              kind: "command",
                              label: "Approvazione documento",
                              command: {
                                type: "artifact.approve",
                                reviewId: r.id,
                                expectedAccessRevision:
                                  state.workspace.access_revision,
                                representSelf: true,
                                nonOperative: true,
                              },
                            }),
                        },
                      ],
                    )
                  }
                />
              )}
          </View>
        );
      })}
    </View>
  );
}
export function Composer({
  state,
  commands,
  onClose,
  handoff,
}: {
  state: Snapshot;
  commands: Commands;
  onClose: () => void;
  handoff?: ConversationHandoff;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    [title, setTitle] = useState(handoff?.summary.slice(0, 160) ?? ""),
    [purpose, setPurpose] = useState(handoff?.summary ?? ""),
    [blocks, setBlocks] = useState<ArtifactBlock[]>([]),
    [draft, setDraft] = useState<Choice>({
      type: "paragraph",
      text: handoff?.suggestedText ?? "",
      source: "",
    }),
    [info, setInfo] = useState<{ id: string; version: number }[]>([]),
    [sources, setSources] = useState<string[]>(handoff?.sourceIds ?? []),
    [references, setReferences] = useState(false);
  const value = blockValue(draft),
    busy = commands.working || !!commands.pending || !commands.ready;
  const submitted = value ? [...blocks, value] : blocks;
  const stale =
    info.some(
      (ref) =>
        !state.information.some(
          (i) => i.id === ref.id && i.current_version === ref.version,
        ),
    ) ||
    sources.some(
      (id) =>
        !state.sources.some((s) => s.id === id && !s.withdrawn) &&
        !state.messages.some((m) => m.id === id),
    );
  return (
    <View style={{ gap: 8 }}>
      <Action
        label={uiText("Chiudi creazione")}
        onPress={() => {
          if (!title && !draft.text && !blocks.length) onClose();
          else
            Alert.alert(
              uiText("Chiudere la bozza?"),
              uiText(
                "I contenuti non salvati su questo dispositivo verranno scartati.",
              ),
              [
                { text: uiText("Continua"), style: "cancel" },
                {
                  text: uiText("Scarta"),
                  style: "destructive",
                  onPress: onClose,
                },
              ],
            );
        }}
      />
      <Field
        label={uiText("Titolo")}
        value={title}
        onChangeText={setTitle}
        maxLength={160}
      />
      <Field
        label={uiText("Scopo (facoltativo)")}
        value={purpose}
        onChangeText={setPurpose}
        maxLength={2000}
      />
      {blocks.map((b, i) => (
        <View key={i} style={{ gap: 4 }}>
          <Text numberOfLines={2} style={{ color: p.text }}>
            {uiText(blockLabels[b.type])} ·{" "}
            {documentMarkdown("", "", [b]).trim().slice(1).trim()}
          </Text>
          <Action
            label={uiText("Rimuovi blocco")}
            onPress={() => setBlocks(blocks.filter((_, n) => n !== i))}
          />
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
        {(Object.keys(blockLabels) as ArtifactBlock["type"][]).map((type) => (
          <Action
            key={type}
            label={uiText(blockLabels[type])}
            primary={draft.type === type}
            onPress={() => setDraft({ ...draft, type })}
          />
        ))}
      </View>
      {draft.type === "image" &&
        state.sources
          .filter((s) => !s.withdrawn && s.media_type?.startsWith("image/"))
          .map((s) => (
            <Action
              key={s.id}
              label={s.filename ?? s.title}
              primary={draft.source === s.id}
              onPress={() => setDraft({ ...draft, source: s.id })}
            />
          ))}
      <Field
        label={
          draft.type === "table"
            ? uiText("Una riga per volta, colonne separate da |")
            : draft.type === "checklist"
              ? uiText("Una voce per riga")
              : draft.type === "image"
                ? uiText("Descrizione dell’immagine")
                : uiText("Testo del blocco")
        }
        multiline
        value={draft.text}
        onChangeText={(text) => setDraft({ ...draft, text })}
        maxLength={24000}
      />
      <Action
        label={uiText("Aggiungi altro blocco")}
        disabled={!value || blocks.length >= 99}
        onPress={() => {
          if (value) {
            setBlocks([...blocks, value]);
            setDraft({ type: "paragraph", text: "", source: "" });
          }
        }}
      />
      <Action
        label={
          references
            ? uiText("Chiudi riferimenti")
            : uiText("Collega fonti e riferimenti")
        }
        onPress={() => setReferences(!references)}
      />
      {references && (
        <>
          {state.information.map((i) => (
            <Action
              key={i.id}
              label={uiText(
                "{0} · v{1}",
                String(i.subject),
                String(i.current_version),
              )}
              primary={info.some((r) => r.id === i.id)}
              onPress={() =>
                setInfo(
                  info.some((r) => r.id === i.id)
                    ? info.filter((r) => r.id !== i.id)
                    : [...info, { id: i.id, version: i.current_version }],
                )
              }
            />
          ))}
          {state.sources
            .filter((s) => !s.withdrawn)
            .map((s) => (
              <Action
                key={s.id}
                label={s.title}
                primary={sources.includes(s.id)}
                onPress={() => setSources(next(sources, s.id))}
              />
            ))}
        </>
      )}
      {stale && (
        <Text style={{ color: p.text }}>
          {uiText(
            "Un riferimento è cambiato. Rimuovilo e seleziona quello attuale.",
          )}
        </Text>
      )}
      <Action
        label={uiText(
          state.workspace.personal
            ? "Salva documento"
            : "Salva bozza condivisa",
        )}
        primary
        disabled={
          busy ||
          stale ||
          !title.trim() ||
          !submitted.length ||
          (!value && !!draft.text.trim())
        }
        onPress={() =>
          void commands
            .send({
              kind: "command",
              label: "Crea documento",
              command: {
                type: "artifact.compose",
                ...(handoff
                  ? { conversationOrigin: { handoffId: handoff.id } }
                  : {}),
                title: title.trim(),
                purpose: purpose.trim() || "Documento di lavoro",
                blocks: submitted,
                information: info,
                sourceIds: [
                  ...new Set([
                    ...sources,
                    ...submitted
                      .filter((b) => b.type === "image")
                      .map((b) => b.sourceId),
                  ]),
                ],
                reason: state.workspace.personal
                  ? "Creazione del documento personale"
                  : "Creazione del documento condiviso",
                nonOperative: true,
              },
            })
            .then((ok) => {
              if (ok) onClose();
            })
        }
      />
    </View>
  );
}
