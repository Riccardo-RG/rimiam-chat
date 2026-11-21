import { test, expect } from "@playwright/test";
import {
  fillWorkspaceName,
  chooseContextView,
  expandContextRecord,
  openMessageComposer,
  openWorkspacePanel,
  register,
} from "./helpers";
test("a selected question and accepted reference become a versioned brief with separate named adoption", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    a = await ca.newPage(),
    b = await cb.newPage(),
    suffix = crypto.randomUUID();
  try {
    await register(a, "Brief A", `brief-a-${suffix}@example.test`);
    await register(b, "Brief B", `brief-b-${suffix}@example.test`);
    await fillWorkspaceName(a, `Brief ${suffix}`);
    await a.getByRole("button", { name: "Crea spazio", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: "Conversazione", exact: true }),
    ).toBeVisible();
    const w = new URL(a.url()).searchParams.get("workspace")!,
      origin = new URL(a.url()).origin;
    const invite = await a.request.post(`/api/workspaces/${w}/commands`, {
      headers: { Origin: origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "invitation.create",
          email: `brief-b-${suffix}@example.test`,
          fullHistoryDisclosed: true,
        },
      },
    });
    expect(invite.ok()).toBe(true);
    const { token } = await invite.json();
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
    const composer = await openMessageComposer(a);
    await composer.fill("Il locale costa €3.000 al mese.");
    await a.getByRole("button", { name: "Invia", exact: true }).click();
    await openWorkspacePanel(a, "context");
    await expandContextRecord(a, "Da valutare", "3.000");
    await a
      .getByRole("button", {
        name: "Accetta come riferimento descrittivo",
        exact: true,
      })
      .click();
    await chooseContextView(a, "Domande");
    await a.getByText("Aggiungi una domanda", { exact: true }).click();
    await a
      .getByLabel("Domanda da chiarire", { exact: true })
      .fill("Quali costi confrontiamo?");
    await a
      .getByRole("combobox", {
        name: "Fonte che motiva la domanda",
        exact: true,
      })
      .selectOption({ label: "Brief A: Il locale costa €3.000 al mese." });
    await a
      .getByRole("button", { name: "Registra domanda", exact: true })
      .click();
    await openWorkspacePanel(a, "artifacts");
    await openWorkspacePanel(b, "artifacts");
    await a.getByText("Prepara un brief", { exact: true }).click();
    await a
      .getByLabel("Titolo del brief", { exact: true })
      .fill("Confronto dei locali");
    await a
      .getByRole("combobox", { name: "Domanda di riferimento", exact: true })
      .selectOption({ label: "Quali costi confrontiamo? · v1" });
    await a
      .getByRole("checkbox", {
        name: "Affitto del locale · v1: Il locale costa €3.000 al mese.",
        exact: true,
      })
      .check();
    await a
      .getByRole("textbox", { name: "Note e ipotesi della bozza", exact: true })
      .fill("Confrontare due locali; nessun impegno di spesa assunto.");
    const draftResponse = a.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/workspaces/${w}/commands` &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.command?.type === "artifact.draft",
    );
    await a
      .getByRole("button", { name: "Crea bozza del brief", exact: true })
      .click();
    const drafted = await draftResponse;
    expect(
      drafted.ok(),
      `artifact.draft returned ${drafted.status()}: ${await drafted.text()}`,
    ).toBe(true);
    const aa = a.getByRole("article", {
        name: "Artifact: Confronto dei locali",
      }),
      bb = b.getByRole("article", { name: "Artifact: Confronto dei locali" });
    await expect(bb).toContainText("Bozza da valutare");
    await aa
      .getByText("Leggi il documento e le fonti", { exact: true })
      .click();
    await expect(
      aa.locator(".artifact-document, .artifact-body").first(),
    ).toContainText("€3.000");
    await aa
      .getByRole("button", {
        name: "Brief A: Il locale costa €3.000 al mese.",
        exact: true,
      })
      .click();
    await expect(
      a.getByRole("dialog", { name: "Condivisi", exact: true }),
    ).not.toBeVisible();
    await expect(
      a
        .locator(".messages")
        .getByRole("article")
        .filter({
          has: a.getByText("Il locale costa €3.000 al mese.", { exact: true }),
        }),
    ).toBeFocused();
    await openWorkspacePanel(a, "artifacts");
    await expect(aa).toContainText("Bozza da valutare");
    await aa
      .getByText("Leggi il documento e le fonti", { exact: true })
      .click();
    await expect(
      aa.locator(".artifact-document, .artifact-body").first(),
    ).toContainText("€3.000");
    await aa
      .getByText("Richiedi adozione di questa versione", { exact: true })
      .click();
    await aa.getByRole("checkbox", { name: "Brief A", exact: true }).check();
    await aa.getByRole("checkbox", { name: "Brief B", exact: true }).check();
    await aa
      .getByRole("checkbox", {
        name: "Propongo l’uso del brief come documento di lavoro non operativo.",
        exact: true,
      })
      .check();
    await aa
      .getByRole("button", { name: "Avvia review nominativa", exact: true })
      .click();
    await aa
      .getByRole("button", { name: "Approvo per me il brief v1", exact: true })
      .click();
    await expect(bb).toContainText("Bozza da valutare");
    await bb
      .getByRole("button", { name: "Approvo per me il brief v1", exact: true })
      .click();
    await expect(aa).toContainText(
      /Adottata v1 dalle persone nominate: (Brief A, Brief B|Brief B, Brief A)\./,
    );
    const downloadEvent = a.waitForEvent("download");
    await aa
      .getByRole("button", { name: "Scarica copia modificabile" })
      .click();
    const downloaded = await downloadEvent;
    expect(downloaded.suggestedFilename()).toMatch(/-v1\.md$/);
    const filePicker = a.waitForEvent("filechooser");
    await a.getByRole("button", { name: "Allega file", exact: true }).click();
    await (
      await filePicker
    ).setFiles({
      name: downloaded.suggestedFilename(),
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Brief aggiornato\n\nConfronto delle spese accessorie.",
      ),
    });
    await a
      .getByRole("dialog", { name: "Condividi allegato" })
      .getByRole("button", { name: "Condividi in chat" })
      .click();
    await expect(
      a
        .getByRole("region", { name: "Conversazione", exact: true })
        .getByRole("button", {
          name: "Apri anteprima di " + downloaded.suggestedFilename(),
          exact: true,
        }),
    ).toBeVisible();
    await expect(aa).toContainText("Adottata v1");
    await expect(aa).not.toContainText("Bozza da valutare · v2");
    await b.setViewportSize({ width: 390, height: 844 });
    expect(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await b.screenshot({
      path: "test-results/artifact-mobile.png",
      fullPage: true,
    });
  } finally {
    await ca.close();
    await cb.close();
  }
});
