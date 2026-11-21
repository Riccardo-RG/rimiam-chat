import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { openAccountAppearance, register } from "./helpers";
test.use({
  browserName: "firefox",
  viewport: { width: 640, height: 800 },
  launchOptions: { firefoxUserPrefs: { "font.size.variable.x-western": 32 } },
});
test("account controls reflow and remain reachable at twice the usual browser font", async ({
  page,
}) => {
  await register(page, "Alma", randomUUID() + "@example.test");
  expect(
    await page
      .locator("html")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(32);
  await page.getByRole("button", { name: "Apri navigazione" }).click();
  await openAccountAppearance(page);
  const menu = page.locator(".account-options");
  const accent = menu.getByLabel("Colore di accento");
  await accent.selectOption("forest");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "forest");
  await menu
    .getByRole("button", { name: "Esci dall’account" })
    .scrollIntoViewIfNeeded();
  await expect(
    menu.getByRole("button", { name: "Esci dall’account" }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await menu.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
});
