import { test, expect } from "./backend-fixture";
import { fillWorkspaceName, register, openWorkspacePanel } from "./helpers";
import { pool } from "../../src/server/db";
import { establishMailbox } from "../../src/server/email-state";
import { FixtureEmail } from "../support/fixture-email";
test("Email web: private read, selected disclosure, exact forward, response loss and reconciliation", async ({
  page,
}) => {
  test.setTimeout(120000);
  const email = `email-web-${crypto.randomUUID()}@example.test`;
  await register(page, "Email Web", email);
  await fillWorkspaceName(page, "Email web verification");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await openWorkspacePanel(page, "email");
  const region = page.getByRole("region", { name: "Email dello spazio" });
  await expect(region).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  const u = (await pool.query('SELECT id FROM "user" WHERE email=$1', [email]))
    .rows[0];
  const session = (
    await pool.query(
      'SELECT id FROM session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
      [u.id],
    )
  ).rows[0];
  await establishMailbox(
    u.id,
    w,
    session.id,
    new FixtureEmail(),
    email,
    "Mailbox test web",
  );
  await region.getByLabel("Cerca nella tua posta").fill("locale");
  await region
    .getByRole("button", {
      name: "Cerca privatamente · Mailbox test web",
      exact: true,
    })
    .click();
  await expect(
    region.getByRole("button", { name: "Prepara inoltro", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    (
      await pool.query(
        "SELECT id FROM email_disclosure WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
  const excerpt = "Il locale è disponibile venerdì.";
  await region
    .getByLabel("Estratto da condividere", { exact: true })
    .fill(excerpt);
  await region
    .getByRole("button", {
      name: "Condividi questo estratto nello spazio",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "SELECT s.content FROM workspace_source s JOIN email_disclosure d ON d.source_id=s.id WHERE d.workspace_id=$1",
            [w],
          )
        ).rows,
    )
    .toEqual([{ content: excerpt }]);
  expect(
    (
      await pool.query(
        "SELECT id FROM accepted_information WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
  await region
    .getByRole("button", { name: "Prepara inoltro", exact: true })
    .click();
  const title = "Forward web [response-loss]";
  await region.getByLabel("Oggetto email", { exact: true }).fill(title);
  await region.getByLabel("Corpo email", { exact: true }).fill(excerpt);
  // Type rather than fill to exercise comma-separated recipient editing.
  await region
    .getByLabel("Email TO", { exact: true })
    .pressSequentially("guest@example.test, colleague@example.test");
  await region
    .getByLabel("Email BCC", { exact: true })
    .fill("hidden@example.test");
  await region
    .getByLabel("Motivo bozza", { exact: true })
    .fill("Inoltro del solo estratto selezionato");
  await region
    .getByRole("button", { name: "Salva bozza interna", exact: true })
    .click();
  const draft = region.getByRole("article", { name: `Bozza: ${title}` });
  await expect(draft).toBeVisible();
  expect(
    (await pool.query("SELECT id FROM email_send WHERE workspace_id=$1", [w]))
      .rowCount,
  ).toBe(0);
  await draft
    .getByRole("button", {
      name: "Controlla invio",
      exact: true,
    })
    .click();
  const action = region.locator('[data-testid^="email-action-"]');
  await expect(action).toContainText("Da autorizzare");
  await expect(action).toContainText("hidden@example.test");
  await expect(action).not.toContainText("Dettaglio privato");
  await action
    .getByRole("button", {
      name: "Autorizza e invia",
      exact: true,
    })
    .click();
  await expect(action).toContainText("Esito da verificare", { timeout: 20000 });
  await page.reload();
  await openWorkspacePanel(page, "email");
  await expect(action).toContainText("Esito da verificare");
  await expect(
    action.getByRole("button", { name: "Riprova stesso invio", exact: true }),
  ).toHaveCount(0);
  await action
    .getByRole("button", { name: "Verifica l’invio", exact: true })
    .click();
  await expect(action).toContainText("Richiesta accettata", { timeout: 20000 });
  const rows = (
    await pool.query(
      "SELECT a.receipt,v.envelope FROM email_send a JOIN email_draft_version v ON v.draft_id=a.draft_id AND v.version=a.draft_version WHERE a.workspace_id=$1",
      [w],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].receipt.evidence).toBe("provider_accepted");
  expect(rows[0].envelope).toMatchObject({
    kind: "forward",
    body: excerpt,
    to: ["guest@example.test", "colleague@example.test"],
    attachments: [],
    target: { messageId: "message-1" },
  });
  await draft
    .getByRole("button", { name: "Storia privata della bozza", exact: true })
    .click();
  await expect(region.locator("pre").last()).toContainText("commit_point");
});

test("Web mailbox connections distinguish providers, preserve the unsaved draft and leave send for explicit review", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const seed = crypto.randomUUID();
  const name = "Caselle " + seed;
  await register(page, "Tester delle caselle", `caselle-${seed}@example.test`);
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const workspace = new URL(page.url()).searchParams.get("workspace")!;
  await page.goto("/?workspace=" + workspace + "&panel=email");
  const area = page.getByRole("region", { name: "Collega una casella" });
  await expect(
    area.getByRole("heading", { name: "Le tue caselle" }),
  ).toBeVisible();
  await page.getByText("Scrivi una bozza", { exact: true }).click();
  const subject = page.getByLabel("Oggetto email", { exact: true });
  await subject.fill("Preventivo da rileggere");
  const [guide] = await Promise.all([
    context.waitForEvent("page"),
    area.getByRole("link", { name: "Come collegare la posta" }).click(),
  ]);
  await expect(guide).toHaveURL(/\/connessioni-e-dati#posta$/);
  await expect(
    guide.getByRole("heading", { name: "Come collegare la posta" }),
  ).toBeInViewport();
  await guide.getByText("Gestisci tu l’installazione?").click();
  await expect(guide.getByText("GOOGLE_OAUTH_CAPABILITIES")).toBeVisible();
  await guide.close();
  await expect(subject).toHaveValue("Preventivo da rileggere");
  if (process.env.MIRIAM_E2E_MAILBOX_OAUTH === "true") {
    // Inspect the first-party redirect itself. A browser route targeting the
    // *destination* cannot stop every HTTP redirect in a navigation chain.
    const origin = new URL(page.url()).origin;
    const authorizedHosts = new Map<string, string>();
    await context.route(
      origin + "/api/v1/integrations/*/launch?*",
      async (route) => {
        const local = new URL(route.request().url());
        const response = await route.fetch({ maxRedirects: 0 });
        const target = new URL(response.headers().location);
        authorizedHosts.set(local.pathname, target.hostname);
        expect([302, 303]).toContain(response.status());
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<title>Provider di prova</title><p>Confine di consenso.</p>",
        });
      },
    );
    for (const [service, id, host] of [
      ["Gmail", "google", "accounts.google.com"],
      ["Outlook", "microsoft", "login.microsoftonline.com"],
    ]) {
      if (
        id === "google" &&
        process.env.MIRIAM_E2E_GOOGLE_CAPABILITIES === "calendar"
      ) {
        await expect(
          area.getByText("Non abilitato su questa installazione", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          area.getByRole("button", { name: "Collega Gmail" }),
        ).toHaveCount(0);
        continue;
      }
      const [consent, start] = await Promise.all([
        context.waitForEvent("page"),
        page.waitForRequest(
          (req) =>
            req.method() === "POST" &&
            req.url().endsWith("/" + id + "-connect"),
        ),
        area
          .getByRole("button", { name: "Collega " + service, exact: true })
          .click(),
      ]);
      expect(start.postDataJSON()).toEqual({ capability: "email" });
      await expect(consent.getByText("Confine di consenso.")).toBeVisible();
      expect(new URL(consent.url()).origin).toBe(origin);
      expect(
        authorizedHosts.get("/api/v1/integrations/" + id + "/launch"),
      ).toBe(host);
      await consent.close();
      await expect(subject).toHaveValue("Preventivo da rileggere");
    }
  } else {
    await expect(
      area.getByText("In attesa di configurazione dal gestore", {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(area.getByRole("button", { name: /^Collega / })).toHaveCount(
      0,
    );
  }
  const retained = await pool.query(
    "SELECT id FROM email_send WHERE workspace_id=$1",
    [workspace],
  );
  expect(retained.rowCount).toBe(0);
});
