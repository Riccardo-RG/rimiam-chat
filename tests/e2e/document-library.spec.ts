import { devices, expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
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
  const linkLabel = "example.org/…/" + "abcdefgh".repeat(4) + "abc…";
  const saved = library.getByRole("link", { name: linkLabel, exact: true });
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
    .getByRole("button", { name: "Rimuovi " + linkLabel, exact: true })
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
    .filter({ has: page.getByRole("link", { name: linkLabel, exact: true }) })
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
  await library
    .getByRole("button", { name: "Nuovo documento", exact: true })
    .click();
  await expect(
    library.getByText(
      "Destinazione: Documenti personali › Documenti di lavoro",
    ),
  ).toBeVisible();
  await library.getByLabel("Titolo", { exact: true }).fill("Note di lancio");
  await library.getByLabel("A cosa ti serve?").fill("Preparare il rilascio");
  await library
    .getByLabel("Contenuto", { exact: true })
    .fill("Confermare la data di lancio.");
  const receipt = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/commands") &&
      response.request().postDataJSON()?.command?.type === "artifact.compose",
  );
  await library
    .getByRole("button", { name: "Salva documento", exact: true })
    .click();
  await expect(
    library.getByRole("status").filter({
      hasText:
        "«Note di lancio» salvato in Documenti personali › Documenti di lavoro.",
    }),
  ).toBeVisible();
  const first = await receipt;
  const { artifactId, version } = (await first.json()).result;
  expect(version).toBe(1);
  const next = await page.request.post(first.url(), {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      commandId: crypto.randomUUID(),
      command: {
        ...first.request().postDataJSON().command,
        artifactId,
        expectedVersion: version,
        title: "Note aggiornate",
        blocks: [{ type: "paragraph", text: "La data è confermata." }],
        reason: "Aggiornamento da una seconda sessione",
      },
    },
  });
  expect(next.ok()).toBe(true);
  // A subsequent action refreshes the archive while keeping its save receipt.
  const fullUrl =
    "https://example.org/ricerca/agenda?periodo=" + "a".repeat(500);
  await library
    .getByRole("button", { name: "Aggiungi link", exact: true })
    .click();
  await library.getByLabel("Indirizzo della pagina").fill(fullUrl);
  await library
    .getByRole("button", { name: "Salva link", exact: true })
    .click();
  const compactLink = library.getByRole("link", {
    name: "example.org/…/agenda",
    exact: true,
  });
  await expect(compactLink).toHaveAttribute("href", fullUrl);
  expect(
    await library.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await expect(
    library.getByRole("heading", { name: "Note aggiornate" }),
  ).toBeVisible();
  await expect(
    library.getByRole("status").filter({ hasText: "«Note di lancio» salvato" }),
  ).toBeVisible();
  await library
    .getByRole("button", { name: "Apri il documento salvato" })
    .click();
  await expect(
    library.getByText("Confermare la data di lancio.", { exact: true }),
  ).toBeVisible();
  await expect(
    library.getByText("Contenuto v1", { exact: true }),
  ).toBeFocused();
});

test("the preview cites the selected quote version only after the reader sends and reopens the exact source", async ({
  page,
  browserName,
}) => {
  const suffix = crypto.randomUUID();
  const space = "Preventivi " + suffix;
  await register(page, "Ada", "version-" + suffix + "@example.test");
  await fillWorkspaceName(page, space);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: space, exact: true }),
  ).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace");
  const path = "/api/v1/workspaces/" + w + "/commands";
  const name = "Preventivo.txt";
  async function upload(text: string, previousSourceId?: string) {
    const response = await page.request.post(path, {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "document.upload",
          filename: name,
          bytesBase64: Buffer.from(text).toString("base64"),
          previousSourceId,
        },
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).result.sourceId as string;
  }
  const v1 = await upload("Il totale è 120 euro.");
  const v2 = await upload("Il totale è 470 euro.", v1);
  const photo = "Screenshot.png";
  const imageUpload = await page.request.post(path, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      commandId: crypto.randomUUID(),
      command: {
        type: "document.upload",
        filename: photo,
        bytesBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC",
      },
    },
  });
  expect(imageUpload.ok()).toBe(true);
  await page.reload();
  await openWorkspacePanel(page, "artifacts", { dock: false });
  const library = page.getByRole("dialog", { name: "Condivisi", exact: true });
  await library
    .getByRole("button", { name: "Apri " + photo, exact: true })
    .click();
  const imagePreview = page.getByRole("dialog", { name: photo, exact: true });
  await expect(
    imagePreview.getByRole("button", { name: "Chiedi a Emme su questo file" }),
  ).toBeDisabled();
  await expect(
    imagePreview.getByText("Lettura con AI non autorizzata."),
  ).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await imagePreview
    .getByRole("button", { name: "Consenti lettura con AI…" })
    .click();
  await expect(
    imagePreview.getByRole("button", { name: "Chiedi a Emme su questo file" }),
  ).toBeDisabled();
  await imagePreview
    .getByRole("button", { name: "Chiudi", exact: true })
    .click();
  await library
    .getByRole("button", { name: "Apri " + name, exact: true })
    .click();
  const preview = page.getByRole("dialog", { name, exact: true });
  const favorite = preview.getByRole("button", {
    name: "Aggiungi ai preferiti " + name,
  });
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await page.emulateMedia({ colorScheme: "light" });
  const outline = await favorite.locator("svg path").getAttribute("fill");
  expect(outline).toBe("none");
  await favorite.click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    preview.getByRole("button", { name: "Rimuovi dai preferiti " + name }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await preview
      .getByRole("button", { name: "Rimuovi dai preferiti " + name })
      .locator("svg path")
      .getAttribute("fill"),
  ).not.toBe("none");
  const sent: string[] = [];
  page.on("request", (req) => {
    if (
      new URL(req.url()).pathname === path &&
      req.method() === "POST" &&
      req.postDataJSON()?.command?.type === "message.send"
    )
      sent.push(req.postDataJSON().command.content);
  });
  await preview
    .getByRole("button", { name: "Chiedi a Emme su questo file" })
    .click();
  await expect(page.locator(".composer-reference")).toContainText(
    "Preventivo.txt · v2",
  );
  expect(sent).toEqual([]);
  const editor = await openMessageComposer(page);
  await editor.fill("Qual è il totale?");
  const received = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === path &&
      res.request().postDataJSON()?.command?.reference?.id === v2,
  );
  if (browserName === "webkit")
    await page.getByRole("button", { name: "Invia", exact: true }).tap();
  else await editor.press("Enter");
  const receipt = await received;
  expect(receipt.ok()).toBe(true);
  expect(receipt.request().postDataJSON().command).toMatchObject({
    content: "@Emme Qual è il totale?",
    reference: { kind: "source", id: v2, version: 1 },
  });
  const answer = page.locator(".messages article").filter({
    hasText: "Risposta di prova al messaggio: Il totale è 470 euro.",
  });
  await expect(answer).toBeVisible();
  const citation = answer.getByRole("button", { name: "Preventivo.txt · v2" });
  if (browserName === "webkit") await citation.tap();
  else await citation.click();
  await expect(
    page
      .locator(".reference-detail pre")
      .filter({ hasText: "Il totale è 470 euro." }),
  ).toBeVisible();
  await expect(page.locator(".reference-detail")).not.toContainText("120 euro");
});
