import { test, expect } from "./backend-fixture";
import { fillWorkspaceName, openAccountMenu, register } from "./helpers";
import type { Page } from "@playwright/test";

async function enterSpace(page: Page) {
  await register(page, "Push QA", `push-${crypto.randomUUID()}@example.test`);
  await fillWorkspaceName(page, "Push acceptance");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Notifiche di questo spazio" }),
  ).toBeVisible();
}

async function configuredPreference(page: Page) {
  await page.route("**/api/web-push?*", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        configured: true,
        publicKey: "test-only",
      },
    });
  });
}

test("optional notifications recover without asking permission or blocking logout", async ({
  page,
}) => {
  await enterSpace(page);
  const initialPermission = await page.evaluate(() => Notification.permission);
  const initialWorkers = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map(
      (worker) => worker.scope,
    ),
  );
  const endpoint = "**/api/web-push?*";
  await page.route(endpoint, (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "Notifiche di questo spazio", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText(
    "Verifica la connessione",
  );
  await page.unroute(endpoint);
  await panel
    .getByRole("button", { name: "Riprova verifica", exact: true })
    .click();
  await expect(panel).toContainText(
    "Notifiche non ancora attivate sul servizio.",
  );
  await expect(
    panel.getByRole("button", {
      name: "Attiva per questo spazio",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByText("Come ricevere gli avvisi sul telefono", { exact: true })
    .click();
  await expect(
    panel.getByText("iPhone e iPad (16.4 o successivo).", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe(
    initialPermission,
  );
  expect(
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map(
        (worker) => worker.scope,
      ),
    ),
  ).toEqual(initialWorkers);
  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await openAccountMenu(page);
  await page
    .getByRole("button", { name: "Esci dall’account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Crea un account", exact: true }),
  ).toBeVisible();
  const session = await page.request.get("/api/auth/get-session");
  expect(session.ok()).toBe(true);
  expect(await session.json()).toBeNull();
});

test("chat prompt opens the existing opt-in without requesting browser permission until activation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => "default",
    });
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => {
        document.body.dataset.permissionRequested = "true";
        return "denied";
      },
    });
  });
  await configuredPreference(page);
  await enterSpace(page);
  const prompt = page.getByRole("complementary", { name: "Avvisi della chat" });
  await prompt.getByRole("button", { name: "Configura notifiche" }).click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
  });
  const activate = panel.getByRole("button", {
    name: "Attiva per questo spazio",
  });
  await expect(activate).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-permission-requested",
  );
  await activate.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Il browser non ha autorizzato",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-permission-requested",
    "true",
  );
  await panel.getByRole("button", { name: "Torna alla conversazione" }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Notifiche di questo spazio" }),
  ).toBeVisible();
  await expect(prompt).toHaveCount(0);
});

test("the iPhone browser prompt can be dismissed across reloads and the bell still explains Home Screen setup", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "iPhone",
    });
  });
  await configuredPreference(page);
  await enterSpace(page);
  const prompt = page.getByRole("complementary", { name: "Avvisi della chat" });
  await expect(
    prompt.getByRole("button", { name: "Come attivarli" }),
  ).toBeVisible();
  await prompt.getByRole("button", { name: "Non ora" }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  const bell = page.getByRole("button", { name: "Notifiche di questo spazio" });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
  });
  await expect(panel.getByText(/Su iPhone o iPad, da Safari/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Attiva per questo spazio" }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Torna alla conversazione" }).click();
  await expect(prompt).toHaveCount(0);
});

test("closing the permission prompt leaves an explicit retry and the same bell", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => "default",
    });
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => "default",
    });
  });
  await configuredPreference(page);
  await enterSpace(page);
  await page
    .getByRole("button", { name: "Notifiche di questo spazio" })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
  });
  const enable = panel.getByRole("button", {
    name: "Attiva per questo spazio",
  });
  await enable.click();
  await expect(panel.getByText(/aspetta ancora la tua scelta/i)).toBeVisible();
  await expect(enable).toBeEnabled();
  await expect(panel.getByText(/blocca gli avvisi/i)).toHaveCount(0);
});

test("blocked Android permission shows the shortest supported path and rechecks a site-control change in the foreground", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Uses Chromium site permission controls.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Android Chrome/131.0 Mobile",
    });
  });
  await configuredPreference(page);
  await enterSpace(page);
  // Headless Shell always returns "denied" from the legacy static getter.
  // Bridge that getter to Chromium's real, changing permission object.
  await page.evaluate(async () => {
    const permission = await navigator.permissions.query({
      name: "notifications",
    });
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => (permission.state === "prompt" ? "default" : permission.state),
    });
  });
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions([], { origin });
  await expect
    .poll(() => page.evaluate(() => Notification.permission))
    .toBe("denied");
  await page
    .getByRole("button", { name: "Notifiche di questo spazio" })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
  });
  await expect(
    panel.getByText(/il dispositivo blocca gli avvisi/i),
  ).toContainText("Autorizzazioni");
  await expect(
    panel.getByRole("button", { name: "Attiva per questo spazio" }),
  ).toHaveCount(0);
  await page.context().grantPermissions(["notifications"], { origin });
  await expect(
    panel.getByRole("button", { name: "Attiva per questo spazio" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Prova avviso sul dispositivo" }),
  ).toHaveCount(0);
  // Let the permission change's authenticated preference refresh finish.
  await page.unrouteAll({ behavior: "wait" });
});

test("distinguishes a local notification preview from the push service result for the current device", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => "granted",
    });
    Object.defineProperty(PushManager.prototype, "getSubscription", {
      configurable: true,
      value: async () => ({}),
    });
    Object.defineProperty(
      ServiceWorkerRegistration.prototype,
      "showNotification",
      {
        configurable: true,
        value: async (title: string, options: NotificationOptions) => {
          document.body.dataset.preview = title + " " + options.body;
        },
      },
    );
  });
  await enterSpace(page);
  await page.evaluate(async () => {
    const identity = await (await fetch("/api/auth/get-session")).json();
    await navigator.serviceWorker.register("/sw.js");
    const reg = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    const applied = new Promise<boolean>((resolve) => {
      channel.port1.onmessage = (event) =>
        resolve(event.data.ok && event.data.value);
    });
    reg.active!.postMessage(
      {
        type: "RIMIAM_PUSH_BIND",
        expected: null,
        binding: {
          actor: identity.user.id,
          session: identity.session.id,
          device: crypto.randomUUID(),
        },
      },
      [channel.port2],
    );
    if (!(await applied)) throw Error("Test device binding failed");
    channel.port1.close();
  });
  await page.route("**/api/web-push?*", (route) => {
    const device = new URL(route.request().url()).searchParams.get("device");
    return route.fulfill({
      json: {
        configured: true,
        publicKey: "test-only",
        deviceId: device,
        enabled: !!device,
        optedIn: !!device,
        lastDelivery: device
          ? { status: "queued", at: new Date().toISOString() }
          : null,
      },
    });
  });
  await page
    .getByRole("button", { name: "Notifiche di questo spazio" })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Notifiche su questo dispositivo",
  });
  await panel
    .getByRole("button", { name: "Prova avviso sul dispositivo" })
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-preview",
    "RIMIAM Questa è la prova degli avvisi su questo dispositivo.",
  );
  await expect(panel.getByText(/Prova richiesta al dispositivo/)).toBeVisible();
  await panel.getByText("Controlla l’ultimo invio", { exact: true }).click();
  await expect(panel.getByText(/Ultimo avviso dello spazio/)).toContainText(
    "in coda",
  );
});
