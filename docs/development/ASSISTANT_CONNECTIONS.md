# Assistant connections

The Home configuration panel selects an operator-approved connection by ID. The built-in `default` uses the deployment's existing `AI_MODE`, model and endpoint. Additional models and independent agents are opt-in. The destination shown in the panel is the origin receiving the supplied conversation context. “Configured” means the adapter has the required settings. Checking the list makes no network call and does not verify reachability.

## Web workflow

Open **Home → Configura Emme**. Use **Conversazione da configurare** to switch between **Tu ed Emme** and a space you created. The selector identifies the assistant and connection used by each space. In a space, its navigation opens that space’s settings directly. The creation form also offers a connection selector. Members can inspect their space’s settings. Changes require its creator to retain an eligible account and active access.

An empty **Istruzioni personali** or **Istruzioni dello spazio** field uses the installation’s built-in communication preferences, visible under **Istruzioni predefinite di RIMIAM**. Enter English instructions and press **Salva impostazioni** to customize that style for the selected conversation. The model receives the base style first and the selected conversation’s preferences afterwards. Personal instructions apply only to the personal chat. **Usa le istruzioni predefinite** clears that conversation’s instructions and preserves its name and connection on save. The fixed system rules always apply. The Markdown download contains the effective saved instructions for that conversation, including its fixed rules. Saving checks the viewed settings version and the endpoint fingerprint.

Human chat messages retain their selected configuration when queued. A change blocks disclosure for stale attempts and publication of late replies. A person can explicitly retry under the current choice. Published conversation replies keep the assistant name used at publication. The selector covers conversational answers. Independent research, analysis, transcription, email, personal consultations of shared spaces and direct-chat summaries retain their own service and consent boundaries.

## When the assistant speaks

A contributing member chooses the shared rhythm in **Attività e argomenti → Il ritmo di Emme**. Every member sees the saved choice after reopening the space. The creator’s style instructions apply to a response once permitted. They cannot turn on participation, change who sees the reply or grant authority.

| Chat turn | Solo quando chiamata (default) | Collaborativa | Propositiva |
| --- | --- | --- | --- |
| Ordinary greeting or message addressed to a member | Quiet | Quiet | Quiet |
| Useful answer to an open group question or request | Quiet | May reply | May reply |
| Concrete risk or dependency with a supplied source | Quiet | Quiet | May flag it |
| `@Emme` or **Chiedi a Emme** on a message | May reply | May reply | May reply |

The interpreter can classify an ordinary turn as `group_request`, `material_risk` or `other`. The server checks the latest rhythm again before publishing a response, handoff or proposed work. A legacy agent that omits the classification can still answer an explicitly addressed request and, when the space opts in, a group question with a question mark. The assistant may remain quiet when an intervention adds no value.

The worker processes queued messages in source order within each space. On recovery it fences interpretations whose leases expired and restores a missing or exhausted delivery for the first queued interpretation per space. Healthy deliveries keep their existing retry schedule. An older generation cannot publish over the recovered turn.

## Register a connection

### Who pays for an invoked connection

The selector and space creation form identify the service before use. OpenAI and Anthropic API adapters use the installation’s configured API account. Ollama uses its model host. An external agent may have its own billing arrangement. RIMIAM cannot infer its tariff. Two members using the same space use the connection selected for that space. No member supplies a personal ChatGPT or Claude subscription token.

The hosted shared worker cannot use an individual's ChatGPT plan under the published user-controlled-runtime requirements. A user-controlled runtime would require a separate integration and personal consent. Anthropic’s third-party linked billing charges a Claude Console organization, separately from a chat subscription. [OpenAI plan usage, §3.1](https://openai.com/policies/sign-in-with-chatgpt-terms/) · [Anthropic linked billing](https://support.claude.com/en/articles/18467148-use-your-claude-platform-account-in-a-third-party-app)

### Operator setup

Set `RIMIAM_ASSISTANT_CONNECTIONS` to a JSON array on the Web/API and worker. Give them the same catalog and the required server-side secrets. Restart both after changing environment settings. Example entries:

```json
[
  { "id": "openai-small", "label": "OpenAI · GPT-4.1 mini", "kind": "model", "provider": "openai", "model": "gpt-4.1-mini" },
  { "id": "local-model", "label": "Local Ollama", "kind": "model", "provider": "ollama", "model": "your-installed-model", "baseURL": "http://127.0.0.1:11434" },
  { "id": "studio", "label": "Studio agent", "kind": "agent", "url": "https://agent.example.com/contribute", "tokenEnv": "RIMIAM_AGENT_STUDIO_TOKEN", "readOnly": true }
]
```

- Named OpenAI and Anthropic models use their official APIs and `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Set `provider` to `anthropic` and supply a structured-output model ID available to your account to register a Claude model. Give each model a descriptive label.
- A named Ollama adapter calls the native `/api/chat` endpoint under its base URL. Install the model separately. For models or agents on the same host as the worker, use a loopback URL. A hosted worker's localhost refers to that worker. Configure a reachable HTTPS endpoint for a separate host.
- An independent agent implements the contract below. An existing agent with its own API needs a small wrapper if its API differs. Register an endpoint without userinfo, query parameters or fragments. Use HTTPS outside loopback. The optional bearer token comes from a server variable named `RIMIAM_AGENT_…`. Keep secrets out of labels, URLs and the catalog. No browser-supplied URL, credential, or tool definition is accepted.
- Use unique, stable IDs. The catalog accepts at most 64 entries. Invalid syntax, a duplicate/reserved ID or a malformed entry hides all named connections. A missing referenced key makes that connection unavailable. An unavailable selection has no automatic fallback. A changed endpoint, model or secret reference has a different revision; rotating the value of a secret at the same reference preserves it.

## Independent agent protocol

RIMIAM posts one JSON request to the configured endpoint. The request contains `protocol: "rimiam.contribution.v1"`, the effective `system` instructions, a scoped `prompt`, the caller's `responseSchema` in JSON Schema format, and `maxOutputTokens`. Only the context assembled by that operation is included. The adapter omits RIMIAM session credentials, tool handles, callbacks and usage-scope metadata. The token identifies the configured agent endpoint.

Return HTTP 200 with exactly `{"output": …}`, where the JSON value conforms to that request's schema. For a test schema requiring a single string field named `answer`, a valid reply is `{"output":{"answer":"Blue"}}`. Real conversation turns supply a different schema. Keep the entire response within 1 MiB. RIMIAM validates the result, applies existing source and capability checks and treats it as a contribution. Returning a tool-call envelope does not execute a tool. An agent response cannot authorize an external action or adopt shared state.

Before registering an agent, configure its service to run in a read-only, isolated mode and verify its handling of retention and external disclosure. The operator's `readOnly: true` attests to that setup. RIMIAM cannot enforce what another service does internally with its own credentials. A service that cannot disable independent actions or leaks context between users is unsuitable for this connection.

Agent dispatch uses the existing invocation limits and timeout, disallows HTTP redirects, and does not retry on transport failure. Shared diagnostics record an attempt under provider `agent` and the connection ID; token counts and estimated cost are unknown. A local adapter check exercises registration, credential handling, network framing and response validation against an ephemeral loopback server using synthetic content. Run `npm test -- tests/assistant-connections.test.ts` on the development machine. A live compatibility and data-handling check for each actual service remains an operator step before using real conversations.
