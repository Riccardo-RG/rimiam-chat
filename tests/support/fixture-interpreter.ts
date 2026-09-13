import type { Interpreter } from "../../src/server/interpretation";
// Offline, labelled demonstration adapter. It makes no claim of general language understanding.
export const fixtureInterpreter: Interpreter = {
  async interpret(context) {
    const content = context.trigger.content;
    const normative =
      /\b(decidiamo|spenderemo|impegniamo|non spender|budget massimo|ci impegniamo|we will|we commit|must|shall)\b/i.test(
        content,
      );
    const descriptive =
      /\b(costa|affitto|rent|costs|disponibile)\b/i.test(content) && !normative;
    return {
      needsMore: [],
      proposals: [
        {
          subject: /\b(affitto|locale|rent)\b/i.test(content)
            ? "Affitto del locale"
            : /budget/i.test(content)
              ? "Budget"
              : "Nota dalla conversazione",
          content,
          classification: content.trim().endsWith("?")
            ? "question"
            : normative
              ? "normative"
              : descriptive
                ? "descriptive"
                : "uncertain",
          origin: "attributed",
          qualification:
            context.trigger.qualification ??
            "Affermazione della persona citata; non verificata indipendentemente.",
          sourceIds: [context.trigger.id],
        },
      ],
    };
  },
};
