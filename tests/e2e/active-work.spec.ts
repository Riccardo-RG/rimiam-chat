import { test, expect } from "./backend-fixture";
import { register } from "./helpers";
test("Active Work conversation controls, restriction, contribution and reconnect", async ({
  page,
  context,
}) => {
  await register(page, "Work Web", `work-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Nuovo spazio", { exact: true })
    .fill("Active Work verification");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const send = async (text: string) => {
    await page.locator("#message").fill(text);
    await page
      .getByRole("button", { name: "Invia messaggio", exact: true })
      .click();
    await expect(
      page.locator(".messages").getByText(text, { exact: true }),
    ).toBeVisible();
  };
  await send("Il locale Milano costa 3000 euro al mese, cifra da verificare.");
  await send("Analizza: locali Milano");
  const region = page.getByRole("region", { name: "Active Work", exact: true });
  const work = region.getByTestId("active-work").first();
  await expect(work.locator("summary").first()).toContainText("Completato", {
    timeout: 15000,
  });
  await work.locator("summary").first().click();
  await expect(
    work.getByText("Contributo non adottato · contratto v1", { exact: true }),
  ).toBeVisible();
  await work.getByRole("button", { name: "Pausa", exact: true }).click();
  await expect(work.locator("summary").first()).toContainText("In pausa");
  await work
    .getByRole("combobox", { name: "Come vuoi contribuire?", exact: true })
    .selectOption("objection");
  await work
    .getByLabel("Istruzione per questo lavoro", { exact: true })
    .fill("chiarire il costo prima di continuare");
  await work
    .getByRole("button", { name: "Invia istruzione", exact: true })
    .click();
  await expect(work.locator("summary").first()).toContainText(
    "Serve un chiarimento",
  );
  await expect(
    work.getByRole("button", { name: "Riprendi", exact: true }),
  ).toBeDisabled();
  await context.setOffline(true);
  await page.waitForTimeout(2200);
  await context.setOffline(false);
  await page.reload();
  await work.locator("summary").first().click();
  await expect(
    work.getByText("chiarire il costo prima di continuare", { exact: true }),
  ).toBeVisible();
  await work
    .getByRole("button", { name: "Ritira la tua richiesta", exact: true })
    .click();
  await expect(
    work.getByRole("button", { name: "Riprendi", exact: true }),
  ).toBeEnabled();
  await work.getByRole("button", { name: "Riprendi", exact: true }).click();
  await expect(work.locator("summary").first()).toContainText("Completato", {
    timeout: 15000,
  });
  await work.getByRole("button", { name: "Ferma", exact: true }).click();
  await expect(work.locator("summary").first()).toContainText("Fermato");
  await page.reload();
  await work.locator("summary").first().click();
  await expect(work.locator("summary").first()).toContainText("Fermato");
  await work
    .getByRole("button", { name: "Storia e provenance", exact: true })
    .click();
  await expect(
    region.getByText("Storia del lavoro", { exact: true }),
  ).toBeVisible();
  await region
    .getByText("Contributi prodotti, non adottati", { exact: true })
    .click();
  await expect(region.locator(".history-entry").last()).toContainText(
    "non adottata",
  );
});
