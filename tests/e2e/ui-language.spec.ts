import { expect, test } from "@playwright/test";
import { fillWorkspaceName, openMessageComposer, register } from "./helpers";
test("language changes persist without translating a space or dropping a draft", async ({
  page,
}) => {
  await register(
    page,
    "Alba",
    "locale-" + crypto.randomUUID() + "@example.test",
  );
  await fillWorkspaceName(page, "Aggiungi al messaggio");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Aggiungi al messaggio", exact: true }),
  ).toBeVisible();
  const draft = "Scrivo in italiano. Add this tomorrow.";
  await (await openMessageComposer(page)).fill(draft);
  const menu = page
    .locator("details")
    .filter({ has: page.locator(".account-options") });
  await menu.locator(":scope > summary").click();
  const appearance = menu.locator("details").filter({
    has: page.getByRole("combobox", {
      name: "Lingua",
      exact: true,
      includeHidden: true,
    }),
  });
  if (await appearance.count())
    await appearance.first().locator(":scope > summary").click();
  await page
    .getByRole("combobox", { name: "Lingua", exact: true })
    .selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Aggiungi al messaggio", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#message")).toHaveValue(draft);
  await expect(
    page.getByRole("button", { name: /^(Emme’s activity|Space activity)$/ }),
  ).toBeVisible();
  await page.goto("/account/access?error=access_denied");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Sign-in cancelled.",
  );
  await page.goto("/beta");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("it");
  await expect(
    page.getByRole("heading", { name: "Regole della beta" }),
  ).toBeVisible();
});

test("an English phone gets English on first visit and can choose Italian before signing in", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    locale: "en-GB",
    viewport: { width: 320, height: 568 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show password", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Hide password", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("it");
    await expect(
      page.getByRole("heading", { name: "Entra in RIMIAM" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
  } finally {
    await context.close();
  }
});
