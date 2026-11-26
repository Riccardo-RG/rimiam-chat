import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  openWithSession,
  fillWorkspaceName,
  register,
  openWorkspacePanel,
} from "./helpers";

test("Home separates the private configuration from the agent chosen for a new space", async ({
  page,
}) => {
  await register(page, "Giulia", randomUUID() + "@example.test");
  const personal = page.getByRole("region", { name: "Personale", exact: true });
  await personal.getByRole("button", { name: "Configura Emme" }).click();
  const panel = page.getByRole("dialog", { name: "Configura Emme" });
  await expect(panel.getByLabel("Modello o agente")).toHaveValue("default");
  await expect(
    panel.getByRole("option", { name: /Modello senza chiave/ }),
  ).toBeDisabled();
  await panel.getByLabel("Nome dell’assistente").fill("Luce");
  await expect(panel.getByLabel("Istruzioni personali")).toBeEmpty();
  await panel
    .getByLabel("Istruzioni personali")
    .fill("Answer in two sentences.");
  await panel.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(panel.getByRole("status")).toHaveText("Impostazioni salvate.");
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: /Scarica le istruzioni salvate/ })
    .click();
  const download = await downloading;
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "Answer in two sentences.",
  );
  await panel.getByRole("button", { name: "Chiudi" }).click();
  if (!(await page.getByLabel("Nuovo spazio", { exact: true }).isVisible()))
    await page
      .getByRole("button", { name: "Crea un nuovo spazio", exact: true })
      .click();
  await fillWorkspaceName(page, "Studio condiviso");
  await page
    .getByLabel("Modello o agente dello spazio")
    .selectOption("test-agent");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Studio condiviso", exact: true }),
  ).toBeVisible();
  await openWithSession(page, "/");
  await expect(
    page.getByRole("region", { name: "Elenco degli spazi disponibili" }),
  ).toContainText("Agente di prova");
  await personal.getByRole("button", { name: "Configura Emme" }).click();
  await expect(panel.getByLabel("Modello o agente")).toHaveValue("default");
  await expect(panel.getByLabel("Nome dell’assistente")).toHaveValue("Luce");
  const scopeSelector = panel.getByLabel("Conversazione da configurare");
  const space = await scopeSelector
    .getByRole("option", { name: /Studio condiviso/ })
    .getAttribute("value");
  expect(space).toBeTruthy();
  await scopeSelector.selectOption(space!);
  await expect(panel.getByLabel("Modello o agente")).toHaveValue("test-agent");
  await expect(panel.getByLabel("Nome dell’assistente")).toHaveValue("Emme");
  const guide = panel.getByLabel("Istruzioni dello spazio");
  const save = panel.getByRole("button", { name: "Salva impostazioni" });
  await expect(guide).toBeEmpty();
  await expect(
    panel.getByText(/^Il ritmo in Attività e argomenti/),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await panel
    .getByText("Istruzioni predefinite di RIMIAM", { exact: true })
    .click();
  await expect(
    panel.getByText(/Speak naturally in the language/).first(),
  ).toBeVisible();
  await guide.fill("Always mention the next design milestone.");
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Impostazioni salvate.");
  await scopeSelector.selectOption("");
  await expect(panel.getByLabel("Istruzioni personali")).toHaveValue(
    "Answer in two sentences.",
  );
  await scopeSelector.selectOption(space!);
  await expect(guide).toHaveValue("Always mention the next design milestone.");
  await panel
    .getByRole("button", { name: "Usa le istruzioni predefinite" })
    .click();
  await expect(guide).toBeEmpty();
  await expect(panel.getByLabel("Modello o agente")).toHaveValue("test-agent");
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Impostazioni salvate.");
  await expect(save).toBeDisabled();
  await scopeSelector.selectOption("");
  await expect(panel.getByLabel("Istruzioni personali")).toHaveValue(
    "Answer in two sentences.",
  );
});

test("the shared participation setting survives reopening the workspace on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, "Ada", randomUUID() + "@example.test");
  const name = "Ritmo " + randomUUID();
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const openRhythm = async () => {
    await openWorkspacePanel(page, "attention", { dock: false });
    await page.getByText("Il ritmo di Emme", { exact: true }).click();
  };
  await openRhythm();
  const setting = page.getByLabel("Preferenza condivisa");
  await expect(setting).toHaveValue("discreet");
  await setting.selectOption("proactive");
  await expect(
    page.getByText(
      "Può anche segnalare un rischio concreto indicando la fonte.",
    ),
  ).toBeVisible();
  await page.reload();
  await openRhythm();
  await expect(setting).toHaveValue("proactive");
});
