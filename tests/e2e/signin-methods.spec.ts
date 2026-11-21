import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("signed-out login and signed-in linking show the real provider state and keep the return destination", async ({
  page,
  baseURL,
}) => {
  const configured = process.env.MIRIAM_E2E_SIGN_IN === "true";
  const destination = `/?invite=${"g".repeat(43)}`;
  // Never open an external account or authorize a third party during browser checks.
  for (const origin of ["accounts.google.com", "login.microsoftonline.com"]) {
    await page.route(`https://${origin}/**`, (route) =>
      route.fulfill({
        contentType: "text/plain",
        body: "Test provider handoff",
      }),
    );
  }
  const configResponse = await page.request.get("/api/config");
  expect(configResponse.headers()["cache-control"]).toContain("no-store");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(destination);
  const providers = [
    ["Google", "accounts.google.com"],
    ["Microsoft", "login.microsoftonline.com"],
  ] as const;
  if (!configured) {
    await expect(
      page.getByText("L’accesso con Google e Microsoft non è ancora attivo.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continua con/ }),
    ).toHaveCount(0);
  } else {
    for (const [name, domain] of providers) {
      const request = page.waitForRequest(
        (r) => new URL(r.url()).pathname === "/api/auth/sign-in/social",
      );
      await page.getByRole("button", { name: `Continua con ${name}` }).click();
      expect((await request).postDataJSON().callbackURL).toBe(destination);
      await expect(page).toHaveURL((u) => u.hostname === domain);
      const url = new URL(page.url());
      expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
        "email",
        "openid",
        "profile",
      ]);
      await page.goto(destination);
    }
  }
  const email = `methods-${crypto.randomUUID()}@example.test`;
  await register(page, "Giulia", email);
  const workspaceDestination =
    "/?workspace=20000000-0000-4000-8000-000000000000";
  await page.goto(
    `/account/access?returnTo=${encodeURIComponent(workspaceDestination)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Metodi di accesso" }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Torna a RIMIAM" }),
  ).toHaveAttribute("href", workspaceDestination);
  if (!configured) {
    await expect(
      page.getByText("Non attivo su questa installazione"),
    ).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Collega/ })).toHaveCount(0);
    return;
  }
  const settingsPage = page.url();
  for (const [name, domain] of providers) {
    const launch = page.waitForRequest(
      (r) => new URL(r.url()).pathname === "/api/auth/link-social",
    );
    await page.getByRole("button", { name: `Collega ${name}` }).click();
    const request = (await launch).postDataJSON();
    const callback = new URL(request.callbackURL, baseURL);
    expect(callback.pathname).toBe("/account/access");
    expect(callback.searchParams.get("returnTo")).toBe(workspaceDestination);
    await expect(page).toHaveURL((u) => u.hostname === domain);
    await page.goto(settingsPage);
  }
});

test("email login stays available when the sign-in configuration must be retried", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/config", async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    return route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByText("Impossibile verificare l’accesso con Google e Microsoft.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "Riprova", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Riprova", exact: true }),
  ).toHaveCount(0);
  if (process.env.MIRIAM_E2E_SIGN_IN === "true")
    await expect(
      page.getByRole("button", { name: "Continua con Google" }),
    ).toBeVisible();
  else
    await expect(
      page.getByText("L’accesso con Google e Microsoft non è ancora attivo.", {
        exact: false,
      }),
    ).toBeVisible();
});

test("device identity start and verified account linking use the configured provider and the same member", async ({
  page,
}) => {
  const configured = process.env.MIRIAM_E2E_SIGN_IN === "true",
    state = "a".repeat(64),
    challenge = "Z".repeat(43);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const domain of ["accounts.google.com", "login.microsoftonline.com"])
    await page.route("https://" + domain + "/**", (route) =>
      route.fulfill({ contentType: "text/plain", body: "Provider boundary" }),
    );
  await page.goto(
    "/account/native?" +
      new URLSearchParams({ provider: "google", state, challenge }),
  );
  await expect(
    page.getByRole("heading", { name: "Accedi all’app RIMIAM" }),
  ).toBeVisible();
  if (!configured) {
    await expect(
      page.getByText(
        "Questo servizio di accesso non è abilitato su questa installazione.",
      ),
    ).toBeVisible();
    return;
  }
  const social = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/auth/sign-in/social",
  );
  await page.getByRole("button", { name: "Continua con Google" }).click();
  const callback = new URL(
    (await social).postDataJSON().callbackURL,
    "https://example.test",
  );
  expect(callback.pathname).toBe("/account/native/return");
  expect(callback.searchParams.get("challenge")).toBe(challenge);
  await expect(page).toHaveURL((u) => u.hostname === "accounts.google.com");
  const email = `device-${crypto.randomUUID()}@example.test`;
  await register(page, "Contatto", email);
  const session = await (
    await page.request.get("/api/auth/get-session")
  ).json();
  await page.goto(
    "/account/native/link?" +
      new URLSearchParams({
        actor: "another-test-actor",
        provider: "microsoft",
      }),
  );
  await expect(
    page.getByText("L’account del browser è diverso", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collega Microsoft" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Esci da RIMIAM nel browser e cambia account",
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Accedi con password" }),
  ).toBeVisible();
  await page.goto(
    "/account/native/link?" +
      new URLSearchParams({ actor: session.user.id, provider: "microsoft" }),
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-password-2026!");
  await page.getByRole("button", { name: "Accedi con password" }).click();
  const link = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/auth/link-social",
  );
  await page.getByRole("button", { name: "Collega Microsoft" }).click();
  const request = await link;
  expect(request.headers()["x-rimiam-link-account"]).toBe(session.user.id);
  await expect(page).toHaveURL(
    (u) => u.hostname === "login.microsoftonline.com",
  );
});
