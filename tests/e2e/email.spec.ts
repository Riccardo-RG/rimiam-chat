import { test, expect } from "./backend-fixture";
import { register, openWorkspacePanel } from "./helpers";
import { pool } from "../../src/server/db";
import { establishMailbox } from "../../src/server/email-state";
import { FixtureEmail } from "../support/fixture-email";
test("Email web: private read, selected disclosure, exact forward, response loss and reconciliation", async ({
  page,
}) => {
  test.setTimeout(120000);
  const email = `email-web-${crypto.randomUUID()}@example.test`;
  await register(page, "Email Web", email);
  await page
    .getByLabel("Nuovo spazio", { exact: true })
    .fill("Email web verification");
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
  await region.getByLabel("Ricerca nella mailbox").fill("locale");
  await region
    .getByRole("button", {
      name: "Cerca privatamente · Mailbox test web",
      exact: true,
    })
    .click();
  await expect(
    region.getByRole("button", { name: "Prepara forward", exact: true }),
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
    .getByRole("button", { name: "Prepara forward", exact: true })
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
      name: "Prepara proposta di invio esatta",
      exact: true,
    })
    .click();
  const action = region.locator('[data-testid^="email-action-"]');
  await expect(action).toContainText("PROPOSED");
  await expect(action).toContainText("hidden@example.test");
  await expect(action).not.toContainText("Dettaglio privato");
  await action
    .getByRole("button", {
      name: "Autorizzo invio e disclosure per me",
      exact: true,
    })
    .click();
  await expect(action).toContainText("OUTCOME_UNKNOWN", { timeout: 20000 });
  await page.reload();
  await openWorkspacePanel(page, "email");
  await expect(action).toContainText("OUTCOME_UNKNOWN");
  await expect(
    action.getByRole("button", { name: "Riprova stesso invio", exact: true }),
  ).toHaveCount(0);
  await action
    .getByRole("button", { name: "Verifica esito email", exact: true })
    .click();
  await expect(action).toContainText("SUCCEEDED", { timeout: 20000 });
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
