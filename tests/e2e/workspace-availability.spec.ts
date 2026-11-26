import { test, expect } from "./backend-fixture";
import {
  fillWorkspaceName,
  messageComposer,
  openMessageComposer,
  register,
} from "./helpers";

test("a tool that fails to load leaves the existing chat draft usable", async ({
  page,
}) => {
  test.skip(
    !["build", "start"].includes(process.env.MIRIAM_E2E_SERVER ?? ""),
    "Requires production chunks without the development error overlay",
  );
  await register(page, "Ada", `panel-${crypto.randomUUID()}@example.test`);
  const name = "Revisione documenti";
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const draft = "Rileggo il documento prima della riunione";
  await (await openMessageComposer(page)).fill(draft);
  const scripts = /\/_next\/static\/chunks\/[^?]+\.js(?:\?|$)/;
  await page.route(scripts, (route) => route.abort("failed"));
  const shared = page
    .getByRole("navigation", { name: "Viste dello spazio" })
    .getByRole("button", { name: "Condivisi", exact: true });
  await shared.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Impossibile aprire questo pannello." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Torna alla conversazione" }).click();
  await expect(messageComposer(page)).toHaveValue(draft);
  await page.unroute(scripts);
  await shared.click();
  await page.getByRole("button", { name: "Ricarica la pagina" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  if (
    !(await page
      .getByRole("button", { name: "Allega file", exact: true })
      .isVisible())
  )
    await shared.click();
  await expect(
    page.getByRole("button", { name: "Nuova nota", exact: true }),
  ).toBeVisible();
});

test("Home distinguishes pending and failed reads from an empty list, and connection recovery preserves the message draft", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  await register(
    page,
    "Availability",
    `availability-${crypto.randomUUID()}@example.test`,
  );
  let listMode: "pending" | "failed" | "ready" = "pending";
  let releaseList = () => {};
  const listGate = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route("**/api/workspaces", async (route) => {
    if (listMode === "pending") {
      await listGate;
      await route.abort("failed");
    } else if (listMode === "failed") await route.abort("failed");
    else await route.continue();
  });
  try {
    await page.reload();
    const list = page.getByRole("region", { name: "Elenco degli spazi" });
    await expect(list.getByRole("status")).toHaveText(
      "Caricamento dei tuoi spazi…",
    );
    await expect(
      page.getByRole("button", { name: "Crea un nuovo spazio", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByText("Non hai ancora spazi.", { exact: false }),
    ).not.toBeVisible();
    listMode = "failed";
    releaseList();
    await expect(list.getByRole("alert")).toContainText(
      "Non riesco a caricare i tuoi spazi.",
    );
    await expect(
      page.getByRole("button", { name: "Crea un nuovo spazio", exact: true }),
    ).not.toBeVisible();
    listMode = "ready";
    await list
      .getByRole("button", {
        name: "Riprova a caricare gli spazi",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Crea un nuovo spazio", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Non hai ancora spazi.", { exact: false }),
    ).toBeVisible();
    await page.unroute("**/api/workspaces");

    const streamOpened = page.waitForResponse(
      (response) =>
        /\/api\/workspaces\/[^/]+\/events$/.test(
          new URL(response.url()).pathname,
        ) && response.ok(),
    );
    await fillWorkspaceName(page, "Continuità della bozza");
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    const composer = await openMessageComposer(page);
    expect((await streamOpened).headers()["content-type"]).toContain(
      "text/event-stream",
    );
    await expect(page.locator(".connection-notice")).not.toBeVisible();
    const workspace = new URL(page.url()).searchParams.get("workspace")!;
    const draft = "Questa bozza deve restare durante la riconnessione.";
    await composer.fill(draft);
    let snapshotUnavailable = true;
    await page.route(`**/api/workspaces/${workspace}`, async (route) => {
      if (snapshotUnavailable) await route.abort("failed");
      else await route.continue();
    });
    await context.setOffline(true);
    await expect(
      page.getByRole("status").filter({ hasText: "Sei offline." }),
    ).toBeVisible();
    await expect(composer).toHaveValue(draft);
    await context.setOffline(false);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Non riesco ad aggiornare lo spazio." }),
    ).toBeVisible();
    await expect(composer).toHaveValue(draft);
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/workspaces/${workspace}` &&
        response.ok(),
    );
    snapshotUnavailable = false;
    await refreshed;
    await expect(page.locator(".connection-notice")).not.toBeVisible();
    await openMessageComposer(page);
    await expect(composer).toHaveValue(draft);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Non riesco a raggiungere il servizio." }),
    ).not.toBeVisible();
  } finally {
    releaseList();
    await context.setOffline(false);
  }
});

test("invitation and list retries preserve the selected Workspace, and a real loss of access clears the loaded snapshot", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  // Live code replacement is a development transport, unrelated to invitation or workspace sync.
  for (const page of [owner, guest])
    await page.routeWebSocket(/\/_next\/webpack-hmr(?:\?|$)/, () => {});
  const suffix = crypto.randomUUID();
  const guestEmail = `giulia-${suffix.slice(0, 8)}@example.test`;
  const invitedName = "Lancio di RIMIAM";
  const existingName = `Existing availability ${suffix}`;
  const history =
    "Un riferimento condiviso prima dell’ingresso del nuovo partecipante.";
  let releaseInvitation = () => {};
  let releaseList = () => {};
  try {
    await register(
      owner,
      "Availability owner",
      `availability-owner-${suffix}@example.test`,
    );
    await fillWorkspaceName(owner, invitedName);
    await owner
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: invitedName, exact: true }),
    ).toBeVisible();
    const workspace = new URL(owner.url()).searchParams.get("workspace")!;
    const origin = new URL(owner.url()).origin;
    const composer = await openMessageComposer(owner);
    await composer.fill(history);
    await owner.getByRole("button", { name: "Invia", exact: true }).click();
    await expect(owner.locator(".messages")).toContainText(history);
    const invitation = await owner.request.post(
      `/api/workspaces/${workspace}/commands`,
      {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "invitation.create",
            email: guestEmail,
            fullHistoryDisclosed: true,
          },
        },
      },
    );
    expect(invitation.ok()).toBe(true);
    const { token } = await invitation.json();
    // Changing accounts on an invitation must retain the URL without disclosing its recipient.
    await owner.goto(`/?invite=${token}`);
    const denied = owner.getByRole("region", { name: "Invito allo spazio" });
    await expect(denied.getByRole("alert")).toContainText("email invitata");
    await expect(denied).not.toContainText(guestEmail);
    await expect(denied).not.toContainText(invitedName);
    await expect(
      owner.getByRole("button", {
        name: "Apri il modulo per creare uno spazio",
        exact: true,
      }),
    ).not.toBeVisible();
    await denied
      .getByRole("button", { name: "Accedi con un altro account" })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Accedi per aprire l’invito" }),
    ).toBeVisible();
    expect(new URL(owner.url()).searchParams.get("invite")).toBe(token);
    await owner.goto("/?invite=incompleto");
    await expect(
      owner.getByRole("heading", { name: "Link d’invito incompleto" }),
    ).toBeVisible();
    await register(guest, "Availability guest", guestEmail);
    const workspaceInvite = guest.getByRole("region", {
      name: "Inviti ricevuti",
    });
    await expect(workspaceInvite).toContainText(invitedName);
    await expect(workspaceInvite.getByRole("checkbox")).toBeVisible();
    await expect(workspaceInvite.getByRole("checkbox")).not.toBeChecked();
    await expect(
      guest.getByRole("button", { name: "Crea spazio", exact: true }),
    ).not.toBeVisible();
    await guest
      .getByRole("button", { name: "Crea un nuovo spazio", exact: true })
      .click();
    await fillWorkspaceName(guest, existingName);
    await guest
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: existingName, exact: true }),
    ).toBeVisible();
    const existingWorkspace = new URL(guest.url()).searchParams.get(
      "workspace",
    )!;
    await expect(workspaceInvite).toContainText(invitedName);
    await workspaceInvite.getByText("Vedi invito", { exact: true }).click();
    await expect(workspaceInvite.getByRole("checkbox")).not.toBeChecked();
    expect(
      (await guest.request.get(`/api/workspaces/${workspace}`)).status(),
    ).toBe(403);

    let invitationMode: "pending" | "failed" | "ready" = "pending";
    const invitationGate = new Promise<void>((resolve) => {
      releaseInvitation = resolve;
    });
    await guest.route(`**/api/invitations/${token}`, async (route) => {
      if (route.request().method() !== "GET" || invitationMode === "ready") {
        await route.continue();
      } else if (invitationMode === "pending") {
        await invitationGate;
        await route.abort("failed");
      } else await route.abort("failed");
    });
    let listMode: "ready" | "failed" | "pending" = "ready";
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    await guest.route("**/api/workspaces", async (route) => {
      if (listMode === "failed") await route.abort("failed");
      else {
        if (listMode === "pending") await listGate;
        await route.continue();
      }
    });
    await guest.goto(`/?returnTo=${encodeURIComponent(`/?invite=${token}`)}`);
    const invitationRead = guest.getByRole("region", {
      name: "Invito allo spazio",
    });
    await expect(invitationRead.getByRole("status")).toHaveText(
      "Caricamento dell’invito…",
    );
    await expect(
      guest
        .getByRole("navigation", { name: "I tuoi spazi", exact: true })
        .getByRole("button", { name: existingName, exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Crea spazio", exact: true }),
    ).not.toBeVisible();
    invitationMode = "failed";
    releaseInvitation();
    await expect(invitationRead.getByRole("alert")).toContainText(
      "Non riesco ad aprire l’invito.",
    );
    await expect(
      guest.getByRole("button", { name: "Crea spazio", exact: true }),
    ).not.toBeVisible();
    invitationMode = "ready";
    await invitationRead
      .getByRole("button", { name: "Riprova ad aprire l’invito", exact: true })
      .click();
    await expect(
      invitationRead.getByRole("heading", { name: `Entra in ${invitedName}` }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", {
        name: "Apri il modulo per creare uno spazio",
        exact: true,
      }),
    ).not.toBeVisible();
    await invitationRead.screenshot({
      path: info.outputPath("invito-destinatario.png"),
    });
    await expect(
      guest.getByRole("heading", {
        name: `Entra in ${invitedName}`,
        exact: true,
      }),
    ).toBeVisible();
    await guest
      .getByLabel(
        "Accetto esplicitamente di entrare con questa visibilità della storia.",
        { exact: true },
      )
      .check();
    listMode = "failed";
    await guest
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: invitedName, exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".messages")).toContainText(history);
    const list = guest.getByRole("region", { name: "Elenco degli spazi" });
    await expect(list.getByRole("alert")).toContainText(
      "Non riesco a caricare i tuoi spazi.",
    );
    listMode = "pending";
    await list
      .getByRole("button", {
        name: "Riprova a caricare gli spazi",
        exact: true,
      })
      .click();
    await expect(list.getByRole("status")).toBeVisible();
    await guest
      .getByRole("navigation", { name: "I tuoi spazi", exact: true })
      .getByRole("button", { name: existingName, exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: existingName, exact: true }),
    ).toBeVisible();
    listMode = "ready";
    releaseList();
    const invitedSpace = guest
      .getByRole("navigation", { name: "I tuoi spazi", exact: true })
      .getByRole("button", { name: invitedName, exact: true });
    await expect(invitedSpace).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: existingName, exact: true }),
    ).toBeVisible();
    expect(new URL(guest.url()).searchParams.get("workspace")).toBe(
      existingWorkspace,
    );
    expect(new URL(guest.url()).searchParams.has("invite")).toBe(false);
    await expect(
      guest.getByRole("heading", {
        name: `Entra in ${invitedName}`,
        exact: true,
      }),
    ).not.toBeVisible();

    const streamOpened = guest.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/workspaces/${workspace}/events` && response.ok(),
    );
    await invitedSpace.click();
    await expect(guest.locator(".messages")).toContainText(history);
    expect((await streamOpened).headers()["content-type"]).toContain(
      "text/event-stream",
    );
    await expect(guest.locator(".connection-notice")).not.toBeVisible();
    const leave = await guest.request.post(
      `/api/workspaces/${workspace}/commands`,
      {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "member.leave", confirmed: true },
        },
      },
    );
    expect(leave.ok()).toBe(true);
    await expect(
      guest
        .getByRole("alert")
        .filter({ hasText: "Non hai più accesso a questo spazio." }),
    ).toBeVisible();
    await expect(
      guest.getByRole("textbox", { name: "Messaggio", exact: true }),
    ).not.toBeVisible();
    await expect(messageComposer(guest)).not.toBeVisible();
    await expect(guest.getByText(history, { exact: true })).not.toBeVisible();
    expect(
      (await guest.request.get(`/api/workspaces/${workspace}`)).status(),
    ).toBe(403);
  } finally {
    releaseInvitation();
    releaseList();
    await ownerContext.close();
    await guestContext.close();
  }
});
