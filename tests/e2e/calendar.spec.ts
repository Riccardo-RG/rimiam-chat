import { test, expect } from "./backend-fixture";
import { register, openWorkspacePanel } from "./helpers";
import { pool } from "../../src/server/db";
import { establishCalendarConnection } from "../../src/server/calendar-state";
import { FixtureCalendar } from "../support/fixture-calendar";
test("Calendar web: internal state, explicit proposal/approval, unknown outcome, reload and reconciliation", async ({
  page,
}) => {
  test.setTimeout(120000);
  const email = `calendar-web-${crypto.randomUUID()}@example.test`;
  await register(page, "Calendar Web", email);
  await page
    .getByLabel("Nuovo spazio", { exact: true })
    .fill("Calendar web verification");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await openWorkspacePanel(page, "calendar");
  const region = page.getByRole("region", { name: "Calendario dello spazio" });
  await expect(region).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  const user = (
    await pool.query('SELECT id FROM "user" WHERE email=$1', [email])
  ).rows[0];
  const session = (
    await pool.query(
      'SELECT id FROM session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
      [user.id],
    )
  ).rows[0];
  await establishCalendarConnection(
    user.id,
    w,
    session.id,
    new FixtureCalendar(),
    user.id,
    "Calendar test web",
  );
  await page.reload();
  await openWorkspacePanel(page, "calendar");
  await region
    .getByText("Aggiungi appuntamento personale", { exact: true })
    .click();
  const title = "Visita personale [response-loss]";
  await region.getByLabel("Titolo appuntamento", { exact: true }).fill(title);
  const start = new Date(Date.now() + 86400000),
    end = new Date(start.getTime() + 3600000);
  await region
    .getByLabel("Inizio appuntamento", { exact: true })
    .fill(start.toISOString().slice(0, 16));
  await region
    .getByLabel("Fine appuntamento", { exact: true })
    .fill(end.toISOString().slice(0, 16));
  await region
    .getByLabel("Motivo appuntamento", { exact: true })
    .fill("Solo il mio sopralluogo");
  await region.getByRole("checkbox").check();
  await region
    .getByRole("button", { name: "Salva appuntamento interno", exact: true })
    .click();
  await expect(
    region.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  expect(
    (
      await pool.query("SELECT id FROM calendar_action WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(0);
  await region
    .getByRole("button", {
      name: "Proponi pubblicazione su Calendario personale di test",
      exact: true,
    })
    .click();
  const proposed = region.locator('[data-testid^="calendar-action-"]');
  await expect(proposed).toContainText("PROPOSED");
  const actionId = (
    await pool.query("SELECT id FROM calendar_action WHERE workspace_id=$1", [
      w,
    ])
  ).rows[0].id;
  await proposed
    .getByRole("button", {
      name: "Autorizzo questa azione per me",
      exact: true,
    })
    .click();
  await expect(proposed).toContainText("OUTCOME_UNKNOWN", { timeout: 20000 });
  await page.reload();
  await openWorkspacePanel(page, "calendar");
  await expect(proposed).toContainText("OUTCOME_UNKNOWN");
  await expect(
    proposed.getByRole("button", {
      name: "Riprova azione invariata",
      exact: true,
    }),
  ).toHaveCount(0);
  await proposed
    .getByRole("button", { name: "Verifica esito esterno", exact: true })
    .click();
  await expect(proposed).toContainText("SUCCEEDED", { timeout: 20000 });
  expect(
    (
      await pool.query(
        "SELECT id FROM calendar_publication WHERE action_id=$1",
        [actionId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query("SELECT id FROM scheduled_event WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(1);
  await proposed
    .getByRole("button", { name: "Storia e autorizzazioni", exact: true })
    .click();
  await expect(region.locator("pre")).toContainText("commit_point");
  await region.getByText(/^Osservazione esterna riservata ·/).click();
  await region
    .getByRole("button", {
      name: "Proponi modifica interna da questa osservazione",
      exact: true,
    })
    .click();
  await expect(
    region.getByLabel("Titolo appuntamento", { exact: true }),
  ).toHaveValue(title);
  await region
    .getByLabel("Motivo appuntamento", { exact: true })
    .fill("Confermo esplicitamente questi dati osservati per me");
  await region.getByRole("checkbox").check();
  await region
    .getByRole("button", { name: "Salva appuntamento interno", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "SELECT version,source_observation_id FROM scheduled_event_version WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1",
            [w],
          )
        ).rows[0],
    )
    .toMatchObject({ version: 2, source_observation_id: expect.any(String) });
  expect(
    (
      await pool.query(
        "SELECT count(*) FROM calendar_action WHERE workspace_id=$1",
        [w],
      )
    ).rows[0].count,
  ).toBe("1");
});
