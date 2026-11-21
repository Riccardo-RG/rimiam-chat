import { expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
  register,
  joinTestWorkspace,
  openWorkspacePanel,
} from "./helpers";

test("a contributor edits the shared objective and archives a topic with attributed chat history", async ({
  page,
  browser,
}) => {
  const other = await browser.newPage();
  try {
    const name = "Lancio " + crypto.randomUUID();
    await register(
      page,
      "Alba",
      "goal-" + crypto.randomUUID() + "@example.test",
    );
    await fillWorkspaceName(page, name);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, other, name, "Leo");
    await openWorkspacePanel(page, "goal", { dock: false });
    await page
      .getByLabel("Obiettivo dello spazio", { exact: true })
      .fill("Preparare la beta");
    await page.getByRole("button", { name: "Imposta obiettivo" }).click();
    await expect(
      other.getByRole("button", {
        name: "Alba ha impostato l’obiettivo dello spazio.",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
    await openWorkspacePanel(other, "goal", { dock: false });
    await other
      .getByRole("button", { name: "Modifica obiettivo", exact: true })
      .click();
    await other
      .getByLabel("Obiettivo dello spazio", { exact: true })
      .fill("Provare RIMIAM in due");
    await expect(
      other.getByRole("textbox", { name: "Motivazione", exact: true }),
    ).not.toBeVisible();
    await other.getByRole("button", { name: "Salva obiettivo" }).click();
    const notice = page.getByRole("button", {
      name: "Leo ha aggiornato l’obiettivo dello spazio.",
    });
    await expect(notice).toBeVisible();
    await notice.click();
    await expect(
      page.getByText("Provare RIMIAM in due", { exact: true }).first(),
    ).toBeVisible();
    await other
      .getByRole("button", { name: "Torna alla conversazione", exact: true })
      .click();
    await openWorkspacePanel(other, "attention", { dock: false });
    await other
      .getByText("Argomenti della conversazione", { exact: true })
      .click();
    await other.getByLabel("Un nuovo argomento").fill("Prove sul telefono");
    await other.getByRole("button", { name: "Crea argomento" }).click();
    const topic = other
      .locator("details")
      .filter({
        has: other
          .locator("summary")
          .filter({ hasText: "Prove sul telefono · Attivo" }),
      })
      .last();
    await topic.locator(":scope > summary").click();
    await topic.getByText("Modifica l’argomento", { exact: true }).click();
    await topic
      .getByRole("textbox", { name: "Descrizione", exact: true })
      .fill("Bozza di Leo");
    const url = new URL(other.url());
    const endpoint = "/api/v1/workspaces/" + url.searchParams.get("workspace");
    const observed = await (
      await page.request.get(endpoint + "/attention")
    ).json();
    const current = observed.workstreams.find(
      (s: { title: string }) => s.title === "Prove sul telefono",
    );
    const concurrent = await page.request.post(endpoint + "/commands", {
      headers: { Origin: url.origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "workstream.save",
          id: current.id,
          expectedVersion: current.version,
          title: current.title,
          description: "Nota di Alba",
        },
      },
    });
    expect(concurrent.ok()).toBe(true);
    await expect(
      topic.getByRole("status").getByText("Nota di Alba", { exact: true }),
    ).toBeVisible({
      timeout: 12000,
    });
    await expect(
      topic.getByRole("button", { name: "Aggiorna argomento" }),
    ).toBeDisabled();
    await expect(
      topic.getByRole("textbox", { name: "Descrizione", exact: true }),
    ).toHaveValue("Bozza di Leo");
    await topic
      .getByRole("button", { name: "Usa il testo aggiornato" })
      .click();
    await expect(
      topic.getByRole("textbox", { name: "Descrizione", exact: true }),
    ).toHaveValue("Nota di Alba");
    await topic.getByRole("button", { name: "Archivia argomento" }).click();
    await other
      .getByLabel("Mostra anche gli argomenti proposti, conclusi e archiviati")
      .check();
    const archived = other
      .locator("summary")
      .filter({ hasText: "Prove sul telefono · Archiviato" });
    await expect(archived).toBeVisible();
    const restore = other.getByRole("button", { name: "Ripristina argomento" });
    if (!(await restore.isVisible())) await archived.click();
    await restore.click();
    await page.reload();
    await expect(
      page.locator(".messages").getByRole("button", {
        name: /Leo ha archiviato l’argomento «Prove sul telefono»/i,
      }),
    ).toHaveCount(1);
    await expect(
      page.locator(".messages").getByRole("button", {
        name: /Leo ha ripristinato l’argomento «Prove sul telefono»/i,
      }),
    ).toHaveCount(1);
  } finally {
    await other.close();
  }
});
