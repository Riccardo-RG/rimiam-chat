import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { configuredMediaExtractor } from "../src/server/media-provider";

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));

const input = {
  kind: "image" as const,
  filename: "receipt.png",
  mediaType: "image/png",
  bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  allowModelProcessing: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("OpenAI image boundary", () => {
  it("requires explicit disclosure and complete configuration without a provider call", async () => {
    vi.stubEnv("AI_MODE", "openai");
    vi.stubEnv("AI_MODEL", "gpt-4.1-mini");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      configuredMediaExtractor().extract(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "AI_CONFIGURATION_REQUIRED" });
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    await expect(
      configuredMediaExtractor().extract(
        { ...input, allowModelProcessing: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "MEDIA_DISCLOSURE_REQUIRED" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("sends only the disclosed image and keeps provider provenance unaccepted", async () => {
    vi.stubEnv("AI_MODE", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "gpt-4.1-mini");
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        text: "Ricevuta",
        uncertainty: "Testo parziale.",
        needsInput: "",
      },
    } as Awaited<ReturnType<typeof generateText>>);
    expect(
      await configuredMediaExtractor().extract(
        input,
        new AbortController().signal,
      ),
    ).toMatchObject({
      text: "Ricevuta",
      provider: "openai-vision/gpt-4.1-mini",
    });
    const request = vi.mocked(generateText).mock.calls[0][0];
    expect(request.model).toMatchObject({
      provider: "openai.responses",
      modelId: "gpt-4.1-mini",
    });
    expect(request.maxRetries).toBe(0);
    expect(request.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "file", data: input.bytes, mediaType: input.mediaType },
        ],
      },
    ]);
    expect(request).not.toHaveProperty("tools");
  });
});
