import { expect, test, type Locator } from "@playwright/test";
import { fillWorkspaceName, register } from "./helpers";

test("workspace activity keeps tablet controls reachable and mobile conversation height stable", async ({
  page,
}) => {
  const title =
    "Lancio RIMIAM · Coordinamento design, sviluppo e pubblicazione della prima beta";
  await register(page, "Sara", `header-${crypto.randomUUID()}@example.test`);
  await fillWorkspaceName(page, title);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const header = page.locator("main > header");
  const heading = header.getByRole("heading", { name: title, exact: true });
  await expect(heading).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });

  async function expectControl(button: Locator) {
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return (
            width >= 44 &&
            height >= 44 &&
            element.contains(
              document.elementFromPoint(x + width / 2, y + height / 2),
            )
          );
        }),
      )
      .toBe(true);
  }
  async function expectHeader() {
    await expect
      .poll(() => heading.evaluate((node) => node.clientWidth))
      .toBeGreaterThan(44);
    for (const name of [
      "Attività di Emme",
      "Notifiche di questo spazio",
      "Invita",
    ]) {
      await expectControl(header.getByRole("button", { name, exact: true }));
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(768);
  }
  await expectHeader();
  const spaceLabel = page
    .getByRole("navigation", { name: "I tuoi spazi", exact: true })
    .getByRole("button", { name: title })
    .locator(".rail-space-name");
  expect(
    await spaceLabel.evaluate(
      (el) =>
        el.getBoundingClientRect().height /
        parseFloat(getComputedStyle(el).lineHeight),
    ),
  ).toBeLessThanOrEqual(2.05);
  const desktopStatus = page.locator(".composer-availability");
  await expect(desktopStatus).toHaveText("Emme non disponibile");
  expect(
    await desktopStatus.evaluate((element) => {
      const text = document.createRange();
      text.selectNodeContents(element);
      return new Set(
        Array.from(text.getClientRects(), (r) => Math.round(r.top)),
      ).size;
    }),
  ).toBe(1);

  const url = new URL(page.url());
  async function command(command: Record<string, unknown>) {
    const response = await page.request.post(
      `/api/v1/workspaces/${url.searchParams.get("workspace")}/commands`,
      {
        headers: { Origin: url.origin },
        data: { commandId: crypto.randomUUID(), command },
      },
    );
    expect(response.ok()).toBe(true);
    return (await response.json()).result;
  }
  await command({
    type: "work.converse",
    text: "Analizza: il preventivo per lo sviluppo del software e la verifica del budget del gruppo",
  });
  await expect(
    header.getByRole("button", { name: /preventivo per lo sviluppo/i }),
  ).toBeVisible();
  await expectHeader();

  await page.setViewportSize({ width: 390, height: 844 });
  const chatTab = header.getByRole("button", { name: "Chat", exact: true });
  await expect(chatTab).toHaveAttribute("aria-current", "page");
  await expect(chatTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    await chatTab.evaluate(
      (tab) => getComputedStyle(tab, "::after").borderBottomWidth,
    ),
  ).toBe("2px");
  await expectControl(chatTab);
  const trigger = header.getByRole("button", {
    name: "Attività dello spazio",
    exact: true,
  });
  const popover = header.getByRole("region", {
    name: "Attività dello spazio",
    exact: true,
  });
  const messages = page.locator(".messages");
  await expectControl(trigger);
  await expect(trigger).toHaveAccessibleDescription(/Emme non disponibile/);
  const editor = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await editor.focus();
  await expect(desktopStatus).toHaveCount(0);
  await expectControl(page.getByRole("button", { name: "Invia", exact: true }));
  await trigger.click();
  await expect(
    popover
      .getByRole("status")
      .filter({ hasText: "Il servizio AI non è configurato." }),
  ).toBeVisible();
  await popover.getByRole("button", { name: "Chiudi attività" }).click();
  const closedHeight = (await messages.boundingBox())!.height;
  expect(closedHeight).toBeGreaterThan(844 / 2);
  const goal = "Raccogliere i commenti dei primi clienti.";
  await command({ type: "goal.establish", content: goal });
  const source = await command({
    type: "message.send",
    content: "Quali clienti vorreste invitare?",
  });
  await command({
    type: "question.open",
    sourceId: source.messageId,
    content: "Chi invitiamo?",
  });
  await expect(
    messages.getByText("Quali clienti vorreste invitare?"),
  ).toBeVisible();
  await expect(popover).toBeHidden();
  await trigger.click();
  await expect(popover.getByText("1 da seguire")).toBeVisible();
  await expect(
    popover.getByRole("button", { name: new RegExp(goal) }),
  ).toBeVisible();
  await expect(
    popover.getByRole("button", { name: /preventivo per lo sviluppo/i }),
  ).toBeVisible();
  expect((await messages.boundingBox())!.height).toBeGreaterThanOrEqual(
    closedHeight - 1,
  );
  await popover.getByRole("button", { name: "Chiudi attività" }).click();
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText(goal, { exact: true })).not.toBeVisible();
  await trigger.click();
  await heading.click();
  await expect(popover).toBeHidden();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 844, height: 390 });
  await expectControl(trigger);
  await trigger.click();
  await expectControl(popover.getByRole("button", { name: "Chiudi attività" }));
  await popover.getByRole("button", { name: "Chiudi attività" }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await expectControl(trigger);
  await expect(trigger).toHaveAccessibleDescription(/Emme non disponibile/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await trigger.click();
  await expectControl(popover.getByRole("button", { name: "Chiudi attività" }));
  await popover.getByRole("button", { name: /Attività e argomenti/ }).click();
  const follow = page.getByRole("region", { name: "Current State" });
  const question = follow.getByText("Chi invitiamo?", { exact: true });
  await expect(question).toBeHidden();
  await follow.locator("summary").filter({ hasText: "Da seguire" }).click();
  await expect(question).toBeVisible();
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText(goal, { exact: true })).toBeHidden();
  await activity
    .locator("summary")
    .filter({ hasText: "Registro attività" })
    .click();
  const intent = activity
    .locator("li")
    .filter({ hasText: "Obiettivo impostato" });
  await expect(intent.getByText(goal, { exact: true })).toBeHidden();
  await intent.locator("summary").click();
  await expect(intent.getByText(goal, { exact: true })).toBeVisible();
  await intent.getByRole("button", { name: "Apri dettaglio e fonti" }).click();
  await expect(
    page.getByRole("heading", { name: "Obiettivo impostato" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  // The installation remains unconfigured. Choose a registered connection for
  // this space and observe the new effective availability in the open client.
  const path = "/api/v1/assistant-settings";
  const w = url.searchParams.get("workspace")!;
  const settings = await (
    await page.request.get(path + "?workspaceId=" + w)
  ).json();
  const session = await (
    await page.request.get("/api/auth/get-session")
  ).json();
  const agent = settings.connections.find(
    (c: { id: string }) => c.id === "test-agent",
  );
  const saved = await page.request.post(path, {
    headers: { Origin: url.origin },
    data: {
      workspaceId: w,
      expectedActorId: session.user.id,
      expectedRevision: settings.revision,
      connectionId: agent.id,
      connectionRevision: agent.revision,
      displayName: "Emme",
      instructions: "",
    },
  });
  expect(saved.ok()).toBe(true);
  await expectControl(trigger);
  await expect(trigger).not.toHaveAccessibleDescription(/Emme non disponibile/);
  await trigger.click();
  await expect(popover).toBeVisible();
  await expect(
    popover.getByText("Emme non disponibile", { exact: true }),
  ).toHaveCount(0);
});
