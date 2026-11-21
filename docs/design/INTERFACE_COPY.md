# RIMIAM interface copy

The conversation list is the starting point on an authenticated Home. Its rows give priority to the name, new messages and mentions. Personal shortcuts follow the list. Today comes last and can be collapsed. The same order applies on Web, iOS and Android. Buttons can have a short visible label and a longer accessible name describing the action.

## Decisions from the 21 November Web review

| Journey | Wording and reason |
| --- | --- |
| Home and personal tools | Show “Personale” and “Solo io” together. Short labels such as “Documenti” are unambiguous in that section. A default model name adds little to every chat preview. Connection details belong in assistant settings. |
| Registration, account recovery and invitations | Specify which link to open and which email address to use. Provide the same recovery guidance whether an account exists or not. Distinguish an invitation available by link from an email sent or received. |
| Conversation and assistant | Keep a recorded failure with the request it affected. Explain whether the message is saved and what the person can do next. An ordinary message, a background reading or a delay alone is insufficient evidence of a failed reply. Preserve a custom assistant name when the request or current settings identify it. |
| Interrupted submissions | An action whose receipt was lost is a “richiesta” on the device. “Verifica esito” checks the existing action. “Rimuovi da questo dispositivo” dismisses its local entry. Reserve “promemoria” for an actual scheduled reminder. |
| Shared material, tasks and decisions | Use the destination that appears in navigation, such as “Condivisi” or “In programma”. Explain what completing a task, checking a document item, sharing a source or approving a decision actually changes. |
| Email and calendar | Distinguish private reading, drafts, sharing with the space and transmission to an outside service. Label each action with its effect, for example “Prepara risposta” and “Verifica l’invio”. |
| Errors and feedback | Publish a readable reason for a known failure. An unknown server error code gets recovery guidance. Explain who can read feedback before it is submitted. |

Use Italian source strings and their English catalogue entries together. Translate authored controls, help, status and error descriptions. Treat member content, historical messages, names and provider identifiers as opaque values. For a sentence with a name, use one translated template with a placeholder so the other language can put the name in the right place. Keep explicit consent and confirmation wording tied to the operation that records it.

The review inventoried source text in Web routes, components and shared presentation helpers, including conditional and recovery paths. A source inventory cannot establish that each state has been exercised. [Browser Home regression](../../tests/e2e/home-priority.spec.ts) · [Account recovery journey](../../tests/e2e/account.spec.ts) · [Interrupted submissions](../../tests/e2e/command-recovery.spec.ts) · [Language switching](../../tests/e2e/ui-language.spec.ts) · [Assistant failure attribution](../../tests/assistant-request-failures.test.ts)
