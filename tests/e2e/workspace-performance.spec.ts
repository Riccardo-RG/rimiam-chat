import { devices, expect, test } from "@playwright/test";
import { fillWorkspaceName, openWithSession, register } from "./helpers";

for (const device of ["Desktop Chrome", "Pixel 7"] as const) {
  test(
    device + " opens a populated space and scrolls without render errors",
    async ({ browser, browserName, baseURL }, info) => {
      test.skip(browserName !== "chromium", "Chromium performance profile");
      const context = await browser.newContext({
        ...devices[device],
        baseURL,
        locale: "it-IT",
      });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (entry) => {
          if (
            entry.type() === "error" &&
            !entry.text().startsWith("Failed to load resource:")
          )
            errors.push(entry.text());
        });
        page.on("response", (response) => {
          const kind = response.request().resourceType();
          if (
            response.status() >= 400 &&
            ["script", "stylesheet", "font"].includes(kind)
          )
            errors.push(
              response.status() + " " + new URL(response.url()).pathname,
            );
        });
        await register(
          page,
          "Elena",
          "render-" + crypto.randomUUID() + "@example.test",
        );
        const name = "Rilascio di primavera";
        await fillWorkspaceName(page, name);
        await page
          .getByRole("button", { name: "Crea spazio", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
        const url = new URL(page.url());
        const path =
          "/api/v1/workspaces/" +
          url.searchParams.get("workspace") +
          "/commands";
        const count = 28;
        for (let i = 1; i <= count; i++) {
          const send = await page.request.post(path, {
            headers: { Origin: url.origin },
            data: {
              commandId: crypto.randomUUID(),
              command: {
                type: "message.send",
                content:
                  "Aggiornamento " +
                  i +
                  ". Il gruppo verifica i materiali prima del prossimo incontro.",
              },
            },
          });
          expect(send.ok()).toBe(true);
        }
        const metrics = [];
        while (metrics.length < 3) {
          const { rateLimited } = await openWithSession(page, "/");
          const room = page
            .getByRole("region", { name: "Elenco degli spazi disponibili" })
            .getByRole("button", { name: new RegExp(name) });
          await expect(room).toBeVisible();
          // The real authentication backoff is outside the rendering benchmark.
          // After the page recovers, measure a fresh navigation instead.
          if (rateLimited) continue;
          const home = await page.evaluate(() => performance.now());
          const bytes = await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
              .reduce(
                (sum, entry) =>
                  sum + (entry as PerformanceResourceTiming).decodedBodySize,
                0,
              ),
          );
          await room.click();
          const timeline = page.locator(".messages");
          await expect(
            timeline.getByText(/^Aggiornamento 28\./),
          ).toBeAttached();
          metrics.push(
            await timeline
              .evaluate(async (element, start) => {
                const chat = performance.now() - start;
                const intervals: number[] = [];
                let previous = performance.now();
                for (let n = 0; n < 24; n++) {
                  element.scrollTop =
                    (n / 23) * (element.scrollHeight - element.clientHeight);
                  await new Promise<void>((done) =>
                    requestAnimationFrame(() => done()),
                  );
                  const now = performance.now();
                  intervals.push(now - previous);
                  previous = now;
                }
                return {
                  chat: Math.round(chat),
                  scrollP95: Math.round(intervals.sort((a, b) => a - b)[22]),
                };
              }, home)
              .then((result) => ({ home: Math.round(home), bytes, ...result })),
          );
        }
        await page
          .getByRole("navigation", { name: "Viste dello spazio" })
          .getByRole("button", { name: "Condivisi", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Allega file", exact: true }),
        ).toBeVisible();
        console.info(device, JSON.stringify(metrics));
        await info.attach("tempi-e-render", {
          body: JSON.stringify({ device, count, metrics, errors }),
          contentType: "application/json",
        });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
}
