import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  fillWorkspaceName,
  openAccountAppearance,
  openAccountMenu,
  openWorkspacePanel,
  register,
} from "./helpers";

async function colors(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const rgb = (token: string) => {
      probe.style.color = "var(--" + token + ")";
      return getComputedStyle(probe).color;
    };
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .map(Number)
        .slice(0, 3)
        .map((channel) => {
          const srgb = channel / 255;
          return srgb <= 0.04045
            ? srgb / 12.92
            : ((srgb + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(rgb(foreground)), luminance(rgb(background))];
      return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    };
    const result = {
      paper: rgb("paper"),
      ink: rgb("ink"),
      accent: rgb("accent"),
      graphite: rgb("graphite-ink"),
      wash: rgb("graphite-wash"),
      graphiteOnPaper: contrast("graphite-ink", "paper"),
      graphiteOnSelection: contrast("graphite-ink", "graphite-wash"),
      ratio: contrast("accent", "on-accent"),
    };
    probe.remove();
    return result;
  });
}
test("accent changes persist without tinting the reading surface; the account menu dismisses outside or with Escape", async ({
  page,
}) => {
  await register(page, "Ada Studio", randomUUID() + "@example.test");
  const html = page.locator("html");
  const summary = await openAccountAppearance(page);
  const mode = page.getByLabel("Aspetto dell’app");
  const accents = page.getByLabel("Colore di accento");
  const heading = page.getByRole("heading", {
    name: "I tuoi spazi",
    exact: true,
  });
  const homeIcon = page
    .getByRole("button", { name: "I tuoi spazi", exact: true })
    .locator("svg");
  for (const theme of ["light", "dark"]) {
    await mode.selectOption(theme);
    await expect(html).toHaveAttribute("data-appearance", theme);
    await accents.selectOption("neutral");
    await expect(html).toHaveAttribute("data-accent", "neutral");
    const base = await colors(page);
    await expect(heading).toHaveCSS("color", base.graphite);
    await expect(homeIcon).toHaveCSS("color", base.graphite);
    expect(base.graphiteOnPaper).toBeGreaterThanOrEqual(4.5);
    expect(base.graphiteOnSelection).toBeGreaterThanOrEqual(4.5);
    for (const accent of ["ocean", "forest", "plum"]) {
      await accents.selectOption(accent);
      await expect(html).toHaveAttribute("data-accent", accent);
      const current = await colors(page);
      expect(current.paper).toEqual(base.paper);
      expect(current.ink).toEqual(base.ink);
      expect(current.accent).not.toEqual(base.accent);
      expect(current.ratio).toBeGreaterThanOrEqual(4.5);
      await expect(heading).toHaveCSS("color", base.ink);
      await expect(homeIcon).toHaveCSS("color", current.accent);
    }
  }
  await page
    .getByRole("heading", { name: "I tuoi spazi", exact: true })
    .click();
  await expect(accents).toBeHidden();
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "plum");
  await openAccountMenu(page);
  await page.keyboard.press("Escape");
  await expect(accents).toBeHidden();
  await expect(summary).toBeFocused();
  await expect(summary).toHaveCSS("outline-style", "solid");
});

test("Grafite follows the selected workspace and shared library tab in both system themes", async ({
  page,
}) => {
  await register(page, "Lia Studio", randomUUID() + "@example.test");
  const workspace = "Studio Grafite";
  await fillWorkspaceName(page, workspace);
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  const title = page.getByRole("heading", { name: workspace, exact: true });
  await expect(title).toBeVisible();
  const spaceLink = page
    .getByRole("navigation", { name: "I tuoi spazi", exact: true })
    .getByRole("button", { name: workspace });
  await openWorkspacePanel(page, "artifacts");
  const library = page.getByRole("dialog", { name: "Condivisi", exact: true });
  const media = library.getByRole("button", { name: "Media", exact: true });
  await media.click();
  const tab = page
    .getByRole("navigation", { name: "Viste dello spazio", exact: true })
    .getByRole("button", { name: "Condivisi", exact: true });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const palette = await colors(page);
    await expect(title).toHaveCSS("color", palette.graphite);
    await expect(spaceLink.locator("svg")).toHaveCSS("color", palette.graphite);
    await expect(spaceLink).toHaveCSS("background-color", palette.wash);
    await expect(tab).toHaveCSS("background-color", palette.wash);
    await expect(
      library.getByRole("heading", { name: "Condivisi", exact: true }),
    ).toHaveCSS("color", palette.graphite);
    await expect(media).toHaveCSS("border-bottom-color", palette.graphite);
    await expect(
      library.getByRole("button", { name: "Recenti", exact: true }),
    ).not.toHaveCSS("color", palette.graphite);
  }
});

test.describe("touch navigation", () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });
  test("touch focus stays quiet, keyboard focus returns, and account closes separately from the drawer", async ({
    page,
  }) => {
    await register(page, "Lea Studio", randomUUID() + "@example.test");
    await page.getByRole("button", { name: "Apri navigazione" }).tap();
    const drawer = page.getByRole("dialog", { name: "Menu di navigazione" });
    await expect(drawer).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-touch-focus", "");
    await expect(drawer.locator(":focus")).toHaveCSS("outline-style", "none");
    const account = drawer.locator("summary[title='Account personale']");
    await account.tap();
    await expect(
      drawer.getByRole("link", {
        name: /Metodi di accesso.*Google e Microsoft/,
      }),
    ).toBeInViewport();
    await expect(
      drawer.getByRole("button", { name: "Collega calendario" }),
    ).toBeInViewport();
    const accent = drawer.getByLabel("Colore di accento");
    await expect(accent).toBeHidden();
    await openAccountAppearance(page);
    await expect(accent).toBeVisible();
    await expect(accent).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(accent).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(account).toBeFocused();
    await expect(account).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
});

test("personal menu shows login methods and calendars before appearance settings on narrow and tablet screens", async ({
  page,
}, info) => {
  await page.goto("/");
  const dataLink = page.getByRole("link", {
    name: /Account, calendari e dati/,
  });
  await expect(dataLink).toHaveAttribute("href", "/connessioni-e-dati");
  await page.goto("/beta");
  await page
    .getByRole("link", {
      name: "Come vengono usati i dati di account e calendari",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account, calendari e dati" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Se vuoi interrompere il collegamento" }),
  ).toBeVisible();
  await register(page, "Riccardo Grandinetti", randomUUID() + "@example.test");
  await page.emulateMedia({ colorScheme: "dark" });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    if (width < 761)
      await page.getByRole("button", { name: "Apri navigazione" }).click();
    await openAccountMenu(page);
    const accountName = page
      .locator(".rail-account-name")
      .getByText("Riccardo Grandinetti", { exact: true });
    expect(
      await accountName.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeLessThanOrEqual(1);
    const menu = page.locator(".account-options");
    const profile = menu.getByRole("button", { name: "Il mio profilo" });
    await expect(profile).toContainText("Riccardo Grandinetti");
    const access = menu.getByRole("link", {
      name: /Metodi di accesso.*Google e Microsoft/,
    });
    await expect(access).toHaveAttribute(
      "href",
      /\/account\/access\?returnTo=/,
    );
    for (const item of [
      profile,
      access,
      menu.getByRole("button", { name: "Collega calendario" }),
      menu.getByRole("button", { name: "Esci dall’account" }),
    ]) {
      await expect(item).toBeInViewport({ ratio: 1 });
      expect(
        await item.evaluate((element) => {
          const r = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(r.right - 12, r.top + r.height / 2),
          );
        }),
      ).toBe(true);
    }
    await expect(menu.getByLabel("Colore di accento")).toBeHidden();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`menu-${width}.png`) });
    await menu.getByRole("button", { name: "Chiudi menu account" }).click();
    await expect(menu).toBeHidden();
    if (width < 761) await page.keyboard.press("Escape");
  }
  await openAccountMenu(page);
  await page
    .locator(".account-options")
    .getByRole("button", { name: "Collega calendario" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Collega calendario" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Come vengono usati i dati del calendario/,
    }),
  ).toHaveAttribute("href", "/connessioni-e-dati");
  await openAccountMenu(page);
  await page.getByRole("link", { name: /Metodi di accesso/ }).click();
  await expect(
    page.getByRole("heading", { name: "Metodi di accesso" }),
  ).toBeVisible();
});
