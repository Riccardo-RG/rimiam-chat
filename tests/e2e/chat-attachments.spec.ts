import { devices, expect, test, type Page } from "@playwright/test";
import {
  fillWorkspaceName,
  joinTestWorkspace,
  openMessageComposer,
  openWorkspacePanel,
  register,
} from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      browserName === "webkit" ? devices["iPhone 13 Pro"] : {},
    );
  },
});

const photo = {
  name: "taccuinoVerificaInterfacciaConversazioneConContributiEDecisioniDelloSpazio.png",
  mimeType: "image/png",
  // Valid 1 × 1 RGB PNG, so the preview must decode the original bytes.
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC",
    "base64",
  ),
};

async function choosePhotos(page: Page, touch: boolean, files = [photo]) {
  await page.bringToFront();
  if (touch)
    await page.getByRole("textbox", { name: "Messaggio", exact: true }).tap();
  const button = page.getByRole("button", {
    name: "Allega un file o una foto",
    exact: true,
  });
  const [picker] = await Promise.all([
    page.waitForEvent("filechooser"),
    touch ? button.tap() : button.click(),
  ]);
  await picker.setFiles(files);
  return page.getByRole("list", { name: "Allegati in ordine di invio" });
}

function attachmentMessage(page: Page, author: string, filename: string) {
  return page
    .locator(".messages")
    .getByRole("article", { name: author, exact: true })
    .filter({ hasText: filename });
}

test("two members share an ordered batch, resume a draft, find photos by preview and navigate to the same original message", async ({
  page,
  browser,
  browserName,
}) => {
  test.setTimeout(150_000);
  const guest = await browser.newPage(),
    anonymous = await browser.newContext();
  try {
    const suffix = crypto.randomUUID(),
      workspaceName = "Media " + suffix;
    await register(page, "Alba", "media-" + suffix + "@example.test");
    await fillWorkspaceName(page, workspaceName);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: workspaceName, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, workspaceName, "Leo");
    const caption = "Le due schermate da confrontare.",
      other = { ...photo, name: "seconda.png" };
    await (await openMessageComposer(page)).fill(caption);
    const queue = await choosePhotos(page, browserName === "webkit");
    await queue.getByRole("button", { name: "Rimuovi " + photo.name }).click();
    await expect(await openMessageComposer(page)).toHaveValue(caption);
    await expect(attachmentMessage(guest, "Alba", photo.name)).toHaveCount(0);
    await choosePhotos(page, browserName === "webkit", [photo, other]);
    await queue
      .getByRole("button", { name: "Sposta prima " + other.name })
      .click();
    await page.reload();
    await expect(await openMessageComposer(page)).toHaveValue(caption);
    await expect(queue.getByRole("listitem").first()).toContainText(other.name);
    await expect(queue.getByRole("checkbox").first()).not.toBeChecked();
    const path =
        "**/api/v1/workspaces/" +
        new URL(page.url()).searchParams.get("workspace") +
        "/commands",
      sent: string[] = [];
    await page.route(path, async (route) => {
      if (route.request().postDataJSON()?.command?.type !== "message.send")
        return route.continue();
      sent.push(route.request().postData()!);
      if (sent.length !== 1) return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    const send = page.getByRole("button", { name: "Invia", exact: true });
    await send.click();
    const post = attachmentMessage(guest, "Alba", photo.name);
    await expect(post).toHaveCount(1);
    await expect(post).toContainText(caption);
    await expect(post.getByRole("img")).toHaveCount(2);
    await expect(post.getByRole("img").first()).toHaveAttribute(
      "alt",
      other.name,
    );
    // Even losing the tab's in-memory receipt after the server committed must
    // not create another message or discard the original attachment order.
    await page.reload();
    await expect(await openMessageComposer(page)).toHaveValue(caption);
    await expect(queue.getByRole("listitem")).toHaveCount(2);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(await openMessageComposer(page)).toHaveValue("");
    expect(sent).toEqual([sent[0], sent[0]]);
    expect(
      JSON.parse(sent[0]).command.attachments.map(
        (f: { filename: string }) => f.filename,
      ),
    ).toEqual([other.name, photo.name]);
    await page.unroute(path);
    const id = await post.getAttribute("id");
    const openPreview = post.getByRole("button", {
      name: "Apri anteprima di " + photo.name,
      exact: true,
    });
    await openPreview.click();
    const fromChat = guest.getByRole("dialog", { name: photo.name });
    await expect(fromChat.getByRole("img")).toBeVisible();
    const href = await fromChat
      .getByRole("link", { name: "Scarica originale" })
      .getAttribute("href");
    const previewApi =
      "/api/v1/workspaces/" +
      new URL(page.url()).searchParams.get("workspace") +
      "/source-file?id=" +
      href!.split("/").pop() +
      "&view=preview";
    await expect(
      (await guest.request.get(previewApi)).json(),
    ).resolves.toMatchObject({
      bytes: photo.buffer.length,
      preview: { kind: "image" },
    });
    await fromChat.getByRole("button", { name: "Chiudi" }).click();
    await expect(openPreview).toBeFocused();
    await guest.setViewportSize({ width: 320, height: 568 });
    await openWorkspacePanel(guest, "artifacts", { dock: false });
    const lib = guest.getByRole("dialog", { name: /^(Condivisi|Documenti)$/ });
    await lib.getByRole("button", { name: "Media", exact: true }).click();
    await lib.getByRole("searchbox").fill("taccuino");
    const item = lib.getByRole("button", { name: "Apri " + photo.name });
    await item.click();
    const preview = guest.getByRole("dialog", { name: photo.name });
    await expect(preview).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      await preview.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
    ).toBe(true);
    await expect(preview.getByRole("img")).toHaveAttribute(
      "src",
      href + "?preview=1",
    );
    const jpeg = await guest.request.get(href + "?preview=1");
    expect((await jpeg.body()).equals(photo.buffer)).toBe(true);
    expect(
      (
        await anonymous.request.get(
          new URL(href + "?preview=1", guest.url()).href,
        )
      ).status(),
    ).toBe(401);
    await preview.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(item).toBeFocused();
    await expect(lib.getByRole("searchbox")).toHaveValue("taccuino");
    await expect(
      lib.getByRole("button", { name: "Media", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await item.click();
    await preview.getByRole("button", { name: "Vai al messaggio" }).click();
    await expect(guest.locator("#" + id)).toBeFocused();
    await guest.reload();
    await expect(attachmentMessage(guest, "Alba", photo.name)).toHaveCount(1);
    const w = new URL(guest.url()).searchParams.get("workspace");
    const leave = await guest.request.post(
      "/api/workspaces/" + w + "/commands",
      {
        headers: { Origin: new URL(guest.url()).origin },
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "member.leave", confirmed: true },
        },
      },
    );
    expect(leave.ok()).toBe(true);
    expect((await guest.request.get(href!)).status()).toBe(403);
    expect((await guest.request.get(previewApi)).status()).toBe(403);
    expect(
      (
        await anonymous.request.get(new URL(previewApi, guest.url()).href)
      ).status(),
    ).toBe(401);
  } finally {
    await guest.close();
    await anonymous.close();
  }
});
