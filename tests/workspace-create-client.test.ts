import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  WorkspaceCreation,
  workspaceCreationError,
} from "../src/client/workspace-create";
import { createWorkspaceSchema } from "../src/contracts/v1";

it.each([
  { name: "", description: "", invalid: "name" },
  { name: " \t ", description: "Introduzione", invalid: "name" },
  { name: "Nome", description: "", invalid: null },
  { name: "  Nome  ", description: "  Introduzione  ", invalid: null },
  { name: "x".repeat(120), description: "", invalid: null },
  { name: "x".repeat(121), description: "", invalid: "name" },
  { name: "🌱".repeat(60), description: "", invalid: null },
  { name: "🌱".repeat(120), description: "", invalid: null },
  { name: "🌱".repeat(121), description: "", invalid: "name" },
  { name: "Nome", description: "x".repeat(2000), invalid: null },
  { name: "Nome", description: "x".repeat(2001), invalid: "description" },
  { name: "Nome", description: "🌱".repeat(1000), invalid: null },
  { name: "Nome", description: "🌱".repeat(2000), invalid: null },
  { name: "Nome", description: "🌱".repeat(2001), invalid: "description" },
  {
    name: ` ${"x".repeat(120)} `,
    description: ` ${"x".repeat(2000)} `,
    invalid: null,
  },
])(
  "validates the existing creation contract before journaling (case %#)",
  ({ name, description, invalid }) => {
    const issue = workspaceCreationError(name, description);
    expect(issue?.field ?? null).toBe(invalid);
    const serverContract = createWorkspaceSchema.safeParse({
      commandId: "85023b93-bf1c-47aa-a696-735e3074bed6",
      expectedActorId: "test-actor",
      name,
      description,
    });
    expect(issue === null).toBe(serverContract.success);
  },
);

it("explains the initial recovery-journal check and labels the existing limits before creation is available", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceCreation, {
      actor: "test-actor",
      onCreated: () => {},
    }),
  );
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain("Controllo delle richieste in sospeso");
  expect(html).toContain('aria-describedby="workspace-name-hint"');
  expect(html).toContain('aria-describedby="workspace-description-hint"');
  expect(html).toContain("Massimo 120 caratteri.");
  expect(html).toContain("Massimo 2.000 caratteri.");
  expect(html).toContain('<button disabled="">Crea spazio</button>');
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain("Goal obbligatorio");
});
