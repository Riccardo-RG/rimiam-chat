"use client";

import { useUiLanguage } from "./ui-language";
import type { Command } from "@/contracts/commands";
import type { Snapshot } from "./types";

export function FileVisibilityButton({
  file,
  busy,
  command,
  action,
  libraryAudience,
}: {
  libraryAudience?: "personal" | "group";
  file: Snapshot["sources"][number];
  busy: boolean;
  command: (c: Command) => Promise<unknown>;
  action: (work: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useUiLanguage();
  if (
    !file.can_manage_visibility ||
    !file.document_version ||
    !file.visibility_version
  )
    return null;
  const withdrawn = file.withdrawn;
  const filename = file.filename ?? file.title;
  const label = t(
    withdrawn
      ? "Ripristina file"
      : libraryAudience === "group"
        ? "Rimuovi per tutti"
        : libraryAudience === "personal"
          ? "Rimuovi dai miei documenti"
          : "Ritira file",
  );
  return (
    <button
      type="button"
      className="quiet"
      disabled={busy}
      onClick={() => {
        const note =
          libraryAudience === "personal"
            ? withdrawn
              ? "Il file sarà di nuovo disponibile nei tuoi documenti."
              : "Il file verrà ritirato dai tuoi documenti. Potrai ripristinarlo da File ritirati."
            : withdrawn
              ? "Il file sarà di nuovo disponibile ai membri di questo spazio."
              : "In questo spazio nessuno potrà più aprire o scaricare questa versione. La chat e le citazioni già pubblicate restano nella cronologia. Puoi ripristinarla.";
        if (
          !window.confirm(t("{0} «{1}»?", label, filename) + "\n\n" + t(note))
        )
          return;
        void action(async () => {
          await command({
            type: withdrawn ? "document.restore" : "document.withdraw",
            sourceId: file.id,
            documentVersion: file.document_version!,
            expectedVisibilityVersion: file.visibility_version!,
          });
        });
      }}
    >
      {label}
    </button>
  );
}
