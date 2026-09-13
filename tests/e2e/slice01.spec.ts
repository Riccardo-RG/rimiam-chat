import { register, openWorkspacePanel } from "./helpers";
import { test, expect } from "@playwright/test";

test("two people exercise admission, history, explicit adherence, context and correction", async ({
  browser,
}) => {
  const suffix = Date.now();
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    await register(a, "Riccardo", `riccardo-${suffix}@example.test`);
    await a
      .getByLabel("Nuovo spazio", { exact: true })
      .fill(`Cocktail bar ${suffix}`);
    await a.getByRole("button", { name: "Crea spazio", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: `Cocktail bar ${suffix}`, exact: true }),
    ).toBeVisible();
    const workspaceId = new URL(a.url()).searchParams.get("workspace")!;
    const csrf = await a.request.post(
      `/api/workspaces/${workspaceId}/commands`,
      {
        headers: { Origin: "https://untrusted.example" },
        data: {
          commandId: crypto.randomUUID(),
          command: {
            type: "message.send",
            content: "Rejected cross-origin write",
          },
        },
      },
    );
    expect(csrf.status()).toBe(403);
    await openWorkspacePanel(a, "context");
    await a
      .getByLabel("Il mio intento iniziale", { exact: true })
      .fill("Aprire un cocktail bar a Milano");
    await a
      .getByRole("button", { name: "Stabilisci il Goal come mio intento" })
      .click();
    await a
      .getByRole("button", { name: "Aderisco personalmente a questo Goal v1" })
      .click();
    await a
      .getByLabel("Messaggio", { exact: true })
      .fill("Il locale costa €3.000 al mese.");
    await a
      .getByRole("button", { name: "Invia messaggio", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Accetta come riferimento descrittivo" }),
    ).toBeVisible();
    await register(b, "Marco", `marco-${suffix}@example.test`);
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    await openWorkspacePanel(a, "people");
    await a
      .getByLabel("Email del destinatario", { exact: true })
      .fill(`marco-${suffix}@example.test`);
    await a
      .getByLabel(
        "Confermo che l’invito concede accesso all’intera storia condivisa conservata.",
        { exact: true },
      )
      .check();
    await a
      .getByRole("button", { name: "Crea invito personale", exact: true })
      .click();
    await expect(a.getByLabel("Link invito", { exact: true })).toBeVisible();
    const link = await a
      .getByLabel("Link invito", { exact: true })
      .inputValue();
    await b.goto(link);
    await expect(
      b.getByRole("heading", { name: `Entra in Cocktail bar ${suffix}` }),
    ).toBeVisible();
    await expect(
      b.getByText("Entrando potrai leggere", { exact: false }),
    ).toBeVisible();
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    await b
      .getByLabel(
        "Accetto esplicitamente di entrare con questa visibilità della storia.",
        { exact: true },
      )
      .check();
    await b
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await expect(b.locator(".messages")).toContainText(
      "Il locale costa €3.000 al mese.",
    );
    await openWorkspacePanel(b, "context");
    await openWorkspacePanel(a, "context");
    await expect(
      b.getByRole("button", {
        name: "Aderisco personalmente a questo Goal v1",
      }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Aderisco personalmente a questo Goal v1" })
      .click();
    await b
      .getByRole("button", { name: "Accetta come riferimento descrittivo" })
      .click();
    await expect(a.locator(".information")).toContainText("Accettata da Marco");
    await b
      .getByLabel("Messaggio", { exact: true })
      .fill("No, il locale costa €3.500 al mese.");
    await b
      .getByRole("button", { name: "Invia messaggio", exact: true })
      .click();
    await b
      .getByRole("button", { name: "Valuta come correzione", exact: true })
      .click();
    await b
      .getByLabel("Motivo della correzione", { exact: true })
      .fill("Il proprietario ha precisato il canone.");
    await b
      .getByRole("button", {
        name: "Accetta la nuova versione descrittiva",
        exact: true,
      })
      .click();
    await expect(a.locator(".information")).toContainText("Accettata · v2");
    await expect(a.locator(".information")).toContainText("3.500");
    await a
      .getByText("Fonti e storia delle correzioni", { exact: true })
      .click();
    await expect(a.locator(".version")).toHaveCount(2);
    await expect(a.locator(".version").first()).toContainText("3.000");
    await a
      .getByLabel("Messaggio", { exact: true })
      .fill("Ci impegniamo a preparare il concept insieme.");
    await a
      .getByRole("button", { name: "Invia messaggio", exact: true })
      .click();
    await a
      .locator(".proposal")
      .filter({ hasText: "Ci impegniamo a preparare il concept insieme." })
      .getByRole("button", { name: "Proponi come impegno esplicito" })
      .click();
    await a.getByRole("dialog").getByLabel("Marco", { exact: true }).check();
    await a
      .getByRole("button", { name: "Proponi il testo a queste persone" })
      .click();
    await a.getByText("Decisioni, vincoli e impegni", { exact: true }).click();
    await b.getByText("Decisioni, vincoli e impegni", { exact: true }).click();
    await a
      .getByRole("button", { name: "Approvo questo contenuto per me" })
      .click();
    await expect(
      a.getByRole("region", { name: "Goal, decisioni e mandati" }),
    ).toContainText("approvazione richiesta");
    await b
      .getByRole("button", { name: "Approvo questo contenuto per me" })
      .click();
    await expect(
      a.getByRole("region", { name: "Goal, decisioni e mandati" }),
    ).toContainText("Impegno · efficace");
    await a.reload();
    await openWorkspacePanel(a, "context");
    await expect(a.locator(".information")).toContainText("3.500");
    await expect(a.locator(".messages .message")).toHaveCount(3);
    await a.screenshot({
      path: "test-results/slice01-desktop.png",
      fullPage: true,
    });
    await a.setViewportSize({ width: 390, height: 844 });
    await expect(
      a.getByRole("heading", { name: `Cocktail bar ${suffix}`, exact: true }),
    ).toBeVisible();
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await a.screenshot({
      path: "test-results/slice01-mobile.png",
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
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    await ca.close();
    await cb.close();
  }
});
