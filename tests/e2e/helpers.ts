import { expect, type Page } from "@playwright/test";
export async function openWorkspacePanel(
  page: Page,
  panel:
    | "context"
    | "work"
    | "sources"
    | "artifacts"
    | "calendar"
    | "email"
    | "people",
) {
  const close = page.getByRole("button", {
    name: "Torna alla conversazione",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  const top = {
    context: "Contesto",
    work: "Lavoro",
    sources: "Materiali",
    artifacts: "Materiali",
    calendar: "Strumenti",
    email: "Strumenti",
    people: "Persone",
  }[panel];
  await page
    .getByRole("navigation", { name: "Esplora lo spazio" })
    .getByRole("button", { name: top, exact: true })
    .click();
  const destination = {
    sources: /Fonti e ricerca/,
    artifacts: /Documenti e risultati/,
    calendar: /Calendario/,
    email: /Email/,
  }[panel as "sources" | "artifacts" | "calendar" | "email"];
  if (destination)
    await page
      .locator(".workspace-layer")
      .getByRole("button", { name: destination })
      .click();
  if (panel === "work")
    await page
      .getByRole("region", { name: "Tasks e follow-up" })
      .getByRole("button", { name: "Lavoro e follow-up", exact: true })
      .click();
  const summary = {
    sources: "Documenti e ricerca web",
    email: "Workspace Email",
    people: "Partecipanti e accesso",
  }[panel as "sources" | "email" | "people"];
  if (summary) {
    const target = page
      .locator(".workspace-layer summary")
      .filter({ hasText: new RegExp(`^${summary}(?:$| ·)`) })
      .first();
    await expect(target).toBeVisible();
    if (!(await target.evaluate((e) => e.parentElement?.hasAttribute("open"))))
      await target.click();
  }
}
export async function register(
  page: Page,
  name: string,
  email: string,
  destination = "/",
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(destination);
    await page
      .getByRole("button", { name: "Crea un account", exact: true })
      .click();
    await page.getByLabel("Nome", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Local-test-password-2026!");
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/sign-up/email") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Registrati", exact: true }).click();
    const sent = await response;
    if (sent.status() !== 429) break;
    // Honour the actual auth limiter. Do not disable production protections for E2E.
    const seconds = Number(
      sent.headers()["x-retry-after"] ?? sent.headers()["retry-after"] ?? 60,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  await expect(page.getByRole("status")).toContainText(
    "Controlla la tua email",
  );
  const response = await page.request.get("/api/local-mail");
  expect(response.ok()).toBeTruthy();
  const mails = (await response.json()) as {
    recipient: string;
    link: string;
  }[];
  const mail = mails.find((m) => m.recipient === email)!;
  expect(mail).toBeDefined();
  // A long suite may exhaust the real session-read limiter after verification.
  // Honour Retry-After and reload with the issued session; never disable auth protection.
  for (let attempt = 0; attempt < 3; attempt++) {
    const sessionRead = page.waitForResponse(async (r) => {
      if (!r.url().includes("/api/auth/get-session")) return false;
      if (r.status() === 429) return true;
      // Ignore an earlier unauthenticated page's in-flight session read.
      const body = await r.json().catch(() => null);
      return body?.user?.email === email;
    });
    if (attempt === 0) await page.goto(mail.link);
    else await page.reload();
    const response = await sessionRead;
    if (response.status() !== 429) break;
    const seconds = Number(
      response.headers()["x-retry-after"] ??
        response.headers()["retry-after"] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  await expect(
    page.getByRole("button", { name: "Crea spazio", exact: true }),
  ).toBeVisible();
}
