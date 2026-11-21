import { expect, test } from "@playwright/test";
import { fillWorkspaceName, register, openWorkspacePanel } from "./helpers";
import { workspaceConsultation } from "../../src/server/private-consultation";
import { pool } from "../../src/server/db";
import type { StructuredModel } from "../../src/server/structured-llm";

test("private Context stays empty until resumed, preserves two turns and addresses a follow-up to the selected exchange", async ({
  page,
}) => {
  const db = new URL(process.env.DATABASE_URL!);
  if (
    process.env.MIRIAM_E2E !== "true" ||
    !["localhost", "127.0.0.1"].includes(db.hostname) ||
    !/^\/miriam_e2e(?:_\d+)?$/.test(db.pathname)
  )
    throw Error("Local isolated E2E database required");
  const email = crypto.randomUUID() + "@example.test";
  await register(page, "Giulia", email);
  await fillWorkspaceName(page, "Scelta del primo test");
  await page.getByRole("button", { name: "Crea spazio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scelta del primo test", exact: true }),
  ).toBeVisible();
  const w = new URL(page.url()).searchParams.get("workspace")!;
  const {
    rows: [identity],
  } = await pool.query(
    'SELECT u.id,s.id AS session FROM "user" u JOIN session s ON s."userId"=u.id WHERE u.email=$1 ORDER BY s."createdAt" DESC LIMIT 1',
    [email],
  );
  const question = "Quale test facciamo per primo?",
    explanation = "Perché partire dagli inviti?";
  const fixture: StructuredModel = {
    async generateJSON({ schema, prompt }) {
      return schema.parse({
        answer:
          JSON.parse(prompt).question === question
            ? "Gli inviti alla beta."
            : "Servono due persone nella stessa chat.",
        keys: [],
        moreTerms: [],
      });
    },
  };
  const ask = (q: string, parentId?: string) =>
    workspaceConsultation(
      identity.id,
      identity.session,
      w,
      {
        action: "ask",
        kind: "context",
        expectedActorId: identity.id,
        id: crypto.randomUUID(),
        question: q,
        parentId,
      },
      fixture,
    );
  const first = await ask(question),
    second = await ask(explanation, first.id);
  await openWorkspacePanel(page, "context");
  const panel = page.getByRole("region", { name: "Consulta il contesto" });
  await expect(panel.getByText(first.answer, { exact: true })).toHaveCount(0);
  await panel
    .getByRole("button", { name: /Riprendi l’ultima consultazione/ })
    .click();
  await expect(panel.getByText(first.answer, { exact: true })).toBeVisible();
  await expect(panel.getByText(second.answer, { exact: true })).toBeVisible();
  await panel.getByLabel("Continua la consultazione").fill("E perché?");
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/consultation") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON().action === "ask",
  );
  await panel
    .getByRole("button", { name: "Chiedi a Emme", exact: true })
    .click();
  const response = await sent;
  expect(response.request().postDataJSON()).toMatchObject({
    parentId: second.id,
    question: "E perché?",
  });
  // No real provider is enabled in the local release configuration.
  expect(response.status()).toBe(503);
  await expect(
    panel.getByRole("button", { name: "Riprova", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".messages")).not.toContainText(second.answer);
  await panel.getByRole("button", { name: "Nuova consultazione" }).click();
  await expect(panel.getByText(second.answer, { exact: true })).toHaveCount(0);
});
