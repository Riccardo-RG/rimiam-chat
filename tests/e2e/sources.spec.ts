import { test, expect } from "@playwright/test";
import {
  fillWorkspaceName,
  chooseContextView,
  expandContextRecord,
  register,
  openWorkspacePanel,
  openMessageComposer,
  joinTestWorkspace,
} from "./helpers";
test("two members share a document, accept its interpretation and retrieve governed research sources", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  const suffix = crypto.randomUUID();
  try {
    await register(a, "Source A", `source-a-${suffix}@example.test`);
    await register(b, "Source B", `source-b-${suffix}@example.test`);
    await fillWorkspaceName(a, `Fonti ${suffix}`);
    await a.getByRole("button", { name: "Crea spazio", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: "Conversazione", exact: true }),
    ).toBeVisible();
    const w = new URL(a.url()).searchParams.get("workspace")!;
    const origin = new URL(a.url()).origin;
    const invited = await a.request.post(`/api/workspaces/${w}/commands`, {
      headers: { Origin: origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "invitation.create",
          email: `source-b-${suffix}@example.test`,
          fullHistoryDisclosed: true,
        },
      },
    });
    const { token } = await invited.json();
    await b.goto(`/?invite=${token}`);
    await b
      .getByLabel(
        "Accetto esplicitamente di entrare con questa visibilità della storia.",
        { exact: true },
      )
      .check();
    await b
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await openWorkspacePanel(a, "sources");
    await openWorkspacePanel(b, "sources");
    await a.getByText("Carica un file", { exact: true }).click();
    await a
      .getByLabel("Documento, immagine o messaggio vocale", { exact: true })
      .setInputFiles({
        name: "contratto.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Il locale costa €3.200 al mese."),
      });
    await a
      .getByRole("button", { name: "Condividi documento", exact: true })
      .click();
    await expect(
      b.getByRole("heading", {
        name: "contratto.txt",
        exact: true,
      }),
    ).toBeVisible();
    await openWorkspacePanel(b, "artifacts");
    const library = b.getByRole("list", { name: "File condivisi" });
    await expect(library).toContainText("contratto.txt");
    await expect(library).toContainText("Testo");
    await library.getByRole("button", { name: "Apri contratto.txt" }).click();
    const preview = b.getByRole("dialog", { name: "contratto.txt" });
    const original = preview.getByRole("link", { name: "Scarica originale" });
    expect(
      await (
        await b.request.get((await original.getAttribute("href"))!)
      ).text(),
    ).toBe("Il locale costa €3.200 al mese.");
    await preview.getByRole("button", { name: "Chiudi", exact: true }).click();
    await openWorkspacePanel(b, "context");
    await chooseContextView(b, "Riferimenti");
    await expect(b.locator(".information")).toHaveCount(0);
    const proposal = await expandContextRecord(
      b,
      "Da valutare",
      "Il locale costa €3.200 al mese.",
    );
    await proposal
      .getByRole("button", {
        name: "Accetta come riferimento descrittivo",
        exact: true,
      })
      .click();
    await openWorkspacePanel(a, "context");
    const acceptedRent = await expandContextRecord(a, "Riferimenti", "3.200");
    await expect(acceptedRent).toContainText("3.200");
    await openWorkspacePanel(a, "sources");
    const download = a.getByRole("link", {
      name: "Scarica originale",
      exact: true,
    });
    const href = await download.getAttribute("href");
    expect(await (await b.request.get(href!)).text()).toBe(
      "Il locale costa €3.200 al mese.",
    );
    const outsider = await browser.newContext();
    try {
      expect((await outsider.request.get(origin + href!)).status()).toBe(401);
    } finally {
      await outsider.close();
    }
    await openWorkspacePanel(a, "context");
    await chooseContextView(a, "Domande");
    await chooseContextView(b, "Domande");
    await a.getByText("Aggiungi una domanda", { exact: true }).click();
    await a
      .getByLabel("Domanda da chiarire", { exact: true })
      .fill("Quanto costa la licenza?");
    const motivation = a.getByRole("combobox", {
      name: "Fonte che motiva la domanda",
      exact: true,
    });
    await motivation.selectOption(href!.split("/").pop()!);
    await a
      .getByRole("button", { name: "Registra domanda", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "Quanto costa la licenza?", exact: true }),
    ).toBeVisible();
    await openWorkspacePanel(a, "sources");
    await openWorkspacePanel(b, "sources");
    await a.getByText("Cerca sul web", { exact: true }).click();
    await a
      .getByRole("combobox", { name: "Domanda collegata", exact: true })
      .selectOption({ label: "Quanto costa la licenza?" });
    await a
      .getByLabel("Che cosa serve sapere?", { exact: true })
      .fill("E2E costo licenza");
    await a
      .getByLabel(
        "Autorizzo l’invio del solo testo della ricerca al servizio esterno. Non includo dati che non posso condividere.",
        { exact: true },
      )
      .check();
    await a.getByRole("button", { name: "Avvia ricerca", exact: true }).click();
    await expect(
      b.getByRole("article", { name: "Ricerca: E2E costo licenza" }),
    ).toContainText("Risultati disponibili");
    await expect(
      b.getByRole("heading", {
        name: "Licenza di prova",
        exact: true,
      }),
    ).toBeVisible();
    await openWorkspacePanel(b, "context");
    await chooseContextView(b, "Riferimenti");
    await expect(b.locator(".information")).not.toContainText("2.000");
    const licenseProposal = await expandContextRecord(
      b,
      "Da valutare",
      "La licenza costa circa €2.000 (fonte di test).",
    );
    await licenseProposal
      .getByRole("button", {
        name: "Accetta come riferimento descrittivo",
        exact: true,
      })
      .click();
    await chooseContextView(b, "Domande");
    const question = b.getByRole("region", { name: "Domande dello spazio" });
    await question.getByText("Collega una risposta", { exact: true }).click();
    await question
      .getByRole("combobox", {
        name: "Riferimento che risponde alla domanda",
        exact: true,
      })
      .selectOption({ label: "Nota dalla conversazione · v1" });
    await question
      .getByLabel("Motivo", { exact: true })
      .fill(
        "Stima iniziale della ricerca, da verificare prima di impegnare spese.",
      );
    await question
      .getByRole("button", { name: "Collega risposta accettata", exact: true })
      .click();
    await openWorkspacePanel(a, "context");
    await chooseContextView(a, "Domande");
    await expect(
      a.getByRole("region", { name: "Domande dello spazio" }),
    ).toContainText("Risposta di lavoro collegata");
    await a.reload();
    await openWorkspacePanel(a, "sources");
    await expect(
      a.getByRole("heading", {
        name: "Licenza di prova",
        exact: true,
      }),
    ).toBeVisible();
    await a.setViewportSize({ width: 390, height: 844 });
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await a.screenshot({
      path: "test-results/sources-mobile.png",
      fullPage: true,
    });
    await openWorkspacePanel(b, "people");
    b.once("dialog", (d) => d.accept());
    await b.getByText("La mia partecipazione", { exact: true }).click();
    await b
      .getByRole("button", { name: "Lascia lo spazio", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "I tuoi spazi", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await b.request.get(href!)).status())
      .toBe(403);
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("two sessions can preview a shared photo, withdraw it as its author and restore after reload", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  const name = "foto-app.png",
    space = "Prove foto " + crypto.randomUUID();
  try {
    await register(
      a,
      "Autore allegato",
      "foto-" + crypto.randomUUID() + "@example.test",
    );
    await fillWorkspaceName(a, space);
    await a.getByRole("button", { name: "Crea spazio", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: space, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(a, b, space, "Secondo membro");
    const editor = await openMessageComposer(a);
    await editor.fill("Ecco lo screenshot per il confronto.");
    const [picker] = await Promise.all([
      a.waitForEvent("filechooser"),
      a.getByRole("button", { name: "Allega un file o una foto" }).click(),
    ]);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRU0AAAAASUVORK5CYII=",
      "base64",
    );
    await picker.setFiles({ name, mimeType: "image/png", buffer: png });
    await expect(
      a.getByRole("button", { name: "Rimuovi " + name }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Invia", exact: true }).click();
    const timeline = b.locator(".messages");
    await expect(
      timeline.getByRole("img", { name, exact: true }),
    ).toBeVisible();
    await timeline
      .getByRole("button", { name: "Apri anteprima di " + name })
      .click();
    const chatPreview = b.getByRole("dialog", { name });
    const download = await chatPreview
      .getByRole("link", { name: "Scarica originale" })
      .getAttribute("href");
    expect(download).toBeTruthy();
    await chatPreview
      .getByRole("button", { name: "Chiudi", exact: true })
      .click();
    await Promise.all([
      openWorkspacePanel(a, "sources"),
      openWorkspacePanel(b, "sources"),
    ]);
    const region = (page: typeof a) =>
      page.getByRole("region", { name: "Fonti e ricerche" });
    const previewButton = (page: typeof a) =>
      region(page).getByRole("button", { name: "Apri anteprima di " + name });
    await expect
      .poll(() =>
        previewButton(b)
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await previewButton(b).click();
    const preview = b.getByRole("dialog", { name, exact: true });
    await expect(preview).toBeVisible();
    const previewUrl = await preview
      .getByRole("img", { name })
      .getAttribute("src");
    expect(await (await b.request.get(previewUrl!)).body()).toEqual(png);
    await expect(
      region(b).getByRole("button", { name: "Ritira file", exact: true }),
    ).toHaveCount(0);
    const withdraw = region(a).getByRole("button", {
      name: "Ritira file",
      exact: true,
    });
    a.once("dialog", (d) => d.dismiss());
    await withdraw.click();
    await expect(previewButton(a)).toBeVisible();
    expect((await b.request.get(download!)).status()).toBe(200);
    a.once("dialog", (d) => d.accept());
    await withdraw.click();
    await expect(preview).toHaveCount(0);
    await expect(previewButton(b)).toHaveCount(0);
    await expect(
      timeline.getByText("File ritirato", { exact: true }),
    ).toBeAttached();
    for (const href of [download!, previewUrl!])
      expect((await b.request.get(href)).status()).toBe(404);
    await a.reload();
    await openWorkspacePanel(a, "sources");
    await region(a).getByText("File ritirati", { exact: true }).click();
    a.once("dialog", (d) => d.accept());
    await region(a)
      .getByRole("button", { name: "Ripristina file", exact: true })
      .click();
    await expect(previewButton(b)).toBeVisible();
    expect(await (await b.request.get(download!)).body()).toEqual(png);
    await expect(
      timeline.getByRole("img", { name, exact: true }),
    ).toBeAttached();
  } finally {
    await ca.close();
    await cb.close();
  }
});
