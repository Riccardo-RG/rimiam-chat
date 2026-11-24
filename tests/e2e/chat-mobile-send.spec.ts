import {
  devices,
  expect,
  test,
  type Locator,
  type Request,
} from "@playwright/test";
import { fillWorkspaceName, joinTestWorkspace, register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      devices[browserName === "webkit" ? "iPhone 13 Pro" : "Pixel 7"],
    );
  },
});

// Chromium does not open the iOS software keyboard. Reproduce its viewport pan
// and transient blur, then let a real pointer sequence hit the actual control.
async function tapWhileKeyboardPans(button: Locator) {
  const observed = await button.evaluateHandle((target) => {
    const field = target.closest("form")!.querySelector("textarea")!;
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 395 },
      pageTop: { configurable: true, value: 84 },
    });
    viewport.dispatchEvent(new Event("resize"));
    const touch = { native: false, stayedUnderFinger: false };
    document.addEventListener("pointerdown", function record(event) {
      if (!event.composedPath().includes(target)) return;
      document.removeEventListener("pointerdown", record);
      touch.native = event.isTrusted && !event.defaultPrevented;
      const start = target.getBoundingClientRect();
      field.blur();
      viewport.dispatchEvent(new Event("scroll"));
      const hit = document.elementFromPoint(
        start.left + start.width / 2,
        start.top + start.height / 2,
      );
      touch.stayedUnderFinger = target.contains(hit);
    });
    return touch;
  });
  try {
    await button.tap();
    expect(await observed.jsonValue()).toEqual({
      native: true,
      stayedUnderFinger: true,
    });
  } finally {
    await observed.dispose();
    await button.page().evaluate(() => {
      const viewport = window.visualViewport!;
      Reflect.deleteProperty(viewport, "pageTop");
      Reflect.deleteProperty(viewport, "height");
      viewport.dispatchEvent(new Event("resize"));
    });
  }
}

test("mobile Return writes a newline and tapping Send delivers once to both members", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const guest = await browser.newPage();
  try {
    const suffix = crypto.randomUUID();
    const name = `Chat mobile ${suffix}`;
    await register(page, "Luca", `mobile-${suffix}@example.test`);
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, name, "Giulia");

    const workspace = new URL(page.url()).searchParams.get("workspace");
    const path = `/api/v1/workspaces/${workspace}/commands`;
    const historyText = Array.from(
      { length: 18 },
      (_, i) => `Passo ${i + 1} della prova mobile.`,
    ).join("\n");
    const seed = await guest.request.post(path, {
      headers: { Origin: new URL(guest.url()).origin },
      // Playwright replays the same command ID if the connection resets.
      maxRetries: 1,
      data: {
        commandId: crypto.randomUUID(),
        command: { type: "message.send", content: historyText },
      },
    });
    expect(seed.ok()).toBe(true);
    await expect(page.locator(".messages")).toContainText(
      "Passo 18 della prova mobile.",
    );
    const isSend = (r: Request) =>
      r.method() === "POST" &&
      new URL(r.url()).pathname === path &&
      r.postDataJSON()?.command?.type === "message.send";
    const sends: string[] = [];
    page.on("request", (r) => {
      if (isSend(r)) sends.push(r.postDataJSON().command.content);
    });
    const navigations: string[] = [];
    for (const client of [page, guest]) {
      client.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === client.mainFrame())
          navigations.push(r.url());
      });
    }
    const editor = page.getByRole("textbox", {
      name: "Messaggio",
      exact: true,
    });
    const send = page.getByRole("button", { name: "Invia", exact: true });
    const attach = page.getByRole("button", {
      name: "Allega un file o una foto",
    });
    await expect(attach).toBeHidden();
    await expect(send).toBeHidden();
    await expect(editor).toBeInViewport({ ratio: 1 });
    const content = "Prova da telefono.\nSeconda riga.";
    await editor.tap();
    await expect(attach).toBeInViewport({ ratio: 1 });
    await expect(send).toBeInViewport({ ratio: 1 });
    await tapWhileKeyboardPans(
      page.getByRole("button", { name: "Voce", exact: true }),
    );
    const voice = page.getByRole("dialog", { name: "Voce" });
    await expect(voice.getByRole("checkbox")).not.toBeChecked();
    await expect(
      voice.getByRole("button", { name: "Registra messaggio vocale" }),
    ).toBeDisabled();
    await voice.getByRole("button", { name: "Chiudi" }).tap();
    await editor.tap();
    await page
      .getByRole("button", { name: "Chiamata audio", exact: true })
      .tap();
    const call = page.getByRole("dialog", { name: "Chiamata audio" });
    await expect(
      call.getByText("Il servizio chiamate deve essere configurato."),
    ).toBeVisible();
    await call.getByRole("button", { name: "Chiudi" }).tap();
    await editor.tap();
    await editor.fill("Prova da telefono.");
    await editor.press("End");
    await editor.press("Enter");
    await expect(editor).toHaveValue("Prova da telefono.\n");
    await page.keyboard.insertText("Seconda riga.");
    await expect(editor).toHaveValue(content);
    const permitsSoftwareReturn = await editor.evaluate((field) =>
      field.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          cancelable: true,
          bubbles: true,
        }),
      ),
    );
    expect(permitsSoftwareReturn).toBe(true);
    expect(sends).toEqual([]);
    // Use the measured visual-viewport height from Safari with the keyboard open.
    // The layout viewport stays tall, as it does while editing on iOS.
    const keyboardTop = 395;
    await page.locator("main.workspace").evaluate((workspace, height) => {
      workspace.style.setProperty("--chat-viewport-height", `${height}px`);
    }, keyboardTop);
    await expect
      .poll(() =>
        page
          .locator(".messages")
          .evaluate((list) => list.scrollHeight > list.clientHeight),
      )
      .toBe(true);
    const center = await send.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2,
        y = rect.top + rect.height / 2;
      return { y, hit: button.contains(document.elementFromPoint(x, y)) };
    });
    expect(center.y).toBeGreaterThanOrEqual(0);
    expect(center.y).toBeLessThan(keyboardTop);
    expect(center.hit).toBe(true);
    const [response] = await Promise.all([
      page.waitForResponse((r) => isSend(r.request()), { timeout: 10_000 }),
      tapWhileKeyboardPans(send),
    ]);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      status: "committed",
      commandId: response.request().postDataJSON().commandId,
    });
    await expect(editor).toHaveValue("");
    for (const client of [page, guest])
      await expect(
        client.locator(".messages").getByText(content, { exact: true }),
      ).toHaveCount(1);
    await test.step("Touch editing protects drafts through cancelled gestures and transient focus", async () => {
      await editor.tap();
      const draft = "Bozza da conservare.";
      await editor.fill(draft);
      const header = page.getByRole("heading", { name, exact: true });
      const send = page.getByRole("button", { name: "Invia", exact: true });
      const touch = {
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
      };
      // Playwright supplies tap but no cross-engine swipe gesture. Exercise the
      // cancellation and focus paths explicitly alongside the real taps above.
      await send.dispatchEvent("pointerdown", touch);
      await send.dispatchEvent("pointercancel", touch);
      await header.dispatchEvent("pointerdown", touch);
      await header.dispatchEvent("pointercancel", touch);
      await expect
        .soft(
          editor,
          "An outside gesture cancelled by scrolling should keep the editor visible",
        )
        .toBeVisible({ timeout: 1500 });
      await editor.tap();
      await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus({ preventScroll: true });
        document.body.removeAttribute("tabindex");
      });
      await expect
        .soft(
          editor,
          "A neutral focus transfer on touch should preserve the editing surface",
        )
        .toBeVisible({ timeout: 1500 });
      await editor.tap();
      await header.tap();
      await expect(attach).toBeHidden();
      await expect(send).toBeHidden();
      await expect(editor).toBeVisible();
      await expect(editor).toHaveValue(draft);
      await expect(
        guest.locator(".messages").getByText(draft, { exact: true }),
      ).toHaveCount(0);
    });
    expect(sends).toEqual([content]);
    expect(navigations).toEqual([]);
    await test.step("A private chat offers the same multiline field and visible Send", async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "Scrivi a un contatto" }).tap();
      await page
        .getByRole("button", { name: "Scrivi a Giulia", exact: true })
        .tap();
      const field = page.getByLabel("Messaggio privato");
      await expect(field).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Allega file o foto" }),
      ).toBeHidden();
      await field.fill("Una nota privata");
      await field.press("End");
      await field.press("Enter");
      await expect(field).toHaveValue("Una nota privata\n");
      await page.keyboard.insertText("La seconda riga.");
      await page.locator("main").evaluate((main, height) => {
        main.style.setProperty("--chat-viewport-height", height + "px");
      }, keyboardTop);
      await expect(
        page.getByRole("button", { name: "Allega file o foto" }),
      ).toBeInViewport({ ratio: 1 });
      const directSend = page.getByRole("button", {
        name: "Invia",
        exact: true,
      });
      const bottom = await directSend.evaluate(
        (button) => button.getBoundingClientRect().bottom,
      );
      expect(bottom).toBeLessThanOrEqual(keyboardTop);
      await directSend.tap();
      await expect(field).toHaveValue("");
      await guest.goto("/");
      await guest.getByRole("button", { name: /Luca.*Chat privata/ }).click();
      await expect(
        guest.getByText("Una nota privata\nLa seconda riga.", { exact: true }),
      ).toBeVisible();
    });
    await test.step("Personal Emme chat keeps the same compact entry and draft", async () => {
      await page.goto("/");
      await page
        .getByRole("button", { name: "Tu ed Emme", exact: true })
        .first()
        .tap();
      const field = page.getByRole("textbox", {
        name: "Messaggio",
        exact: true,
      });
      await expect(field).toBeVisible();
      const file = page.getByRole("button", {
        name: "Allega file",
        exact: true,
      });
      await expect(file).toBeHidden();
      await field.fill("Bozza privata");
      await expect(file).toBeVisible();
      await page
        .getByRole("heading", { name: "Tu ed Emme", exact: true })
        .first()
        .tap();
      await expect(file).toBeHidden();
      await expect(field).toHaveValue("Bozza privata");
    });
  } finally {
    await guest.close();
  }
});
