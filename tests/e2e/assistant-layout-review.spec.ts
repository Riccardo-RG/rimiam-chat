import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fillWorkspaceName,
  register,
  joinTestWorkspace,
  openWorkspacePanel,
} from "./helpers";

const targets = [
  [320, 568],
  [360, 640],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1366, 768],
  [390, 440],
] as const;
const title = "Lancio RIMIAM";
const excerpts = [
  "Ho rivisto i punti della prova di domani. Partirei da un gruppo che ha già qualcosa da decidere.",
  "Sì. Chiediamo di confrontare due preventivi e di indicarci dove si bloccano.",
  "Nel primo giro lascerei parlare loro. Prendiamo nota delle domande che fanno al gruppo.",
  "Per il secondo giro, facciamo ritrovare il documento condiviso ieri e il messaggio da cui nasce.",
  "Mi piace. Tengo distinti i dubbi sul prodotto dalle difficoltà di navigazione.",
  "Raccogliamo le osservazioni più importanti e venerdì decidiamo insieme che cosa cambiare.",
];
test.skip(
  ({ browserName }) => browserName === "webkit",
  "WebKit has a separate touch and keyboard suite.",
);
test.use({ viewport: { width: 1366, height: 768 } });
test("a populated Home, private settings, conversation and shared library fit the responsive workspace", async ({
  page,
  browser,
  browserName: engine,
}, info) => {
  test.setTimeout(240000);
  await page.addInitScript(
    (mode) => localStorage.setItem("rimiam-appearance", mode),
    engine === "chromium" ? "light" : "dark",
  );
  const directory = info.outputPath("captures");
  await mkdir(directory, { recursive: true });
  const guest = await browser.newPage();
  const metrics: Record<string, unknown>[] = [];
  async function capture(
    name: string,
    width: number,
    height: number,
    subject?: Locator,
  ) {
    const layout = await page.evaluate(() => {
      const size = { width: innerWidth, height: innerHeight };
      const root = document.documentElement,
        scroll = root.scrollWidth - root.clientWidth;
      const chat = document.querySelector(".messages")?.getBoundingClientRect();
      return {
        ...size,
        overflow: scroll,
        chatHeight: chat?.height,
        theme: document.documentElement.dataset.appearance,
      };
    });
    if (subject) await expect(subject).toBeVisible();
    await page.mouse.move(1, height - 1);
    metrics.push({ name, ...layout });
    expect(
      layout.overflow,
      engine + " " + name + " " + width + "px",
    ).toBeLessThanOrEqual(1);
    if (name === "chat") expect(layout.chatHeight!).toBeGreaterThan(105);
    if (
      ((width === 320 && name === "shared") ||
        [390, 768, 1366].includes(width)) &&
      (height !== 440 || name === "composer")
    ) {
      await page.screenshot({
        path: path.join(directory, `${engine}-${width}x${height}-${name}.png`),
        animations: "disabled",
      });
    }
  }
  try {
    await register(page, "Riccardo", crypto.randomUUID() + "@example.test");
    await fillWorkspaceName(page, title);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const workspaceURL = page.url(),
      origin = new URL(workspaceURL).origin;
    const workspace = new URL(workspaceURL).searchParams.get("workspace")!;
    await joinTestWorkspace(page, guest, title, "Giulia");
    const notice = page.getByRole("button", {
      name: "Accetto la regola d’uso della beta",
    });
    await notice.click();
    await expect(notice).toHaveCount(0);
    async function send(
      author: Page,
      content: string,
      attachments?: { filename: string; bytesBase64: string }[],
    ) {
      const response = await author.request.post(
        "/api/v1/workspaces/" + workspace + "/commands",
        {
          headers: { Origin: origin },
          data: {
            commandId: crypto.randomUUID(),
            command: { type: "message.send", content, attachments },
          },
        },
      );
      expect(response.ok(), String(response.status())).toBeTruthy();
    }
    await send(guest, "Carico la traccia per la prova.", [
      {
        filename: "Traccia della prima intervista.txt",
        bytesBase64: Buffer.from(excerpts.join("\n")).toString("base64"),
      },
    ]);
    for (let i = 0; i < 12; i++)
      await send(i % 2 === 0 ? page : guest, excerpts[i % excerpts.length]);
    const requestedViewport = process.env.RIMIAM_REVIEW_VIEWPORT;
    const viewports = requestedViewport
      ? targets.filter(([w, h]) => `${w}x${h}` === requestedViewport)
      : targets;
    expect(viewports, "Unknown review viewport").not.toHaveLength(0);
    for (const [width, height] of viewports) {
      await test.step(width + " × " + height, async () => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        const home = page.getByRole("region", {
          name: "Personale",
          exact: true,
        });
        await expect(
          page.getByRole("region", {
            name: "Elenco degli spazi disponibili",
          }),
        ).toContainText(title);
        const room = page
          .getByRole("region", { name: "Elenco degli spazi disponibili" })
          .getByRole("button", { name: /Lancio RIMIAM/ })
          .first();
        if (width <= 430)
          expect((await room.boundingBox())!.height).toBeLessThan(160);
        if (width === 768) {
          const label = page.locator(".rail-settings-label");
          const position = await label.evaluate((el) => {
            const row = el.closest("button")!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(el);
            return {
              lines: range.getClientRects().length,
              fits: range.getBoundingClientRect().right <= row.right,
            };
          });
          expect(position).toEqual({ lines: 1, fits: true });
        }
        await capture("home", width, height, home);
        await home.getByRole("button", { name: "Configura Emme" }).click();
        const dialog = page.getByRole("dialog", { name: "Configura Emme" });
        await expect(dialog.getByLabel("Modello o agente")).toHaveValue(
          "default",
        );
        await capture("settings", width, height, dialog);
        const close = dialog.getByRole("button", {
          name: "Chiudi",
          exact: true,
        });
        const save = dialog.getByRole("button", {
          name: "Salva impostazioni",
        });
        await save.scrollIntoViewIfNeeded();
        await expect(save).toBeInViewport({ ratio: 0.95 });
        await close.scrollIntoViewIfNeeded();
        await close.click();
        await expect(dialog).toHaveCount(0);
        await expect(
          home.getByRole("button", { name: "Configura Emme" }),
        ).toBeFocused();
        await page.goto(workspaceURL);
        await expect(page.locator(".messages")).toContainText(excerpts[5]);
        const stream = page.locator(".messages");
        await stream.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await capture("chat", width, height, stream);
        const editor = page.getByRole("textbox", {
          name: "Messaggio",
          exact: true,
        });
        await editor.fill(
          "Prima della prova voglio verificare il testo della domanda.",
        );
        const sendButton = page.getByRole("button", {
          name: "Invia",
          exact: true,
        });
        await expect(sendButton).toBeInViewport({ ratio: 1 });
        await expect(editor).toBeInViewport({ ratio: 1 });
        if (height === 440) await capture("composer", width, height, editor);
        await editor.fill("");
        const sharedTab = page
          .getByRole("navigation", { name: "Viste dello spazio" })
          .getByRole("button", { name: "Condivisi", exact: true });
        await sharedTab.focus();
        const before = await stream.evaluate((el) => el.scrollTop);
        await openWorkspacePanel(page, "artifacts", { dock: false });
        const library = page.getByRole("dialog", {
          name: "Condivisi",
          exact: true,
        });
        await expect(library).toContainText(
          "Traccia della prima intervista.txt",
        );
        if (width <= 600) {
          const filter = library.getByRole("button", {
            name: "Filtri",
            exact: true,
          });
          const searchBox = (await library
            .getByRole("searchbox")
            .boundingBox())!;
          const filterBox = (await filter.boundingBox())!;
          expect(
            Math.abs(
              searchBox.y +
                searchBox.height / 2 -
                filterBox.y -
                filterBox.height / 2,
            ),
          ).toBeLessThanOrEqual(3);
          await filter.click();
          await expect(
            library.getByLabel("Data di condivisione"),
          ).toBeVisible();
          await filter.click();
          await expect(library.getByLabel("Data di condivisione")).toBeHidden();
          await library.locator(".layer-body").evaluate((el) => {
            el.scrollTop = 0;
          });
          if (height >= 568)
            await expect(
              library.getByRole("button", {
                name: "Apri Traccia della prima intervista.txt",
              }),
            ).toBeInViewport();
        }
        await capture("shared", width, height, library);
        const dismiss = library
          .getByRole("button", { name: "Torna alla conversazione" })
          .first();
        await expect(dismiss).toBeInViewport();
        await dismiss.click();
        await expect(library).toHaveCount(0);
        if (width <= 600) {
          await expect(sharedTab).toBeFocused();
          expect(
            Math.abs((await stream.evaluate((el) => el.scrollTop)) - before),
          ).toBeLessThanOrEqual(2);
        }
      });
    }
  } finally {
    await writeFile(
      path.join(directory, "metrics.json"),
      JSON.stringify(metrics, null, 2),
    );
    await guest.close();
  }
});
