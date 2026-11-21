import { devices, expect, test } from "@playwright/test";
import { fillWorkspaceName, register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      devices[browserName === "webkit" ? "iPhone 13 Pro" : "Pixel 7"],
    );
  },
});

test("a single tap opens each workspace header control and returns to a usable chat", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(
    page,
    "Elena Quercia",
    `touch-${crypto.randomUUID()}@example.test`,
  );
  const name = "Preparazione del lancio";
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).tap();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const header = page.locator("main > header");
  const navigation = header.getByRole("button", { name: "Apri navigazione" });
  const drawer = page.getByRole("dialog", { name: "Menu di navigazione" });
  await navigation.tap();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Chiudi navigazione" }).tap();
  await expect(drawer).toBeHidden();

  for (const [trigger, title] of [
    ["Condivisi", "Condivisi"],
    ["Notifiche di questo spazio", "Notifiche su questo dispositivo"],
    ["1 persona", "Persone e accesso"],
    ["Invita", "Invita una persona"],
  ]) {
    await header.getByRole("button", { name: trigger, exact: true }).tap();
    const panel = page.getByRole("dialog", { name: title, exact: true });
    await expect(panel).toBeVisible();
    if (title === "Condivisi") {
      await expect(
        panel.locator("header").getByText(name, { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Viste dello spazio" }),
      ).toHaveCount(0);
    }
    if (title === "Persone e accesso") {
      await expect(panel.getByText("EQ", { exact: true })).toBeVisible();
      await panel
        .getByRole("button", {
          name: "Apri il profilo di Elena Quercia",
          exact: true,
        })
        .tap();
      const profile = page.getByRole("dialog", {
        name: "Elena Quercia",
        exact: true,
      });
      await expect(
        profile.getByRole("link", { name: /@example.test/ }),
      ).toBeVisible();
      await profile.getByRole("button", { name: "Chiudi", exact: true }).tap();
      await panel
        .getByRole("button", { name: "Invita una persona", exact: true })
        .tap();
      const invite = page.getByRole("dialog", {
        name: "Invita una persona",
        exact: true,
      });
      await invite
        .getByRole("button", { name: "Torna a Persone e accesso", exact: true })
        .tap();
      await expect(panel).toBeVisible();
    }
    await panel.getByRole("button", { name: "Torna alla conversazione" }).tap();
    await expect(panel).toBeHidden();
  }
  await header.getByRole("button", { name: "Attività dello spazio" }).tap();
  const activity = header.getByRole("region", {
    name: "Attività dello spazio",
  });
  await expect(activity).toBeVisible();
  await activity.getByRole("button", { name: "Chiudi attività" }).tap();
  await expect(activity).toBeHidden();
  const editor = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await editor.tap();
  await editor.fill("Messaggio dopo aver chiuso gli strumenti");
  await page.getByRole("button", { name: "Invia", exact: true }).tap();
  await expect(page.locator(".messages")).toContainText(
    "Messaggio dopo aver chiuso gli strumenti",
  );
  expect(errors).toEqual([]);
});
