import type { Browser, Page } from "@playwright/test";
import { test, expect } from "./backend-fixture";
import {
  fillWorkspaceName,
  joinTestWorkspace,
  messageComposer,
  openAccountAppearance,
  openMessageComposer,
  openWorkspacePanel,
  register,
} from "./helpers";
test("Conversation-first Home, responsive layers and structured document remain usable", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await register(
    page,
    "Riccardo QA",
    `design-${crypto.randomUUID()}@example.test`,
  );
  await expect(
    page.getByRole("heading", { name: "I tuoi spazi", level: 1, exact: true }),
  ).toBeVisible();
  await fillWorkspaceName(page, "Il nostro cocktail bar");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Conversazione", exact: true }),
  ).toBeVisible();
  const composer = await openMessageComposer(page);
  await composer.fill(
    "Emme, vorremmo confrontare due locali luminosi vicino alla stazione.",
  );
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(page.locator(".messages")).toContainText("due locali luminosi");
  const accountMenu = await openAccountAppearance(page);
  const appearance = page.getByRole("combobox", { name: "Aspetto dell’app" });
  const renderedColors = () =>
    page.locator("body").evaluate((body) => {
      const { color, backgroundColor } = getComputedStyle(body);
      return { color, backgroundColor };
    });
  await appearance.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  const light = await renderedColors();
  await appearance.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  const dark = await renderedColors();
  expect(dark.color).not.toBe(light.color);
  expect(dark.backgroundColor).not.toBe(light.backgroundColor);
  await accountMenu.click();
  await page.screenshot({
    path: info.outputPath("conversation-dark-1440.png"),
    fullPage: true,
  });
  await openAccountAppearance(page);
  await appearance.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  expect(await renderedColors()).toEqual(light);
  await accountMenu.click();
  const workspaceUrl = page.url();
  const draft = "Un confronto ancora da chiarire.\nUna seconda riga.";
  await openMessageComposer(page);
  await composer.fill("Un confronto ancora da chiarire.");
  await composer.press("End");
  await composer.press("Shift+Enter");
  await page.keyboard.insertText("Una seconda riga.");
  await expect(composer).toHaveValue(draft);
  const keyboardMessage = page
    .locator(".messages")
    .getByText(draft, { exact: true });
  await expect(keyboardMessage).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "I tuoi spazi", exact: true })
    .getByRole("button", { name: "Il nostro cocktail bar", exact: true })
    .click();
  await expect(composer).toHaveValue(draft);
  const rail = page.getByRole("complementary", {
    name: "Navigazione principale",
  });
  await rail.getByRole("button", { name: "Chiudi navigazione" }).click();
  await expect(rail).toBeHidden();
  const reopen = page.getByRole("button", { name: "Apri navigazione" });
  await expect(reopen).toBeFocused();
  await reopen.press("Enter");
  await expect(
    rail.getByRole("button", { name: "RIMIAM — Home", exact: true }),
  ).toBeFocused();
  await expect(composer).toHaveValue(draft);
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue(draft);
    if (size.width <= 760) {
      const navigation = page.getByRole("complementary", {
        name: "Navigazione principale",
      });
      const toggle = page.getByRole("button", {
        name: "Apri navigazione",
        exact: true,
      });
      await expect(navigation).not.toBeVisible();
      await toggle.focus();
      await toggle.press("Enter");
      await expect(navigation).toBeVisible();
      await expect(
        navigation.getByRole("button", { name: "RIMIAM — Home", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(navigation).not.toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.press("Enter");
      await navigation
        .getByRole("button", { name: "Il nostro cocktail bar", exact: true })
        .click();
      await expect(navigation).not.toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(composer).toHaveValue(draft);
    }
    const pageWidth = () =>
      page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      await pageWidth(),
      `Conversation at ${size.width}px`,
    ).toBeLessThanOrEqual(size.width + 1);
    await page.screenshot({
      path: info.outputPath(`conversation-${size.width}.png`),
      fullPage: true,
    });
    await openWorkspacePanel(page, "context", { dock: false });
    const contextLayer = page.getByRole("dialog", {
      name: "Contesto condiviso",
      exact: true,
    });
    await expect(contextLayer).toBeVisible();
    await expect(
      contextLayer.getByRole("heading", {
        name: "Contesto condiviso",
        exact: true,
      }),
    ).toBeVisible();
    expect(await pageWidth(), `Context at ${size.width}px`).toBeLessThanOrEqual(
      size.width + 1,
    );
    await page.screenshot({
      path: info.outputPath(`context-${size.width}.png`),
      fullPage: true,
    });
    const tools = page.getByRole("navigation", {
      name: "Strumenti dello spazio",
    });
    const contextEntry = tools.getByRole("button", {
      name: "Contesto",
      exact: true,
    });
    const workEntry = tools.getByRole("button", {
      name: "In programma",
      exact: true,
    });
    if (size.width > 760) {
      await workEntry.click();
      const workLayer = page.getByRole("dialog", {
        name: "In programma",
        exact: true,
      });
      await expect(workLayer).toBeVisible();
      await workLayer
        .getByRole("button", { name: "Torna alla conversazione" })
        .click();
      await expect(workEntry).toBeFocused();
    } else {
      await page.keyboard.press("Escape");
      await expect(contextEntry).toBeFocused();
      await expect(page.locator("#navigation-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
    await expect(tools).toBeVisible();
    await expect(contextLayer).not.toBeVisible();
    await expect(composer).toHaveValue(draft);
    if (size.width <= 760) {
      await contextEntry.press("Escape");
      await expect(tools).not.toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMessageComposer(page);
  await expect(composer).toHaveValue(draft);
  await composer.press("Enter");
  await expect(keyboardMessage).toBeVisible();
  await expect(keyboardMessage).toHaveCount(1);
  await openMessageComposer(page);
  await expect(composer).toHaveValue("");
  await openWorkspacePanel(page, "artifacts", { dock: false });
  const documentContent = page
    .getByRole("region", { name: "Brief e Artifacts", exact: true })
    .getByRole("textbox", { name: "Contenuto", exact: true });
  const library = page.getByRole("region", {
    name: "Brief e Artifacts",
    exact: true,
  });
  const newDocument = library.getByRole("button", {
    name: "Nuovo documento",
    exact: true,
  });
  const backToLibrary = library.getByRole("button", {
    name: "Torna al raccoglitore",
    exact: true,
  });
  const confirmDiscard = library.getByRole("button", {
    name: "Scarta modifiche",
    exact: true,
  });
  await newDocument.click();
  await library
    .getByRole("button", { name: "Aggiungi tabella", exact: true })
    .click();
  await expect(library.getByLabel("Colonna 1", { exact: true })).toBeVisible();
  await expect(documentContent).toHaveCount(0);
  await library
    .getByRole("button", { name: "Rimuovi tabella", exact: true })
    .click();
  await expect(documentContent).toBeEmpty();
  await backToLibrary.click();
  await expect(confirmDiscard).toHaveCount(0);
  await expect(newDocument).toBeFocused();

  await newDocument.click();
  await documentContent.fill("Questa prova deve restare solo nell’editor.");
  await backToLibrary.click();
  await library
    .getByRole("button", { name: "Continua a scrivere", exact: true })
    .click();
  await expect(documentContent).toHaveValue(
    "Questa prova deve restare solo nell’editor.",
  );
  await backToLibrary.click();
  await confirmDiscard.click();
  await expect(newDocument).toBeFocused();
  await expect(library.getByRole("article")).toHaveCount(0);
  await newDocument.click();
  await documentContent.fill("Mantieni il testo mentre scelgo se uscire.");
  const documents = page.getByRole("dialog", {
    name: "Condivisi",
    exact: true,
  });
  await expect(
    documents.getByRole("button", { name: "Viste dello spazio" }),
  ).toHaveCount(0);
  await documents
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await expect(confirmDiscard).toBeVisible();
  await library
    .getByRole("button", { name: "Continua a scrivere", exact: true })
    .click();
  await expect(documentContent).toHaveValue(
    "Mantieni il testo mentre scelgo se uscire.",
  );
  await page
    .getByRole("navigation", { name: "Strumenti dello spazio" })
    .getByRole("button", { name: "Contesto", exact: true })
    .click();
  await expect(confirmDiscard).toBeVisible();
  await library
    .getByRole("button", { name: "Continua a scrivere", exact: true })
    .click();
  await expect(documentContent).toHaveValue(
    "Mantieni il testo mentre scelgo se uscire.",
  );
  await page.keyboard.press("Escape");
  await expect(documents).toBeVisible();
  await confirmDiscard.click();
  await expect(documents).toBeHidden();
  await openWorkspacePanel(page, "artifacts", { dock: false });
  await newDocument.click();
  await expect(documentContent).toHaveValue("");
  await page.getByLabel("Titolo", { exact: true }).fill("Confronto dei locali");
  await page
    .getByLabel("A cosa ci serve?", { exact: true })
    .fill("Raccogliere le alternative prima di decidere");
  await documentContent.fill(
    "Valuteremo luminosità, distanza e costo senza adottare ancora una scelta.",
  );
  await expect(
    documents.getByRole("button", { name: "Sgancia", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Titolo", { exact: true })).toHaveValue(
    "Confronto dei locali",
  );
  await expect(
    page.getByLabel("A cosa ci serve?", { exact: true }),
  ).toHaveValue("Raccogliere le alternative prima di decidere");
  await expect(documentContent).toHaveValue(
    "Valuteremo luminosità, distanza e costo senza adottare ancora una scelta.",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Salva bozza", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Confronto dei locali", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".messages")).toContainText("due locali luminosi");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  await expect(keyboardMessage).toHaveCount(1);
  await page
    .getByRole("button", { name: "RIMIAM — Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "I tuoi spazi", level: 1, exact: true }),
  ).toBeVisible();
  const room = page
    .getByRole("region", { name: "Elenco degli spazi disponibili" })
    .getByRole("button", { name: /Il nostro cocktail bar/ })
    .first();
  const thumbnail = await room.locator(".directory-thumb").boundingBox();
  const name = await room
    .getByText("Il nostro cocktail bar", { exact: true })
    .boundingBox();
  expect(thumbnail).not.toBeNull();
  expect(name).not.toBeNull();
  expect(name!.x - (thumbnail!.x + thumbnail!.width)).toBeGreaterThanOrEqual(8);
  await page.screenshot({
    path: info.outputPath("application-home.png"),
    fullPage: true,
  });
  await page.goto(workspaceUrl);
  await expect(composer).toBeVisible();
  for (const [panel, region, entry] of [
    ["sources", "Fonti e ricerche", "Carica un file"],
    ["calendar", "Calendario dello spazio", "Aggiungi appuntamento personale"],
    ["email", "Email dello spazio", "Scrivi una bozza"],
  ] as const) {
    await openWorkspacePanel(page, panel, { dock: false });
    await expect(
      page
        .getByRole("region", { name: region, exact: true })
        .getByText(entry, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
    await expect(composer).toBeVisible();
  }
});

const finalReadingMessage =
  "Se una persona riesce a entrare e a capire dove scrivere senza il nostro aiuto, abbiamo già imparato qualcosa.";

async function seedReadingHistory(page: Page, browser: Browser, name: string) {
  const guest = await browser.newPage();
  try {
    const workspace = new URL(page.url()).searchParams.get("workspace");
    const commands = `/api/workspaces/${workspace}/commands`;
    const headers = { Origin: new URL(page.url()).origin };
    await joinTestWorkspace(page, guest, name, "Giulia");
    for (const [author, content] of [
      [
        page,
        "Per la prima beta inizierei da una domanda: Emme capisce davvero quando intervenire?",
      ],
      [
        guest,
        "Proviamola in due. Voglio vedere come si inserisce quando stiamo già ragionando insieme.",
      ],
      [guest, "E anche quando sceglie di lasciarci parlare."],
      [
        page,
        "Potremmo usarla per preparare la demo. Abbiamo già le domande dei primi tester?",
      ],
      [
        guest,
        "Sì, te le porto giovedì. Scegliamone tre e vediamo cosa succede nella conversazione.",
      ],
      [page, "Perfetto. Partiamo dal primo invito."],
      [page, finalReadingMessage],
    ] as const) {
      const sent = await author.request.post(commands, {
        headers,
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "message.send", content },
        },
      });
      expect(sent.ok()).toBe(true);
    }
  } finally {
    await guest.close();
  }
}

for (const device of [
  { name: "desktop", viewport: { width: 1280, height: 900 }, touch: false },
  { name: "touch", viewport: { width: 390, height: 844 }, touch: true },
]) {
  test.describe(`Reading and writing on ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test("the composer leaves the latest message readable and preserves its draft", async ({
      page,
      browser,
    }, info) => {
      test.setTimeout(180000);
      await register(
        page,
        "Luca",
        `layout-${crypto.randomUUID()}@example.test`,
      );
      await page
        .getByRole("button", { name: "Accetto la regola d’uso della beta" })
        .click();
      const name = "RIMIAM · Prima beta";
      await fillWorkspaceName(page, name);
      await page
        .getByRole("button", { name: "Crea spazio", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();

      await seedReadingHistory(page, browser, name);
      await page.reload();
      const history = page.locator(".messages");
      const message = history.getByText(finalReadingMessage, { exact: true });
      await expect(message).toBeVisible();
      const continuation = history
        .getByRole("article")
        .filter({ hasText: finalReadingMessage });
      const groupStart = history.getByRole("article").filter({
        hasText: "Perfetto. Partiamo dal primo invito.",
      });
      await expect(groupStart).toHaveAttribute("data-continuation", "false");
      await expect(groupStart.locator(".message-author")).toBeVisible();
      await expect(continuation).toHaveAttribute("data-continuation", "true");
      await expect(continuation).toHaveAccessibleName(/Luca/);
      await expect(continuation.locator(".message-author")).not.toBeVisible();
      const options = continuation.getByLabel(/Opzioni del messaggio/);
      const source = continuation.getByText(/Atto umano originale/);
      await options.click();
      await expect(source).toBeVisible();
      await options.click();
      await expect(source).not.toBeVisible();
      const editor = messageComposer(page);
      await expect(editor).toBeInViewport({ ratio: 1 });
      const clipButton = page.getByRole("button", {
        name: "Allega un file o una foto",
      });
      if (device.touch) await expect(clipButton).toBeHidden();
      else await expect(clipButton).toBeInViewport({ ratio: 1 });

      // Read through the last line of the history without scrolling the document
      // to a locator. A sticky composer can otherwise cover a passing in-viewport check.
      await page
        .locator(".messages")
        .evaluate((list) => list.scrollTo(0, list.scrollHeight));
      await expect
        .poll(() =>
          message.evaluate((element) => {
            const { left, width, bottom } = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(left + width / 2, bottom - 2),
            );
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`reading-${device.name}.png`),
        animations: "disabled",
      });

      const draft = "Bozza da riprendere dopo la lettura.";
      if (device.touch) await editor.tap();
      else await editor.click();
      await editor.fill(draft);
      if (device.touch) {
        // Start every gesture on a focused writing surface. Tapping a toolbar
        // control must open it immediately, including when the draft has text.
        const [emptyPicker] = await Promise.all([
          page.waitForEvent("filechooser"),
          clipButton.tap(),
        ]);
        await emptyPicker.setFiles([]);
        const pendingFiles = page.getByRole("list", {
          name: "Allegati in ordine di invio",
        });
        await expect(pendingFiles).toHaveCount(0);
        await expect(editor).toHaveValue(draft);

        await editor.tap();
        const [filePicker] = await Promise.all([
          page.waitForEvent("filechooser"),
          clipButton.tap(),
        ]);
        await filePicker.setFiles({
          name: "nota-di-prova.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Nota per il gruppo."),
        });
        await expect(pendingFiles).toContainText("nota-di-prova.txt");
        await pendingFiles
          .getByRole("button", { name: "Rimuovi nota-di-prova.txt" })
          .tap();
        await expect(pendingFiles).toHaveCount(0);

        for (const [button, title, close] of [
          ["Azioni", "Azioni dello spazio", "Chiudi azioni"],
          ["Voce", "Voce", "Chiudi"],
          ["Chiamata audio", "Chiamata audio", "Chiudi"],
        ]) {
          await editor.tap();
          await page.getByRole("button", { name: button, exact: true }).tap();
          const dialog = page.getByRole("dialog", { name: title, exact: true });
          await expect(dialog).toBeInViewport();
          await dialog.getByRole("button", { name: close, exact: true }).tap();
          await expect(dialog).toBeHidden();
          await expect(editor).toHaveValue(draft);
        }

        await page.getByRole("heading", { name, level: 1, exact: true }).tap();
      } else {
        await message.hover();
        await page.mouse.wheel(0, -160);
        await editor.press("Escape");
      }
      await expect(editor).toBeVisible();
      await expect(editor).toHaveValue(draft);
      await expect(
        page.locator(".messages").getByText(draft, { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`writing-${device.name}.png`),
        animations: "disabled",
      });
      const send = page.getByRole("button", { name: "Invia", exact: true });
      const sizes = device.touch
        ? [
            [320, 568],
            [360, 640],
            [375, 667],
            [390, 844],
            [390, 260],
            [393, 852],
            [430, 932],
            [667, 375],
            [844, 390],
            [768, 1024],
            [820, 1180],
            [1024, 768],
            [1180, 820],
          ]
        : [
            [1024, 600],
            [1280, 720],
            [1366, 768],
            [1440, 900],
            [1920, 1080],
          ];
      if (device.touch) await editor.tap();
      for (const [width, height] of sizes) {
        await test.step(`Read and compose at ${width}×${height}`, async () => {
          await page.setViewportSize({ width, height });
          await expect(editor).toHaveValue(draft);
          await expect(editor).toBeInViewport({ ratio: 1 });
          await expect(send).toBeInViewport({ ratio: 1 });
          if (device.touch && width <= 844) {
            const fieldBox = (await editor.boundingBox())!;
            const sendBox = (await send.boundingBox())!;
            const row = (await page.locator(".composer-row").boundingBox())!;
            expect(fieldBox.width).toBeGreaterThanOrEqual(row.width - 2);
            expect(sendBox.y).toBeGreaterThanOrEqual(
              fieldBox.y + fieldBox.height - 1,
            );
          }
          await expect(
            page.getByRole("button", { name: "Allega un file o una foto" }),
          ).toBeInViewport({ ratio: 1 });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width + 1);
          await history.evaluate((list) => list.scrollTo(0, list.scrollHeight));
          await expect
            .poll(() =>
              message.evaluate((node) => {
                const box = node.getBoundingClientRect();
                return node.contains(
                  document.elementFromPoint(
                    box.left + box.width / 2,
                    box.bottom - 2,
                  ),
                );
              }),
            )
            .toBe(true);
          if (
            (device.touch &&
              (width === 667 || (width === 390 && height === 844))) ||
            (width === 1366 && !device.touch)
          ) {
            await page.screenshot({
              path: info.outputPath(`chat-${width}x${height}.png`),
              animations: "disabled",
            });
          }
        });
      }
      if (device.touch) {
        // Exercise the constrained page layout separately from the native keyboard test.
        await page.setViewportSize({ width: 844, height: 154 });
        await editor.focus();
        await expect(send).toBeInViewport({ ratio: 1 });
        await expect
          .poll(() =>
            send.evaluate((button) => {
              const box = button.getBoundingClientRect();
              return button.contains(
                document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                ),
              );
            }),
          )
          .toBe(true);
      }
      await page.setViewportSize(device.viewport);
      if (device.touch) {
        // Model the WebKit touch sequence: the textarea loses focus without
        // transferring it to the submit button before that button's click.
        await editor.evaluate((element) => element.blur());
        await expect(send).toBeVisible();
        await send.tap();
      } else {
        await editor.dispatchEvent("keydown", {
          key: "Enter",
          isComposing: true,
        });
        await editor.dispatchEvent("keyup", { key: "Enter" });
        await expect(editor).toHaveValue(draft);
        await editor.press("Enter");
      }
      await expect(history.getByText(draft, { exact: true })).toHaveCount(1);
      await expect(editor).toHaveValue("");

      if (device.touch) {
        await editor.fill("Due righe");
        await editor.press("End");
        await editor.press("Enter");
        await expect(editor).toHaveValue("Due righe\n");
        await expect(
          history.getByText("Due righe", { exact: true }),
        ).toHaveCount(0);
      } else {
        const clicked = "Messaggio dal pulsante desktop.";
        await editor.fill(clicked);
        await expect(editor).toBeFocused();
        await send.click();
        await expect(history.getByText(clicked, { exact: true })).toHaveCount(
          1,
        );
        await expect(editor).toHaveValue("");

        // Keep a verified response in flight while the user replaces the draft
        // with a new one that happens to contain exactly the same text.
        const repeated = "Prendo nota.";
        const committed = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        await page.route(
          "**/api/v1/workspaces/*/commands",
          async (route) => {
            const response = await route.fetch();
            committed.resolve();
            await release.promise;
            await route.fulfill({ response });
          },
          { times: 1 },
        );
        await editor.fill(repeated);
        await editor.press("Enter");
        try {
          await committed.promise;
          await editor.fill("Riscrivo");
          await editor.fill(repeated);
        } finally {
          release.resolve();
        }
        await expect(history.getByText(repeated, { exact: true })).toHaveCount(
          1,
        );
        await expect(send).toBeEnabled();
        await expect(editor).toHaveValue(repeated);
      }
    });
  });
}
