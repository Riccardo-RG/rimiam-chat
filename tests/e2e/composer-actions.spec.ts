import { expect, test } from "@playwright/test";
import { fillWorkspaceName, openMessageComposer, register } from "./helpers";

test("slash and visible actions open actual Workspace tools without posting or consuming a normal draft", async ({
  page,
}) => {
  const suffix = crypto.randomUUID();
  await register(page, "Alba", `actions-${suffix}@example.test`);
  await fillWorkspaceName(page, "Scorciatoie " + suffix);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scorciatoie " + suffix }),
  ).toBeVisible();
  const workspace = new URL(page.url());
  const sharedFile = await page.request.post(
    `/api/workspaces/${workspace.searchParams.get("workspace")}/sources`,
    {
      headers: { Origin: workspace.origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "document.upload",
          filename: "brief-condiviso.txt",
          bytesBase64: Buffer.from("Promemoria per il team").toString("base64"),
        },
      },
    },
  );
  expect(sharedFile.ok()).toBe(true);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/commands$/.test(new URL(request.url()).pathname)
    )
      writes.push(request.postDataJSON()?.command?.type);
  });
  const search = page.getByRole("combobox", { name: "Cerca un’azione" });
  const close = page.getByRole("button", {
    name: "Torna alla conversazione",
    exact: true,
  });
  const libraryShortcuts = /\/(?:documenti|file)\b/;
  let firstDownload: string | null = null;
  for (const [query, title] of [
    ["guida", "Guida dello spazio"],
    ["file", "Condivisi"],
    ["documenti", "Condivisi"],
    ["contesto", "Contesto condiviso"],
    ["task", "In programma"],
    ["carica", "Fonti e ricerca"],
    ["ricerca", "Fonti e ricerca"],
  ]) {
    const editor = await openMessageComposer(page);
    await editor.press("/");
    await expect(search).toBeFocused();
    if (query === "guida") {
      const options = page.getByRole("option", { name: libraryShortcuts });
      await expect(options).toHaveCount(1);
      await expect(options).toContainText("/documenti");
      await expect(options).toContainText("/file");
    }
    await search.fill(query);
    // IME commits must not choose an action or submit the chat form.
    await search.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await expect(search).toBeVisible();
    const taskRead = Promise.withResolvers<void>();
    const taskUrl = `**/api/v1/workspaces/${workspace.searchParams.get("workspace")}/tasks`;
    let taskReadStarted = false;
    if (query === "task") {
      // The UI may legitimately repeat its read during mount or a sync.
      // Keep all responses pending to exercise the unavailable view.
      await page.route(taskUrl, async (route) => {
        taskReadStarted = true;
        await taskRead.promise;
        await route.continue();
      });
    }
    await search.press("Enter");
    await expect(
      page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    if (query === "guida") {
      const terms = page
        .getByRole("dialog", { name: title, exact: true })
        .locator("dt")
        .filter({ hasText: libraryShortcuts });
      await expect(terms).toHaveCount(1);
      await expect(terms).toContainText("/documenti");
      await expect(terms).toContainText("/file");
    }
    if (title === "Condivisi") {
      const openFile = page
        .getByRole("dialog", { name: "Condivisi", exact: true })
        .getByRole("list", { name: "File condivisi" })
        .getByRole("button", { name: "Apri brief-condiviso.txt" });
      await openFile.click();
      const preview = page.getByRole("dialog", { name: "brief-condiviso.txt" });
      const original = preview.getByRole("link", { name: "Scarica originale" });
      const link = await original.getAttribute("href");
      expect(link).toBeTruthy();
      if (firstDownload) expect(link).toBe(firstDownload);
      else firstDownload = link;
      await preview
        .getByRole("button", { name: "Chiudi", exact: true })
        .click();
    }
    if (query === "task") {
      const taskTitle = page.getByRole("textbox", {
        name: "Attività",
        exact: true,
      });
      try {
        await expect.poll(() => taskReadStarted).toBe(true);
        await expect(taskTitle).toBeVisible();
        await expect(taskTitle).toBeDisabled();
      } finally {
        taskRead.resolve();
      }
      await expect(taskTitle).toBeEnabled();
      await page.unroute(taskUrl);
    }
    if (query === "carica")
      await expect(
        page.locator('input[type="file"][name="document"]'),
      ).toBeVisible();
    if (query === "ricerca") {
      await expect(
        page.getByRole("textbox", { name: "Che cosa serve sapere?" }),
      ).toBeFocused();
      await expect(
        page.getByRole("checkbox", {
          name: /Autorizzo l’invio del solo testo/,
        }),
      ).not.toBeChecked();
    }
    await close.click();
  }
  const tools = page.getByRole("navigation", {
    name: "Strumenti dello spazio",
    exact: true,
  });
  if (!(await tools.isVisible()))
    await page
      .locator(".sidebar-tools")
      .getByText("Strumenti", { exact: true })
      .click();
  const editor = await openMessageComposer(page);
  const draft = "Domani / dopodomani?";
  await editor.fill(draft);
  // Keep the intended target under a live mouse press; shrinking the editor
  // on pointerdown/blur can scroll it away before mouseup dispatches the click.
  const context = page
    .getByRole("navigation", { name: "Strumenti dello spazio" })
    .getByRole("button", { name: "Contesto", exact: true });
  await context.scrollIntoViewIfNeeded();
  const bounds = await context.boundingBox();
  if (!bounds) throw new Error("Missing Context control");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await expect(editor).toBeVisible({ timeout: 1500 });
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "Contesto condiviso", exact: true }),
  ).toBeVisible();
  await close.click();
  await expect(await openMessageComposer(page)).toHaveValue(draft);
  await page.getByRole("button", { name: "Azioni", exact: true }).click();
  await search.fill("emme");
  await page.getByRole("option", { name: /Chiedi a Emme/ }).click();
  await expect(editor).toHaveValue("@Emme " + draft);
  await page.getByRole("button", { name: "Azioni", exact: true }).click();
  await search.fill("invita");
  await search.press("Escape");
  await expect(editor).toHaveValue("@Emme " + draft);
  await page.getByRole("button", { name: "Azioni", exact: true }).click();
  await search.fill("analizza");
  await search.press("Enter");
  await expect(editor).toHaveValue("@Emme analizza: " + draft);
  await editor.fill("");
  await editor.press("/");
  await search.fill("feedback nota di prova");
  await expect(editor).toHaveValue("/feedback nota di prova");
  expect(writes).toEqual([]);
});

test.describe("touch shortcut", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("opens beside the message field, and a soft-keyboard action keeps the draft", async ({
    page,
  }) => {
    const suffix = crypto.randomUUID();
    await register(page, "Alba", `touch-actions-${suffix}@example.test`);
    await fillWorkspaceName(page, "Azioni touch " + suffix);
    await page.getByRole("button", { name: "Crea spazio", exact: true }).tap();
    await expect(
      page.getByRole("heading", { name: "Azioni touch " + suffix }),
    ).toBeVisible();
    await openMessageComposer(page);
    const shortcut = page.getByRole("button", { name: "Azioni", exact: true });
    const search = page.getByRole("combobox", { name: "Cerca un’azione" });
    await shortcut.tap();
    await expect(search).toBeFocused();
    await page.getByRole("button", { name: "Chiudi azioni" }).tap();
    const editor = await openMessageComposer(page);
    // A mobile paste of the whole alias must open the grouped result too.
    await editor.fill("/file");
    await expect(search).toBeFocused();
    await page.getByRole("option", { name: /\/documenti/ }).tap();
    await expect(
      page.getByRole("heading", { name: "File condivisi", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .tap();
    await openMessageComposer(page);
    await editor.fill("Una bozza sul telefono");
    await shortcut.tap();
    await search.fill("emme");
    // Some software keyboards report the text-editing intent without a keydown.
    await search.evaluate((field) =>
      field.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect(editor).toHaveValue("@Emme Una bozza sul telefono");
    await expect(search).toHaveCount(0);
  });
});
