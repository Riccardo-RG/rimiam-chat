import { readFileSync, writeFileSync } from "node:fs";
import { availableComposerActions } from "../../src/shared/composer-actions";

const permissions = { canInvite: true, canContribute: true };
const local = availableComposerActions(permissions);
const english = availableComposerActions(permissions, "", "en");
const entries = local.map((entry, index) => ({
  id: entry.id,
  label: entry.label,
  englishLabel: english[index].label,
  shortcuts: entry.shortcuts,
  english: english[index].shortcuts,
  keywords: [entry.keywords, english[index].label].filter(Boolean).join(" "),
  needs: entry.needs ?? null,
}));
const file = new URL("../assets/workspace_actions.json", import.meta.url);
const json = JSON.stringify(entries, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== json)
    throw new Error("Rigenera il catalogo Flutter con tool/sync_composer_actions.ts");
} else {
  writeFileSync(file, json);
}
