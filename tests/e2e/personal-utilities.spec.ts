import { devices, expect, test } from "@playwright/test";
import { register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      browserName === "webkit" ? devices["iPhone 13 Pro"] : {},
    );
  },
});

test("Home opens isolated personal documents, scheduled reminders and a solo conversation", async ({
  page,
  browser,
}) => {
  const other = await browser.newPage();
  try {
    const id = crypto.randomUUID();
    await register(page, "Anna", "utilities-a-" + id + "@example.test");
    await register(other, "Leo", "utilities-b-" + id + "@example.test");
    const home = page.getByRole("region", { name: "Personale", exact: true });
    expect(
      await (await page.request.get("/api/v1/personal-space")).json(),
    ).toEqual({ id: null, reminders: [] });
    await home.getByRole("button", { name: "Documenti", exact: true }).click();
    const docs = page.getByRole("region", {
      name: "Documenti personali",
      exact: true,
    });
    await expect(docs).toBeVisible();
    const personalId = new URL(page.url()).searchParams.get("workspace")!;
    await docs.getByRole("button", { name: "Nuova nota", exact: true }).click();
    const privateNote = "Appunti miei: primo colloquio";
    await docs
      .getByRole("textbox", { name: "Testo della nota", exact: true })
      .fill(privateNote);
    await docs
      .getByRole("button", { name: /^(?:Salva|Condividi) nota$/ })
      .click();
    await docs.getByRole("button", { name: /Apri Appunti miei/ }).click();
    const preview = page.getByRole("dialog", { name: /Appunti miei/ });
    const original = await preview
      .getByRole("link", { name: "Scarica originale" })
      .getAttribute("href");
    expect((await other.request.get(original!)).status()).toBe(403);
    await preview.getByRole("button", { name: "Chiudi", exact: true }).click();
    const navigation = page.getByRole("navigation", {
      name: "Utility personali",
    });
    await navigation
      .getByRole("button", { name: "Promemoria", exact: true })
      .click();
    const reminders = page.getByRole("region", {
      name: "Promemoria personali",
    });
    await reminders.getByText("Nuovo promemoria", { exact: true }).click();
    const reminder = "Rileggi il preventivo personale";
    await reminders.getByLabel("Cosa vuoi ricordare?").fill(reminder);
    const time = reminders.locator('input[type="datetime-local"]');
    await time.fill("2034-10-02T09:00");
    await reminders.getByLabel("Ripeti", { exact: true }).selectOption("daily");
    await reminders
      .getByRole("button", { name: "Salva promemoria", exact: true })
      .click();
    await expect(
      reminders.getByText(reminder, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Nuova attività", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Torna a tutti gli spazi", exact: true })
      .click();
    await expect(home.getByText(reminder, { exact: true })).toBeVisible();
    await home.getByRole("button", { name: "Tu ed Emme", exact: true }).click();
    const msg = "Questa chat è solo mia?";
    await page
      .getByRole("textbox", { name: "Messaggio", exact: true })
      .fill(msg);
    await page
      .getByRole("button", { name: "Invia a Emme", exact: true })
      .click();
    const chat = page.getByLabel("Messaggi con Emme", { exact: true });
    await expect(chat).toContainText(msg);
    const reply = chat.getByRole("article", { name: "Emme", exact: true });
    await expect(reply).toContainText(
      "Risposta di prova alla domanda sulla chat.",
    );
    await page.reload();
    await expect(chat).toContainText(msg);
    await expect(reply).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("workspace")).toBe(personalId);
    expect(
      (await other.request.get("/api/workspaces/" + personalId)).status(),
    ).toBe(403);
    expect(
      await (await other.request.get("/api/v1/personal-space")).json(),
    ).toEqual({ id: null, reminders: [] });
    await expect(other.getByText(reminder)).toHaveCount(0);
  } finally {
    await other.close();
  }
});
