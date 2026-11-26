import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  openWithSession,
  fillWorkspaceName,
  joinTestWorkspace,
  register,
} from "./helpers";

test("participants can listen to a chat attachment before downloading in a workspace and a private chat", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const guest = await browser.newPage();
  const outsider = await browser.newPage();
  const suffix = crypto.randomUUID();
  const filename = "intervento.mp3";
  const attachments = [
    {
      filename,
      bytesBase64: (await readFile("tests/fixtures/call-tone.mp3")).toString(
        "base64",
      ),
    },
  ];
  async function listen(reader: Page) {
    await reader.bringToFront();
    await reader
      .getByRole("button", { name: "Apri anteprima di " + filename })
      .click();
    const dialog = reader.getByRole("dialog", { name: filename });
    const player = dialog.locator("audio");
    await expect(
      dialog.getByRole("link", { name: "Scarica originale" }),
    ).toBeVisible();
    await expect(player).not.toHaveAttribute("src", /./);
    const downloads: string[] = [];
    reader.once("download", (file) => downloads.push(file.suggestedFilename()));
    await dialog.getByRole("button", { name: "Ascolta anteprima" }).click();
    await expect
      .poll(() =>
        player.evaluate(
          (el) =>
            el instanceof HTMLAudioElement && (el.currentTime > 0 || el.ended),
        ),
      )
      .toBe(true);
    const audioPath = await player.getAttribute("src");
    const denied = await outsider.request.get(audioPath!, {
      headers: { Range: "bytes=0-1" },
    });
    expect([403, 404]).toContain(denied.status());
    expect(downloads).toEqual([]);
    await dialog.getByRole("button", { name: "Chiudi" }).click();
    await expect(dialog).not.toBeVisible();
  }
  try {
    const space = "Registrazioni " + suffix;
    await register(
      outsider,
      "Teresa",
      "ascolto-esterno-" + suffix + "@example.test",
    );
    await register(page, "Alba", "ascolto-" + suffix + "@example.test");
    await fillWorkspaceName(page, space);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: space, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, space, "Leo");
    const { origin, searchParams } = new URL(page.url());
    const sent = await page.request.post(
      "/api/v1/workspaces/" + searchParams.get("workspace") + "/commands",
      {
        headers: { Origin: origin },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            content: "Registrazione dello spazio",
            attachments,
          },
        },
      },
    );
    expect(sent.ok()).toBe(true);
    await listen(guest);
    await openWithSession(page, "/");
    await page.getByRole("button", { name: "Scrivi a un contatto" }).click();
    await page
      .getByRole("button", { name: "Scrivi a Leo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Leo", exact: true }),
    ).toBeVisible();
    const direct = new URL(page.url()).pathname.replace(
      "/chat/",
      "/api/v1/direct-chats/",
    );
    const { me } = await (await page.request.get(direct)).json();
    const privateSent = await page.request.post(direct, {
      headers: { Origin: origin },
      data: {
        type: "send",
        id: crypto.randomUUID(),
        expectedActorId: me,
        text: "Registrazione privata",
        attachments,
      },
    });
    expect(privateSent.ok()).toBe(true);
    await guest.goto(new URL(page.url()).pathname);
    await listen(guest);
  } finally {
    await guest.close();
    await outsider.close();
  }
});
