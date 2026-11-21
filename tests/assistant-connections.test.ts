import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  assistantConnectionRevision,
  listAssistantConnections,
  resolveAssistantConnection,
} from "../src/server/assistant-connections";
import { admitAIInvocation } from "../src/server/ai-admission";
import { beginUsage, finishUsage } from "../src/server/ai-usage";

vi.mock("../src/server/ai-admission", () => ({ admitAIInvocation: vi.fn() }));
vi.mock("../src/server/ai-usage", () => ({
  beginUsage: vi.fn(),
  finishUsage: vi.fn(),
}));
const args = {
  system: "Use the synthetic material only.",
  prompt: "What is the synthetic colour?",
  schema: z.strictObject({ answer: z.string() }),
};
const agent = {
  id: "studio",
  label: "Studio",
  kind: "agent",
  url: "https://agent.example.com/private-route",
  readOnly: true,
};
function configure(...entries: unknown[]) {
  vi.stubEnv("RIMIAM_ASSISTANT_CONNECTIONS", JSON.stringify(entries));
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("installation assistant catalog", () => {
  it("lists operator-approved connections; a secret alone never registers a recipient", () => {
    vi.stubEnv("AI_MODE", "openai");
    vi.stubEnv("AI_MODEL", "default-model");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("RIMIAM_AGENT_STUDIO_TOKEN", "synthetic-token");
    configure(
      {
        id: "local",
        label: "Ollama",
        kind: "model",
        provider: "ollama",
        model: "installed",
      },
      {
        id: "claude",
        label: "Claude",
        kind: "model",
        provider: "anthropic",
        model: "configured",
      },
      { ...agent, tokenEnv: "RIMIAM_AGENT_STUDIO_TOKEN" },
    );
    expect(
      listAssistantConnections().map((c) => [c.id, c.kind, c.configured]),
    ).toEqual([
      ["default", "model", true],
      ["local", "model", true],
      ["claude", "model", false],
      ["studio", "agent", true],
    ]);
    expect(listAssistantConnections().at(-1)?.destination).toBe(
      "https://agent.example.com",
    );
    const summary = JSON.stringify(listAssistantConnections());
    for (const value of [
      "synthetic-key",
      "synthetic-token",
      "private-route",
      "RIMIAM_AGENT_",
    ])
      expect(summary).not.toContain(value);
    expect(resolveAssistantConnection("claude")).toBeUndefined();
    expect(
      resolveAssistantConnection("https://arbitrary.example.com"),
    ).toBeUndefined();
    expect(resolveAssistantConnection("default")).toBeDefined();
    expect(resolveAssistantConnection("local")).toBeDefined();
    vi.stubEnv("RIMIAM_AGENT_STUDIO_TOKEN", "");
    expect(resolveAssistantConnection("studio")).toBeUndefined();
  });

  it.each([
    [{ ...agent, readOnly: false }],
    [{ ...agent, tokenEnv: "DATABASE_URL" }],
    [{ ...agent, url: "https://token@provider.example.com" }],
    [{ ...agent, url: "https://provider.example.com?q=secret" }],
    [{ ...agent, url: "http://provider.example.com" }],
    [agent, agent],
    [{ ...agent, id: "default" }],
    [{ ...agent, apiKey: "synthetic" }],
  ])(
    "denies ambiguous or unsafe settings without dispatch %#",
    (...entries) => {
      configure(...entries);
      expect(listAssistantConnections().map((c) => c.id)).toEqual(["default"]);
      expect(resolveAssistantConnection("studio")).toBeUndefined();
      expect(admitAIInvocation).not.toHaveBeenCalled();
    },
  );

  it("pins endpoint/model and secret reference without invalidating a selection on token rotation", () => {
    configure({ ...agent, tokenEnv: "RIMIAM_AGENT_STUDIO_TOKEN" });
    const original = assistantConnectionRevision("studio");
    vi.stubEnv("RIMIAM_AGENT_STUDIO_TOKEN", "rotated");
    expect(assistantConnectionRevision("studio")).toBe(original);
    configure({
      ...agent,
      tokenEnv: "RIMIAM_AGENT_STUDIO_TOKEN",
      url: "https://agent.example.com/different",
    });
    expect(assistantConnectionRevision("studio")).not.toBe(original);
    configure({ ...agent, tokenEnv: "RIMIAM_AGENT_OTHER" });
    expect(assistantConnectionRevision("studio")).not.toBe(original);
    configure({
      id: "model",
      label: "Model",
      kind: "model",
      provider: "openai",
      model: "first",
    });
    const first = assistantConnectionRevision("model");
    configure({
      id: "model",
      label: "Model",
      kind: "model",
      provider: "openai",
      model: "second",
    });
    expect(assistantConnectionRevision("model")).not.toBe(first);
    expect(assistantConnectionRevision("retired")).toBeUndefined();
  });

  it("isolates two simultaneous model selections without changing deployment defaults", async () => {
    vi.stubEnv("AI_MODE", "fixture");
    configure(
      {
        id: "one",
        label: "One",
        kind: "model",
        provider: "ollama",
        model: "first-model",
        baseURL: "http://127.0.0.1:18100",
      },
      {
        id: "two",
        label: "Two",
        kind: "model",
        provider: "ollama",
        model: "second-model",
        baseURL: "http://127.0.0.1:18200",
      },
    );
    const request = vi.fn(async (_url: URL, options: RequestInit) => {
      const { model } = JSON.parse(String(options.body));
      return Response.json({
        message: { content: JSON.stringify({ answer: model }) },
        done: true,
      });
    });
    vi.stubGlobal("fetch", request);
    const results = await Promise.all(
      ["one", "two"].map((id) =>
        resolveAssistantConnection(id)!.generateJSON(args),
      ),
    );
    expect(results).toEqual([
      { answer: "first-model" },
      { answer: "second-model" },
    ]);
    expect(request.mock.calls.map(([url]) => url.href)).toEqual([
      "http://127.0.0.1:18100/api/chat",
      "http://127.0.0.1:18200/api/chat",
    ]);
    expect(resolveAssistantConnection("default")).toBeUndefined();
  });

  it("executes the documented wire contract against a loopback server with synthetic input", async () => {
    let body: Record<string, unknown> | undefined;
    let auth: string | undefined;
    const server = createServer(async (req, res) => {
      auth = req.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      body = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output: { answer: "Blue" } }));
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contribute`;
      vi.stubEnv("RIMIAM_AGENT_STUDIO_TOKEN", "synthetic-token");
      configure({ ...agent, url, tokenEnv: "RIMIAM_AGENT_STUDIO_TOKEN" });
      const usageScope = {
        operation: "conversation" as const,
        workspace: "private-diagnostic-id",
      };
      expect(
        await resolveAssistantConnection("studio")!.generateJSON({
          ...args,
          usageScope,
        }),
      ).toEqual({ answer: "Blue" });
      expect(auth).toBe("Bearer synthetic-token");
      expect(body).toEqual({
        protocol: "rimiam.contribution.v1",
        prompt: args.prompt,
        system: args.system,
        maxOutputTokens: 3000,
        responseSchema: expect.objectContaining({ required: ["answer"] }),
      });
      expect(admitAIInvocation).toHaveBeenCalledExactlyOnceWith(
        "conversation",
        usageScope.workspace,
        undefined,
      );
      expect(beginUsage).toHaveBeenCalledExactlyOnceWith(
        usageScope,
        "agent",
        "studio",
      );
      expect(finishUsage).toHaveBeenCalledExactlyOnceWith(
        undefined,
        "returned",
        undefined,
      );
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });
  it.each([
    { output: { answer: "Blue" }, toolCalls: [{ name: "send" }] },
    { output: { answer: "Blue", unexpected: "write" } },
    { output: { answer: 7 } },
    { output: { answer: "x".repeat(1024 * 1024) } },
  ])(
    "rejects invalid, unsolicited or oversized responses without replay %#",
    async (payload) => {
      configure(agent);
      const fetchDouble = vi.fn().mockResolvedValue(Response.json(payload));
      vi.stubGlobal("fetch", fetchDouble);
      await expect(
        resolveAssistantConnection("studio")!.generateJSON(args),
      ).rejects.toMatchObject({ code: "AI_OUTPUT_PARSE_ERROR" });
      expect(fetchDouble).toHaveBeenCalledTimes(1);
      expect(fetchDouble.mock.calls[0][1].redirect).toBe("error");
      expect(finishUsage).toHaveBeenCalledWith(undefined, "failed", undefined);
    },
  );
  it("does not transport prompts when admission is denied", async () => {
    configure(agent);
    const fetchDouble = vi.fn();
    vi.stubGlobal("fetch", fetchDouble);
    vi.mocked(admitAIInvocation).mockRejectedValueOnce(new Error("limit"));
    await expect(
      resolveAssistantConnection("studio")!.generateJSON(args),
    ).rejects.toThrow("limit");
    expect(fetchDouble).not.toHaveBeenCalled();
  });
});
