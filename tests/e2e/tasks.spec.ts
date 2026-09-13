import { test, expect } from "./backend-fixture";
import { register, openWorkspacePanel } from "./helpers";
test("Tasks: explicit responsibility, durable follow-up, completion and reload", async ({
  page,
}) => {
  test.setTimeout(120000);
  await register(
    page,
    "Tasks Web",
    `tasks-${crypto.randomUUID()}@example.test`,
  );
  await page
    .getByLabel("Nuovo spazio", { exact: true })
    .fill("Tasks verification");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await openWorkspacePanel(page, "work");
  const region = page.getByRole("region", { name: "Tasks e follow-up" });
  await region
    .getByLabel("Attività", { exact: true })
    .fill("Confrontare preventivi senza acquisti");
  await region
    .getByRole("button", { name: "Registra Task", exact: true })
    .click();
  await expect(
    region.getByText("Responsabilità: Non assegnato", { exact: true }),
  ).toBeVisible();
  await region
    .getByRole("button", { name: "Me ne occupo", exact: true })
    .click();
  await expect(
    region.getByText(/Responsabilità: Tasks Web · accettata su v1/),
  ).toBeVisible();
  await region
    .getByRole("button", { name: "Prepara follow-up", exact: true })
    .click();
  await region
    .getByLabel("Quando", { exact: true })
    .fill(new Date(Date.now() - 60000).toISOString().slice(0, 16));
  await region
    .getByRole("button", { name: "Salva follow-up", exact: true })
    .click();
  await expect(
    region.getByText("Promemoria disponibile — nessuna azione eseguita", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await page.reload();
  await openWorkspacePanel(page, "work");
  await expect(
    region.getByText(/Responsabilità: Tasks Web · accettata su v1/),
  ).toBeVisible();
  await region
    .getByRole("button", { name: "Segna completato — solo Task", exact: true })
    .click();
  await expect(region.getByText(/completed · v3/)).toBeVisible();
  await expect(
    region.getByText("Da rivedere: accesso o riferimento cambiato", {
      exact: true,
    }),
  ).toBeVisible();
  await region
    .getByRole("button", { name: "Storia Task", exact: true })
    .click();
  await expect(
    region.getByText("Storia e provenance", { exact: true }),
  ).toBeVisible();
});
