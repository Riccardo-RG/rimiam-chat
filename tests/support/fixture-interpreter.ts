import type { Interpreter } from "../../src/server/interpretation";
import { addressMiriam } from "../../src/shared/miriam-address";
// Offline, labelled demonstration adapter. It makes no claim of general language understanding.
export const fixtureInterpreter: Interpreter = {
  async interpret(context) {
    const content = context.trigger.content;
    if (
      content === addressMiriam("Suggerisci due passi per il test del gruppo.")
    ) {
      const origin = {
        target: null,
        candidateIndex: null,
        sourceIds: [context.trigger.id],
      };
      return {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond",
          text: "Ho due suggerimenti da valutare.",
          sourceIds: origin.sourceIds,
        },
        handoffs: [
          {
            ...origin,
            kind: "task.create",
            summary: "Preparare le domande per il primo gruppo",
            suggestedText: "Raccogliere tre domande per il test.",
          },
          {
            ...origin,
            kind: "email.prepare",
            summary: "Preparare un invito per il primo gruppo",
            suggestedText: "Invito personale al test.",
          },
        ],
      };
    }
    if (content === addressMiriam("Questa chat è solo mia?")) {
      return {
        needsMore: [],
        proposals: [],
        response: {
          mode: "respond",
          text: "Risposta di prova alla domanda sulla chat.",
          sourceIds: [context.trigger.id],
        },
      };
    }
    if (
      context.replyOnlyToSource &&
      context.objectReference?.reference.kind === "source"
    ) {
      return {
        needsMore: [],
        proposals: [],
        response: {
          mode: "respond",
          text: `Risposta di prova al messaggio: ${context.objectReference.content.slice(0, 120)}`,
          sourceIds: [context.trigger.id, context.objectReference.reference.id],
        },
      };
    }
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
