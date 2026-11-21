import {
  fillWorkspaceName,
  expandContextRecord,
  openMessageComposer,
  openWorkspacePanel,
  register,
} from "./helpers";
import { test, expect } from "@playwright/test";

test("two people exercise admission, history, explicit adherence, context and correction", async ({
  browser,
}, info) => {
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
    await fillWorkspaceName(a, `Cocktail bar ${suffix}`);
    await a.getByRole("button", { name: "Crea spazio", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: `Cocktail bar ${suffix}`, exact: true }),
    ).toBeVisible();
    const invite = a
      .locator("main > header")
      .getByRole("button", { name: "Invita", exact: true });
    await expect(invite).toBeVisible();
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
    await openWorkspacePanel(a, "goal");
    await a
      .getByLabel("Obiettivo dello spazio", { exact: true })
      .fill("Aprire la prima beta di RIMIAM alle coppie di cofondatori");
    await a.getByRole("button", { name: "Imposta obiettivo" }).click();
    const previousViewport = a.viewportSize()!;
    const previousScheme = await a.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
    const goalPanel = a.getByRole("dialog");
    const adherence = goalPanel.getByRole("button", {
      name: "Aderisco personalmente a questo Goal v1",
      exact: true,
    });
    try {
      await a.emulateMedia({ colorScheme: "dark" });
      await a.setViewportSize({ width: 390, height: 844 });
      await expect(
        goalPanel.getByRole("heading", {
          name: "Aprire la prima beta di RIMIAM alle coppie di cofondatori",
          exact: true,
        }),
      ).toBeInViewport();
      await expect(
        goalPanel.getByText("Attivo", { exact: true }),
      ).toBeVisible();
      await expect(
        goalPanel.getByRole("button", {
          name: "Modifica obiettivo",
          exact: true,
        }),
      ).toBeInViewport();
      const history = goalPanel
        .locator("summary")
        .filter({ hasText: "Storia e adesioni" });
      const historyOpen = () =>
        history.evaluate((summary) =>
          summary.parentElement?.hasAttribute("open"),
        );
      await expect.poll(historyOpen).toBe(false);
      await history.click();
      await expect.poll(historyOpen).toBe(true);
      await expect(adherence).toBeVisible();
      await history.click();
      await expect.poll(historyOpen).toBe(false);
      await a.screenshot({ path: info.outputPath("goal-mobile-dark.png") });
    } finally {
      await a.setViewportSize(previousViewport);
      await a.emulateMedia({ colorScheme: previousScheme });
    }
    await goalPanel.getByText("Storia e adesioni", { exact: true }).click();
    await adherence.click();
    await openWorkspacePanel(a, "context");
    const ownerComposer = await openMessageComposer(a);
    await ownerComposer.fill("Il locale costa €3.000 al mese.");
    await a.getByRole("button", { name: "Invia", exact: true }).click();
    await expandContextRecord(a, "Da valutare", "3.000");
    await expect(
      a.getByRole("button", { name: "Accetta come riferimento descrittivo" }),
    ).toBeVisible();
    await register(b, "Marco", `marco-${suffix}@example.test`);
    const inbox = b.getByRole("region", { name: "Inviti ricevuti" });
    await expect(inbox).toHaveCount(0);
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    // The invitation must stay reachable after onboarding, even on a narrow screen.
    await a.setViewportSize({ width: 390, height: 844 });
    await a.reload();
    await invite.click();
    const inviteDialog = a.getByRole("dialog", {
      name: "Invita una persona",
      exact: true,
    });
    const email = inviteDialog.getByLabel("Email del destinatario", {
      exact: true,
    });
    await expect(email).toBeInViewport();
    await expect(email).toBeFocused();
    const disclosure = inviteDialog.getByLabel(
      "Confermo che l’invito concede accesso all’intera storia condivisa conservata.",
      { exact: true },
    );
    await expect(disclosure).not.toBeChecked();
    await expect(
      inviteDialog.getByLabel("Invia anche un’email al destinatario", {
        exact: true,
      }),
    ).not.toBeChecked();
    await email.fill(`marco-${suffix}@example.test`);
    const submit = inviteDialog.getByRole("button", {
      name: "Crea invito personale",
      exact: true,
    });
    await submit.click();
    await expect(disclosure).toBeFocused();
    const inviteLink = inviteDialog.getByLabel("Link invito", { exact: true });
    await expect(inviteLink).toHaveCount(0);
    await disclosure.check();
    await submit.click();
    await expect(inviteLink).toBeVisible();
    const link = await inviteLink.inputValue();
    await ca.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(a.url()).origin,
    });
    await a.bringToFront();
    await inviteDialog
      .getByRole("button", { name: "Copia link", exact: true })
      .click();
    await expect
      .poll(() => a.evaluate(() => navigator.clipboard.readText()))
      .toBe(link);
    await a.keyboard.press("Escape");
    await expect(inviteDialog).not.toBeVisible();
    await expect(invite).toBeFocused();
    await a.setViewportSize({ width: 1440, height: 960 });
    await openWorkspacePanel(a, "people", { dock: false });
    await a
      .getByRole("dialog", { name: "Persone e accesso", exact: true })
      .getByRole("button", { name: "Invita una persona", exact: true })
      .click();
    await expect(inviteLink).toHaveValue(link);
    // The recipient returns to an already-open Home without visiting the personal link.
    await b.bringToFront();
    await b.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(inbox).toContainText(`Cocktail bar ${suffix}`);
    await b.reload();
    await expect(inbox).toContainText(`Cocktail bar ${suffix}`);
    expect(new URL(b.url()).searchParams.has("invite")).toBe(false);
    await expect(
      b.getByRole("button", { name: "Crea spazio", exact: true }),
    ).not.toBeVisible();
    await expect(
      b.getByRole("heading", { name: `Entra in Cocktail bar ${suffix}` }),
    ).toBeVisible();
    await expect(
      b.getByText("Entrando potrai leggere", { exact: false }),
    ).toBeVisible();
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    const acceptedHistory = b.getByLabel(
      "Accetto esplicitamente di entrare con questa visibilità della storia.",
      { exact: true },
    );
    await expect(acceptedHistory).not.toBeChecked();
    await inbox.screenshot({ path: "test-results/invitation-inbox.png" });
    await inbox
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await expect(acceptedHistory).toBeFocused();
    expect(
      (await b.request.get(`/api/workspaces/${workspaceId}`)).status(),
    ).toBe(403);
    await acceptedHistory.check();
    await b
      .getByRole("button", { name: "Accetta invito ed entra", exact: true })
      .click();
    await expect(b.locator(".messages")).toContainText(
      "Il locale costa €3.000 al mese.",
    );
    await expect(inbox).toHaveCount(0);
    await expect(
      b
        .locator("main > header")
        .getByRole("button", { name: "Invita", exact: true }),
    ).toHaveCount(0);
    await expect(
      inviteDialog.getByRole("heading", {
        name: "Invito accettato",
        exact: true,
      }),
    ).toBeVisible();
    await expect(inviteLink).toHaveCount(0);
    await openWorkspacePanel(b, "goal");
    await b.getByText("Storia e adesioni", { exact: true }).click();
    await openWorkspacePanel(a, "context");
    await expect(
      b.getByRole("button", {
        name: "Aderisco personalmente a questo Goal v1",
      }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Aderisco personalmente a questo Goal v1" })
      .click();
    await openWorkspacePanel(b, "context");
    await expandContextRecord(b, "Da valutare", "3.000");
    await b
      .getByRole("button", { name: "Accetta come riferimento descrittivo" })
      .click();
    await expect(
      await expandContextRecord(a, "Riferimenti", "3.000"),
    ).toContainText("Accettata da Marco");
    const guestComposer = await openMessageComposer(b);
    await guestComposer.fill("No, il locale costa €3.500 al mese.");
    await b.getByRole("button", { name: "Invia", exact: true }).click();
    await expandContextRecord(b, "Da valutare", "3.500");
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
    const corrected = await expandContextRecord(a, "Riferimenti", "3.500");
    await expect(corrected.locator(":scope > summary")).toContainText("v2");
    await expect(a.locator(".information")).toContainText("3.500");
    await a
      .getByText("Fonti e storia delle correzioni", { exact: true })
      .click();
    await expect(a.locator(".version")).toHaveCount(2);
    await expect(a.locator(".version").first()).toContainText("3.000");
    await openMessageComposer(a);
    await ownerComposer.fill("Ci impegniamo a preparare il concept insieme.");
    await a.getByRole("button", { name: "Invia", exact: true }).click();
    const commitment = await expandContextRecord(
      a,
      "Da valutare",
      "Ci impegniamo a preparare il concept insieme.",
    );
    await commitment
      .getByRole("button", { name: "Proponi come impegno esplicito" })
      .click();
    await a.getByRole("dialog").getByLabel("Marco", { exact: true }).check();
    await a
      .getByRole("button", { name: "Proponi il testo a queste persone" })
      .click();
    await expect(
      a.getByRole("dialog", { name: "Proponi impegno", exact: true }),
    ).not.toBeVisible();
    await openWorkspacePanel(a, "goal");
    await openWorkspacePanel(b, "goal");
    await a.getByText("Decisioni, vincoli e impegni", { exact: true }).click();
    await b.getByText("Decisioni, vincoli e impegni", { exact: true }).click();
    await a
      .getByRole("button", { name: "Approvo questo contenuto per me" })
      .click();
    await expect(
      a.getByRole("region", { name: "Obiettivo, decisioni e deleghe" }),
    ).toContainText("approvazione richiesta");
    await b
      .getByRole("button", { name: "Approvo questo contenuto per me" })
      .click();
    await expect(
      a.getByRole("region", { name: "Obiettivo, decisioni e deleghe" }),
    ).toContainText("Impegno · efficace");
    await a.reload();
    await openWorkspacePanel(a, "context");
    const persisted = await expandContextRecord(a, "Riferimenti", "3.500");
    await expect(persisted).toContainText("3.500");
    const messages = a.locator(".messages");
    for (const content of [
      "Il locale costa €3.000 al mese.",
      "No, il locale costa €3.500 al mese.",
      "Ci impegniamo a preparare il concept insieme.",
    ])
      await expect(messages.getByText(content, { exact: true })).toHaveCount(1);
    const welcome = messages.getByRole("article", {
      name: "Emme",
      exact: true,
    });
    await expect(welcome).toHaveCount(1);
    await expect(messages.locator(".message")).toHaveCount(4);
    await a.screenshot({
      path: "test-results/slice01-desktop.png",
      fullPage: true,
    });
    await a
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
    const origin = welcome.getByText(
      /Introduzione deterministica, nessuna inferenza AI/,
    );
    await expect(origin).toBeHidden();
    const options = welcome.getByLabel(/Opzioni del messaggio/);
    await options.click();
    await expect(origin).toBeVisible();
    await options.click();
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
    await expect(
      b
        .getByRole("dialog", { name: "Persone e accesso", exact: true })
        .getByRole("button", { name: /invita/i }),
    ).toHaveCount(0);
    b.once("dialog", (d) => d.accept());
    await b.getByText("La mia partecipazione", { exact: true }).click();
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
