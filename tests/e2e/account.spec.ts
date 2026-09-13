import { test, expect } from "@playwright/test";
import { register } from "./helpers";

test("a new invitee verifies, explicitly joins, recovers access and invalidates old sessions without changing membership", async ({
  browser,
}) => {
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
    await register(owner, "Account owner", `owner-${suffix}@example.test`);
    await owner.getByLabel("Nuovo spazio", { exact: true }).fill(name);
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
    await expect(recovery.getByRole("status")).toContainText("Se l’indirizzo");
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
    await recovery
      .getByLabel("Ripeti la nuova password", { exact: true })
      .fill("Recovered-test-password-2026!");
    await recovery
      .getByRole("button", { name: "Salva nuova password", exact: true })
      .click();
    await expect(
      recovery.getByRole("heading", {
        name: "Password aggiornata",
        exact: true,
      }),
    ).toBeVisible();
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
