import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interpretationOutputSchema } from "../src/server/interpretation";
import { configuredStructuredModel } from "../src/server/structured-llm";

const sourceId = "7f909388-6757-431c-91ed-dd5ac196bc91";
const request = vi.fn<typeof fetch>();
const args = {
  system: "Use only the supplied synthetic source.",
  prompt: "Miriam, answer this synthetic test request.",
  schema: interpretationOutputSchema,
};
const absentOptionals = {
  proposals: [],
  needsMore: [],
  handoffs: null,
  response: null,
  organization: null,
  workControl: null,
  workIntent: null,
};
const handoff = {
  kind: "goal.change",
  summary: "Review the proposed synthetic Goal change.",
  suggestedText: "A revised synthetic Goal.",
  target: { kind: "goal", id: sourceId, version: 1, eventId: null },
  candidateIndex: null,
  sourceIds: [sourceId],
};

function providerResponse(output: unknown) {
  return Response.json({
    id: "resp_synthetic_test",
    created_at: 1,
    model: "gpt-4.1-mini",
    status: "completed",
    output: [
      {
        id: "msg_synthetic_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(output),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  });
}

type SchemaNode = Record<string, unknown>;
function objectSchemas(value: unknown): SchemaNode[] {
  if (Array.isArray(value)) return value.flatMap(objectSchemas);
  if (value === null || typeof value !== "object") return [];
  const node = value as SchemaNode;
  return [
    ...(node.properties ? [node] : []),
    ...Object.values(node).flatMap(objectSchemas),
  ];
}
function admitsNull(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const node = value as SchemaNode;
  return (
    node.type === "null" ||
    (Array.isArray(node.type) && node.type.includes("null")) ||
    (Array.isArray(node.anyOf) && node.anyOf.some(admitsNull)) ||
    (Array.isArray(node.oneOf) && node.oneOf.some(admitsNull))
  );
}

beforeEach(() => {
  vi.stubEnv("AI_MODE", "openai");
  vi.stubEnv("AI_MODEL", "gpt-4.1-mini");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  // Exercise the installed SDK while making every possible HTTP call local.
  request.mockRejectedValue(new Error("Unexpected test HTTP call"));
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("OpenAI structured output through the real SDK and local HTTP double", () => {
  it("sends a strict, recursively required schema and restores absent optional fields", async () => {
    request.mockResolvedValueOnce(providerResponse(absentOptionals));
    const result = await configuredStructuredModel()!.generateJSON(args);
    expect(result).toEqual({
      proposals: [],
      needsMore: [],
      workControl: null,
      workIntent: null,
    });
    expect(result).not.toHaveProperty("handoffs");
    expect(result).not.toHaveProperty("response");
    expect(result).not.toHaveProperty("organization");
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(options?.method).toBe("POST");
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
    const wireSchema = body.text.format.schema;
    expect(wireSchema.required.toSorted()).toEqual(
      Object.keys(interpretationOutputSchema.shape).toSorted(),
    );
    const objects = objectSchemas(wireSchema);
    expect(objects.length).toBeGreaterThan(5);
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false);
      expect((node.required as string[]).toSorted()).toEqual(
        Object.keys(node.properties as SchemaNode).toSorted(),
      );
    }
    for (const key of [
      "handoffs",
      "response",
      "organization",
      "workControl",
      "workIntent",
    ])
      expect(admitsNull(wireSchema.properties[key]), key).toBe(true);
    const targets = objects.filter(
      (node) => (node.properties as SchemaNode).eventId !== undefined,
    );
    expect(targets).toHaveLength(1);
    expect(admitsNull((targets[0].properties as SchemaNode).eventId)).toBe(
      true,
    );
    // The application schema remains unchanged and still rejects null sentinels.
    expect(interpretationOutputSchema.safeParse(absentOptionals).success).toBe(
      false,
    );
  });

  it("removes a nested optional null sentinel while preserving genuinely nullable fields", async () => {
    request.mockResolvedValueOnce(
      providerResponse({ ...absentOptionals, handoffs: [handoff] }),
    );
    const result = await configuredStructuredModel()!.generateJSON(args);
    expect(result.handoffs).toEqual([
      {
        ...handoff,
        target: { kind: "goal", id: sourceId, version: 1 },
      },
    ]);
    expect(result.handoffs?.[0].target).not.toHaveProperty("eventId");
    expect(result.handoffs?.[0].candidateIndex).toBeNull();
    expect(result.workControl).toBeNull();
    expect(result.workIntent).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retains present optional values at every level", async () => {
    const output = {
      proposals: [],
      needsMore: [],
      handoffs: [
        { ...handoff, target: { ...handoff.target, eventId: "goal:1" } },
      ],
      response: {
        mode: "respond",
        text: "A synthetic answer.",
        sourceIds: [sourceId],
      },
      organization: [{ title: "Synthetic topic", sourceIds: [sourceId] }],
      workControl: {
        workId: sourceId,
        expectedRevision: 1,
        operation: "pause",
        text: "Pause this synthetic analysis.",
      },
      workIntent: { objective: "Review the synthetic source." },
    };
    request.mockResolvedValueOnce(providerResponse(output));
    expect(await configuredStructuredModel()!.generateJSON(args)).toEqual(
      output,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...absentOptionals, needsMore: null },
    {
      ...absentOptionals,
      handoffs: [{ ...handoff, target: { ...handoff.target, version: 0 } }],
    },
    {
      ...absentOptionals,
      response: { mode: "invalid", text: "Private output", sourceIds: [] },
    },
  ])(
    "rejects output invalid under the original domain schema: %#",
    async (output) => {
      request.mockResolvedValueOnce(providerResponse(output));
      await expect(
        configuredStructuredModel()!.generateJSON(args),
      ).rejects.toMatchObject({
        code: "AI_OUTPUT_PARSE_ERROR",
        message: "AI_OUTPUT_PARSE_ERROR",
        status: 502,
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("sanitizes an HTTP 400 rejection without exposing the provider body or retrying", async () => {
    const privateMessage = "Sensitive provider request details and prompt";
    request.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            message: privateMessage,
            type: "invalid_request_error",
            param: "text.format.schema",
            code: "invalid_json_schema",
          },
        },
        { status: 400 },
      ),
    );
    const result = configuredStructuredModel()!.generateJSON(args);
    await expect(result).rejects.toMatchObject({
      code: "AI_REQUEST_REJECTED",
      message: "AI_REQUEST_REJECTED",
      status: 502,
    });
    await expect(result).rejects.not.toHaveProperty("cause");
    await expect(result).rejects.not.toHaveProperty("responseBody");
    await expect(result).rejects.not.toThrow(privateMessage);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
