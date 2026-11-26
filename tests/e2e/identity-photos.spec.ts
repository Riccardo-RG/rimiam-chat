import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  openWithSession,
  fillWorkspaceName,
  joinTestWorkspace,
  openAccountMenu,
  openAccountAppearance,
  openWorkspacePanel,
  openMessageComposer,
  register,
} from "./helpers";

async function inspectNoraPhoto(page: Page, opener: Locator, escape = false) {
  await opener.click();
  const preview = page.getByRole("dialog", {
    name: "Foto di Nora Foto",
    exact: true,
  });
  const photo = preview.getByRole("img", {
    name: "Foto del profilo di Nora Foto",
  });
  await expect(photo).toBeVisible();
  await expect
    .poll(() =>
      photo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(256);
  if (escape) await page.keyboard.press("Escape");
  else
    await preview.getByRole("button", { name: "Chiudi", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(opener).toBeFocused();
}

test("editorial themes follow the device or explicit mode; personal and shared identity photos persist", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const upload = {
    name: "ritratto.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 300, height: 300, channels: 3, background: "teal" },
    })
      .png()
      .toBuffer(),
  };
  await page.emulateMedia({ colorScheme: "dark" });
  const ownerEmail = randomUUID() + "@example.test";
  await register(page, "Nora Foto", ownerEmail);
  await openAccountAppearance(page);
  const mode = page.getByLabel("Aspetto dell’app");
  await expect(mode.locator("option")).toHaveText([
    "Come il dispositivo",
    "Chiaro",
    "Scuro",
  ]);
  await expect(page.locator(".account-options input[type=file]")).toHaveCount(
    0,
  );
  await mode.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  await expect(page.locator(".workspace-header")).toHaveCSS(
    "background-image",
    "none",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await mode.selectOption("dark");
  await expect(page.locator(".workspace-header")).toHaveCSS(
    "background-image",
    "none",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await mode.selectOption("system");
  await expect(page.locator(".workspace-header")).toHaveCSS(
    "background-image",
    "none",
  );
  const ownerProfile = page.getByRole("dialog", {
    name: "Nora Foto",
    exact: true,
  });
  const profileButton = page.getByRole("button", {
    name: "Il mio profilo",
    exact: true,
  });
  await profileButton.click();
  const own = ownerProfile.locator(".identity-photo-editor");
  await expect(
    own.getByRole("button", { name: "Aggiungi foto" }),
  ).toBeEnabled();
  await own.getByLabel("Foto del profilo").setInputFiles(upload);
  await expect(own.getByRole("status")).toHaveText("Foto aggiornata.");
  await expect(page.locator(".account-avatar img")).toBeVisible();
  await expect(
    ownerProfile.getByRole("link", { name: ownerEmail }),
  ).toBeVisible();
  await ownerProfile
    .getByLabel("Telefono (facoltativo)")
    .fill("+39 000 000 0001");
  await ownerProfile.getByRole("button", { name: "Salva numero" }).click();
  await expect(
    ownerProfile.getByText("Numero salvato.", { exact: true }),
  ).toBeVisible();
  await ownerProfile
    .getByRole("button", { name: "Chiudi", exact: true })
    .click();
  await openAccountMenu(page);
  const ownOpener = page.getByRole("button", {
    name: "Apri la foto di Nora Foto",
    exact: true,
  });
  await inspectNoraPhoto(page, ownOpener, true);
  await expect(own).toBeHidden();
  await page.reload();
  await inspectNoraPhoto(page, ownOpener);
  await expect(own).toBeHidden();
  await openAccountMenu(page);
  await profileButton.click();
  await expect(own.getByRole("button", { name: "Cambia foto" })).toBeVisible();
  await ownerProfile
    .getByRole("button", { name: "Chiudi", exact: true })
    .click();
  await info.attach("Account in modalità notte", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const account = page
    .locator("summary")
    .filter({ hasText: "Account personale" });
  await account.click();
  const name = "Spazio foto " + randomUUID().slice(0, 7);
  await fillWorkspaceName(page, name);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invita", exact: true }),
  ).toBeVisible();
  await openWorkspacePanel(page, "people");
  await expect(
    page.getByRole("button", { name: "Invita una persona", exact: true }),
  ).toBeVisible();
  const space = page
    .locator(".identity-photo-editor")
    .filter({ hasText: "Foto dello spazio" });
  await expect(
    space.getByRole("button", { name: "Aggiungi foto" }),
  ).toBeEnabled();
  await space.getByLabel("Foto dello spazio").setInputFiles(upload);
  await expect(space.getByRole("status")).toHaveText("Foto aggiornata.");
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.locator(".workspace-heading .workspace-photo img"),
  ).toBeVisible();
  await info.attach("Workspace con immagine condivisa", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const editor = await openMessageComposer(page);
  await editor.fill("Il mio aggiornamento per il gruppo.");
  await page.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(page.locator(".messages")).toContainText("Il mio aggiornamento");
  const desktopAvatar = page.locator(".message-author .byline-photo").first();
  await expect(desktopAvatar).toHaveCSS("width", "28px");
  await expect(desktopAvatar).toHaveCSS("height", "28px");
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    await joinTestWorkspace(page, guest, name, "Matteo Foto");
    const profileLink = guest.getByRole("button", {
      name: "Apri il profilo di Nora Foto",
      exact: true,
    });
    await expect(profileLink.locator(".byline-photo")).toBeHidden();
    await profileLink.click();
    const profile = guest.getByRole("dialog", {
      name: "Nora Foto",
      exact: true,
    });
    await expect(
      profile.getByRole("link", { name: ownerEmail, exact: true }),
    ).toBeVisible();
    await expect(
      profile.getByRole("link", { name: "+39 000 000 0001", exact: true }),
    ).toBeVisible();
    await expect(profile.getByRole("textbox")).toHaveCount(0);
    await profile.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(profileLink).toBeFocused();
    await expect(
      guest.getByRole("button", { name: "Invita", exact: true }),
    ).toHaveCount(0);
    await guest.getByRole("button", { name: "2 persone", exact: true }).click();
    const people = guest.getByRole("dialog", {
      name: "Persone e accesso",
      exact: true,
    });
    await expect(people).toBeVisible();
    await expect(
      people.getByRole("button", { name: "Invita una persona", exact: true }),
    ).toHaveCount(0);
    const peerOpener = guest.getByRole("button", {
      name: "Apri la foto di Nora Foto",
      exact: true,
    });
    await inspectNoraPhoto(
      guest,
      people.getByRole("button", {
        name: "Apri la foto di Nora Foto",
        exact: true,
      }),
    );
    await expect(people).toBeVisible();
    await expect(
      people.getByRole("button", { name: "Apri la foto di Matteo Foto" }),
    ).toHaveCount(0);
    await expect(
      people
        .getByRole("listitem")
        .filter({ hasText: "Matteo Foto" })
        .getByText("MF", { exact: true }),
    ).toBeVisible();
    await openWithSession(guest, "/");
    await guest.getByRole("button", { name: "Scrivi a un contatto" }).click();
    await guest
      .getByRole("button", { name: "Scrivi a Nora Foto", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Nora Foto", exact: true }),
    ).toBeVisible();
    await profileLink.click();
    await expect(
      profile.getByRole("link", { name: ownerEmail, exact: true }),
    ).toBeVisible();
    await inspectNoraPhoto(
      guest,
      profile.getByRole("button", { name: "Apri la foto di Nora Foto" }),
    );
    await profile.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(profile).toHaveCount(0);
    await guest.getByLabel("Messaggio privato").tap();
    await guest.getByLabel("Messaggio privato").fill("Messaggio per Nora");
    await guest.getByRole("button", { name: "Invia", exact: true }).click();
    await expect(
      guest.getByText("Messaggio per Nora", { exact: true }),
    ).toBeVisible();
    await guest.getByRole("link", { name: "Torna alla Home" }).click();
    await expect(
      guest.getByRole("heading", { name: "I tuoi spazi", exact: true }),
    ).toBeVisible();
    await inspectNoraPhoto(guest, peerOpener);
    await guest
      .getByRole("button", { name: /Nora Foto.*Chat privata/ })
      .click();
    await expect(
      guest.getByText("Messaggio per Nora", { exact: true }),
    ).toBeVisible();
  } finally {
    await guest.close();
  }
});
