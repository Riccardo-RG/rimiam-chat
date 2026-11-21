import { expect, test } from "@playwright/test";
import { fillWorkspaceName, register, joinTestWorkspace } from "./helpers";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("touch composer distinguishes asking Emme from sending to the group at narrow and landscape sizes", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage();
  try {
    await register(page, "Fabio", crypto.randomUUID() + "@example.test");
    const group = "Studio " + crypto.randomUUID();
    await fillWorkspaceName(page, group);
    await page.getByRole("button", { name: "Crea spazio", exact: true }).tap();
    await expect(
      page.getByRole("heading", { name: group, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, group, "Sara");
    const form = page.locator(".conversation-composer");
    const input = form.getByRole("textbox", { name: "Messaggio", exact: true });
    const ask = form.getByRole("button", {
      name: "Chiedi a Emme",
      exact: true,
    });
    const send = form.getByRole("button", { name: "Invia", exact: true });
    const commands: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/commands")) {
        const command = request.postDataJSON()?.command;
        if (command?.type === "message.send") commands.push(command.content);
      }
    });
    await expect(ask).toBeHidden();
    await input.tap();
    await input.fill("Qual è il prossimo passo?");
    const requested = "@Emme Qual è il prossimo passo?";
    await ask.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      button: 0,
    });
    await ask.dispatchEvent("pointercancel", {
      pointerType: "touch",
      isPrimary: true,
      button: 0,
    });
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    expect(commands).toEqual([]);
    for (const [width, height] of [
      [390, 844],
      [320, 568],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      if (width > height)
        await input.evaluate((field) => {
          const main = field.closest("main")!;
          main.setAttribute("data-short-composer", "");
          main.style.setProperty("--chat-viewport-height", "145px");
        });
      await expect(ask).toBeInViewport({ ratio: 1 });
      await expect(send).toBeInViewport({ ratio: 1 });
      const positions = await form.evaluate((element) => {
        const row = element
          .querySelector(".composer-row")!
          .getBoundingClientRect();
        const field = element
          .querySelector("textarea")!
          .getBoundingClientRect();
        const ask = element
          .querySelector("[data-target=miriam]")!
          .getBoundingClientRect();
        const send = element
          .querySelector("[data-primary-send]")!
          .getBoundingClientRect();
        return {
          line: field.width,
          available: row.width,
          afterField: ask.top >= field.bottom - 1,
          together: Math.abs(ask.top - send.top) < 6,
          fits: ask.left >= row.left - 1 && send.right <= row.right + 1,
          bottom: send.bottom,
        };
      });
      expect(positions.line).toBeGreaterThanOrEqual(positions.available - 2);
      expect(positions.afterField).toBe(true);
      expect(positions.together).toBe(true);
      expect(positions.fits).toBe(true);
      if (width > height) expect(positions.bottom).toBeLessThanOrEqual(145);
    }
    // Expanded tabs + native keyboard on iPhone Safari can leave 44px of Web content.
    await input.evaluate((field) => {
      field.focus();
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, "height", {
        configurable: true,
        value: 44,
      });
      viewport.dispatchEvent(new Event("resize"));
    });
    const singleLine = await form.evaluate((element) => {
      const field = element.querySelector("textarea")!.getBoundingClientRect();
      const buttons = element.querySelectorAll(".composer-delivery button");
      return Array.from(buttons, (button) => {
        const rect = button.getBoundingClientRect();
        const point = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return {
          visible: rect.top >= -1 && rect.bottom <= 45,
          reachable: button.contains(point),
          separate: field.right <= rect.left + 1 && field.width >= 320,
        };
      });
    });
    expect(singleLine).toEqual(
      Array(2).fill({ visible: true, reachable: true, separate: true }),
    );
    await ask.tap();
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height");
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(input).toHaveValue("");
    for (const user of [page, guest])
      await expect(
        user.locator(".messages").getByText(requested, { exact: true }),
      ).toHaveCount(1);
    await page.setViewportSize({ width: 320, height: 568 });
    await input.tap();
    await input.fill("Questo è per il gruppo.");
    await send.tap();
    for (const user of [page, guest])
      await expect(
        user
          .locator(".messages")
          .getByText("Questo è per il gruppo.", { exact: true }),
      ).toHaveCount(1);
    expect(commands).toEqual([requested, "Questo è per il gruppo."]);
    const workspaceId = new URL(page.url()).searchParams.get("workspace")!;
    const settings = await (
      await page.request.get(
        "/api/v1/assistant-settings?workspaceId=" + workspaceId,
      )
    ).json();
    const session = await (
      await page.request.get("/api/auth/get-session")
    ).json();
    const renamed = await page.request.post("/api/v1/assistant-settings", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        workspaceId,
        expectedActorId: session.user.id,
        expectedRevision: settings.revision,
        connectionId: "default",
        connectionRevision: settings.connections.find(
          (c: { id: string }) => c.id === "default",
        ).revision,
        displayName: "Luce",
        instructions: "",
      },
    });
    expect(renamed.ok()).toBe(true);
    await page.reload();
    await input.tap();
    await input.fill("Hai un suggerimento?");
    await form
      .getByRole("button", { name: "Chiedi a Luce", exact: true })
      .tap();
    await expect(input).toHaveValue("");
    await expect(
      guest
        .locator(".messages")
        .getByText("@Emme Hai un suggerimento?", { exact: true }),
    ).toHaveCount(1);

    await page.getByRole("heading", { name: group, exact: true }).tap();
    await expect(
      form.getByRole("button", { name: "Chiedi a Luce", exact: true }),
    ).toBeHidden();
  } finally {
    await guest.close();
  }
});

test.describe("Short desktop window", () => {
  test.use({
    viewport: { width: 390, height: 440 },
    isMobile: false,
    hasTouch: false,
  });
  test("the send controls stay above the window edge as a multiline draft grows", async ({
    page,
  }) => {
    await register(page, "Adele", crypto.randomUUID() + "@example.test");
    const name = "Studio finestra bassa";
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const workspace = new URL(page.url()).searchParams.get("workspace");
    const history = Array.from(
      { length: 35 },
      (_, i) => `Punto di discussione ${i + 1}`,
    ).join("\n");
    const seed = await page.request.post(
      `/api/v1/workspaces/${workspace}/commands`,
      {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "message.send", content: history },
        },
      },
    );
    expect(seed.ok()).toBeTruthy();
    await expect(page.locator(".messages")).toContainText(
      "Punto di discussione 35",
    );
    const form = page.locator(".conversation-composer");
    const editor = form.getByRole("textbox", { name: "Messaggio" });
    await editor.fill(
      "Prima della prova voglio verificare il testo della domanda.\nChe ne pensate?",
    );
    const send = form.getByRole("button", { name: "Invia", exact: true });
    const ask = form.getByRole("button", {
      name: "Chiedi a Emme",
      exact: true,
    });
    for (const control of [send, ask]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(
        await control.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      ).toBe(true);
    }
    await send.click();
    await expect(editor).toHaveValue("");
    await expect(page.locator(".messages")).toContainText("Che ne pensate?");
  });
});
