import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  register,
  fillWorkspaceName,
  openMessageComposer,
  joinTestWorkspace,
} from "./helpers";
test("a hand-drawn sketch stays in the draft until sent and another member can open the inked PNG", async ({
  page,
  browser,
}) => {
  const guest = await browser.newPage({ locale: "it-IT" }),
    name = "Disegni " + crypto.randomUUID();
  try {
    await register(
      page,
      "Alba",
      "sketch-" + crypto.randomUUID() + "@example.test",
    );
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, name, "Leo");
    const editor = await openMessageComposer(page);
    await editor.fill("/h");
    await page
      .getByRole("combobox", { name: "Cerca un’azione" })
      .press("Enter");
    const dialog = page.getByRole("dialog", { name: "Disegna", exact: true }),
      add = dialog.getByRole("button", { name: "Aggiungi al messaggio" });
    await expect(add).toBeDisabled();
    const box = await dialog
      .getByRole("img", { name: "Tela di disegno" })
      .boundingBox();
    expect(box).toBeTruthy();
    const start = box!;
    const paint = async () => {
      await page.mouse.move(
        start.x + start.width * 0.2,
        start.y + start.height * 0.3,
      );
      await page.mouse.down();
      await page.mouse.move(
        start.x + start.width * 0.6,
        start.y + start.height * 0.5,
        { steps: 7 },
      );
      await page.mouse.up();
    };
    await paint();
    await dialog.getByRole("button", { name: "Annulla tratto" }).click();
    await expect(add).toBeDisabled();
    await paint();
    await add.click();
    await expect(dialog).toHaveCount(0);
    const queue = page.getByRole("list", {
      name: "Allegati in ordine di invio",
    });
    await expect(queue).toContainText("Schizzo.png");
    await editor.fill("Aggiungi al messaggio"); // Deliberately identical to UI copy; this is user content.
    const received = guest
      .locator(".messages article")
      .filter({ hasText: "Schizzo.png" });
    await expect(received).toHaveCount(0);
    await page.reload();
    await expect(queue).toContainText("Schizzo.png");
    await page.getByRole("button", { name: "Invia", exact: true }).click();
    await expect(received).toContainText("Aggiungi al messaggio");
    await received
      .getByRole("button", { name: "Apri anteprima di Schizzo.png" })
      .click();
    const preview = guest.getByRole("dialog", { name: "Schizzo.png" });
    const url = await preview
      .getByRole("link", { name: "Scarica originale" })
      .getAttribute("href");
    const bytes = await (await guest.request.get(url!)).body();
    const { info, data } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([640, 440]);
    expect(data[0]).toBe(255);
    let ink = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] < 100) ink++;
    expect(ink).toBeGreaterThan(200);
  } finally {
    await guest.close();
  }
});
