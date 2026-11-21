import { test, expect } from "@playwright/test";
import { fillWorkspaceName, openAccountMenu, register } from "./helpers";

test("a new invitee verifies, explicitly joins, recovers access and invalidates old sessions without changing membership", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const ownerContext = await browser.newContext(),
    guestContext = await browser.newContext(),
    recoveryContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    guest = await guestContext.newPage(),
    recovery = await recoveryContext.newPage();
  const suffix = crypto.randomUUID(),
    email = `new-guest-${suffix}@example.test`,
    name = `Account ${suffix}`;
  const pageErrors: string[] = [];
  for (const p of [owner, guest, recovery])
    p.on("pageerror", (e) => pageErrors.push(e.message));
  try {
    const signupRequests: string[] = [];
    owner.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/auth/sign-up/email"
      )
        signupRequests.push(request.url());
    });
    await owner.goto("/");
    await expect(
      owner.getByRole("heading", { name: "Entra in RIMIAM", exact: true }),
    ).toBeVisible();
    const coverTitle = owner.getByRole("heading", {
      name: "La chat di progetto.",
    });
    for (const colorScheme of ["dark", "light"] as const) {
      await owner.emulateMedia({ colorScheme });
      await expect(coverTitle).toHaveCSS(
        "color",
        await coverTitle.evaluate(
          (node) => getComputedStyle(node.parentElement!).color,
        ),
      );
    }
    await owner.screenshot({ path: info.outputPath("web-account-access.png") });
    await owner
      .getByRole("button", { name: "Crea un account", exact: true })
      .click();
    const ownerName = owner.getByLabel("Nome", { exact: true });
    const signupForm = owner.locator("form").filter({ has: ownerName });
    await ownerName.fill("   ");
    await owner
      .getByLabel("Email", { exact: true })
      .fill(`owner-${suffix}@example.test`);
    await owner
      .getByLabel("Password", { exact: true })
      .fill("Local-test-password-2026!");
    await owner
      .getByRole("button", { name: "Registrati", exact: true })
      .click();
    await expect(signupForm.getByRole("alert")).toHaveText(
      "Inserisci il tuo nome.",
    );
    await expect(ownerName).toBeFocused();
    await expect(ownerName).toHaveAttribute("aria-invalid", "true");
    await expect(ownerName).toHaveAccessibleDescription(
      "Inserisci il tuo nome.",
    );
    await ownerName.fill("Account owner");
    await expect(ownerName).not.toHaveAttribute("aria-invalid", "true");
    await expect(signupForm.getByRole("alert")).not.toBeVisible();
    expect(signupRequests).toHaveLength(0);
    await register(owner, "Account owner", `owner-${suffix}@example.test`);
    expect(signupRequests.length).toBeGreaterThan(0);
    await fillWorkspaceName(owner, name);
    await owner
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const workspaceId = new URL(owner.url()).searchParams.get("workspace")!,
      origin = new URL(owner.url()).origin;
    const invite = await owner.request.post(
      `/api/workspaces/${workspaceId}/commands`,
      {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "invitation.create",
            email,
            fullHistoryDisclosed: true,
          },
        },
      },
    );
    expect(invite.ok()).toBe(true);
    const { token } = await invite.json(),
      invitationPath = `/?invite=${token}`;
    await register(guest, "New guest", email, invitationPath);
    await expect(
      guest.getByRole("heading", { name: `Entra in ${name}`, exact: true }),
    ).toBeVisible();
    expect(new URL(guest.url()).searchParams.get("invite")).toBe(token);
    expect(
      (await guest.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    await guest
      .getByLabel(
        "Accetto esplicitamente di entrare con questa visibilità della storia.",
        { exact: true },
      )
      .check();
    await guest
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const before = await (
      await guest.request.get(`/api/workspaces/${workspaceId}`)
    ).json();
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();

    await recovery.goto(`/?workspace=${workspaceId}`);
    await recovery
      .getByRole("link", { name: "Password dimenticata?", exact: true })
      .click();
    await recovery
      .getByLabel("Email dell’account", { exact: true })
      .fill(email);
    await recovery
      .getByRole("button", { name: "Richiedi link di recupero", exact: true })
      .click();
    await expect(recovery.getByRole("status")).toContainText(
      "Se possiamo completare la richiesta",
    );
    const mails = await (await recovery.request.get("/api/local-mail")).json();
    const mail = mails.find(
      (m: { recipient: string; subject: string }) =>
        m.recipient === email && m.subject === "Reset your MIRIAM password",
    );
    expect(mail).toBeDefined();
    await recovery.goto(mail.link);
    await expect(
      recovery.getByRole("heading", { name: "Scegli una nuova password" }),
    ).toBeVisible();
    expect(new URL(recovery.url()).searchParams.has("token")).toBe(false);
    await recovery
      .getByLabel("Nuova password", { exact: true })
      .fill("Recovered-test-password-2026!");
    const repeatPassword = recovery.getByLabel("Ripeti la nuova password", {
      exact: true,
    });
    const recoveryForm = recovery
      .locator("form")
      .filter({ has: repeatPassword });
    const savePassword = recovery.getByRole("button", {
      name: "Salva nuova password",
      exact: true,
    });
    const resetRequests: string[] = [];
    recovery.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/auth/reset-password"
      )
        resetRequests.push(request.url());
    });
    await repeatPassword.fill("Different-test-password-2026!");
    await savePassword.click();
    await expect(recoveryForm.getByRole("alert")).toHaveText(
      "Le due password non coincidono.",
    );
    await expect(repeatPassword).toBeFocused();
    await expect(repeatPassword).toHaveAttribute("aria-invalid", "true");
    await expect(repeatPassword).toHaveAccessibleDescription(
      /Le due password non coincidono\./,
    );
    await repeatPassword.fill("Recovered-test-password-2026!");
    await expect(repeatPassword).not.toHaveAttribute("aria-invalid", "true");
    await expect(recoveryForm.getByRole("alert")).not.toBeVisible();
    expect(resetRequests).toHaveLength(0);
    await savePassword.click();
    const recoveryComplete = recovery.getByRole("heading", {
      name: "Password aggiornata",
      exact: true,
    });
    await expect(recoveryComplete).toBeVisible();
    await expect(recoveryComplete).toBeFocused();
    expect(resetRequests).toHaveLength(1);
    await expect(recovery.getByRole("status")).toContainText(
      "Le sessioni precedenti sono state chiuse",
    );
    expect(
      (await guest.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(401);
    await recovery
      .getByRole("link", { name: "Torna all’accesso", exact: true })
      .click();
    await recovery.getByLabel("Email", { exact: true }).fill(email);
    await recovery
      .getByLabel("Password", { exact: true })
      .fill("Recovered-test-password-2026!");
    await recovery.getByRole("button", { name: "Accedi", exact: true }).click();
    await expect(
      recovery.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const after = await (
      await recovery.request.get(`/api/workspaces/${workspaceId}`)
    ).json();
    expect(after.members).toEqual(before.members);
    expect(after.access).toEqual(before.access);
    await openAccountMenu(recovery);
    await recovery
      .getByRole("button", { name: "Esci dall’account", exact: true })
      .click();
    await expect(
      recovery.getByRole("button", { name: "Accedi", exact: true }),
    ).toBeVisible();
    expect(
      (await recovery.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(401);
    expect(pageErrors).toEqual([]);
  } finally {
    await ownerContext.close();
    await guestContext.close();
    await recoveryContext.close();
  }
});
