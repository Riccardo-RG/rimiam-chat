import { expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
  register,
  joinTestWorkspace,
  openAccountAppearance,
} from "./helpers";

test("adopted decision stays in its place, opens the recorded act and retains mobile reading cadence", async ({
  page,
  browser,
}, info) => {
  const title = "Lancio RIMIAM";
  await register(
    page,
    "Caterina Test",
    "caterina-" + crypto.randomUUID() + "@example.test",
  );
  await fillWorkspaceName(page, title);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  const beta = page.getByRole("button", {
    name: "Accetto la regola d’uso della beta",
  });
  if (await beta.isVisible()) await beta.click();
  const guest = await browser.newPage({
    baseURL: process.env.MIRIAM_TEST_BASE_URL,
  });
  await joinTestWorkspace(page, guest, title, "Matteo Test");
  await expect(
    guest
      .locator("main > header")
      .getByRole("button", { name: "Invita", exact: true }),
  ).toHaveCount(0);
  const headers = { Origin: new URL(page.url()).origin };
  const reply = await guest.request.post(
    "/api/v1/workspaces/" + w + "/commands",
    {
      headers,
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "message.send",
          content:
            "Ho raccolto i nomi dei team. Quanti ne invitiamo nel primo giro?",
        },
      },
    },
  );
  expect(reply.ok()).toBeTruthy();
  await guest.close();
  const command = async (command: Record<string, unknown>) => {
    const r = await page.request.post("/api/v1/workspaces/" + w + "/commands", {
      headers,
      data: { commandId: crypto.randomUUID(), command },
    });
    expect(r.ok(), String(r.status())).toBeTruthy();
    return (await r.json()).result;
  };
  const session = (
    await (await page.request.get("/api/auth/get-session")).json()
  ).user;
  const goal = await command({
    type: "goal.establish",
    content: "Invitare i primi gruppi a provare la beta di RIMIAM.",
  });
  await command({
    type: "message.send",
    content:
      "Propongo di partire con tre gruppi e raccogliere i loro commenti.",
  });
  const words = "Apriamo la prima beta di RIMIAM a tre gruppi.";
  const proposal = await command({
    type: "project.propose",
    kind: "decision",
    content: words,
    people: [session.id],
    goal: { id: goal.goalId, version: 1 },
    reason: "Verifica del flusso.",
  });
  const project = await (
    await page.request.get("/api/v1/workspaces/" + w + "/project")
  ).json();
  const row = page.getByRole("button", {
    name: /Decisione adottata.*Apriamo la prima beta/,
  });
  await expect(row).toHaveCount(0);
  await command({
    type: "project.approve",
    proposalId: proposal.proposalId,
    expectedAccessRevision: project.accessRevision,
    representedPersonId: session.id,
    confirmExactContent: true,
  });
  await command({
    type: "message.send",
    content: "Preparo gli inviti per domani.",
  });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("dialog")).toContainText(words);
  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await expect(row).toBeFocused();
  await page.reload();
  await expect(row).toBeVisible();
  const tabs = page.getByRole("navigation", {
    name: "Viste dello spazio",
    exact: true,
  });
  const header = page.locator("main > header");
  const invite = header.getByRole("button", { name: "Invita", exact: true });
  const tooltip = header.getByRole("tooltip");
  const members = header.getByRole("button", {
    name: "2 persone",
    exact: true,
  });
  await expect(invite).toHaveText("");
  await expect(invite.locator('svg[aria-hidden="true"]')).toBeVisible();
  await expect(invite).toHaveAccessibleDescription("Invita una persona");
  await invite.hover();
  await expect(tooltip).toHaveText("Invita una persona");
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await members.hover();
  await members.focus();
  await page.keyboard.press("Tab");
  await expect(invite).toBeFocused();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await invite.press("Enter");
  const invitation = page.getByRole("dialog", {
    name: "Invita una persona",
    exact: true,
  });
  await expect(
    invitation.getByLabel("Email del destinatario", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(invite).toBeFocused();
  const assertInviteTarget = async () => {
    await expect(invite).toBeInViewport();
    const target = (await invite.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  };
  await assertInviteTarget();
  await expect(tabs.getByRole("button")).toHaveCount(2);
  await tabs.getByRole("button", { name: "Condivisi", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Condivisi", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Torna alla conversazione" }).click();
  await expect(
    tabs.getByRole("button", { name: "Chat", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  async function expectEmmeSignature() {
    const author = page.locator(".miriam-message .message-author").first();
    const voice = await author.evaluate((node) => getComputedStyle(node).color);
    await expect(
      page
        .getByRole("button", { name: /^Attività (di Emme|dello spazio)$/ })
        .locator("svg"),
    ).toHaveCSS("color", voice);
    const humanInk = await page
      .locator(".message:not(.miriam-message) .message-body")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    await expect(
      page.locator(".miriam-message .message-body").first(),
    ).not.toHaveCSS("color", humanInk);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectEmmeSignature();
  await info.attach("Conversazione e decisione", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await openAccountAppearance(page);
  await page.getByLabel("Aspetto dell’app").selectOption("dark");
  await page
    .locator("summary")
    .filter({ hasText: "Account personale" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expectEmmeSignature();
  await info.attach("Stessa conversazione di notte", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertInviteTarget();
  const human = page
    .getByRole("article", { name: "Caterina Test", exact: true })
    .first();
  await expect(human.locator(".byline-photo")).toBeHidden();
  await expect(human.locator(".byline-time")).toBeHidden();
  await expect(page.locator(".day-mobile").first()).toBeVisible();
  await page.locator(".messages").evaluate((node) => node.scrollTo(0, 0));
  await expectEmmeSignature();
  await info.attach("Lettura su Web stretto", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
