import { test, expect } from "@playwright/test";

test("registration keeps its form and verification notice through an anonymous session recheck", async ({
  page,
}) => {
  test.setTimeout(180000);
  const suffix = crypto.randomUUID();
  const name = `Session check ${suffix}`;
  const email = `session-check-${suffix}@example.test`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Crea un account", exact: true })
    .click();
  const nameField = page.getByLabel("Nome", { exact: true });
  await nameField.fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-password-2026!");

  let releaseSession!: () => void;
  const heldSession = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  let sessionHandlerStarted = false;
  let sessionResponseStatus = 0;
  await page.route(
    (url) => url.pathname === "/api/auth/get-session",
    async (route) => {
      sessionHandlerStarted = true;
      const response = await route.fetch();
      sessionResponseStatus = response.status();
      await heldSession;
      await route.fulfill({ response });
    },
    { times: 1 },
  );

  try {
    let signupStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const signedUp = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/auth/sign-up/email",
      );
      await page
        .getByRole("button", { name: "Registrati", exact: true })
        .click();
      const response = await signedUp;
      signupStatus = response.status();
      if (signupStatus !== 429 || attempt === 2) break;
      // Honour the real auth limiter, matching the shared registration helper.
      const seconds = Number(
        response.headers()["x-retry-after"] ??
          response.headers()["retry-after"] ??
          60,
      );
      await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    }
    expect(signupStatus).toBe(200);
    await expect.poll(() => sessionHandlerStarted).toBe(true);
    await expect.poll(() => sessionResponseStatus).toBe(200);
    await expect(page.getByRole("status")).toHaveText(
      "Verifica della sessione…",
    );

    // The actual session response is withheld: the pending state must not
    // unmount the form or discard the successful registration's local state.
    await expect(
      page.getByRole("heading", {
        name: "Crea il tuo account",
        exact: true,
        includeHidden: true,
      }),
    ).toBeAttached();
    await expect(nameField).toBeAttached();
    await expect(nameField).toHaveValue(name);
    await expect(nameField).not.toBeVisible();

    releaseSession();
    const verificationNotice = page.getByRole("status").filter({
      hasText: "Controlla la tua email",
    });
    await expect(verificationNotice).toBeVisible();
    await expect(verificationNotice).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Crea il tuo account", exact: true }),
    ).toBeVisible();
    await expect(nameField).toHaveValue(name);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
    await expect(
      page.getByRole("button", { name: "Crea spazio", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Navigazione principale" }),
    ).not.toBeVisible();
  } finally {
    releaseSession();
    await page.unrouteAll({ behavior: "wait" });
  }
});
