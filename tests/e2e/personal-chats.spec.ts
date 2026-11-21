import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { register } from "./helpers";
test("opens a fresh personal conversation, resumes the right thread, reopens a searched exchange, and keeps workspace consultation explicit", async ({
  page,
}) => {
  await register(page, "Ester", randomUUID() + "@example.test");
  const api = await page.request.post("/api/v1/workspaces", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: "Lancio riservato", commandId: randomUUID() },
  });
  expect(api.ok(), await api.text()).toBe(true);
  const home = page.getByRole("region", { name: "Personale", exact: true });
  await home.getByRole("button", { name: "Tu ed Emme", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Messaggio", exact: true }),
    send = page.getByRole("button", { name: "Invia a Emme", exact: true });
  await expect(
    page.getByRole("button", { name: "Nuova conversazione" }),
  ).toBeVisible();
  const first = new URL(page.url()).searchParams.get("workspace")!;
  await message.fill("Preventivo per il laboratorio");
  await send.click();
  const timeline = page.getByRole("log", { name: "Messaggi con Emme" });
  await expect(timeline).toContainText("Preventivo per il laboratorio");
  await page.getByRole("button", { name: "Nuova conversazione" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("workspace"))
    .not.toBe(first);
  const second = new URL(page.url()).searchParams.get("workspace")!;
  await expect(timeline).not.toContainText("Preventivo");
  await page.getByRole("button", { name: "Torna a tutti gli spazi" }).click();
  const { id: group } = await api.json();
  await page.goto("/?workspace=" + group);
  await expect(
    page.getByRole("heading", { name: "Lancio riservato", exact: true }),
  ).toBeVisible();
  const openNavigation = page.getByRole("button", { name: "Apri navigazione" });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page
    .getByRole("navigation", { name: "Navigazione personale" })
    .getByRole("button", { name: "Tu ed Emme", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("workspace"))
    .toBe(second);
  await message.fill("Riprendi il preventivo di ieri");
  await send.click();
  const history = page.getByRole("region", { name: "Cronologia personale" });
  await expect(history.getByRole("searchbox")).toHaveValue("preventivo");
  await history
    .getByRole("button", { name: /Preventivo per il laboratorio/ })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("workspace"))
    .toBe(first);
  await page.getByRole("button", { name: "Consulta uno spazio" }).click();
  await page
    .getByLabel("Conversazione da consultare")
    .selectOption({ label: "Lancio riservato" });
  await page.getByRole("button", { name: "Consulta", exact: true }).click();
  await expect(page.getByText("Stai consultando")).toContainText(
    "Lancio riservato",
  );
  await page.reload();
  await expect(page.getByText("Stai consultando")).toContainText(
    "Lancio riservato",
  );
  await page.getByRole("button", { name: "Termina", exact: true }).click();
  await expect(page.getByText("Stai consultando")).toHaveCount(0);
  await message.fill(
    "Fai una ricerca approfondita su strumenti per piccoli team",
  );
  await send.click();
  await expect(page.getByLabel("Cosa vuoi approfondire?")).toHaveValue(
    "strumenti per piccoli team",
  );
  await expect(
    page.getByLabel("Avvisami sul telefono per questa ricerca"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await page.goto("/?workspace=" + second + "&utility=documents");
  await expect(
    page.getByRole("region", { name: "Documenti personali", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("workspace"))
    .toBe(first);
});
