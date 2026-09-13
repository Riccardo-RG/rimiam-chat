import { test, expect } from "@playwright/test";
import { register, openWorkspacePanel } from "./helpers";
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
    await a.getByLabel("Nuovo spazio", { exact: true }).fill(`Fonti ${suffix}`);
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
        name: "Documento · contratto.txt · v1",
        exact: true,
      }),
    ).toBeVisible();
    await openWorkspacePanel(b, "context");
    await expect(b.locator(".information")).toHaveCount(0);
    const proposal = b
      .locator(".proposal")
      .filter({ hasText: "Il locale costa €3.200 al mese." });
    await proposal
      .getByRole("button", {
        name: "Accetta come riferimento descrittivo",
        exact: true,
      })
      .click();
    await openWorkspacePanel(a, "context");
    await expect(a.locator(".information")).toContainText("3.200");
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
        name: "Fonte web · Licenza di prova",
        exact: true,
      }),
    ).toBeVisible();
    await openWorkspacePanel(b, "context");
    await expect(b.locator(".information")).not.toContainText("2.000");
    await b
      .locator(".proposal")
      .filter({ hasText: "La licenza costa circa €2.000 (fonte di test)." })
      .getByRole("button", {
        name: "Accetta come riferimento descrittivo",
        exact: true,
      })
      .click();
    const question = b.getByRole("region", { name: "Domande dello spazio" });
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
    await expect(
      a.getByRole("region", { name: "Domande dello spazio" }),
    ).toContainText("Risposta di lavoro collegata");
    await a.reload();
    await openWorkspacePanel(a, "sources");
    await expect(
      a.getByRole("heading", {
        name: "Fonte web · Licenza di prova",
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
    await b
      .getByRole("button", { name: "Lascia lo spazio", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Crea spazio", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await b.request.get(href!)).status())
      .toBe(403);
  } finally {
    await ca.close();
    await cb.close();
  }
});
