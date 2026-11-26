import { test, expect } from "@playwright/test";
import { openWithSession, fillWorkspaceName, register } from "./helpers";

test("Home prioritises recent conversations and keeps personal tools reachable at every viewport", async ({
  page,
}, info) => {
  await register(page, "Gioia", `home-${crypto.randomUUID()}@example.test`);
  const accept = page.getByRole("button", {
    name: "Accetto la regola d’uso della beta",
  });
  await accept.click();
  await expect(accept).toHaveCount(0);
  await fillWorkspaceName(page, "Interviste ai tester");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Interviste ai tester", exact: true }),
  ).toBeVisible();
  await openWithSession(page, "/");
  const room = "Lancio RIMIAM";
  await fillWorkspaceName(page, room);
  await expect(
    page.getByRole("region", { name: "Agenda personale" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Personale", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: room, exact: true }),
  ).toBeVisible();
  const workspace = new URL(page.url()).searchParams.get("workspace")!;
  const preview = "Il prototipo è pronto per il prossimo incontro.";
  const response = await page.request.post(
    `/api/v1/workspaces/${workspace}/commands`,
    {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        commandId: crypto.randomUUID(),
        command: { type: "message.send", content: preview },
      },
    },
  );
  expect(response.ok()).toBe(true);
  await openWithSession(page, "/");
  const directory = page.getByRole("region", {
    name: "Elenco degli spazi disponibili",
  });
  const personal = page.getByRole("region", { name: "Personale", exact: true });
  const today = page.getByRole("region", { name: "Agenda personale" });
  await expect(directory.getByText(preview)).toBeVisible();
  await expect(
    today.getByText("Nessun impegno per questa giornata."),
  ).toBeVisible();
  await today.getByRole("button", { name: "Nuovo appuntamento" }).click();
  await today
    .getByLabel("Titolo", { exact: true })
    .fill("Rivedere il prototipo");
  await today.getByRole("button", { name: "Salva appuntamento" }).click();
  await expect(today.getByText("Rivedere il prototipo")).toBeVisible();
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        return page.locator("main").evaluate((main) => {
          const sections = [
            "Elenco degli spazi disponibili",
            "Personale",
            "Agenda personale",
          ].map((label) =>
            main
              .querySelector(`section[aria-label="${label}"]`)!
              .getBoundingClientRect(),
          );
          return sections.every(
            (box, index) =>
              index === 0 || sections[index - 1].bottom <= box.top + 1,
          );
        });
      })
      .toBe(true);
    await expect(directory.getByText(room, { exact: true })).toBeInViewport();
    for (const label of ["Tu ed Emme", "Documenti", "Promemoria"]) {
      const shortcut = personal.getByRole("button", {
        name: label,
        exact: true,
      });
      await expect(shortcut).toBeVisible();
      expect(
        Math.round((await shortcut.boundingBox())!.height),
      ).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 390 || width === 1440) {
      const colors = new Set<string>();
      await page.mouse.move(1, 1);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        colors.add(
          await page
            .locator("body")
            .evaluate((body) => getComputedStyle(body).backgroundColor),
        );
        const path = info.outputPath(
          `home-${width}${colorScheme === "dark" ? "-dark" : ""}.png`,
        );
        await page.screenshot({ path, animations: "disabled" });
        await info.attach(`Home ${width} × ${height} · ${colorScheme}`, {
          path,
          contentType: "image/png",
        });
      }
      expect(colors.size).toBe(2);
    }
  }
  await today.getByRole("button", { name: "Nuovo promemoria" }).click();
  await expect(today.getByLabel("Cosa ricordare")).toBeVisible();
  await today.getByRole("button", { name: "Annulla" }).click();
  await directory.getByRole("button", { name: new RegExp(room) }).click();
  await expect(
    page.getByRole("heading", { name: room, exact: true }),
  ).toBeVisible();
});
