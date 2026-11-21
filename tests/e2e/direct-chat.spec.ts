import { expect, test } from "@playwright/test";
import { fillWorkspaceName, register, joinTestWorkspace } from "./helpers";
test("two existing contacts message privately, give separate consent, and create a clean group with their chosen materials", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const guest = await browser.newPage();
  try {
    const suffix = crypto.randomUUID(),
      name = "Gruppo iniziale " + suffix;
    await register(page, "Riccardo", "direct-" + suffix + "@example.test");
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, guest, name, "Matteo");
    await page.goto("/");
    await page.getByRole("button", { name: "Scrivi a un contatto" }).click();
    await page
      .getByRole("button", { name: "Scrivi a Matteo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Matteo", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Messaggio privato").fill("Privato tra noi");
    await page.getByLabel("Messaggio privato").press("Enter");
    await expect(
      page.getByText("Privato tra noi", { exact: true }),
    ).toBeVisible();
    await guest.goto("/");
    await guest.getByRole("button", { name: /Riccardo.*Chat privata/ }).click();
    await expect(
      guest.getByText("Privato tra noi", { exact: true }),
    ).toBeVisible();
    const previewPath = new URL(page.url()).pathname.replace(
      "/chat/",
      "/api/v1/direct-chats/",
    );
    const me = (await (await page.request.get(previewPath)).json()).me;
    expect(
      (
        await page.request.post(previewPath, {
          headers: { Origin: new URL(page.url()).origin },
          data: {
            type: "send",
            id: crypto.randomUUID(),
            expectedActorId: me,
            text: "Nota per la demo",
            attachments: [
              {
                filename: "nota-privata.txt",
                bytesBase64: Buffer.from(
                  "Nota privata con <b>testo semplice</b>",
                ).toString("base64"),
              },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    const openFile = guest.getByRole("button", {
      name: "Apri anteprima di nota-privata.txt",
    });
    await openFile.click();
    const preview = guest.getByRole("dialog", { name: "nota-privata.txt" });
    await expect(
      preview.getByText("Nota privata con <b>testo semplice</b>", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      preview.getByRole("link", { name: "Scarica originale" }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Vai al messaggio" }).click();
    await expect(preview).not.toBeVisible();
    await page
      .getByRole("button", { name: "Riepilogo personale", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Consenti il riepilogo di questa chat" })
      .click();
    await expect(
      page.getByRole("button", { name: "Riassumi per me" }),
    ).toBeDisabled();
    await guest
      .getByRole("button", { name: "Riepilogo personale", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Consenti il riepilogo di questa chat" })
      .click();
    await expect(
      page.getByRole("button", { name: "Riassumi per me" }),
    ).toBeEnabled();
    // Delay delivery of an initiated request, then withdraw this same person's
    // consent. The real API receives the stale request and must decline it.
    const directPath = new URL(page.url()).pathname.replace(
      "/chat/",
      "/api/v1/direct-chats/",
    );
    let arrived = () => {},
      release = () => {};
    const received = new Promise<void>((done) => {
        arrived = done;
      }),
      hold = new Promise<void>((done) => {
        release = done;
      });
    await page.route(
      (url) => url.pathname === directPath,
      async (route) => {
        if (
          route.request().method() === "POST" &&
          route.request().postDataJSON()?.type === "recap"
        ) {
          arrived();
          await hold;
        }
        await route.continue();
      },
    );
    try {
      await page.getByRole("button", { name: "Riassumi per me" }).click();
      await received;
      await page
        .getByRole("button", { name: "Ritira il tuo consenso" })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Consenti il riepilogo di questa chat",
        }),
      ).toBeVisible();
      const stale = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === directPath &&
          r.request().method() === "POST" &&
          r.request().postDataJSON()?.type === "recap",
      );
      release();
      expect((await stale).status()).toBe(403);
    } finally {
      release();
    }
    await page
      .getByRole("button", { name: "Crea uno spazio con Matteo" })
      .click();
    await expect(
      page.getByText("Matteo", { exact: true }).last(),
    ).toBeVisible();
    await fillWorkspaceName(page, "Gruppo dedicato");
    await page.getByLabel("Allega file al nuovo spazio").setInputFiles({
      name: "scelto.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("File nuovo"),
    });
    await page.locator('input[name="historyDisclosure"]').check();
    await page
      .getByRole("button", { name: "Crea spazio e invita", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Gruppo dedicato" }),
    ).toBeVisible();
    await expect(page.locator(".messages")).not.toContainText(
      "Privato tra noi",
    );
    await expect(page.locator(".messages")).toContainText("scelto.txt");
  } finally {
    await guest.close();
  }
});
