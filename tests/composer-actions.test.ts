import { expect, it } from "vitest";
import {
  availableComposerActions,
  analysisDraft,
  launcherQuery,
} from "../src/client/composer-actions";
import { startObjective } from "../src/server/active-work-commands";

const full = { canInvite: true, canContribute: true };
it("publishes distinct real shortcuts and filters on independent contribution/invitation permissions", () => {
  const ids = (p: typeof full) =>
    availableComposerActions(p).map((action) => action.id);
  expect(new Set(ids(full)).size).toBe(ids(full).length);
  expect(availableComposerActions(full, "/task")[0].id).toBe("new-task");
  expect(
    availableComposerActions(full, "attivita").some(
      (action) => action.id === "activity",
    ),
  ).toBe(true);
  expect(
    availableComposerActions(full, "file condiviso").some(
      (action) => action.id === "documents",
    ),
  ).toBe(true);
  expect(ids({ ...full, canInvite: false })).not.toContain("invite");
  expect(ids({ canInvite: true, canContribute: false })).toContain("invite");
  expect(ids({ canInvite: true, canContribute: false })).not.toEqual(
    expect.arrayContaining(["upload"]),
  );
  expect(availableComposerActions(full, "indisponibile")).toEqual([]);
});
it("lists the collector once and resolves every exact shortcut to its own action", () => {
  const catalogue = availableComposerActions(full);
  const allShortcuts = catalogue.flatMap(({ shortcuts }) => shortcuts);
  expect(new Set(allShortcuts).size).toBe(allShortcuts.length);
  for (const { id, shortcuts } of catalogue) {
    for (const shortcut of shortcuts) {
      expect(launcherQuery("", shortcut)).toBe(shortcut.slice(1));
      expect(availableComposerActions(full, shortcut)[0].id).toBe(id);
    }
  }
  const reader = { canContribute: false, canInvite: false };
  const collectors = availableComposerActions(reader).filter((action) =>
    action.shortcuts.some((shortcut) =>
      ["/file", "/documenti"].includes(shortcut),
    ),
  );
  expect(collectors).toHaveLength(1);
  expect(collectors[0]).toMatchObject({
    id: "documents",
    shortcuts: ["/documenti", "/file"],
  });
  expect(availableComposerActions(reader, "/FILE")[0]?.id).toBe("documents");
  expect(launcherQuery("", "/file/note.md")).toBeNull();
  expect(launcherQuery("", "/file in bozza")).toBeNull();
  expect(availableComposerActions(full, "/analizza")[0].id).toBe("analyze");
  expect(availableComposerActions(full, "/ricerca")[0].id).toBe("research");
});
it("opens the same workspace task overview from both aliases without granting task creation to a reader", () => {
  const reader = { canContribute: false, canInvite: false };
  for (const shortcut of ["/dafare", "/lavoro"]) {
    const result = availableComposerActions(reader, shortcut)[0];
    expect(result).toMatchObject({
      id: "work",
      shortcuts: ["/dafare", "/lavoro"],
    });
  }
  expect(
    availableComposerActions(reader).some(({ id }) => id === "new-task"),
  ).toBe(false);
});
it("opens on an initial slash or exact pasted command, preserving paths, ordinary slashes and legacy feedback", () => {
  expect(launcherQuery("", "/")).toBe("");
  expect(launcherQuery("", "/contesto")).toBe("contesto");
  expect(launcherQuery("", "/feedback bene")).toBeNull();
  for (const text of [
    "alle 12/13",
    "/tmp/dati",
    "https://example.test",
    "/non-registrato",
  ])
    expect(launcherQuery("", text)).toBeNull();
  expect(launcherQuery("testo", "/")).toBeNull();
});

it("prepares analysis matching the real Active Work parser and keeps the user's objective", () => {
  const subject = "Confronta le due sedi\ncon il budget disponibile.";
  expect(analysisDraft("")).toBe("@Emme analizza: ");
  expect(startObjective(analysisDraft(""))).toBeUndefined();
  expect(startObjective(analysisDraft(subject))).toBe(subject);
  expect(analysisDraft(analysisDraft(subject))).toBe(analysisDraft(subject));
  expect(analysisDraft("@Emme " + subject)).toBe(analysisDraft(subject));
  expect(availableComposerActions(full, "/ricerca")[0].id).toBe("research");
  expect(
    availableComposerActions({ ...full, canContribute: false }).map(
      (a) => a.id,
    ),
  ).not.toContain("research");
  expect(
    availableComposerActions({ ...full, fieldHelpActive: true }).map(
      (a) => a.id,
    ),
  ).not.toContain("analyze");
});

it("finds the same permitted commands by English name, description or either language's shortcut", () => {
  const en = (query: string) => availableComposerActions(full, query, "en");
  expect(en("shared photos")[0]).toMatchObject({
    id: "documents",
    label: "Open shared files",
    shortcuts: ["/files", "/documents"],
  });
  expect(en("due dates")[0].id).toBe("work");
  expect(en("research")[0].id).toBe("research");
  expect(en("/analyze")[0].id).toBe("analyze");
  expect(en("/ricerca")[0].id).toBe("research");
  expect(availableComposerActions(full, "/research", "it")[0].id).toBe(
    "research",
  );
  expect(launcherQuery("", "/research")).toBe("research");
  expect(launcherQuery("", "/research/foo")).toBeNull();
  expect(
    availableComposerActions(
      { canContribute: false, canInvite: false },
      "/invite",
      "en",
    ),
  ).toEqual([]);
  expect(
    availableComposerActions(full, "", "en").every(
      (item) => item.label && item.description,
    ),
  ).toBe(true);
  const subject = "Compare the original notes.";
  expect(startObjective(analysisDraft(subject, "en"))).toBe(subject);
  expect(analysisDraft(analysisDraft(subject, "en"), "it")).toBe(
    "@Emme analyze: " + subject,
  );
});
