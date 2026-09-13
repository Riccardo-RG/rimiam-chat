import { test, expect } from "./backend-fixture";
import { register } from "./helpers";
test("Conversation-first Home, responsive layers and structured document remain usable", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await register(
    page,
    "Riccardo QA",
    `design-${crypto.randomUUID()}@example.test`,
  );
  await expect(page.getByText("Uno spazio per")).toBeVisible();
  await page
    .getByLabel("Nuovo spazio", { exact: true })
    .fill("Il nostro cocktail bar");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Conversazione", exact: true }),
  ).toBeVisible();
  await page
    .locator("#message")
    .fill(
      "Miriam, vorremmo confrontare due locali luminosi vicino alla stazione.",
    );
  await page
    .getByRole("button", { name: "Invia messaggio", exact: true })
    .click();
  await expect(page.locator(".messages")).toContainText("due locali luminosi");
  const workspaceUrl = page.url();
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator("#message")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`conversation-${size.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Contesto", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Contesto condiviso", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`context-${size.width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Materiali", exact: true }).click();
  await page.getByRole("button", { name: /Documenti e risultati/ }).click();
  await page.getByText("Nuovo documento", { exact: true }).click();
  await page.getByLabel("Titolo", { exact: true }).fill("Confronto dei locali");
  await page
    .getByLabel("A cosa ci serve?", { exact: true })
    .fill("Raccogliere le alternative prima di decidere");
  await page
    .getByLabel("Contenuto", { exact: true })
    .fill(
      "Valuteremo luminosità, distanza e costo senza adottare ancora una scelta.",
    );
  await page.getByRole("button", { name: "Salva bozza", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Confronto dei locali", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".messages")).toContainText("due locali luminosi");
  await page
    .getByRole("button", { name: "Miriam — Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "I tuoi spazi" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("application-home.png"),
    fullPage: true,
  });
  await page.goto(workspaceUrl);
  await expect(page.locator("#message")).toBeVisible();
});
