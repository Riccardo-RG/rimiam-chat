import { expect, test } from "@playwright/test";
import { fillWorkspaceName, register } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("audio tools explain missing services and denied microphone without sending a draft or joining", async ({
  page,
}) => {
  // Deterministic device denial. No real microphone, provider or call transport.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  const suffix = crypto.randomUUID();
  await register(page, "Anna", `audio-tools-${suffix}@example.test`);
  await fillWorkspaceName(page, "Prova audio");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await input.tap();
  await input.fill("Bozza per domani");
  const commands: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/commands$/.test(new URL(request.url()).pathname)
    )
      commands.push(request.postDataJSON().command.type);
  });
  await page.getByRole("button", { name: "Chiamata audio", exact: true }).tap();
  const calls = page.getByRole("dialog", {
    name: "Chiamata audio",
    exact: true,
  });
  await expect(
    calls.getByText(/Il servizio chiamate deve essere configurato/),
  ).toBeVisible();
  await expect(
    calls.getByRole("button", { name: "Entra nella chiamata" }),
  ).toHaveCount(0);
  await calls.getByRole("button", { name: "Chiudi" }).tap();

  await input.tap();
  await page.getByRole("button", { name: "Voce", exact: true }).tap();
  const voice = page.getByRole("dialog", { name: "Voce", exact: true });
  await expect(
    voice.getByText(/La trascrizione non è configurata/),
  ).toBeVisible();
  await voice.getByRole("checkbox").check();
  await expect(
    voice.getByRole("button", { name: "Parla con Emme" }),
  ).toBeDisabled();
  await voice.getByRole("button", { name: "Registra messaggio vocale" }).tap();
  await expect(voice.getByRole("alert")).toHaveText(/Microfono bloccato/);
  await voice.getByRole("button", { name: "Chiudi" }).tap();

  // Only the transport configuration flag changes. A microphone denial still
  // happens before call admission and leaves the original draft intact.
  await page.route("**/api/v1/workspaces/*/calls", async (route) => {
    const response = await route.fetch();
    const current = await response.json();
    await route.fulfill({ response, json: { ...current, configured: true } });
  });
  await input.tap();
  await page.getByRole("button", { name: "Chiamata audio", exact: true }).tap();
  await calls.getByRole("button", { name: "Entra nella chiamata" }).tap();
  await expect(calls.getByRole("alert")).toHaveText(/Microfono bloccato/);
  await calls.getByRole("button", { name: "Chiudi" }).tap();
  await expect(input).toHaveValue("Bozza per domani");
  expect(commands).toEqual([]);
});
