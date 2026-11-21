import { expect, test } from "@playwright/test";
import { fillWorkspaceName, register, openMessageComposer } from "./helpers";

test("the two public notices stay readable without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const page = await browser.newPage({ javaScriptEnabled: false, baseURL });
  try {
    for (const [path, heading] of [
      ["/beta", "Regole della beta"],
      ["/connessioni-e-dati", "Account, calendari e dati"],
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
  } finally {
    await page.close();
  }
});

test("the Web API rejects a stale shell before running a write and keeps public API clients independent", async ({
  request,
}) => {
  const current = await request.get("/api/release");
  expect(current.ok()).toBe(true);
  expect(current.headers()["cache-control"]).toContain("no-store");
  const { release } = await current.json();
  const response = await request.post("/api/v1/workspaces", {
    headers: { "x-rimiam-web-release": "obsolete-build" },
    data: {},
  });
  expect(response.status()).toBe(409);
  expect(response.headers()["x-rimiam-web-update"]).toBe(release);
  expect(await response.json()).toEqual({
    error: { code: "WEB_UPDATE_REQUIRED" },
  });
  expect((await request.get("/api/v1/workspaces")).status()).toBe(401);
  const oldBrowser = await request.post("/api/v1/workspaces", {
    headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Dest": "empty" },
    data: {},
  });
  expect(oldBrowser.status()).toBe(409);
});

test("offline and unverified versions block the app and resume after a fresh check", async ({
  page,
  context,
}) => {
  const { release } = await (await page.request.get("/api/release")).json();
  let mode: "current" | "invalid" = "invalid";
  await page.route("**/api/release", (route) =>
    route.fulfill({
      json: { release: mode === "current" ? release : "<invalid>" },
    }),
  );
  await page.goto("/");
  const gate = page.getByRole("dialog");
  await expect(gate).toContainText("Connessione da verificare");
  mode = "current";
  await gate.getByRole("button", { name: "Riprova" }).click();
  await expect(gate).not.toBeVisible();
  await context.setOffline(true);
  await expect(gate).toContainText("Connessione da verificare");
  expect(
    await page.evaluate(() => document.querySelector("[inert]") !== null),
  ).toBe(true);
  await context.setOffline(false);
  await expect(gate).not.toBeVisible();
});

test("an idle tab reloads automatically while preserving the workspace URL and avoids a rollout loop", async ({
  page,
}) => {
  let checks = 0,
    documents = 0,
    changed = false;
  const { release } = await (await page.request.get("/api/release")).json();
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
  });
  await page.route("**/api/release", (route) => {
    checks++;
    return route.fulfill({
      json: { release: changed ? "release-after-test" : release },
    });
  });
  await page.goto("/?workspace=00000000-0000-4000-b000-000000000011#chat");
  await expect.poll(() => checks).toBeGreaterThan(0);
  changed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page).toHaveURL(
    /workspace=.*__rimiam_release=release-after-test#chat$/,
  );
  const gate = page.getByRole("dialog");
  await expect(gate).toContainText("Aggiornamento necessario");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(gate).toBeVisible();
  expect(documents).toBe(2);
  changed = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(gate).not.toBeVisible();
  await expect(page).not.toHaveURL(/__rimiam_release/);
});

test("a draft and attachments survive a required update and can never be sent with the stale UI", async ({
  page,
}) => {
  await register(
    page,
    "Ada",
    "release-" + crypto.randomUUID() + "@example.test",
  );
  await fillWorkspaceName(page, "Aggiornamento con bozza");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const composer = await openMessageComposer(page),
    text = "Appunto da completare prima di aggiornare.";
  await composer.fill(text);
  await page.getByLabel("Scegli file e foto").setInputFiles({
    name: "bozza.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("appunto non inviato"),
  });
  const attachments = page.getByRole("list", {
    name: "Allegati in ordine di invio",
  });
  await expect(attachments).toContainText("bozza.txt");
  const { release } = await (await page.request.get("/api/release")).json();
  let next = true;
  await page.route("**/api/release", async (route) => {
    expect((await route.request().allHeaders()).cookie).toBeUndefined();
    await route.fulfill({
      json: { release: next ? "next-draft-release" : release },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  const gate = page.getByRole("dialog", { name: "Aggiornamento necessario" });
  await expect(gate).toBeVisible();
  expect(await composer.inputValue()).toBe(text);
  await page.keyboard.press("Escape");
  await expect(gate).toBeVisible();
  expect(
    await page.evaluate(async () => {
      try {
        await fetch("/api/v1/workspaces", { method: "POST", body: "{}" });
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  next = false;
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    gate.getByRole("button", { name: "Aggiorna ora" }).click(),
  ]);
  await expect(await openMessageComposer(page)).toHaveValue(text);
  await expect(attachments).toContainText("bozza.txt");
});
