# Personal conversations with Emme

Home opens the account’s last selected conversation. The reading cursor belongs to the member and conversation. Starting a new conversation requires no title; searching the history lists matching conversations for the user to reopen.

The original personal Workspace remains the account’s unique document and agenda archive. Additional personal conversations have independent message histories and retrieval scopes. They cannot receive members, appear in the shared Workspace directory, act as calendar targets, or give their owner new AI quota. The account owner and authenticated session are checked on every personal chat operation.

Choosing a shared conversation establishes an explicit, versioned consultation in the current personal chat. Answers and references are private to the requester. Retrieval, publication of the result to the requester, and later reads recheck the applicable membership admission. Ending or changing the consultation fences a pending answer. Follow-up questions may use recent private exchanges within that same selection. A former member cannot recover the group's answer by reopening the personal chat.

A private research request discloses the exact query to the search provider. The analysis stage uses the returned public excerpts, validates its citations, and persists the private result. It does not visit or independently verify full pages. The searchable conversation and Home's ready indicator lead back to the same result. Device notification requires both the ordinary push opt-in and explicit “Avvisami” for this search. Publishing the reviewed result requires a separate command at an eligible destination. A failed or interrupted inference remains available for explicit retry.

- [Contract](../../src/contracts/personal-chats.ts), [Web entry points](../../src/client/personal-chat-controls.tsx), [consultation and access guards](../../src/server/personal-chats.ts), [private research worker](../../src/server/personal-research.ts).
- [Database and authority regressions](../../tests/personal-chats.test.ts), [Web workflow](../../tests/e2e/personal-chats.spec.ts).
