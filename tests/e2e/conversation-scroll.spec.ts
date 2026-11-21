import { expect, test } from "@playwright/test";
import { fillWorkspaceName, openWorkspacePanel, register } from "./helpers";

test("scrolling the workspace stops at the last message on wide and narrow screens", async ({
  page,
}) => {
  await register(
    page,
    "Ada",
    "scroll-" + crypto.randomUUID() + "@example.test",
  );
  await fillWorkspaceName(page, "Limiti della cronologia");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Limiti della cronologia", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  const sent = await page.request.post(
    "/api/v1/workspaces/" + url.searchParams.get("workspace") + "/commands",
    {
      headers: { Origin: url.origin },
      data: {
        commandId: crypto.randomUUID(),
        command: {
          type: "message.send",
          content:
            "Confronto\n".repeat(45) +
            "https://example.test/" +
            "f".repeat(260) +
            "\nUltima riga della conversazione.",
        },
      },
    },
  );
  expect(sent.ok()).toBe(true);
  const lastId = (await sent.json()).result.messageId;
  await page.reload();
  const list = page.locator(".messages");
  const last = page.locator("#source-" + lastId);
  await expect(last).toBeAttached();
  for (const [width, height] of [
    [1440, 900],
    [390, 664],
    [844, 390],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(
        () =>
          list.evaluate((el) => {
            const root = document.scrollingElement!;
            root.scrollTo(100000, 100000);
            el.scrollTo(100000, 100000);
            const last = el.querySelectorAll("[id^=source-]");
            const box = el.getBoundingClientRect();
            return {
              horizontal: Math.max(
                root.scrollWidth - root.clientWidth,
                el.scrollWidth - el.clientWidth,
              ),
              pagePan: Math.round(root.scrollTop),
              trailingGap: Math.max(
                0,
                Math.round(
                  box.bottom -
                    last[last.length - 1].getBoundingClientRect().bottom,
                ) - 16,
              ),
            };
          }),
        { message: "Blank scroll range at " + width + "×" + height },
      )
      .toEqual({ horizontal: 0, pagePan: 0, trailingGap: 0 });
  }
  await page.setViewportSize({ width: 1280, height: 600 });
  await openWorkspacePanel(page, "calendar");
  const panel = page.getByRole("dialog", { name: "Calendario" });
  await expect(panel.getByRole("button", { name: "Sgancia" })).toBeVisible();
  await expect
    .poll(
      () =>
        panel.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
          const root = document.scrollingElement!;
          root.scrollTop = root.scrollHeight;
          return Math.max(
            0,
            Math.ceil(el.getBoundingClientRect().bottom - innerHeight),
            Math.round(root.scrollTop),
          );
        }),
      {
        message:
          "A docked tool may scroll independently without pushing the conversation off screen",
      },
    )
    .toBeLessThanOrEqual(1);
});
