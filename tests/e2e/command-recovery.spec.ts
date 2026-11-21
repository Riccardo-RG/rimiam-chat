import { test, expect } from "@playwright/test";
import { fillWorkspaceName, openMessageComposer, register } from "./helpers";

test("a committed command with a lost response survives reload and is recovered without duplication", async ({
  page,
}) => {
  const marker = `Recovery ${Date.now()}`;
  await register(
    page,
    "Recovery browser",
    `journal-${Date.now()}@example.test`,
  );
  await fillWorkspaceName(page, marker);
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
  const composer = await openMessageComposer(page);
  await composer.fill(marker);
  await page.getByRole("button", { name: "Invia", exact: true }).click();
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

test("same-page chat recovery clears only its confirmed draft and retries the original send", async ({
  page,
}) => {
  const workspace = `Bozze ${crypto.randomUUID()}`;
  await register(
    page,
    "Recovery chat",
    `recovery-${crypto.randomUUID()}@example.test`,
  );
  await fillWorkspaceName(page, workspace);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: workspace, exact: true }),
  ).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  const commandsPath = `/api/v1/workspaces/${w}/commands`;
  const pending = page.getByRole("region", {
    name: "Operazioni da verificare",
  });
  const verify = pending.getByRole("button", {
    name: "Verifica esito",
    exact: true,
  });
  const editor = page.locator("#message");
  const send = page.getByRole("button", { name: "Invia", exact: true });
  async function loseReceipt(text: string) {
    let id = "";
    const releaseResponse = Promise.withResolvers<void>();
    await page.route(
      `**${commandsPath}`,
      async (route) => {
        id = route.request().postDataJSON().commandId;
        expect((await route.fetch()).ok()).toBe(true);
        await releaseResponse.promise;
        await route.abort("failed");
      },
      { times: 1 },
    );
    if (!(await editor.isVisible())) await openMessageComposer(page);
    await editor.fill(text);
    try {
      // The reminder can disappear while the preceding recovery is still refreshing.
      await expect(send).toBeEnabled();
      await editor.press("Enter");
      await expect.poll(() => id).not.toBe("");
      await expect(
        page.getByRole("button", { name: "Invio…", exact: true }),
      ).toBeDisabled();
      await expect(pending).toBeHidden();
    } finally {
      releaseResponse.resolve();
    }
    await expect(
      page
        .locator(".conversation")
        .getByRole("alert")
        .filter({ hasText: "Non riesco a raggiungere il servizio" }),
    ).toBeVisible();
    await expect(pending).toBeVisible();
    await expect(editor).toHaveValue(text);
    expect(id).toBeTruthy();
    return id;
  }

  await loseReceipt("Invio senza conferma");
  await verify.click();
  await expect(pending).toBeHidden();
  await expect(editor).toHaveValue("");

  await loseReceipt("Secondo invio senza conferma");
  await editor.fill("Bozza successiva");
  await verify.click();
  await expect(pending).toBeHidden();
  await expect(editor).toHaveValue("Bozza successiva");

  const text = "Invio una volta sola";
  const originalId = await loseReceipt(text);
  const retried = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === commandsPath &&
      request.method() === "POST",
  );
  await expect(send).toBeEnabled();
  await editor.press("Enter");
  expect((await retried).postDataJSON().commandId).toBe(originalId);
  await expect(pending).toBeHidden();
  await expect(editor).toHaveValue("");
  const snapshot = await (
    await page.request.get(`/api/workspaces/${w}`)
  ).json();
  expect(
    snapshot.messages.filter((m: { content: string }) => m.content === text),
  ).toHaveLength(1);
});
