import { expect, test, type Page, type Browser } from "@playwright/test";
import { fillWorkspaceName, register, joinTestWorkspace } from "./helpers";

test("a group opens at the bottom, or at the latest unread mention on a shorter phone", async ({
  page,
  browser,
}) => {
  const guest = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const workspaceName = "Cronologia all’ingresso";
  try {
    await register(
      page,
      "Ada",
      "fresh-reading-" + crypto.randomUUID() + "@example.test",
    );
    await fillWorkspaceName(page, workspaceName);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: workspaceName, exact: true }),
    ).toBeVisible();
    const { origin, searchParams } = new URL(page.url());
    const path =
      "/api/v1/workspaces/" + searchParams.get("workspace") + "/commands";
    const ids: string[] = [];
    // A narrow PNG changes height after the preview's placeholder is replaced.
    const image = {
      filename: "appunto.png",
      bytesBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAAEsCAAAAABWQ+qXAAAAXUlEQVR4nO3MQREAAAwCIOMb2xC7/SAA6VEEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAsFHMMun2kr9le6QAAAAAElFTkSuQmCC",
    };
    for (let i = 1; i <= 16; i++) {
      const sent = await page.request.post(path, {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            ...(i === 16 ? { attachments: [image] } : {}),
            content:
              "Aggiornamento " +
              i +
              "\n" +
              "Verifichiamo le ultime modifiche al progetto. ".repeat(12),
          },
        },
      });
      expect(sent.ok()).toBe(true);
      ids.push((await sent.json()).result.messageId);
    }
    await joinTestWorkspace(page, guest, workspaceName, "Roberta");
    const history = guest.locator(".messages");
    const first = guest.locator("#source-" + ids[0]);
    const latest = guest.locator("#source-" + ids.at(-1));
    await expect(latest).toBeInViewport();
    await expect(first).toBeAttached();
    await expect(first).not.toBeInViewport();
    expect(
      await history.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeGreaterThan(500);
    await expect
      .poll(() =>
        history.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(3);
    await expect(
      guest.getByRole("button", { name: "Riassumi da qui" }),
    ).toHaveCount(0);
    const workspaceUrl = guest.url();
    const readingPath = path.replace(/commands$/, "reading");
    const progress = async (reader: Page) => {
      const response = await reader.request.get(readingPath);
      expect(response.ok()).toBe(true);
      return response.json();
    };
    await expect
      .poll(() => progress(guest))
      .toMatchObject({ anchorId: ids.at(-1), anchorAtBottom: true });
    await guest.goto("/");
    const phone = await browser.newPage({
      storageState: await guest.context().storageState(),
      viewport: { width: 390, height: 667 },
      hasTouch: true,
    });
    try {
      let releaseImage = () => {};
      const waitForImage = new Promise<void>((resolve) => {
        releaseImage = resolve;
      });
      await phone.route(
        "**/sources/*?preview=1",
        async (route) => {
          await waitForImage;
          await route.continue();
        },
        { times: 1 },
      );
      await phone.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
      const phoneTimeline = phone.locator(".messages");
      const lastRead = phone.locator("#source-" + ids.at(-1));
      const preview = lastRead.getByRole("img", { name: image.filename });
      try {
        await expect(lastRead).toBeInViewport();
        await expect(preview).toBeAttached();
        expect(
          await preview.evaluate((el: HTMLImageElement) => el.naturalWidth),
        ).toBe(0);
        await expect
          .poll(() =>
            phoneTimeline.evaluate(
              (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
            ),
          )
          .toBeLessThan(3);
      } finally {
        releaseImage();
      }
      await expect
        .poll(() =>
          preview.evaluate((el: HTMLImageElement) => el.naturalHeight),
        )
        .toBe(300);
      await expect
        .poll(() =>
          phoneTimeline.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
          ),
        )
        .toBeLessThan(3);
      await phone.goto("/");
      const earlier = await page.request.post(path, {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            content: "@Roberta, puoi controllare la prima schermata?",
          },
        },
      });
      expect(earlier.ok()).toBe(true);
      const earlierMentionId = (await earlier.json()).result.messageId;
      const sent = await page.request.post(path, {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            content: "@Roberta " + "Nuove indicazioni. ".repeat(150),
          },
        },
      });
      expect(sent.ok()).toBe(true);
      const next = (await sent.json()).result.messageId;
      const trail = await page.request.post(path, {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            content: "Aggiornamento successivo. ".repeat(100),
          },
        },
      });
      expect(trail.ok()).toBe(true);
      await phone.goto(workspaceUrl);
      const mention = phone.locator("#source-" + next);
      await expect(mention).toBeInViewport();
      await expect
        .poll(() =>
          mention.evaluate((el) =>
            Math.abs(
              el.getBoundingClientRect().top -
                el.closest(".messages")!.getBoundingClientRect().top,
            ),
          ),
        )
        .toBeLessThan(3);
      await expect(
        phone.getByRole("button", { name: /Vai in fondo/ }),
      ).toBeVisible();
      await expect
        .poll(() => progress(phone))
        .toMatchObject({ mentionIds: [earlierMentionId] });
      await expect(
        phone.locator("#source-" + earlierMentionId),
      ).not.toBeInViewport();
    } finally {
      await phone.close();
    }
  } finally {
    await guest.close();
  }
});

async function verifyReading({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) {
  test.setTimeout(120000);
  const guest = await browser.newPage();
  try {
    const n = crypto.randomUUID(),
      name = "Lancio lettura " + n;
    await register(page, "Riccardo", "reading-" + n + "@example.test");
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, name, "Giulia");
    const w = new URL(page.url()).searchParams.get("workspace"),
      path = "/api/v1/workspaces/" + w + "/commands",
      origin = new URL(guest.url()).origin;
    await page.goto("/");
    const ids: string[] = [];
    for (let index = 0; index < 43; index++) {
      const content =
        (index === 2 || index === 20 ? "@Riccardo " : "") +
        "Materiale del lancio " +
        index +
        " · " +
        "Prima di iniziare raccogliamo le osservazioni della prova. ".repeat(7);
      const r = await guest.request.post(path, {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "message.send", content },
        },
      });
      expect(r.ok()).toBe(true);
      ids.push((await r.json()).result.messageId);
    }
    await page.reload();
    const jump = page.getByRole("button", {
      name: "Apri la prima menzione in " + name,
    });
    await expect(jump).toHaveText("@ 2");
    await jump.click();
    const old = page.locator("#source-" + ids[2]);
    await expect(old).toBeFocused();
    const next = page.getByRole("button", { name: "Menzione successiva · 1" });
    await expect(next).toBeVisible();
    await page.getByRole("button", { name: /Vai in fondo/ }).click();
    await expect(next).toBeVisible();
    await next.click();
    await expect(page.locator("#source-" + ids[20])).toBeFocused();
    await expect(
      page.getByRole("button", { name: /Menzione successiva/ }),
    ).toHaveCount(0);
    // A fresh snapshot after visible messages have been acknowledged does not
    // move the entry recap boundary or dispatch an unsolicited model call.
    const initialSummary = page.getByRole("button", {
      name: "Riassumi da qui",
    });
    await expect(initialSummary).toHaveCount(1);
    const summaryTarget = await initialSummary.getAttribute("data-recap-from");
    expect(summaryTarget).toBe(ids[0]);
    const another = await guest.request.post(path, {
      headers: { Origin: origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "message.send",
          content: "Altro aggiornamento dopo la lettura",
        },
      },
    });
    expect(another.ok()).toBe(true);
    await expect(
      page.getByText("Altro aggiornamento dopo la lettura", { exact: true }),
    ).toBeAttached();
    await expect(initialSummary).toHaveCount(1);
    expect(await initialSummary.getAttribute("data-recap-from")).toBe(
      summaryTarget,
    );
    const scroll = page.locator(".messages"),
      target = page.locator("#source-" + ids[10]);
    await target.evaluate((el) => el.scrollIntoView({ block: "start" }));

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/workspaces/" + w);
        return (await res.json()).reading.anchorId;
      })
      .toBe(ids[10]);
    await page.reload();
    await expect
      .poll(() =>
        scroll.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(3);
  } finally {
    await guest.close();
  }
}

test(
  "Home separates unread and mentions; jumping to the bottom preserves older mentions and reopening without unread mentions returns to the end",
  verifyReading,
);

test.describe("Web at 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test(
    "opens the oldest mention from Home and reopens at the bottom on a phone-sized touchscreen",
    verifyReading,
  );
});
