import { randomUUID } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { openWithSession, register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      browserName === "webkit"
        ? devices["iPhone 13 Pro"]
        : {
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
          },
    );
  },
});
test("mobile navigation exposes settings and an outdated form cannot silently overwrite saved changes", async ({
  page,
  context,
}) => {
  await register(page, "Matteo", randomUUID() + "@example.test");
  await page.getByRole("button", { name: "Apri navigazione" }).tap();
  await page
    .getByRole("navigation", { name: "Navigazione personale" })
    .getByRole("button", { name: "Configura Emme" })
    .tap();
  const panel = page.getByRole("dialog", { name: "Configura Emme" });
  await expect(panel.getByLabel("Nome dell’assistente")).toHaveValue("Emme");
  await panel.getByLabel("Nome dell’assistente").fill("Bozza");
  const other = await context.newPage();
  await openWithSession(other, "/");
  await other
    .getByRole("region", { name: "Personale", exact: true })
    .getByRole("button", { name: "Configura Emme" })
    .click();
  const second = other.getByRole("dialog", { name: "Configura Emme" });
  await second.getByLabel("Nome dell’assistente").fill("Luce");
  await second.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(second.getByRole("status")).toHaveText("Impostazioni salvate.");
  await panel.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(panel.getByRole("alert")).toContainText("sono cambiate");
  await panel
    .getByRole("button", { name: "Carica la versione salvata" })
    .click();
  await expect(panel.getByLabel("Nome dell’assistente")).toHaveValue("Luce");
  await panel
    .getByRole("button", { name: "Ripristina tutte le impostazioni" })
    .click();
  await panel.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(panel.getByRole("status")).toHaveText("Impostazioni salvate.");
  await expect(panel).toBeInViewport();
  await panel.getByRole("button", { name: "Chiudi" }).tap();
  await expect(panel).toHaveCount(0);
});
