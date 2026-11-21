import {
  expect,
  type APIResponse,
  type Page,
  type Response,
  type Route,
} from "@playwright/test";

/** Delay real reads across a real command without letting the next poll hide a rollback. */
export async function holdWorkspaceReadsAcrossCommand(
  page: Page,
  workspace: string,
  capability: "active-work" | "tasks",
  commandType: "work.converse" | "task.accept",
  readCount: number,
) {
  const path = `/api/v1/workspaces/${workspace}/${capability}`;
  const pattern = (url: URL) => url.pathname === path;
  const held: { route: Route; response: APIResponse }[] = [];
  let committed: Response | undefined;
  let fresh: APIResponse | undefined;
  let freshStarted = false;
  let closed = false;
  let releaseOld = () => {};
  let releaseLater = () => {};
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const laterGate = new Promise<void>((resolve) => {
    releaseLater = resolve;
  });
  const commandResponse = (response: Response) => {
    if (
      new URL(response.url()).pathname ===
        `/api/v1/workspaces/${workspace}/commands` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.command?.type === commandType
    )
      committed = response;
  };
  page.on("response", commandResponse);
  const intercept = async (route: Route) => {
    if (closed) return route.continue();
    if (!committed) {
      const response = await route.fetch();
      held.push({ route, response });
      await oldGate;
      await route.fulfill({ response });
    } else if (committed.ok() && !freshStarted) {
      // Only a read started after the real command response may publish the new state.
      freshStarted = true;
      const response = await route.fetch();
      fresh = response;
      await route.fulfill({ response });
    } else {
      await laterGate;
      await route.continue();
    }
  };
  await page.route(pattern, intercept);
  return {
    async captured() {
      await expect.poll(() => held.length).toBeGreaterThanOrEqual(readCount);
      return held.map(({ response }) => response);
    },
    async refreshed() {
      await expect.poll(() => committed !== undefined).toBe(true);
      expect(committed!.ok(), `Command returned ${committed!.status()}`).toBe(
        true,
      );
      await expect.poll(() => fresh !== undefined).toBe(true);
      expect(fresh!.ok()).toBe(true);
      return fresh!;
    },
    async releaseStale() {
      const delivered = held.map(({ route }) =>
        page.waitForEvent("requestfinished", {
          predicate: (request) => request === route.request(),
        }),
      );
      releaseOld();
      await Promise.all(delivered);
      // Wait for React to paint delivered responses while later polls remain held.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
    async close() {
      closed = true;
      releaseOld();
      releaseLater();
      page.off("response", commandResponse);
      await page.unroute(pattern, intercept);
    },
  };
}

export async function openWorkspacePanel(
  page: Page,
  panel:
    | "goal"
    | "attention"
    | "context"
    | "work"
    | "sources"
    | "artifacts"
    | "calendar"
    | "email"
    | "people",
  { dock = true }: { dock?: boolean } = {},
) {
  const close = page.getByRole("button", {
    name: "Torna alla conversazione",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  await expect(
    page.getByRole("heading", { name: "Conversazione", exact: true }),
  ).toBeVisible();
  const destination = {
    goal: "Direzione",
    attention: "Attività e argomenti",
    context: "Contesto",
    work: "In programma",
    sources: "Fonti e ricerca",
    artifacts: "Condivisi",
    calendar: "Calendario",
    email: "Email",
    people: "Persone e accesso",
  }[panel];
  const openNavigation = page.getByRole("button", {
    name: "Apri navigazione",
    exact: true,
  });
  const primary = panel === "artifacts";
  if (!primary && (await openNavigation.isVisible()))
    await openNavigation.click();
  const navigation = page.getByRole("navigation", {
    name: primary ? "Viste dello spazio" : "Strumenti dello spazio",
    exact: true,
  });
  if (!primary && !(await navigation.isVisible()))
    await page
      .getByRole("complementary", { name: "Navigazione principale" })
      .getByText("Strumenti", { exact: true })
      .click();
  await navigation
    .getByRole("button", { name: destination, exact: true })
    .click();
  const layer = page.getByRole("dialog", {
    name:
      panel === "goal"
        ? "La direzione"
        : panel === "context"
          ? "Contesto condiviso"
          : panel === "work"
            ? "In programma"
            : destination,
    exact: true,
  });
  await expect(layer).toBeVisible();
  // Capability specs keep the conversation available while inspecting its state.
  const dockLayer = layer.getByRole("button", {
    name: "Affianca",
    exact: true,
  });
  if (dock && (await dockLayer.isVisible())) await dockLayer.click();
}

export async function chooseContextView(
  page: Page,
  name: "Riferimenti" | "Da valutare" | "Domande",
) {
  const inspect = page.getByRole("button", {
    name: "Consulta riferimenti e proposte",
    exact: true,
  });
  if (await inspect.isVisible()) await inspect.click();
  await page
    .getByRole("group", { name: "Sezioni del contesto" })
    .getByRole("button", { name, exact: true })
    .click();
}

export async function expandContextRecord(
  page: Page,
  view: "Riferimenti" | "Da valutare",
  text: string,
) {
  await chooseContextView(page, view);
  const row = page
    .locator(view === "Riferimenti" ? ".information" : ".proposal")
    .filter({ hasText: text })
    .first();
  await expect(row).toBeVisible();
  if (!(await row.evaluate((el) => el.hasAttribute("open"))))
    await row.locator(":scope > summary").click();
  return row;
}

export async function openAccountMenu(page: Page) {
  const summary = page
    .locator("summary")
    .filter({ hasText: "Account personale" });
  if (
    !(await summary.evaluate((element) =>
      element.parentElement?.hasAttribute("open"),
    ))
  )
    await summary.click();
  return summary;
}

export async function openAccountAppearance(page: Page) {
  const account = await openAccountMenu(page);
  const section = page
    .locator(".account-options details")
    .filter({ has: page.locator("summary", { hasText: "Aspetto" }) });
  if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open)))
    await section.locator("summary").click();
  return account;
}

export function messageComposer(page: Page) {
  return page.getByRole("textbox", { name: "Messaggio", exact: true });
}

export async function openMessageComposer(page: Page) {
  const editor = messageComposer(page);
  await expect(editor).toBeVisible();
  await editor.focus();
  return editor;
}

// Production deliberately has no HTTP test mailbox. Only this isolated test process
// can inspect its own local database outbox, before exercising the real verification link.
async function verificationMail(
  page: Page,
  email: string,
): Promise<{ link: string }> {
  if (["build", "start"].includes(process.env.MIRIAM_E2E_SERVER ?? "")) {
    const db = new URL(process.env.DATABASE_URL!);
    if (
      process.env.MIRIAM_E2E !== "true" ||
      !["127.0.0.1", "localhost"].includes(db.hostname) ||
      !/^\/miriam_e2e(?:_\d+)?$/.test(db.pathname)
    )
      throw new Error(
        "The test mailbox requires an isolated local E2E database",
      );
    const { pool } = await import("../../src/server/db");
    const { decryptAccountLink } =
      await import("../../src/server/account-delivery");
    const result = await pool.query(
      "SELECT id,kind,recipient,encrypted_link FROM account_delivery WHERE recipient=$1 AND kind='verification' ORDER BY created_at DESC LIMIT 1",
      [email],
    );
    const row = result.rows[0];
    expect(row).toBeDefined();
    return {
      link: decryptAccountLink(
        row.encrypted_link,
        JSON.stringify([row.id, row.kind, row.recipient]),
      ),
    };
  }
  const response = await page.request.get("/api/local-mail");
  expect(response.ok()).toBeTruthy();
  const mails = (await response.json()) as {
    recipient: string;
    link: string;
  }[];
  const mail = mails.find((item) => item.recipient === email);
  if (!mail)
    throw new Error("Missing verification message in the test mailbox");
  return mail;
}

export async function openWorkspaceCreation(page: Page) {
  const name = page.getByLabel("Nuovo spazio", { exact: true });
  if (!(await name.isVisible())) {
    await page
      .getByRole("button", { name: "Crea un nuovo spazio", exact: true })
      .click();
  }
  return name;
}

export async function fillWorkspaceName(page: Page, name: string) {
  const field = await openWorkspaceCreation(page);
  await field.fill(name);
}

export async function register(
  page: Page,
  name: string,
  email: string,
  destination = "/",
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(destination);
    await page
      .getByRole("button", { name: "Crea un account", exact: true })
      .click();
    await page.getByLabel("Nome", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Local-test-password-2026!");
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/sign-up/email") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Registrati", exact: true }).click();
    const sent = await response;
    if (sent.status() !== 429) break;
    // Honour the actual auth limiter. Do not disable production protections for E2E.
    const seconds = Number(
      sent.headers()["x-retry-after"] ?? sent.headers()["retry-after"] ?? 60,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  await expect(page.getByRole("status")).toContainText(
    "Controlla la tua email",
  );
  const mail = await verificationMail(page, email);
  // A long suite may exhaust the real session-read limiter after verification.
  // Honour Retry-After and reload with the issued session; never disable auth protection.
  for (let attempt = 0; attempt < 3; attempt++) {
    const sessionRead = page.waitForResponse(async (r) => {
      if (!r.url().includes("/api/auth/get-session")) return false;
      if (r.status() === 429) return true;
      // Ignore an earlier unauthenticated page's in-flight session read.
      const body = await r.json().catch(() => null);
      return body?.user?.email === email;
    });
    if (attempt === 0) await page.goto(mail.link);
    else await page.reload();
    const response = await sessionRead;
    if (response.status() !== 429) break;
    const seconds = Number(
      response.headers()["x-retry-after"] ??
        response.headers()["retry-after"] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  const invited = new URL(destination, page.url()).searchParams.has("invite");
  await expect(
    invited
      ? page.getByRole("button", {
          name: "Accetta invito ed entra",
          exact: true,
        })
      : page.getByRole("heading", { name: "I tuoi spazi", exact: true }),
  ).toBeVisible();
}

/** Admit a distinct verified test member through the real shared-history boundary. */
export async function joinTestWorkspace(
  owner: Page,
  guest: Page,
  workspaceName: string,
  guestName: string,
) {
  const workspace = new URL(owner.url()).searchParams.get("workspace");
  expect(workspace).toBeTruthy();
  const email = `guest-${crypto.randomUUID()}@example.test`;
  const invitation = await owner.request.post(
    `/api/workspaces/${workspace}/commands`,
    {
      headers: { Origin: new URL(owner.url()).origin },
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
  expect(invitation.ok()).toBe(true);
  const { token } = await invitation.json();
  await register(guest, guestName, email, `/?invite=${token}`);
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
    guest.getByRole("heading", { name: workspaceName, exact: true }),
  ).toBeVisible();
}
