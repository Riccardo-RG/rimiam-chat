import { test, expect } from "@playwright/test";
import { addressMiriam } from "../../src/shared/miriam-address";
import { fillWorkspaceName, register } from "./helpers";

test("one disclosure per chat message previews Emme's suggestions without applying them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, "Ada", `steps-${crypto.randomUUID()}@example.test`);
  await fillWorkspaceName(page, "Primo gruppo");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Primo gruppo", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  const api = `/api/v1/workspaces/${url.searchParams.get("workspace")}`;
  const request = addressMiriam("Suggerisci due passi per il test del gruppo.");
  const sent = await page.request.post(api + "/commands", {
    headers: { Origin: url.origin },
    data: {
      commandId: crypto.randomUUID(),
      command: { type: "message.send", content: request },
    },
  });
  expect(sent.ok()).toBeTruthy();
  const message = page
    .locator(".message")
    .filter({ has: page.getByText(request, { exact: true }) });
  const disclosure = message.locator("summary").filter({
    hasText: "2 passaggi di Emme",
  });
  await expect(disclosure).toBeVisible();
  const detail = message.getByText("Preparare le domande per il primo gruppo", {
    exact: true,
  });
  await expect(detail).toBeHidden();
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(detail).toBeVisible();
  await expect(
    message.getByRole("button", { name: "Apri il percorso personale" }),
  ).toBeVisible();
  await disclosure.press("Space");
  await expect(detail).toBeHidden();
  await disclosure.click();
  await message.getByRole("button", { name: "Valuta il suggerimento" }).click();
  const panel = page.getByRole("dialog", { name: "In programma" });
  await expect(panel.getByLabel("Richiesta dalla conversazione")).toContainText(
    "Preparare le domande per il primo gruppo",
  );
  const response = await page.request.get(api + "/handoffs");
  expect(response.ok()).toBeTruthy();
  const { handoffs } = await response.json();
  expect(handoffs).toHaveLength(2);
  expect(handoffs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "task.create",
        status: "ready",
        application: null,
      }),
      expect.objectContaining({
        kind: "email.prepare",
        status: "navigation",
        application: null,
      }),
    ]),
  );
});
