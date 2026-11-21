import { expect, test } from "@playwright/test";
import type { Snapshot } from "../../src/contracts/web-snapshot";
import {
  askAboutMessage,
  defaultQuotedQuestion,
} from "../../src/shared/miriam-address";
import { fillWorkspaceName, register } from "./helpers";

test("an explicit message request reports a usage limit on its own row and retries the same reading", async ({
  page,
}) => {
  // Parallel source edits can otherwise hot-reload this dev server mid-act.
  // Production Workspace events/snapshot reads still use their normal paths.
  await page.routeWebSocket(/\/_next\/webpack-hmr(?:\?|$)/, () => {});
  const name = "Lancio RIMIAM";
  await register(page, "Sara", `usage-${crypto.randomUUID()}@example.test`);
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const workspace = new URL(page.url()).searchParams.get("workspace");
  const commands = `/api/v1/workspaces/${workspace}/commands`;
  const snapshot = `/api/workspaces/${workspace}`;
  const emmeMark =
    ".message-author svg[fill='currentColor'][aria-hidden='true']";
  await expect(
    page.getByRole("article", { name: "Emme", exact: true }).locator(emmeMark),
  ).toBeVisible();
  const content = "Come organizziamo il nostro primo incontro?";
  const original = await page.request.post(commands, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      commandId: crypto.randomUUID(),
      command: { type: "message.send", content },
    },
  });
  expect(original.ok()).toBe(true);
  const originalId: string = (await original.json()).result.messageId;
  const subject = page.locator(`#source-${originalId}`);
  let denied = true;
  let attempts = 0;
  const retryIds: string[] = [];
  const retryCommands: string[] = [];
  // Exercise the normal committed request, fixture-worker response and Web
  // sync. Substitute only the denied read and subsequent retry receipt so the
  // test never exhausts the shared test deployment's admission allowance.
  await page.route(`**${snapshot}`, async (route) => {
    const response = await route.fetch();
    if (!denied || !response.ok()) return route.fulfill({ response });
    const body: Snapshot = await response.json();
    const request = body.messages.find((m) => m.content === askAboutMessage);
    if (request) {
      body.messages = body.messages.filter(
        (m) => m.reply_to_source_id !== request.id,
      );
      body.interpretations = body.interpretations.map((reading) =>
        reading.source_id === request.id
          ? {
              ...reading,
              status: "failed",
              hasPublishedReply: false,
              error_code: "AI_USAGE_LIMIT_REACHED",
            }
          : reading,
      );
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(`**${commands}`, async (route) => {
    const { commandId, command } = route.request().postDataJSON();
    if (command.type === "message.send") attempts++;
    if (command.type !== "interpretation.retry") return route.continue();
    retryIds.push(command.interpretationId);
    retryCommands.push(commandId);
    if (retryIds.length === 1) return route.abort("failed");
    denied = false;
    await route.fulfill({
      json: { commandId, status: "committed", result: {} },
    });
  });
  await subject.locator(".message-details > summary").click();
  await subject
    .getByRole("button", { name: /Chiedi a Emme di rispondere/ })
    .click();
  const editor = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(defaultQuotedQuestion);
  expect(attempts).toBe(0);
  const committed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === commands &&
      r.request().postDataJSON().command.content === askAboutMessage &&
      r.request().postDataJSON().command.quoteMessageId === originalId,
  );
  await editor.press("Enter");
  const { result } = await (await committed).json();
  const row = page.locator(`#source-${result.messageId}`);
  await expect(row.getByRole("status")).toContainText("limite di utilizzo");
  await expect(subject.getByRole("status")).toHaveCount(0);
  await expect(row.locator("details[open]")).toHaveCount(0);
  await row
    .getByRole("button", { name: "Riprova questa richiesta a Emme" })
    .click();
  await expect(row.getByRole("status")).toContainText("connessione");
  await row
    .getByRole("button", { name: "Riprova questa richiesta a Emme" })
    .click();
  const answer = page
    .getByRole("article", { name: "Emme", exact: true })
    .filter({
      hasText: `Risposta di prova al messaggio: ${content}`,
    });
  await expect(answer.locator(emmeMark)).toBeVisible();
  await expect(row.getByRole("status")).toHaveCount(0);
  expect(retryIds).toEqual([result.interpretationId, result.interpretationId]);
  expect(new Set(retryCommands).size).toBe(1);
  expect(attempts).toBe(1);
  const actual: Snapshot = await (await page.request.get(snapshot)).json();
  expect(
    actual.messages.filter((m) => m.content === askAboutMessage),
  ).toHaveLength(1);
  expect(
    actual.messages.filter((m) => m.reply_to_source_id === result.messageId),
  ).toHaveLength(1);
});

test("private assistant chat explains a provider failure on the original turn and shows only the eventual reply", async ({
  page,
}) => {
  await register(
    page,
    "Elisa",
    `private-failure-${crypto.randomUUID()}@example.test`,
  );
  const personal = page.getByRole("region", { name: "Personale", exact: true });
  await personal
    .getByRole("button", { name: "Tu ed Emme", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu ed Emme", exact: true }),
  ).toBeVisible();
  const workspace = new URL(page.url()).searchParams.get("workspace")!;
  const question = "Questa chat è solo mia?";
  let readingId = "";
  let failing = true;
  await page.route(`**/api/workspaces/${workspace}`, async (route) => {
    const response = await route.fetch();
    if (!response.ok() || !failing) return route.fulfill({ response });
    const body: Snapshot = await response.json();
    const request = body.messages.find(
      (m) => m.actor_kind === "human" && m.content.includes(question),
    );
    if (request) {
      body.messages = body.messages.filter(
        (m) => m.reply_to_source_id !== request.id,
      );
      const reading = body.interpretations.find(
        (r) => r.source_id === request.id,
      );
      if (reading) {
        readingId = reading.id;
        Object.assign(reading, {
          status: "failed",
          error_code: "AI_PROVIDER_UNAVAILABLE",
          hasPublishedReply: false,
          requestMessageId: request.id,
          requestDisplayName: "Emme",
        });
      }
    }
    await route.fulfill({ response, json: body });
  });
  const retried: string[] = [];
  await page.route(
    `**/api/v1/workspaces/${workspace}/commands`,
    async (route) => {
      const { command, commandId } = route.request().postDataJSON();
      if (command.type !== "interpretation.retry") return route.continue();
      retried.push(command.interpretationId);
      failing = false;
      await route.fulfill({
        json: { commandId, status: "committed", result: {} },
      });
    },
  );
  const chat = page.getByLabel("Messaggi con Emme", { exact: true });
  await page
    .getByRole("textbox", { name: "Messaggio", exact: true })
    .fill(question);
  await page.getByRole("button", { name: "Invia a Emme", exact: true }).click();
  const turn = chat
    .getByRole("article", { name: "Tu", exact: true })
    .filter({ hasText: question });
  await expect(turn.getByRole("status")).toContainText("temporaneamente");
  await expect(chat.getByText("AI_PROVIDER_UNAVAILABLE")).toHaveCount(0);
  await expect(
    chat.getByRole("article", { name: "Emme", exact: true }),
  ).toHaveCount(0);
  await turn
    .getByRole("button", { name: "Riprova questa richiesta a Emme" })
    .click();
  await expect(
    chat.getByRole("article", { name: "Emme", exact: true }),
  ).toHaveCount(1);
  await expect(turn.getByRole("status")).toHaveCount(0);
  expect(retried).toEqual([readingId]);
});
