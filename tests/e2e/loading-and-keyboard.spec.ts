import { devices, expect, test } from "@playwright/test";
import { register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      devices[browserName === "webkit" ? "iPhone 13 Pro" : "Pixel 7"],
    );
  },
});

test("initial release verification shows the brand, respects reduced motion and opens access after verification", async ({
  page,
}) => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/release", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto("/");
    const status = page
      .getByRole("status")
      .filter({ hasText: "Verifica della versione di RIMIAM" });
    await expect(status).toBeVisible();
    await expect(status.locator("img")).toHaveCSS("animation-name", "none");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Crea un account" }),
    ).toHaveCount(0);
  } finally {
    finish();
  }
  await expect(
    page.getByRole("button", { name: "Crea un account" }),
  ).toBeVisible();
});

test("returning Home waits for a throttled session read and recovers other temporary failures", async ({
  page,
}) => {
  await register(
    page,
    "Lea",
    "session-" + crypto.randomUUID() + "@example.test",
  );
  const directory = page.getByRole("region", {
    name: "Elenco degli spazi disponibili",
  });
  const login = page.getByRole("button", {
    name: "Accedi con un account esistente",
  });
  const sessionRoute = "**/api/auth/get-session*";
  const headers = { "content-type": "application/json", "x-retry-after": "1" };
  await page.route(
    sessionRoute,
    (route) =>
      route.fulfill({
        status: 429,
        headers,
        body: JSON.stringify({ message: "Test limit" }),
      }),
    { times: 2 },
  );
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Verifica della sessione" }),
  ).toBeVisible();
  await expect(login).toHaveCount(0);
  await expect(directory).toBeVisible();

  await page.route(
    sessionRoute,
    (route) =>
      route.fulfill({
        status: 503,
        headers,
        body: JSON.stringify({ message: "Test unavailable" }),
      }),
    { times: 1 },
  );
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Verifica della sessione non riuscita.",
  );
  await expect(login).toHaveCount(0);
  await page.getByRole("button", { name: "Riprova", exact: true }).click();
  await expect(directory).toBeVisible();
});

test("personal chat keeps its field and submit inside a shortened and panned visual viewport", async ({
  page,
}) => {
  await register(
    page,
    "Chiara",
    "keyboard-" + crypto.randomUUID() + "@example.test",
  );
  await page
    .getByRole("region", { name: "Personale", exact: true })
    .getByRole("button", { name: "Tu ed Emme", exact: true })
    .tap();
  const editor = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await editor.tap();
  await editor.fill("Controllo del campo di scrittura");
  const send = page.getByRole("button", { name: "Invia a Emme", exact: true });
  await expect(send).toBeEnabled();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 300 },
      offsetTop: { configurable: true, value: 35 },
      pageTop: { configurable: true, value: window.scrollY + 35 },
    });
    viewport.dispatchEvent(new Event("resize"));
  });
  for (const target of [editor, send]) {
    await expect
      .poll(() =>
        target.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const viewport = window.visualViewport!;
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return (
            rect.top >= viewport.offsetTop - 1 &&
            rect.bottom <= viewport.offsetTop + viewport.height + 1 &&
            el.contains(hit)
          );
        }),
      )
      .toBe(true);
  }
  await send.tap();
  await expect(
    page.getByRole("log", { name: "Messaggi con Emme" }),
  ).toContainText("Controllo del campo di scrittura");
});
