import { Text } from "react-native";
import { conversationReferenceSchema } from "../../../src/contracts/activity";
import type { ConsultationRef } from "../../../src/contracts/private-consultation";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";
import { useUiLanguage } from "../i18n";
import { usePalette } from "../ui";
import { Panel, ReferencePanel } from "../workspace/SharedFiles";
import { EvidencePanel } from "../workspace/Consultation";
import { workspacePath } from "../workspace/commands";

export function ConsultedSource({
  request,
  target,
  entry,
  onClose,
  onSource,
}: {
  request: NativeRequest;
  target: string;
  entry: ConsultationRef;
  onClose: () => void;
  onSource: (id: string) => void;
}) {
  const path = workspacePath(target);
  const c = usePalette(),
    { t } = useUiLanguage();
  const candidates = useResource<Pick<Snapshot, "candidates">>(
    request,
    path + "/workspace",
    0,
    entry.kind === "candidate" && entry.version === 1,
  );
  if (
    entry.kind === "temporal_commitment" ||
    (entry.kind === "candidate" && candidates.value)
  ) {
    return (
      <EvidencePanel
        request={request}
        path={path}
        candidates={candidates.value?.candidates}
        entry={entry}
        onClose={onClose}
        onSource={onSource}
      />
    );
  }
  const ref = conversationReferenceSchema.safeParse({
    kind: entry.kind,
    id: entry.id,
    version: entry.version,
  });
  if (ref.success)
    return (
      <ReferencePanel
        request={request}
        path={path}
        refValue={ref.data}
        onClose={onClose}
      />
    );
  return (
    <Panel title={entry.label} onClose={onClose}>
      <Text style={{ color: c.muted }}>
        {candidates.error ||
          (entry.kind === "candidate" && entry.version === 1
            ? t("Caricamento…")
            : t("La versione citata non è disponibile."))}
      </Text>
    </Panel>
  );
}
