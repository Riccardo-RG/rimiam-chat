import type { Page } from "@playwright/test";
import { test, expect } from "./backend-fixture";
import {
  fillWorkspaceName,
  register,
  joinTestWorkspace,
  reloadWithSession,
  openWorkspacePanel,
  holdWorkspaceReadsAcrossCommand,
  openMessageComposer,
} from "./helpers";
import type { TasksView } from "../../src/contracts/tasks";

test("uno spunto del contesto diventa un’attività solo dopo il salvataggio della bozza", async ({
  page,
}) => {
  await register(page, "Ada", `spunto-${crypto.randomUUID()}@example.test`);
  const name = "Scelta preventivi";
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const workspace = new URL(page.url()).searchParams.get("workspace");
  const view = async (): Promise<TasksView> => {
    const response = await page.request.get(
      `/api/v1/workspaces/${workspace}/tasks`,
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const content = "Possiamo raccogliere preventivi?";
  await (await openMessageComposer(page)).fill(content);
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect
    .poll(async () => (await view()).suggestions.length)
    .toBeGreaterThan(0);
  const suggested = (await view()).suggestions[0];
  await openWorkspacePanel(page, "work");
  const region = page.getByRole("region", { name: "Da fare e promemoria" });
  const prepare = region
    .getByRole("button", { name: "Prepara bozza di attività" })
    .first();
  await expect(prepare).toBeHidden();
  await region.getByText(/Spunti dal contesto ·/).click();
  await prepare.click();
  await expect(region.getByLabel("Attività", { exact: true })).toHaveValue(
    suggested.subject,
  );
  await expect(region.getByLabel("Perimetro e aspettative")).toHaveValue(
    suggested.content,
  );
  expect((await view()).tasks).toHaveLength(0);
  await region
    .getByRole("button", { name: "Crea attività", exact: true })
    .click();
  await expect
    .poll(async () => (await view()).tasks)
    .toMatchObject([
      { candidateId: suggested.id, responsible: null, suggestedPerson: null },
    ]);
});

test("Tasks: explicit responsibility, one shared reminder in both chats, recurring schedule and reload", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const guest = await browser.newPage();
  try {
    await register(
      page,
      "Tasks Web",
      `tasks-${crypto.randomUUID()}@example.test`,
    );
    await fillWorkspaceName(page, "Tasks verification");
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tasks verification", exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, "Tasks verification", "Tasks Guest");
    await openWorkspacePanel(page, "work");
    const region = page.getByRole("region", { name: "Da fare e promemoria" });
    await expect(
      region.getByLabel("Attività", { exact: true }),
    ).not.toBeVisible();
    await expect(
      region.getByLabel("Quando", { exact: true }),
    ).not.toBeVisible();
    await region.getByText("Nuovo promemoria", { exact: true }).click();
    await region
      .getByLabel("Cosa vuoi ricordare?", { exact: true })
      .fill("Solo una bozza");
    await region.getByRole("button", { name: "Annulla", exact: true }).click();
    await expect(
      region.getByLabel("Quando", { exact: true }),
    ).not.toBeVisible();
    await region.getByText("Nuovo promemoria", { exact: true }).click();
    await expect(
      region.getByLabel("Cosa vuoi ricordare?", { exact: true }),
    ).toHaveValue("");
    await region.getByRole("button", { name: "Annulla", exact: true }).click();
    await expect(
      region.getByText("Non ci sono ancora promemoria.", { exact: true }),
    ).toBeVisible();
    await region.getByText("Nuova attività", { exact: true }).click();
    await region
      .getByLabel("Attività", { exact: true })
      .fill("Bozza di attività");
    await region.getByRole("button", { name: "Annulla", exact: true }).click();
    await region.getByText("Nuova attività", { exact: true }).click();
    await expect(region.getByLabel("Attività", { exact: true })).toHaveValue(
      "",
    );
    await region
      .getByLabel("Attività", { exact: true })
      .fill("Confrontare preventivi senza acquisti");
    await region
      .getByRole("button", { name: "Crea attività", exact: true })
      .click();
    const taskRow = region
      .locator("summary")
      .filter({ hasText: "Confrontare preventivi senza acquisti" });
    await taskRow.click();
    await expect(
      region.getByText("Responsabilità: Non assegnato", { exact: true }),
    ).toBeVisible();
    const workspace = new URL(page.url()).searchParams.get("workspace")!;
    const reads = await holdWorkspaceReadsAcrossCommand(
      page,
      workspace,
      "tasks",
      "task.accept",
      1,
    );
    try {
      const [captured] = await reads.captured();
      expect(captured.ok()).toBe(true);
      const before = (await captured.json()) as TasksView;
      const oldTask = before.tasks.find(
        (task) => task.title === "Confrontare preventivi senza acquisti",
      )!;
      expect(oldTask.responsible).toBeNull();
      await region
        .getByRole("button", { name: "Me ne occupo", exact: true })
        .click();
      const after = (await (await reads.refreshed()).json()) as TasksView;
      const accepted = after.tasks.find((task) => task.id === oldTask.id)!;
      expect(accepted.version).toBeGreaterThan(oldTask.version);
      expect(accepted.acceptedVersion).toBe(oldTask.version);
      expect(accepted.responsible).toBe(
        after.members.find((member) => member.name === "Tasks Web")!.id,
      );
      await expect(
        region.getByText(/Responsabilità: Tasks Web · accettata su v1/),
      ).toBeVisible();
      await reads.releaseStale();
      await expect(
        region.getByText(/Responsabilità: Tasks Web · accettata su v1/),
      ).toBeVisible();
      await expect(
        region.getByRole("button", { name: "Me ne occupo", exact: true }),
      ).not.toBeVisible();
    } finally {
      await reads.close();
    }
    await region
      .getByRole("button", { name: "Aggiungi promemoria", exact: true })
      .click();
    await expect(region.getByLabel("Tipo di promemoria")).toHaveValue("check");
    const dueLocal = await page.evaluate(() => {
      const time = new Date(Date.now() - 60_000);
      return new Date(time.valueOf() - time.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    });
    await region.getByLabel("Quando", { exact: true }).fill(dueLocal);
    const sharedText =
      "Promemoria: Verificare: Confrontare preventivi senza acquisti";
    const sharedReminder = (client: Page) =>
      client
        .getByRole("article", { name: "Emme", exact: true })
        .filter({ has: client.getByText(sharedText, { exact: true }) });
    await expect(sharedReminder(guest)).toHaveCount(0);
    await region
      .getByRole("button", { name: "Salva promemoria", exact: true })
      .click();
    await expect(sharedReminder(guest)).toHaveCount(1);
    await expect(sharedReminder(guest)).toBeVisible();
    const reminderRow = region
      .locator("summary")
      .filter({ hasText: "Verificare: Confrontare preventivi" });
    await reminderRow.click();
    await expect(
      region.getByText("Promemoria scattato", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
    await expect(sharedReminder(page)).toHaveCount(1);
    await expect(sharedReminder(page)).toBeVisible();
    await openWorkspacePanel(page, "work");
    const nextYear = new Date().getUTCFullYear() + 1;
    const recurringTitle = "Revisione settimanale del quaderno";
    await region.getByText("Nuovo promemoria", { exact: true }).click();
    await region.getByLabel("Cosa vuoi ricordare?").fill(recurringTitle);
    await expect(region.getByLabel("Ripeti", { exact: true })).toHaveValue(
      "once",
    );
    await region.getByLabel("Ripeti", { exact: true }).selectOption("weekly");
    await region.getByLabel("A partire da").fill(`${nextYear}-01-01T10:15`);
    await region
      .getByRole("button", { name: "Salva promemoria", exact: true })
      .click();
    await expect(region.getByRole("alert")).toHaveText(
      "Scegli almeno un giorno della settimana.",
    );
    await region.getByRole("checkbox", { name: "Lunedì", exact: true }).check();
    await region
      .getByRole("checkbox", { name: "Giovedì", exact: true })
      .check();
    await region
      .getByLabel("Fino al giorno incluso (facoltativo)")
      .fill(`${nextYear}-02-28`);
    await region
      .getByRole("button", { name: "Salva promemoria", exact: true })
      .click();
    const seriesSummary = region
      .locator("summary")
      .filter({ hasText: recurringTitle });
    await expect(seriesSummary).toBeVisible();
    await Promise.all([reloadWithSession(guest), reloadWithSession(page)]);
    await expect(sharedReminder(guest)).toHaveCount(1);
    await expect(sharedReminder(page)).toHaveCount(1);
    await openWorkspacePanel(page, "work");
    await seriesSummary.click();
    const series = seriesSummary.locator("..");
    await expect(series.getByText(/Lunedì, Giovedì alle 10:15/)).toContainText(
      `Fino al 28/02/${nextYear} incluso`,
    );
    await series
      .getByRole("button", { name: "Modifica promemoria", exact: true })
      .click();
    await expect(region.getByLabel("Ripeti", { exact: true })).toHaveValue(
      "weekly",
    );
    await expect(
      region.getByRole("checkbox", { name: "Giovedì", exact: true }),
    ).toBeChecked();
    await expect(
      region.getByLabel("Fino al giorno incluso (facoltativo)"),
    ).toHaveValue(`${nextYear}-02-28`);
    await region.getByRole("button", { name: "Annulla", exact: true }).click();
    await series
      .getByRole("button", { name: "Annulla la serie", exact: true })
      .click();
    await expect(seriesSummary).toContainText("Annullato");
    await taskRow.filter({ hasNotText: "Verificare:" }).click();
    await reminderRow.click();
    await expect(
      region.getByText(/Responsabilità: Tasks Web · accettata su v1/),
    ).toBeVisible();
    await region
      .getByRole("button", { name: "Segna come completata", exact: true })
      .click();
    await expect(region.getByText(/Completata · v3/)).toBeVisible();
    await expect(
      region.getByText("Da rivedere: accesso o riferimento cambiato", {
        exact: true,
      }),
    ).toBeVisible();
    const activityList = region.getByRole("region", {
      name: "Elenco delle attività",
    });
    await activityList
      .getByRole("button", { name: "Cronologia", exact: true })
      .click();
    await expect(
      activityList
        .getByRole("region", { name: "Cronologia delle modifiche" })
        .getByText("Versione 3", { exact: true }),
    ).toBeVisible();
  } finally {
    await guest.close();
  }
});

test("Task register: a named offer, comments, standby and completion stay in sync for two contributors", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(110000);
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const workspace = "Lancio · Registro attività",
    title = "Rivedere le schermate di accesso";
  const registerOf = (client: Page) =>
    client.getByRole("region", { name: "Elenco delle attività" });
  const rowOf = (client: Page) =>
    registerOf(client)
      .locator("details[data-schedule-id]")
      .filter({
        has: client.locator("summary strong").filter({ hasText: title }),
      });
  try {
    await register(page, "Giulia", `tasks-${crypto.randomUUID()}@example.test`);
    await fillWorkspaceName(page, workspace);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: workspace, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, workspace, "Matteo");
    await openWorkspacePanel(page, "work");
    const ownerRegister = registerOf(page);
    await ownerRegister.getByText("Nuova attività", { exact: true }).click();
    await ownerRegister.getByLabel("Attività", { exact: true }).fill(title);
    await ownerRegister
      .getByRole("button", { name: "Crea attività", exact: true })
      .click();
    const row = rowOf(page);
    await expect(
      ownerRegister.getByRole("button", {
        name: "Segna come completata: " + title,
      }),
    ).toBeVisible();
    await row.locator("summary").first().click();
    await row
      .getByLabel("Persona a cui proporre l’attività")
      .selectOption({ label: "Matteo" });
    await row.getByRole("button", { name: "Proponi incarico" }).click();
    await expect(row.locator("summary").first()).toContainText(
      "In attesa di Matteo",
    );
    await expect(row.getByRole("button", { name: "Me ne occupo" })).toHaveCount(
      0,
    );
    await openWorkspacePanel(guest, "work");
    const guestRow = rowOf(guest);
    await expect(guestRow.locator("summary").first()).toContainText(
      "In attesa di te",
    );
    await guestRow.locator("summary").first().tap();
    await expect(
      guestRow.getByText("Proposta da Giulia a Matteo."),
    ).toBeVisible();
    const text = "Ho verificato la prima schermata.";
    const sentComments: string[] = [];
    const commandPath = "**/api/v1/workspaces/*/commands";
    await page.route(commandPath, async (route) => {
      const command = route.request().postDataJSON();
      if (command.command.type !== "task.comment") return route.continue();
      sentComments.push(command.commandId);
      if (sentComments.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await row.getByLabel("Scrivi un commento").fill(text);
    await row.getByRole("button", { name: "Pubblica commento" }).click();
    await expect(
      row.getByRole("region", { name: "Commenti" }).getByRole("alert"),
    ).toBeVisible();
    await expect(row.getByLabel("Scrivi un commento")).toHaveValue(text);
    await row.getByRole("button", { name: "Pubblica commento" }).click();
    await expect(row.getByLabel("Scrivi un commento")).toHaveValue("");
    expect(sentComments).toEqual([sentComments[0], sentComments[0]]);
    await page.unroute(commandPath);
    await expect(
      guestRow
        .getByRole("region", { name: "Commenti" })
        .getByText(text, { exact: true }),
    ).toBeVisible();
    await guestRow.getByRole("button", { name: "Accetta incarico" }).tap();
    await expect(row.locator("summary").first()).toContainText("Matteo");
    await expect(row).toContainText(/Responsabilità: Matteo · accettata su v2/);
    await expect(
      row.getByRole("button", { name: "Segna come completata", exact: true }),
    ).toHaveCount(0);
    await guestRow.getByLabel("Stato", { exact: true }).selectOption("standby");
    await expect(row.locator("summary").first()).toContainText("In standby");
    await guest.screenshot({
      path: info.outputPath("task-standby-mobile.png"),
    });
    await guestRow
      .getByRole("button", { name: "Segna come completata", exact: true })
      .tap();
    await expect(row.locator("summary").first()).toContainText("Completata");
    await Promise.all([reloadWithSession(guest), reloadWithSession(page)]);
    await Promise.all([
      openWorkspacePanel(guest, "work"),
      openWorkspacePanel(page, "work"),
    ]);
    await expect(guestRow.locator("summary").first()).toContainText(
      "Completata",
    );
    await row.locator("summary").first().click();
    await expect(
      row
        .getByRole("region", { name: "Commenti" })
        .getByText(text, { exact: true }),
    ).toHaveCount(1);
    await expect(row.getByRole("region", { name: "Commenti" })).toContainText(
      "Giulia",
    );
  } finally {
    await guest.close();
  }
});
