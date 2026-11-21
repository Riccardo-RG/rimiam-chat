import {
  APICallError,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  zodSchema,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { admitAIInvocation } from "./ai-admission.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  beginUsage,
  finishUsage,
  type TokenUsage,
  type UsageScope,
} from "./ai-usage.ts";

export interface StructuredModel {
  generateJSON<T extends z.ZodTypeAny>(args: {
    system: string;
    prompt: string;
    schema: T;
    timeoutMs?: number;
    maxOutputTokens?: number;
    usageScope?: UsageScope;
    // Private capability cost guards must not expose activity in shared diagnostics.
    admissionScope?:
      | {
          workspace: string;
          operation:
            | "email_composition"
            | "private_recap"
            | "private_research"
            | "private_document";
          directChat?: never;
        }
      | { directChat: string; workspace?: never; operation: "direct_recap" };
  }): Promise<z.output<T>>;
}

export function parseStructuredOutput<T extends z.ZodTypeAny>(
  schema: T,
  output: unknown,
): z.output<T> {
  const result = schema.safeParse(output);
  requireThat(result.success, "AI_OUTPUT_PARSE_ERROR", 502);
  return result.data;
}

type ModelJsonSchema = Awaited<ReturnType<typeof zodSchema>["jsonSchema"]>;
type ModelJsonDefinition = NonNullable<ModelJsonSchema["properties"]>[string];

function acceptsNull(schema: ModelJsonDefinition): boolean {
  if (typeof schema === "boolean") return schema;
  return (
    schema.type === "null" ||
    (Array.isArray(schema.type) && schema.type.includes("null")) ||
    schema.enum?.includes(null) === true ||
    schema.anyOf?.some(acceptsNull) === true
  );
}

function openAIRequiredFields(
  schema: ModelJsonDefinition,
): ModelJsonDefinition {
  if (typeof schema === "boolean") return schema;
  const result = { ...schema };
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => {
        const converted = openAIRequiredFields(property);
        return [
          key,
          !schema.required?.includes(key) && !acceptsNull(property)
            ? { anyOf: [converted, { type: "null" }] }
            : converted,
        ];
      }),
    );
    result.required = Object.keys(schema.properties);
  }
  if (schema.items)
    result.items = Array.isArray(schema.items)
      ? schema.items.map(openAIRequiredFields)
      : openAIRequiredFields(schema.items);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(openAIRequiredFields);
  return result;
}

// Current model schemas use anyOf for nullable values. Only the nulls introduced
// for optional, non-nullable properties mean absence; existing nulls retain meaning.
function restoreOptionalFields(
  value: unknown,
  schema: ModelJsonDefinition,
): unknown {
  if (typeof schema === "boolean" || value === null) return value;
  if (schema.anyOf) {
    const branches = schema.anyOf.filter((branch) => !acceptsNull(branch));
    if (branches.length === 1) return restoreOptionalFields(value, branches[0]);
  }
  if (Array.isArray(value) && schema.items) {
    const items = schema.items;
    return value.map((item, index) =>
      restoreOptionalFields(
        item,
        Array.isArray(items) ? (items[index] ?? true) : items,
      ),
    );
  }
  if (typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const result: Record<string, unknown> = { ...value };
    for (const [key, property] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(result, key)) continue;
      if (
        result[key] === null &&
        !schema.required?.includes(key) &&
        !acceptsNull(property)
      )
        delete result[key];
      else result[key] = restoreOptionalFields(result[key], property);
    }
    return result;
  }
  return value;
}

async function openAIOutputSchema<T extends z.ZodTypeAny>(schema: T) {
  const original = await zodSchema(schema).jsonSchema;
  return jsonSchema<z.output<T>>(
    openAIRequiredFields(original) as ModelJsonSchema,
    {
      validate(value) {
        const parsed = schema.safeParse(restoreOptionalFields(value, original));
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );
}

function httpFailure(status: number): DomainError {
  if ([401, 403, 404].includes(status))
    return new DomainError("AI_CONFIGURATION_REQUIRED", 503);
  if (status === 429) return new DomainError("AI_RATE_LIMITED", 503);
  if (status === 408 || status === 504)
    return new DomainError("AI_TIMEOUT", 504);
  if (status >= 400 && status < 500)
    return new DomainError("AI_REQUEST_REJECTED", 502);
  return new DomainError("AI_PROVIDER_UNAVAILABLE", 503);
}

// Provider errors can contain prompts, response bodies or credentials. Only stable codes escape.
function modelFailure(error: unknown): DomainError {
  if (error instanceof DomainError)
    return new DomainError(error.code, error.status);
  if (
    error instanceof SyntaxError ||
    error instanceof z.ZodError ||
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  )
    return new DomainError("AI_OUTPUT_PARSE_ERROR", 502);
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return new DomainError("AI_TIMEOUT", 504);
  if (APICallError.isInstance(error))
    return httpFailure(error.statusCode ?? 503);
  return new DomainError("AI_PROVIDER_UNAVAILABLE", 503);
}

export type StructuredConnection =
  | {
      provider: "openai" | "anthropic";
      model: string;
      baseURL: string;
      apiKey?: string;
    }
  | { provider: "ollama"; model: string; baseURL: string }
  | { provider: "agent"; model: string; baseURL: string; token?: string };

export const providerBaseURL = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://127.0.0.1:11434",
} as const;

export function defaultStructuredConnection():
  StructuredConnection | undefined {
  const provider = process.env.AI_MODE;
  if (provider === "ollama")
    return {
      provider,
      model: process.env.OLLAMA_MODEL?.trim() ?? "",
      baseURL: process.env.OLLAMA_BASE_URL ?? providerBaseURL.ollama,
    };
  if (provider === "openai" || provider === "anthropic") {
    const prefix = provider.toUpperCase();
    return {
      provider,
      model: process.env.AI_MODEL?.trim() ?? "",
      baseURL: process.env[prefix + "_BASE_URL"] ?? providerBaseURL[provider],
      apiKey: process.env[prefix + "_API_KEY"]?.trim(),
    };
  }
}

/** Discard paths from public summaries; paths are only for transport/route identity. */
export function connectionURL(address: string): URL | undefined {
  try {
    const url = new URL(address);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function readAgentEnvelope(response: Response): Promise<unknown> {
  const limit = 1024 * 1024;
  const reader = response.body?.getReader();
  requireThat(reader, "AI_OUTPUT_PARSE_ERROR", 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError("AI_OUTPUT_PARSE_ERROR", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createStructuredModel(
  connection: StructuredConnection | undefined,
): StructuredModel | undefined {
  if (!connection || !connection.model) return undefined;
  const { provider, model } = connection;
  const base = connectionURL(connection.baseURL);
  if (!base) return undefined;
  if (connection.provider === "openai" || connection.provider === "anthropic") {
    const apiKey = connection.apiKey;
    if (!apiKey) return undefined;
    const options = {
      apiKey,
      baseURL: connection.baseURL,
      fetch: ((input, init) =>
        fetch(input, { ...init, redirect: "error" })) satisfies typeof fetch,
    };
    const languageModel =
      provider === "openai"
        ? createOpenAI(options)(model)
        : createAnthropic(options)(model);
    return {
      async generateJSON({
        system,
        prompt,
        schema,
        timeoutMs = 45000,
        maxOutputTokens = 3000,
        usageScope,
        admissionScope,
      }) {
        await admitAIInvocation(
          admissionScope?.operation ?? usageScope?.operation ?? "conversation",
          admissionScope?.workspace ?? usageScope?.workspace,
          admissionScope?.directChat,
        );
        const attempt = await beginUsage(usageScope, provider, model);
        let usage: TokenUsage | undefined;
        let outcome: "returned" | "failed" = "failed";
        try {
          const response = await generateText({
            model: languageModel,
            // Workspace history stays in PostgreSQL, not provider response storage.
            ...(provider === "openai"
              ? { providerOptions: { openai: { store: false } } }
              : {}),
            maxRetries: 0,
            maxOutputTokens,
            abortSignal: AbortSignal.timeout(timeoutMs),
            output: Output.object({
              schema:
                provider === "openai"
                  ? await openAIOutputSchema(schema)
                  : schema,
            }),
            system,
            prompt,
          });
          usage = response.totalUsage;
          requireThat(
            response.finishReason !== "length",
            "AI_OUTPUT_PARSE_ERROR",
            502,
          );
          const output = parseStructuredOutput(schema, response.output);
          outcome = "returned";
          return output;
        } catch (error) {
          if (NoObjectGeneratedError.isInstance(error)) usage ??= error.usage;
          throw modelFailure(error);
        } finally {
          await finishUsage(attempt, outcome, usage);
        }
      },
    };
  }
  if (connection.provider === "ollama" || connection.provider === "agent") {
    const agent = connection.provider === "agent" ? connection : undefined;
    const endpoint = agent
      ? base
      : new URL(`${base.href.replace(/\/$/, "")}/api/chat`);
    return {
      async generateJSON({
        system,
        prompt,
        schema,
        timeoutMs = 45000,
        maxOutputTokens = 3000,
        usageScope,
        admissionScope,
      }) {
        await admitAIInvocation(
          admissionScope?.operation ?? usageScope?.operation ?? "conversation",
          admissionScope?.workspace ?? usageScope?.workspace,
          admissionScope?.directChat,
        );
        const attempt = await beginUsage(usageScope, provider, model);
        let usage: TokenUsage | undefined;
        let outcome: "returned" | "failed" = "failed";
        try {
          const signal = AbortSignal.timeout(timeoutMs);
          const format = z.toJSONSchema(schema);
          const request = agent
            ? {
                protocol: "rimiam.contribution.v1",
                system,
                prompt,
                responseSchema: format,
                maxOutputTokens,
              }
            : {
                model,
                messages: [
                  {
                    role: "system",
                    content: `${system}\nReturn only JSON matching this schema:\n${JSON.stringify(format)}`,
                  },
                  { role: "user", content: prompt },
                ],
                stream: false,
                options: {
                  temperature: 0.2,
                  num_predict: maxOutputTokens,
                },
                format,
              };
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(agent?.token
                ? { Authorization: `Bearer ${agent.token}` }
                : {}),
            },
            signal,
            redirect: "error",
            body: JSON.stringify(request),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw httpFailure(response.status);
          }
          if (agent) {
            const envelope = parseStructuredOutput(
              z.strictObject({ output: z.json() }),
              await readAgentEnvelope(response),
            );
            const result = parseStructuredOutput(schema, envelope.output);
            outcome = "returned";
            return result;
          }
          const payload = parseStructuredOutput(
            z.object({
              message: z.object({ content: z.string() }),
              done: z.literal(true),
              done_reason: z.string().optional(),
              prompt_eval_count: z.number().int().nonnegative().optional(),
              eval_count: z.number().int().nonnegative().optional(),
            }),
            await response.json(),
          );
          usage = {
            inputTokens: payload.prompt_eval_count,
            outputTokens: payload.eval_count,
            inputTokenDetails: {
              noCacheTokens: payload.prompt_eval_count,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          };
          requireThat(
            payload.done_reason !== "length",
            "AI_OUTPUT_PARSE_ERROR",
            502,
          );
          // Do not salvage a fragment of an incomplete or otherwise invalid response.
          const output = parseStructuredOutput(
            schema,
            JSON.parse(payload.message.content),
          );
          outcome = "returned";
          return output;
        } catch (error) {
          throw modelFailure(error);
        } finally {
          await finishUsage(attempt, outcome, usage);
        }
      },
    };
  }
  return undefined;
}

export function configuredStructuredModel(): StructuredModel | undefined {
  return createStructuredModel(defaultStructuredConnection());
}

export function isStructuredModelConfigured(): boolean {
  try {
    return configuredStructuredModel() !== undefined;
  } catch {
    return false;
  }
}
