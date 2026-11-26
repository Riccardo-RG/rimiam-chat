import type { Page } from "@playwright/test";
import { expect, test } from "./backend-fixture";
import { pool } from "../../src/server/db";
import { decryptAccountLink } from "../../src/server/account-delivery";
import { fillWorkspaceName, openMessageComposer, register } from "./helpers";

test.use({ hasTouch: true });

test("two verified people create spaces with an email invitation and then their private contact list", async ({
  browser,
  page: owner,
  browserName,
}, info) => {
  test.setTimeout(150000);
  const viewport =
    browserName === "webkit"
      ? { width: 390, height: 664 }
      : { width: 1366, height: 768 };
  await owner.setViewportSize(viewport);
  const guestContext = await browser.newContext({ viewport });
  const guest = await guestContext.newPage();
  const tag = crypto.randomUUID();
  const guestEmail = `guest-${tag}@example.test`;
  const guestName = "Giulia Inviti";
  const people = owner.getByRole("textbox", { name: /Invita persone/ });
  const confirm = owner.getByLabel(/Confermo che chi accetta/);
  const create = owner.getByRole("button", {
    name: "Crea spazio e invita",
    exact: true,
  });
  async function enterAsGuest(workspaceName: string, workspaceId: string) {
    // A signed-in recipient returns to the already-open app; the inbox refreshes on focus.
    await guest.bringToFront();
    await guest.evaluate(() => window.dispatchEvent(new Event("focus")));
    const inbox = guest.getByRole("region", { name: "Inviti ricevuti" });
    await expect(inbox).toContainText(workspaceName);
    expect(
      (await guest.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    if (!(await inbox.getByRole("checkbox").isVisible()))
      await inbox.getByText("Vedi invito", { exact: true }).click();
    await expect(
      inbox.getByRole("heading", { name: `Entra in ${workspaceName}` }),
    ).toBeVisible();
    const history = inbox.getByLabel(/Accetto esplicitamente di entrare/);
    await expect(history).not.toBeChecked();
    await history.check();
    await inbox
      .getByRole("button", { name: "Accetta invito ed entra" })
      .click();
    await expect(
      guest.getByRole("heading", { name: workspaceName, exact: true }),
    ).toBeVisible();
    await expect(
      guest
        .locator("main > header")
        .getByRole("button", { name: "Invita", exact: true }),
    ).toHaveCount(0);
  }
  async function createdSpace(page: Page, name: string) {
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const id = new URL(page.url()).searchParams.get("workspace");
    expect(id).toBeTruthy();
    return id!;
  }
  try {
    await register(owner, "Founder Inviti", `creator-${tag}@example.test`);
    await register(guest, guestName, guestEmail);
    const first = `Startup ${tag.slice(0, 8)}`;
    await fillWorkspaceName(owner, first);
    const form = owner.getByRole("region", { name: "Creazione spazio" });
    await expect(form).toBeVisible();
    await expect(
      owner.getByRole("region", { name: "Personale", exact: true }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("region", { name: "Agenda personale", exact: true }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("region", {
        name: "Elenco degli spazi disponibili",
        exact: true,
      }),
    ).toHaveCount(0);
    await people.fill(guestName);
    await expect(
      owner.getByText(/Nessun contatto con questo nome/),
    ).toBeVisible();
    await people.fill(guestEmail);
    await owner
      .getByRole("button", { name: `Aggiungi ${guestEmail}`, exact: true })
      .click();
    await confirm.check();
    await owner.getByRole("button", { name: `Rimuovi ${guestEmail}` }).click();
    await expect(confirm).toHaveCount(0);
    await people.fill(guestEmail);
    // Typing a complete email and pressing Create is sufficient on a phone keyboard.
    await expect(confirm).not.toBeChecked();
    await create.click();
    await expect(confirm).toBeFocused();
    await confirm.check();
    if (browserName === "webkit") await create.tap();
    else await create.click();
    const firstId = await createdSpace(owner, first);
    await expect(
      owner.getByRole("status").filter({ hasText: "Le persone invitate" }),
    ).toBeVisible();
    await enterAsGuest(first, firstId);
    const reply = "Sono entrata nello spazio " + tag;
    const compose = await openMessageComposer(guest);
    await compose.fill(reply);
    await guest.getByRole("button", { name: "Invia", exact: true }).click();
    await expect(owner.locator(".messages")).toContainText(reply);
    const navigation = guest.getByRole("button", { name: "Apri navigazione" });
    if (await navigation.isVisible()) await navigation.click();
    await guest
      .getByRole("navigation", { name: "Navigazione personale" })
      .getByRole("button", { name: "Configura Emme" })
      .click();
    const settings = guest.getByRole("dialog", { name: "Configura Emme" });
    await expect(settings.getByLabel("Modello o agente")).toBeDisabled();
    await expect(
      settings.getByRole("button", { name: "Salva impostazioni" }),
    ).toHaveCount(0);
    await settings.getByRole("button", { name: "Chiudi" }).click();
    const navigationDrawer = guest.getByRole("dialog", {
      name: "Menu di navigazione",
    });
    if (await navigationDrawer.isVisible()) {
      await navigationDrawer
        .getByRole("button", { name: "Chiudi navigazione" })
        .click();
    }

    await owner.goto("/");
    await expect(
      owner.getByRole("region", { name: "Elenco degli spazi disponibili" }),
    ).toBeVisible({ timeout: 75000 });
    await owner
      .getByRole("button", { name: "Crea un nuovo spazio", exact: true })
      .click();
    await owner.getByRole("button", { name: "Torna ai tuoi spazi" }).click();
    await expect(
      owner.getByRole("heading", { name: "I tuoi spazi", exact: true }),
    ).toBeVisible();
    await expect(
      owner.getByRole("region", { name: "Personale", exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "Crea un nuovo spazio", exact: true })
      .click();
    const second = `Beta ${tag.slice(0, 8)}`;
    await fillWorkspaceName(owner, second);
    await people.fill("Giulia");
    const contacts = owner.getByRole("list", { name: "Contatti personali" });
    await expect(contacts).toHaveText(guestName);
    await contacts
      .getByRole("button", { name: `Aggiungi ${guestName}`, exact: true })
      .click();
    await expect(
      owner.getByRole("list", { name: "Persone da invitare" }),
    ).toHaveText(guestName);
    await confirm.check();
    await info.attach("Creazione con contatto selezionato", {
      body: await owner.screenshot(),
      contentType: "image/png",
    });
    await create.click();
    const secondId = await createdSpace(owner, second);
    expect(secondId).not.toBe(firstId);
    const outgoing = await owner.request.get(`/api/workspaces/${secondId}`);
    expect(outgoing.ok()).toBe(true);
    expect((await outgoing.json()).invitations).toEqual([
      expect.objectContaining({
        recipient_name: guestName,
        recipient_email: "",
      }),
    ]);
    await enterAsGuest(second, secondId);
    expect(new URL(guest.url()).searchParams.get("workspace")).toBe(secondId);
  } finally {
    await guestContext.close();
  }
});

test("an invitee without an account follows the creation email link through registration into the original chat", async ({
  page: owner,
  browser,
}) => {
  const tag = crypto.randomUUID();
  const email = "invited-" + tag + "@example.test";
  const name = "Lancio " + tag.slice(0, 8);
  await register(owner, "Founder", "founder-" + tag + "@example.test");
  await fillWorkspaceName(owner, name);
  await owner.getByRole("textbox", { name: /Invita persone/ }).fill(email);
  await owner.getByLabel(/Confermo che chi accetta/).check();
  await owner
    .getByRole("button", { name: "Crea spazio e invita", exact: true })
    .click();
  await expect(owner.getByRole("heading", { name, exact: true })).toBeVisible();
  const workspace = new URL(owner.url()).searchParams.get("workspace");
  // Inspect the message the isolated worker would send. Never create an HTTP endpoint for this.
  const database = new URL(process.env.DATABASE_URL!);
  if (
    process.env.MIRIAM_E2E !== "true" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    !/^\/miriam_e2e(?:_\d+)?$/.test(database.pathname)
  )
    throw new Error("Local E2E mailbox required");
  const delivered = await pool.query<{ id: string; encrypted_link: string }>(
    "SELECT i.id,d.encrypted_link FROM invitation i JOIN invitation_delivery d ON i.id=d.invitation_id WHERE i.workspace_id=$1 AND i.recipient_email=$2",
    [workspace, email],
  );
  expect(delivered.rows).toHaveLength(1);
  const row = delivered.rows[0];
  const link = new URL(
    decryptAccountLink(
      row.encrypted_link,
      JSON.stringify(["invitation", row.id, "link"]),
    ),
  );
  expect(link.origin).toBe(new URL(owner.url()).origin);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const guest = await context.newPage();
    await register(guest, "Giulia", email, link.pathname + link.search);
    await expect(
      guest.getByRole("heading", { name: "Entra in " + name }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Crea un nuovo spazio", exact: true }),
    ).toHaveCount(0);
    const notice = guest.getByLabel(/Accetto esplicitamente di entrare/);
    await expect(notice).not.toBeChecked();
    await notice.check();
    await guest
      .getByRole("button", { name: "Accetta invito ed entra" })
      .click();
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(new URL(guest.url()).searchParams.get("workspace")).toBe(workspace);
  } finally {
    await context.close();
  }
});

test("a lost creation response recovers the original workspace and its single invitation", async ({
  page,
}) => {
  const tag = crypto.randomUUID();
  const name = "Ricevuta " + tag.slice(0, 8);
  const email = "recipient-" + tag + "@example.test";
  await register(page, "Founder", "creator-" + tag + "@example.test");
  await fillWorkspaceName(page, name);
  await page.getByRole("textbox", { name: /Invita persone/ }).fill(email);
  await page
    .getByRole("button", { name: "Aggiungi " + email, exact: true })
    .click();
  await page.getByLabel(/Confermo che chi accetta/).check();

  const ids: string[] = [];
  let committed = false;
  await page.route("**/api/v1/workspaces", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    ids.push(route.request().postDataJSON().commandId);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json()).id).toBe(ids[0]);
    committed = true;
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Crea spazio e invita", exact: true })
    .click();
  await expect.poll(() => committed).toBe(true);
  await page.reload();
  const pending = page.getByRole("region", {
    name: "Operazioni da verificare",
  });
  await expect(pending).toContainText("Creazione di uno spazio");
  await pending
    .getByRole("button", { name: "Verifica esito", exact: true })
    .click();
  await expect(pending).not.toBeVisible();
  expect(ids).toHaveLength(1);
  const result = await page.request.get("/api/workspaces/" + ids[0]);
  expect(result.ok()).toBe(true);
  const state = await result.json();
  expect(state.workspace.name).toBe(name);
  expect(state.invitations).toMatchObject([
    { recipient_email: email, accepted_at: null },
  ]);
  expect(
    state.members.filter((m: { active: boolean }) => m.active),
  ).toHaveLength(1);
});

test("several incoming invitations leave the mobile Home and chat readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(
    page,
    "Membro di prova",
    "inbox-" + crypto.randomUUID() + "@example.test",
  );
  const workspace = "Gruppo ospitante";
  await fillWorkspaceName(page, workspace);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: workspace, exact: true }),
  ).toBeVisible();
  const original = new URL(page.url());
  const invitations = [
    "Preparazione della demo con il gruppo di sviluppo",
    "Pianificazione degli incontri con i collaboratori",
  ].map((workspaceName) => ({
    id: crypto.randomUUID(),
    workspaceName,
    inviterName: "Una persona con un nome molto lungo",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }));
  // Isolate this layout regression from the invitation issuance and acceptance flows above.
  await page.route("**/api/v1/invitations", (route) =>
    route.fulfill({ json: { invitations } }),
  );
  for (const path of ["/", original.pathname + original.search]) {
    await page.goto(path);
    const inbox = page.getByRole("region", { name: "Inviti ricevuti" });
    const toggle = inbox.getByRole("button", { name: "Mostra 2 inviti" });
    await expect(toggle).toBeVisible();
    expect((await inbox.boundingBox())!.height).toBeLessThan(110);
    await toggle.click();
    await expect(inbox.locator("summary")).toHaveCount(2);
    await inbox.locator("summary").first().click();
    await expect(inbox.getByRole("checkbox").first()).not.toBeChecked();
    await inbox.getByRole("button", { name: "Nascondi inviti" }).click();
    await expect(inbox.locator("summary")).toHaveCount(0);
  }
});
