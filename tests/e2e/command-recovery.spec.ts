import { test, expect } from "@playwright/test";
import { register } from "./helpers";

test("a committed command with a lost response survives reload and is recovered without duplication", async ({
  page,
}) => {
  const marker = `Recovery ${Date.now()}`;
  await register(
    page,
    "Recovery browser",
    `journal-${Date.now()}@example.test`,
  );
  await page.getByLabel("Nuovo spazio", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: marker, exact: true }),
  ).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  let commandId = "";
  let committed = false;
  await page.route(
    `**/api/v1/workspaces/${w}/commands`,
    async (route) => {
      commandId = route.request().postDataJSON().commandId;
      const response = await route.fetch(); // actual server commit
      expect(response.ok()).toBeTruthy();
      committed = true;
      await route.abort("failed"); // client never receives the receipt
    },
    { times: 1 },
  );
  await page.getByLabel("Messaggio", { exact: true }).fill(marker);
  await page
    .getByRole("button", { name: "Invia messaggio", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Operazioni da verificare" }),
  ).toBeVisible();
  await expect.poll(() => committed).toBe(true);
  await page.reload();
  const pending = page.getByRole("region", {
    name: "Operazioni da verificare",
  });
  await expect(pending).toBeVisible();
  await pending
    .getByRole("button", { name: "Verifica esito", exact: true })
    .click();
  await expect(pending).not.toBeVisible();
  expect(
    (
      await page.request.get(`/api/v1/workspaces/${w}/receipts/${commandId}`)
    ).status(),
  ).toBe(200);
  const snapshot = await (
    await page.request.get(`/api/workspaces/${w}`)
  ).json();
  expect(
    snapshot.messages.filter((m: { content: string }) => m.content === marker),
  ).toHaveLength(1);
});
