import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
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
  if (process.env.AI_MODE === "openai" || process.env.AI_MODE === "anthropic") {
    const provider = process.env.AI_MODE;
    const apiKey = (
      process.env.AI_MODE === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.ANTHROPIC_API_KEY
    )?.trim();
    const model = process.env.AI_MODEL?.trim();
    if (!apiKey || !model) return undefined;
    const languageModel =
      process.env.AI_MODE === "openai"
        ? createOpenAI({ apiKey })(model)
        : createAnthropic({ apiKey })(model);
    return {
      async generateJSON({
        system,
        prompt,
        schema,
        timeoutMs = 45000,
        maxOutputTokens = 3000,
        usageScope,
      }) {
        const attempt = await beginUsage(usageScope, provider, model);
        let usage: TokenUsage | undefined;
        let outcome: "returned" | "failed" = "failed";
        try {
          const response = await generateText({
            model: languageModel,
            maxRetries: 0,
            maxOutputTokens,
            abortSignal: AbortSignal.timeout(timeoutMs),
            output: Output.object({ schema }),
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
        usageScope,
      }) {
        const attempt = await beginUsage(usageScope, "ollama", model);
        let usage: TokenUsage | undefined;
        let outcome: "returned" | "failed" = "failed";
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

export function isStructuredModelConfigured(): boolean {
  try {
    return configuredStructuredModel() !== undefined;
  } catch {
    return false;
  }
}
