import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APICallError, generateText, NoOutputGeneratedError } from "ai";
import {
  configuredStructuredModel,
  isStructuredModelConfigured,
} from "../src/server/structured-llm";

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));
const schema = z
  .object({ answer: z.string().min(1), citations: z.array(z.string()) })
  .strict();
const args = {
  system: "Use only supplied context.",
  prompt: "Shared source",
  schema,
};
const value = { answer: "A qualified answer", citations: ["source-1"] };
const request = vi.fn<typeof fetch>();
async function safeFailure(result: Promise<unknown>, code: string) {
  await expect(result).rejects.toMatchObject({ code, message: code });
  await expect(result).rejects.not.toHaveProperty("cause");
}
function ollama() {
  vi.stubEnv("AI_MODE", "ollama");
  vi.stubEnv("OLLAMA_MODEL", "test-model");
  vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/");
  vi.stubGlobal("fetch", request);
  return configuredStructuredModel()!;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("structured model boundary (no real provider or database)", () => {
  it("sends the requested schema and only supplied context to the configured endpoint", async () => {
    const model = ollama();
    request.mockResolvedValueOnce(
      Response.json({
        message: { content: JSON.stringify(value) },
        done: true,
      }),
    );
    expect(await model.generateJSON(args)).toEqual(value);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.format).toMatchObject({
      type: "object",
      required: ["answer", "citations"],
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: "user", content: args.prompt });
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBe(false);
  });

  it.each([
    { message: { content: "not JSON" }, done: true },
    {
      message: { content: JSON.stringify({ answer: "missing citations" }) },
      done: true,
    },
    { message: { content: JSON.stringify(value) }, done: false },
    {
      message: { content: JSON.stringify(value) },
      done: true,
      done_reason: "length",
    },
    {
      message: {
        content: `Incomplete answer ${JSON.stringify(value)} trailing data`,
      },
      done: true,
    },
    { message: { content: 123 }, done: true },
  ])(
    "rejects malformed, incomplete or nonconforming output without salvaging data: %#",
    async (payload) => {
      const model = ollama();
      request.mockResolvedValueOnce(Response.json(payload));
      await expect(model.generateJSON(args)).rejects.toMatchObject({
        code: "AI_OUTPUT_PARSE_ERROR",
        message: "AI_OUTPUT_PARSE_ERROR",
        status: 502,
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [401, "AI_CONFIGURATION_REQUIRED"],
    [404, "AI_CONFIGURATION_REQUIRED"],
    [429, "AI_RATE_LIMITED"],
    [400, "AI_REQUEST_REJECTED"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
    [504, "AI_TIMEOUT"],
  ])(
    "classifies HTTP %s without echoing provider data or retrying",
    async (status, code) => {
      const model = ollama();
      request.mockResolvedValueOnce(
        new Response("sensitive provider body", { status: Number(status) }),
      );
      await safeFailure(model.generateJSON(args), String(code));
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [new DOMException("private prompt", "TimeoutError"), "AI_TIMEOUT"],
    [
      new TypeError("network error with private URL"),
      "AI_PROVIDER_UNAVAILABLE",
    ],
  ])("sanitizes transport failure %#", async (error, code) => {
    const model = ollama();
    request.mockRejectedValueOnce(error);
    await safeFailure(model.generateJSON(args), String(code));
  });

  it("does not claim readiness or contact a provider with incomplete configuration", () => {
    ollama();
    vi.stubEnv("OLLAMA_MODEL", " ");
    expect(configuredStructuredModel()).toBeUndefined();
    expect(isStructuredModelConfigured()).toBe(false);
    vi.stubEnv("AI_MODE", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MODEL", "test-model");
    expect(configuredStructuredModel()).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it.each([
    "file:///tmp/model",
    "http://user:secret@127.0.0.1:11434",
    "http://localhost:11434?secret=abc",
    "invalid-url",
  ])(
    "rejects invalid or credential-bearing endpoint configuration %#",
    (url) => {
      ollama();
      vi.stubEnv("OLLAMA_BASE_URL", url);
      expect(isStructuredModelConfigured()).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("keeps Anthropic validation, no SDK retries and safe error categories", async () => {
    vi.stubEnv("AI_MODE", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "test-model");
    const model = configuredStructuredModel()!;
    const generate = vi.mocked(generateText);
    generate.mockResolvedValueOnce({
      output: value,
      finishReason: "stop",
    } as Awaited<ReturnType<typeof generateText>>);
    expect(await model.generateJSON(args)).toEqual(value);
    expect(generate.mock.calls[0][0]).toMatchObject({
      maxRetries: 0,
      system: args.system,
      prompt: args.prompt,
    });
    generate.mockRejectedValueOnce(
      new NoOutputGeneratedError({ message: "sensitive model result" }),
    );
    await safeFailure(model.generateJSON(args), "AI_OUTPUT_PARSE_ERROR");
    generate.mockRejectedValueOnce(
      new APICallError({
        message: "sensitive transport data",
        url: "https://example.invalid",
        requestBodyValues: {},
        statusCode: 429,
      }),
    );
    await safeFailure(model.generateJSON(args), "AI_RATE_LIMITED");
    generate.mockResolvedValueOnce({
      output: value,
      finishReason: "length",
    } as Awaited<ReturnType<typeof generateText>>);
    await expect(model.generateJSON(args)).rejects.toMatchObject({
      code: "AI_OUTPUT_PARSE_ERROR",
    });
  });
});
