import { expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
  joinTestWorkspace,
  openMessageComposer,
  register,
} from "./helpers";

test("asking Emme uses the main composer, preserves the selected original and sends only after the author submits", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage();
  try {
    const suffix = crypto.randomUUID(),
      name = "Spazio per la prova " + suffix;
    await register(page, "Luca", `ask-${suffix}@example.test`);
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, name, "Giulia");
    const w = new URL(page.url()).searchParams.get("workspace"),
      path = "/api/v1/workspaces/" + w + "/commands";
    async function send(content: string) {
      const res = await guest.request.post(path, {
        headers: { Origin: new URL(guest.url()).origin },
        data: {
          commandId: crypto.randomUUID(),
          command: { type: "message.send", content },
        },
      });
      expect(res.ok()).toBe(true);
      return (await res.json()).result.messageId as string;
    }
    const first = await send("Quale nome usiamo per la demo?"),
      row = page.locator("#source-" + first);
    const mentionsEditor = await openMessageComposer(page);
    await mentionsEditor.fill("@Giu");
    await page
      .getByRole("group", { name: "Menziona una persona" })
      .getByRole("button", { name: "Giulia", exact: true })
      .click();
    await expect(mentionsEditor).toHaveValue("@Giulia ");
    const mentionSent = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === path &&
        !!res.request().postDataJSON()?.command?.mentionIds?.length,
    );
    await mentionsEditor.press("Enter");
    expect((await mentionSent).ok()).toBe(true);
    await row.locator(".message-details > summary").click();
    await row
      .getByRole("button", { name: /Chiedi a Emme di rispondere/ })
      .click();
    const editor = page.getByRole("textbox", {
      name: "Messaggio",
      exact: true,
    });
    await expect(editor).toBeFocused();
    await expect(page.getByText(/Chiedi a Emme · Giulia/)).toBeVisible();
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: "@Emme Rispondi a questo messaggio." }),
    ).toHaveCount(0);
    await send("Intanto condivido un’altra domanda.");
    await editor.fill("Confronti le due alternative?");
    await page
      .getByRole("button", { name: "I tuoi spazi", exact: true })
      .click();
    const directory = page.getByRole("region", {
      name: "Elenco degli spazi disponibili",
    });
    await directory.getByRole("button", { name: new RegExp(name) }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await openMessageComposer(page);
    await expect(editor).toHaveValue("Confronti le due alternative?");
    await expect(page.getByText(/Chiedi a Emme · Giulia/)).toBeVisible();
    const wait = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === path &&
        res.request().postDataJSON()?.command?.quoteMessageId === first,
    );
    await editor.press("Enter");
    const receipt = await wait;
    expect(receipt.ok()).toBe(true);
    expect(receipt.request().postDataJSON().command).toMatchObject({
      content: "@Emme Confronti le due alternative?",
      reference: { kind: "source", id: first, version: 1 },
    });
    const result = (await receipt.json()).result.messageId as string;
    const linked = guest
      .locator("#source-" + result)
      .getByRole("button", { name: /Giulia · Quale nome/ });
    await expect(linked).toBeVisible();
    await linked.click();
    await expect(guest.locator("#source-" + first)).toBeFocused();
  } finally {
    await guest.close();
  }
});
