import { expect, test } from "@playwright/test";
import {
  fillWorkspaceName,
  register,
  joinTestWorkspace,
  openMessageComposer,
  openWorkspacePanel,
} from "./helpers";

test("attiva la generazione personale e pubblica il documento nello spazio solo dopo aver letto l’anteprima", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.MIRIAM_E2E_CONSULTATION_MODEL !== "true",
    "Requires the local deterministic model endpoint",
  );
  const peer = await browser.newPage(),
    workspace = "Lancio " + crypto.randomUUID().slice(0, 8);
  try {
    await register(
      page,
      "Nora",
      "doc-" + crypto.randomUUID() + "@example.test",
    );
    await fillWorkspaceName(page, workspace);
    await page
      .getByRole("button", { name: "Crea spazio", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: workspace, exact: true }),
    ).toBeVisible();
    await joinTestWorkspace(page, peer, workspace, "Matteo");
    await (
      await openMessageComposer(page)
    ).fill("@Emme crea un documento per il lancio");
    await page.getByRole("button", { name: "Invia", exact: true }).click();
    const preview = page.getByRole("dialog", {
      name: "Documento personale di Emme",
    });
    await expect(
      preview.getByRole("heading", { name: "Anteprima del documento" }),
    ).toBeVisible();
    await expect(
      preview.getByText("Salvato nei Documenti personali · Solo tu"),
    ).toBeVisible();
    const download = preview.getByRole("link", { name: "Scarica Markdown" });
    const privateUrl = await download.getAttribute("href");
    expect(await (await page.request.get(privateUrl!)).text()).toContain(
      "Invitiamo due tester",
    );
    expect((await peer.request.get(privateUrl!)).status()).toBe(403);
    const publicMsg = peer
      .locator(".messages")
      .getByRole("article")
      .filter({ hasText: "Piano di lancio.md" });
    await expect(publicMsg).toHaveCount(0);
    await preview
      .getByRole("button", { name: "Condividi in " + workspace, exact: true })
      .click();
    await expect(publicMsg).toHaveCount(1);
    await preview.getByRole("button", { name: "Chiudi", exact: true }).click();
    await openWorkspacePanel(peer, "artifacts", { dock: false });
    await expect(
      peer.getByRole("button", {
        name: "Apri Piano di lancio.md",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await peer.close();
  }
});
