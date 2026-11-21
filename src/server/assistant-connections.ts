import { createHash } from "node:crypto";
import { z } from "zod";
import {
  connectionURL,
  createStructuredModel,
  defaultStructuredConnection,
  providerBaseURL,
  type StructuredConnection,
  type StructuredModel,
} from "./structured-llm.ts";

const common = {
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .refine((id) => id !== "default"),
  label: z.string().trim().min(1).max(100),
};
const modelName = z.string().trim().min(1).max(200);
const address = z
  .string()
  .max(2048)
  .refine((value) => {
    const url = connectionURL(value);
    return (
      !!url &&
      (url.protocol === "https:" ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  });
const entry = z.union([
  z.strictObject({
    ...common,
    kind: z.literal("model"),
    provider: z.enum(["openai", "anthropic"]),
    model: modelName,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("model"),
    provider: z.literal("ollama"),
    model: modelName,
    baseURL: address.optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("agent"),
    url: address,
    readOnly: z.literal(true),
    tokenEnv: z
      .string()
      .regex(/^RIMIAM_AGENT_[A-Z0-9_]{1,96}$/)
      .optional(),
  }),
]);
const catalog = z
  .array(entry)
  .max(64)
  .refine(
    (entries) =>
      new Set(entries.map((item) => item.id)).size === entries.length,
  );

export type AssistantConnection = {
  id: string;
  label: string;
  kind: "model" | "agent";
  provider: string;
  configured: boolean;
  destination: string;
};

type RegisteredConnection = {
  summary: AssistantConnection;
  revision: string;
  connection?: StructuredConnection;
};

function describe(
  id: string,
  label: string,
  connection?: StructuredConnection,
  secretReference?: string,
  missingSecret = false,
): RegisteredConnection {
  const endpoint = connection && connectionURL(connection.baseURL);
  const provider = connection?.provider ?? "unconfigured";
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        id,
        provider,
        endpoint?.href ?? "",
        connection?.model ?? "",
        secretReference ?? "",
      ]),
    )
    .digest("hex");
  return {
    revision,
    connection: missingSecret ? undefined : connection,
    summary: {
      id,
      label,
      kind: provider === "agent" ? "agent" : "model",
      provider,
      destination: endpoint?.origin ?? "Non configurata",
      configured: !!(
        endpoint &&
        connection?.model &&
        !missingSecret &&
        (!("apiKey" in connection) || connection.apiKey)
      ),
    },
  };
}

function readCatalog(): RegisteredConnection[] {
  const deployment = defaultStructuredConnection();
  const defaultLabel = deployment?.model
    ? `Predefinito · ${deployment.model}`
    : "Predefinito";
  const defaults = describe("default", defaultLabel, deployment);
  const raw = process.env.RIMIAM_ASSISTANT_CONNECTIONS?.trim();
  if (!raw || raw.length > 131072) return [defaults];
  let entries: z.infer<typeof catalog>;
  try {
    entries = catalog.parse(JSON.parse(raw));
  } catch {
    // Never reinterpret a malformed/duplicate ID or dispatch to another recipient.
    return [defaults];
  }
  return [
    defaults,
    ...entries.map((value) => {
      if (value.kind === "agent") {
        const token = value.tokenEnv
          ? process.env[value.tokenEnv]?.trim()
          : undefined;
        return describe(
          value.id,
          value.label,
          { provider: "agent", model: value.id, baseURL: value.url, token },
          value.tokenEnv,
          !!value.tokenEnv && !token,
        );
      }
      if (value.provider === "ollama") {
        return describe(value.id, value.label, {
          provider: "ollama",
          model: value.model,
          baseURL: value.baseURL ?? providerBaseURL.ollama,
        });
      }
      const keyName =
        value.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      return describe(
        value.id,
        value.label,
        {
          provider: value.provider,
          model: value.model,
          baseURL: providerBaseURL[value.provider],
          apiKey: process.env[keyName]?.trim(),
        },
        keyName,
      );
    }),
  ];
}

export function listAssistantConnectionsWithRevisions(): (AssistantConnection & {
  revision: string;
})[] {
  return readCatalog().map(({ summary, revision }) => ({
    ...summary,
    revision,
  }));
}

export function listAssistantConnections(): AssistantConnection[] {
  return readCatalog().map(({ summary }) => summary);
}

export function resolveAssistantConnection(
  id: string,
): StructuredModel | undefined {
  const registered = readCatalog().find(({ summary }) => summary.id === id);
  return registered?.summary.configured
    ? createStructuredModel(registered.connection)
    : undefined;
}

/** A changed recipient, model or secret reference requires a fresh selection.
 * Rotating a token for the same recipient leaves the fingerprint stable.
 */
export function assistantConnectionRevision(id: string): string | undefined {
  return readCatalog().find(({ summary }) => summary.id === id)?.revision;
}
