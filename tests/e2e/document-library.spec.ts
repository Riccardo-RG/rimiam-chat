import { devices, expect, test } from "@playwright/test";
import { fillWorkspaceName, openWorkspacePanel, register } from "./helpers";

test.use({
  contextOptions: async ({ browserName }, provideOptions) => {
    await provideOptions(
      browserName === "webkit" ? devices["iPhone 13 Pro"] : {},
    );
  },
});

test("the document library shares files and pages and keeps unsent input when expanded", async ({
  page,
  browserName,
}) => {
  const suffix = crypto.randomUUID();
  const workspace = "Raccoglitore " + suffix;
  const address =
    "https://example.org/appunti/" +
    "abcdefgh".repeat(100) +
    "?lingua=it#sezione";
  let externalRequests = 0;
  await page.route("https://example.org/**", (route) => {
    externalRequests++;
    return route.abort();
  });
  await register(page, "Giulia", "library-" + suffix + "@example.test");
  await fillWorkspaceName(page, workspace);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: workspace, exact: true }),
  ).toBeVisible();
  await openWorkspacePanel(page, "artifacts", { dock: false });
  const library = page.getByRole("dialog", { name: "Condivisi", exact: true });
  const chooseFile = page.waitForEvent("filechooser");
  await library
    .getByRole("button", { name: "Allega file", exact: true })
    .click();
  const filename = "Piano condiviso.txt";
  await (
    await chooseFile
  ).setFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from("Prima revisione"),
  });
  const upload = page.getByRole("dialog", { name: "Condividi allegato" });
  await expect(upload.getByText(filename, { exact: true })).toBeVisible();
  await upload.getByRole("button", { name: "Condividi in chat" }).click();
  await expect(
    library.getByRole("button", { name: "Apri " + filename }),
  ).toBeVisible();
  await library.getByRole("button", { name: "Aggiungi link" }).click();
  const input = library.getByLabel("Indirizzo della pagina");
  await input.fill(address);
  if (browserName !== "webkit") {
    const initial = (await library.boundingBox())!.width;
    await library.getByRole("button", { name: "Allarga", exact: true }).click();
    await expect
      .poll(async () => (await library.boundingBox())!.width)
      .toBeGreaterThan(initial + 180);
    await expect(input).toHaveValue(address);
    await library.getByRole("button", { name: "Riduci", exact: true }).click();
    await expect(input).toHaveValue(address);
  }
  await library.getByRole("button", { name: "Condividi link" }).click();
  const saved = library.getByRole("link", { name: address, exact: true });
  await expect(saved).toHaveAttribute("href", address);
  await page.reload();
  await openWorkspacePanel(page, "artifacts", { dock: false });
  await expect(saved).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Apri " + filename }),
  ).toBeVisible();
  const file = library.getByRole("button", { name: "Apri " + filename });
  await library
    .getByRole("button", { name: "Collegamenti", exact: true })
    .click();
  await expect(saved).toBeVisible();
  await expect(file).toHaveCount(0);
  // Neither the document nor the actual scrollable panel should pan sideways.
  for (const element of [
    page.locator("html"),
    library.locator(".layer-body"),
  ]) {
    expect(
      await element.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await library
    .getByRole("button", { name: "Rimuovi " + address, exact: true })
    .click();
  await library
    .getByRole("button", { name: "Nascondi su questo dispositivo" })
    .click();
  await expect(saved).toHaveCount(0);
  await page.reload();
  await openWorkspacePanel(page, "artifacts", { dock: false });
  await expect(saved).toHaveCount(0);
  await library
    .getByRole("button", { name: "Mostra elementi nascosti" })
    .click();
  await expect(saved).toBeVisible();
  await library.getByRole("button", { name: "Mostra di nuovo" }).click();
  await expect(file).toBeVisible();
  await library
    .getByRole("button", { name: "Rimuovi " + filename, exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await library
    .getByRole("button", { name: "Rimuovi per tutti", exact: true })
    .click();
  await expect(file).toHaveCount(0);
  await library.getByText("File ritirati", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await library
    .getByRole("button", { name: "Ripristina file", exact: true })
    .click();
  await expect(file).toBeVisible();
  await library
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: address, exact: true }) })
    .getByRole("button", { name: "Vai al messaggio" })
    .click();
  await expect(
    page
      .locator(".messages")
      .getByRole("article")
      .filter({ hasText: "Pagina condivisa: " + address }),
  ).toBeFocused();
  expect(
    await page
      .locator(".messages")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(externalRequests).toBe(0);
});

test("personal documents keeps file intake together and lets the user open and leave the document editor", async ({
  page,
}) => {
  await register(
    page,
    "Ada",
    "personal-library-" + crypto.randomUUID() + "@example.test",
  );
  await page
    .getByRole("region", { name: "Personale", exact: true })
    .getByRole("button", { name: "Documenti", exact: true })
    .click();
  const library = page.getByRole("region", {
    name: "Documenti personali",
    exact: true,
  });
  await expect(
    library.getByRole("button", { name: "Allega file", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Aggiungi link", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("heading", { name: "Pagine web", exact: true }),
  ).toHaveCount(0);
  await expect(
    library.getByRole("heading", { name: "Documenti di lavoro" }),
  ).toHaveCount(0);
  await library.getByText("Crea documento", { exact: true }).click();
  await library
    .getByRole("button", { name: "Nuovo documento", exact: true })
    .click();
  await expect(
    library.getByRole("textbox", { name: "Contenuto", exact: true }),
  ).toBeVisible();
  await library.getByRole("button", { name: "Torna al raccoglitore" }).click();
  await expect(
    library.getByRole("button", { name: "Allega file", exact: true }),
  ).toBeVisible();
});
