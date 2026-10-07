import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  assistanceLabel,
  assistanceQuestion,
  AssistanceReference,
  ProductHelp,
  ProductHelpProvider,
} from "../src/client/product-help";
import { assistanceForMessage } from "../src/client/product-help-draft";
import type { ProductAssistance } from "../src/contracts/product-assistance";
import { WorkspaceLayer } from "../src/client/workspace-layer";

it("shows explicitly selected screen, actual field and issue without attaching input values", () => {
  const context: ProductAssistance = {
    screen: "tasks",
    field: "title",
    issue: "required",
  };
  expect(assistanceLabel(context)).toBe(
    "Task e follow-up · Attività · Campo obbligatorio",
  );
  expect(assistanceQuestion(context)).toContain("@RIMIAM");
  const html = renderToStaticMarkup(
    createElement(AssistanceReference, { context, remove: () => {} }),
  );
  expect(html).toContain("Rimuovi il riferimento di aiuto dal messaggio");
  expect(html).toContain("Aiuto su:");
});

it("offers static fields and an explicit prepare action without making help controls form submission values", () => {
  const html = renderToStaticMarkup(
    createElement(
      ProductHelpProvider,
      { ask: () => {} },
      createElement(ProductHelp, {
        screen: "email",
        field: "subject",
      }),
    ),
  );
  expect(html).toContain('value="subject" selected=""');
  expect(html).toContain("senza i valori del");
  expect(html).toContain('type="button"');
  expect(html).not.toContain(" name=");
  expect(html).not.toContain("<form");
  expect(
    renderToStaticMarkup(createElement(ProductHelp, { screen: "email" })),
  ).toBe("");
});

it("fences help metadata to the current draft scope and excludes feedback and empty drafts", () => {
  const context: ProductAssistance = {
    screen: "calendar",
    field: "start",
    issue: "invalid",
  };
  const help = { context, scope: "workspace-a:filone:2" };
  const draft = { text: "Come inserisco la data?", scope: help.scope };
  expect(assistanceForMessage(help, draft, help.scope)).toEqual(context);
  expect(assistanceForMessage(help, draft, "workspace-b:filone:2")).toBeNull();
  expect(assistanceForMessage(help, draft, "workspace-a:filone:3")).toBeNull();
  expect(
    assistanceForMessage(help, { ...draft, scope: "old" }, help.scope),
  ).toBeNull();
  expect(
    assistanceForMessage(help, { ...draft, text: " " }, help.scope),
  ).toBeNull();
  expect(
    assistanceForMessage(
      help,
      { ...draft, text: "/feedback La data è difficile" },
      help.scope,
    ),
  ).toBeNull();
  expect(assistanceForMessage(null, draft, help.scope)).toBeNull();
});

it("keeps the same layer element and form subtree across modal, docked and suspended presentation", () => {
  for (const docked of [false, true]) {
    for (const suspended of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(
          WorkspaceLayer,
          { title: "Email", close: () => {}, docked, suspended },
          createElement(
            "form",
            null,
            createElement("input", { defaultValue: "local-only-draft" }),
          ),
        ),
      );
      expect(html).toMatch(/^<dialog /);
      expect(html).toContain('<form><input value="local-only-draft"/></form>');
    }
  }
});
