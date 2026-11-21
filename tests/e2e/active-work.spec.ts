import { test, expect } from "./backend-fixture";
import {
  fillWorkspaceName,
  holdWorkspaceReadsAcrossCommand,
  openMessageComposer,
  openWorkspacePanel,
  register,
} from "./helpers";
import type { ActiveWorkView } from "../../src/contracts/active-work";
test("Active Work conversation controls, restriction, contribution and reconnect", async ({
  page,
  context,
}) => {
  await register(page, "Work Web", `work-${crypto.randomUUID()}@example.test`);
  await fillWorkspaceName(page, "Active Work verification");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const send = async (text: string) => {
    const composer = await openMessageComposer(page);
    await composer.fill(text);
    await page.getByRole("button", { name: "Invia", exact: true }).click();
    await expect(
      page.locator(".messages").getByText(text, { exact: true }),
    ).toBeVisible();
  };
  const avatar = page.getByRole("button", {
    name: "Attività di Emme",
    exact: true,
  });
  const popover = page.getByRole("region", {
    name: "Attività di Emme",
    exact: true,
  });
  await avatar.click();
  await expect(popover.getByText("Nessun lavoro in corso.")).toBeVisible();
  await avatar.press("Escape");
  await expect(popover).toBeHidden();
  await send("Il locale Milano costa 3000 euro al mese, cifra da verificare.");
  await send("@Emme Analizza: locali Milano");
  const ready = page.getByRole("button", {
    name: /Leggi il confronto completo/,
  });
  await expect(ready).toBeVisible({ timeout: 15000 });
  await ready.click();
  const region = page.getByRole("region", { name: "Active Work", exact: true });
  const work = region.getByTestId("active-work").first();
  await expect(work.locator("summary").first()).toContainText("Completato", {
    timeout: 15000,
  });
  await expect(work).toHaveAttribute("open", "");
  await expect(
    work.getByText("Contributo non adottato · contratto v1", { exact: true }),
  ).toBeVisible();
  await work.getByRole("button", { name: /^Fonte · / }).click();
  await expect(
    page.getByRole("dialog", { name: "Il passaggio" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Torna alla conversazione", exact: true })
    .click();
  await ready.click();
  const workspace = new URL(page.url()).searchParams.get("workspace")!;
  const workId = await work.getAttribute("data-work-id");
  const reads = await holdWorkspaceReadsAcrossCommand(
    page,
    workspace,
    "active-work",
    "work.converse",
    1, // The header uses its own summary resource. Hold the detail poll across the write.
  );
  try {
    const captured = await reads.captured();
    const oldRevisions: number[] = [];
    for (const response of captured) {
      expect(response.ok()).toBe(true);
      const before = (await response.json()) as ActiveWorkView;
      const oldWork = before.works.find((item) => item.id === workId)!;
      expect(oldWork.phase).toBe("completed");
      oldRevisions.push(oldWork.revision);
    }
    await work.getByRole("button", { name: "Pausa", exact: true }).click();
    const after = (await (await reads.refreshed()).json()) as ActiveWorkView;
    const paused = after.works.find((item) => item.id === workId)!;
    expect(paused.phase).toBe("paused");
    expect(paused.revision).toBeGreaterThan(Math.max(...oldRevisions));
    await expect(work.locator("summary").first()).toContainText("In pausa");
    await reads.releaseStale();
    await expect(work.locator("summary").first()).toContainText("In pausa");
    await expect(
      work.getByRole("button", { name: "Riprendi", exact: true }),
    ).toBeEnabled();
  } finally {
    await reads.close();
  }
  await work
    .getByRole("combobox", { name: "Come vuoi contribuire?", exact: true })
    .selectOption("objection");
  await work
    .getByLabel("Istruzione per questo lavoro", { exact: true })
    .fill("chiarire il costo prima di continuare");
  await work
    .getByRole("button", { name: "Invia istruzione", exact: true })
    .click();
  await expect(work.locator("summary").first()).toContainText(
    "Serve un chiarimento",
  );
  await expect(
    work.getByRole("button", { name: "Riprendi", exact: true }),
  ).toBeDisabled();
  await context.setOffline(true);
  await page.waitForTimeout(2200);
  await context.setOffline(false);
  await page.reload();
  const clarification = page.getByRole("button", {
    name: "Serve un chiarimento · locali Milano",
    exact: true,
  });
  await clarification.click();
  await expect(work).toHaveAttribute("open", "");
  await expect(
    work.getByText("chiarire il costo prima di continuare", { exact: true }),
  ).toBeVisible();
  await work
    .getByRole("button", { name: "Ritira la tua richiesta", exact: true })
    .click();
  await expect(
    work.getByRole("button", { name: "Riprendi", exact: true }),
  ).toBeEnabled();
  await work.getByRole("button", { name: "Riprendi", exact: true }).click();
  await expect(work.locator("summary").first()).toContainText("Completato", {
    timeout: 15000,
  });
  await work.getByRole("button", { name: "Ferma", exact: true }).click();
  await expect(work.locator("summary").first()).toContainText("Fermato");
  await page.reload();
  await openWorkspacePanel(page, "work");
  await work.locator("summary").first().click();
  await expect(work.locator("summary").first()).toContainText("Fermato");
  await work
    .getByRole("button", { name: "Cronologia e fonti", exact: true })
    .click();
  await expect(
    region.getByText("Storia del lavoro", { exact: true }),
  ).toBeVisible();
  await region
    .getByText("Contributi prodotti, non adottati", { exact: true })
    .click();
  await expect(region.locator(".history-entry").last()).toContainText(
    "non adottata",
  );
});
