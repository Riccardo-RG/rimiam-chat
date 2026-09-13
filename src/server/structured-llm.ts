import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { DomainError, requireThat } from "./errors.ts";

export interface StructuredModel {
  generateJSON<T extends z.ZodTypeAny>(args: {
    system: string;
    prompt: string;
    schema: T;
    timeoutMs?: number;
    maxOutputTokens?: number;
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

export function configuredStructuredModel(): StructuredModel | undefined {
  if (process.env.AI_MODE === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const model = process.env.AI_MODEL?.trim();
    if (!apiKey || !model) return undefined;
    const provider = createAnthropic({ apiKey });
    return {
      async generateJSON({
        system,
        prompt,
        schema,
        timeoutMs = 45000,
        maxOutputTokens = 3000,
      }) {
        try {
          const response = await generateText({
            model: provider(model),
            maxRetries: 0,
            maxOutputTokens,
            abortSignal: AbortSignal.timeout(timeoutMs),
            output: Output.object({ schema }),
            system,
            prompt,
          });
          requireThat(
            response.finishReason !== "length",
            "AI_OUTPUT_PARSE_ERROR",
            502,
          );
          return parseStructuredOutput(schema, response.output);
        } catch (error) {
          throw modelFailure(error);
        }
      },
    };
  }
  if (process.env.AI_MODE === "ollama") {
    const model = process.env.OLLAMA_MODEL?.trim();
    if (!model) return undefined;
    let endpoint: URL;
    try {
      const base = new URL(
        process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      );
      if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        return undefined;
      endpoint = new URL(`${base.href.replace(/\/$/, "")}/api/chat`);
    } catch {
      return undefined;
    }
    return {
      async generateJSON({
        system,
        prompt,
        schema,
        timeoutMs = 45000,
        maxOutputTokens = 3000,
      }) {
        try {
          const signal = AbortSignal.timeout(timeoutMs);
          const format = z.toJSONSchema(schema);
          const request = {
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
          } as const;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            redirect: "error",
            body: JSON.stringify(request),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw httpFailure(response.status);
          }
          const payload = parseStructuredOutput(
            z.object({
              message: z.object({ content: z.string() }),
              done: z.literal(true),
              done_reason: z.string().optional(),
            }),
            await response.json(),
          );
          requireThat(
            payload.done_reason !== "length",
            "AI_OUTPUT_PARSE_ERROR",
            502,
          );
          // Do not salvage a fragment of an incomplete or otherwise invalid response.
          return parseStructuredOutput(
            schema,
            JSON.parse(payload.message.content),
          );
        } catch (error) {
          throw modelFailure(error);
        }
      },
    };
  }
  return undefined;
}

export function isStructuredModelConfigured(): boolean {
  try {
    return configuredStructuredModel() !== undefined;
  } catch {
    return false;
  }
}
