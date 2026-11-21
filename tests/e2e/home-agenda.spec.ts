import { test, expect, devices } from "@playwright/test";
import { register, joinTestWorkspace } from "./helpers";
test.use({
  contextOptions: async ({ browserName }, provide) => {
    await provide(browserName === "webkit" ? devices["iPhone 13 Pro"] : {});
  },
});
test("crea e ritrova promemoria e appuntamenti dalla Home anche a Oggi chiuso", async ({
  page,
}) => {
  const key = crypto.randomUUID();
  await register(page, "Prova agenda", "agenda-" + key + "@example.test");
  const agenda = page.getByRole("region", { name: "Agenda personale" });
  await expect(agenda).toBeVisible();
  const toggle = agenda.getByRole("button", { name: /^Oggi/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const openNavigation = page.getByRole("button", { name: "Apri navigazione" });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page
    .getByRole("navigation", { name: "Navigazione personale" })
    .getByRole("button", { name: "Oggi", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#oggi$/);
  await expect(
    page.getByRole("heading", { name: "Oggi", exact: true }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await agenda
    .getByRole("button", { name: "Nuovo promemoria", exact: true })
    .click();
  await expect(agenda.getByLabel("Destinazione")).toHaveValue("");
  await agenda.getByLabel("Cosa ricordare").fill("Mandare la bozza");
  const date = "2033-11-28";
  const selectDate = async () => {
    await agenda
      .getByRole("button", { name: "Calendario", exact: true })
      .click();
    await agenda.getByLabel("Scegli giorno").fill(date);
  };
  await agenda.getByLabel("Quando", { exact: true }).fill(date + "T23:51");
  await agenda.getByLabel("Ripeti", { exact: true }).selectOption("daily");
  await agenda.getByRole("button", { name: "Salva promemoria" }).click();
  await expect(agenda.getByLabel("Cosa ricordare")).toHaveCount(0);
  await toggle.click();
  await selectDate();
  await expect(
    agenda.getByText("Mandare la bozza", { exact: true }),
  ).toBeVisible();
  await agenda.getByRole("button", { name: "Nuovo appuntamento" }).click();
  await agenda
    .getByLabel("Titolo", { exact: true })
    .fill("Rivedere il progetto");
  await agenda.getByLabel("Inizio", { exact: true }).fill(date + "T23:00");
  await agenda.getByLabel("Fine", { exact: true }).fill(date + "T23:10");
  await agenda.getByRole("button", { name: "Salva appuntamento" }).click();
  await expect(
    agenda.getByText("Rivedere il progetto", { exact: true }),
  ).toBeVisible();
  await agenda
    .getByRole("combobox", { name: "Mostra", exact: true })
    .selectOption("spaces");
  await expect(
    agenda.getByText("Nessun impegno per questa giornata."),
  ).toBeVisible();
  await agenda
    .getByRole("combobox", { name: "Mostra", exact: true })
    .selectOption("all");
  await agenda.getByText("Mandare la bozza", { exact: true }).click();
  await agenda.getByRole("button", { name: "Modifica", exact: true }).click();
  const scope = agenda.getByLabel("Applica a");
  await expect(scope).toHaveValue("only");
  await agenda.getByLabel("Cosa ricordare").fill("Revisione finale");
  await agenda.getByRole("button", { name: "Salva promemoria" }).click();
  await expect(
    agenda.getByText("Revisione finale", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await selectDate();
  await expect(
    agenda.getByText("Revisione finale", { exact: true }),
  ).toBeVisible();
});

test("a named appointment reaches its invitee and a task answer updates the original line for both members", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const guest = await browser.newPage();
  try {
    const project = "Agenda di due persone";
    await register(page, "Lina", crypto.randomUUID() + "@example.test");
    const headers = { Origin: new URL(page.url()).origin };
    const created = await page.request.post("/api/v1/workspaces", {
      headers,
      data: { name: project, commandId: crypto.randomUUID() },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = await created.json();
    await page.goto("/?workspace=" + id);
    await joinTestWorkspace(page, guest, project, "Elena");
    const who = await (await guest.request.get("/api/auth/get-session")).json();
    const title = "Revisione finale",
      offer = "Inviare i materiali";
    await page.goto("/");
    const calendar = page.getByRole("region", { name: "Agenda personale" });
    await calendar.getByRole("button", { name: "Nuovo appuntamento" }).click();
    await calendar.getByLabel("Destinazione").selectOption(id);
    await calendar
      .getByRole("combobox", { name: "Invitati", exact: true })
      .selectOption("people");
    await calendar
      .getByRole("checkbox", { name: "Elena", exact: true })
      .check();
    await calendar.getByLabel("Titolo", { exact: true }).fill(title);
    await calendar
      .getByLabel("Inizio", { exact: true })
      .fill("2032-11-07T09:00");
    await calendar.getByLabel("Fine", { exact: true }).fill("2032-11-07T10:00");
    await calendar.getByRole("button", { name: "Salva appuntamento" }).click();
    await expect(calendar.getByLabel("Titolo", { exact: true })).toHaveCount(0);
    const task = await page.request.post(
      "/api/v1/workspaces/" + id + "/commands",
      {
        headers,
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "task.create",
            content: {
              title: offer,
              description: "Pdf del preventivo",
              dueAt: "2032-11-07T10:00:00Z",
              timeZone: "UTC",
              suggestedPerson: who.user.id,
              references: [],
            },
          },
        },
      },
    );
    expect(task.ok(), await task.text()).toBe(true);
    await guest.goto("/");
    const agenda = guest.getByRole("region", { name: "Agenda personale" });
    await expect(agenda.getByText(new RegExp(offer + " · "))).toBeVisible();
    await agenda
      .getByRole("button", { name: "Calendario", exact: true })
      .click();
    await agenda.getByLabel("Scegli giorno").fill("2032-11-07");
    const event = agenda
      .locator("details")
      .filter({ has: guest.getByText(title, { exact: true }) });
    await expect(event).toContainText("Da confermare");
    await event.locator("summary").click();
    await event.getByRole("button", { name: "Accetta", exact: true }).click();
    await expect(event).not.toContainText("Da confermare");
    await calendar
      .getByRole("button", { name: "Calendario", exact: true })
      .click();
    await calendar.getByLabel("Scegli giorno").fill("2032-11-07");
    await expect(
      calendar.getByText("Nessun impegno per questa giornata."),
    ).toBeVisible();
    await expect(calendar.getByText(title, { exact: true })).toHaveCount(0);
    await guest.goto("/?workspace=" + id);
    await page.goto("/beta");
    await page
      .getByRole("combobox", { name: "Lingua", exact: true })
      .selectOption("en");
    await page.goto("/?workspace=" + id);
    const line = guest.locator(".task-offer-line"),
      senderLine = page.locator(".task-offer-line");
    await expect(line).toContainText("Proposta per Elena");
    await expect(senderLine).toContainText("Offered to Elena");
    await line.locator("summary").click();
    await expect(line).toContainText("Pdf del preventivo");
    await line.getByRole("button", { name: "Accetta" }).click();
    await expect(line).toContainText("Elena ha accettato");
    await expect(senderLine).toContainText("Elena accepted", {
      timeout: 20000,
    });
    await expect(senderLine).toHaveCount(1);
    await guest.goto("/");
    await expect(agenda.getByText(new RegExp(offer + " · "))).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test("the same rail connects a private chat, its group spaces and the focused agenda", async ({
  page,
}, info) => {
  await register(page, "Lea", `nav-${crypto.randomUUID()}@example.test`);
  const api = await page.request.post("/api/v1/workspaces", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: "Lancio RIMIAM", commandId: crypto.randomUUID() },
  });
  expect(api.ok()).toBe(true);
  const { id } = await api.json();
  await page.goto("/?workspace=" + id);
  const nav = page.getByRole("complementary", {
    name: "Navigazione principale",
  });
  const spaces = nav.getByRole("navigation", {
    name: "I tuoi spazi",
    exact: true,
  });
  async function openRail() {
    const toggle = page.getByRole("button", { name: "Apri navigazione" });
    if (await toggle.isVisible()) await toggle.click();
    await expect(nav).toBeVisible();
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
    await openRail();
    await nav.getByRole("button", { name: "Tu ed Emme", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Messaggio", exact: true }),
    ).toBeVisible();
    await openRail();
    const space = spaces.getByRole("button", { name: "Lancio RIMIAM" });
    await expect(space).toBeVisible();
    expect((await space.boundingBox())!.y).toBeLessThan(
      (await nav
        .getByRole("button", { name: "Oggi", exact: true })
        .boundingBox())!.y,
    );
    await info.attach("Navigazione personale " + width, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await space.click();
    await expect(
      page.getByRole("heading", { name: "Lancio RIMIAM", exact: true }),
    ).toBeVisible();
    await openRail();
    await nav.getByRole("button", { name: "Oggi", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Oggi", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Nuovo promemoria", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("region", { name: "Elenco degli spazi disponibili" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Agenda personale" }),
    ).toBeVisible();
  }
});
