import { afterEach, describe, expect, it, vi } from "vitest";
import { productAssistanceSchema } from "../src/contracts/product-assistance";
import {
  PRODUCT_GUIDE_VERSION,
  productScreens,
  productScreenIds,
  resolveProductAssistance,
} from "../src/shared/product-guide";
import { productCapabilities } from "../src/server/product-capabilities";
import type { Tx } from "../src/server/db";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bounded product assistance", () => {
  it("accepts only shipped screen/field pairs and closed issue categories", () => {
    for (const screen of productScreenIds) {
      expect(productAssistanceSchema.parse({ screen })).toEqual({ screen });
      for (const field of productScreens[screen].fields) {
        expect(
          productAssistanceSchema.parse({
            screen,
            field: field.id,
            issue: "required",
          }),
        ).toEqual({ screen, field: field.id, issue: "required" });
      }
    }
    for (const invalid of [
      { screen: "mailbox_connection" },
      { screen: "constructor" },
      { screen: "tasks", field: "body" },
      { screen: "email", field: "privateDraftContents" },
      { screen: "email", issue: "raw provider error: secret" },
      { screen: "email", field: "body", value: "private text" },
      { screen: "email", privateConnection: true },
      { screen: "tasks", dom: "<input value='secret'>" },
    ]) {
      expect(productAssistanceSchema.safeParse(invalid).success).toBe(false);
      expect(resolveProductAssistance(invalid)).toBeNull();
    }
  });

  it("reconstructs canonical help instead of echoing any user-supplied content", () => {
    const result = resolveProductAssistance({
      screen: "tasks",
      field: "dueAt",
      issue: "required",
    });
    expect(result).toMatchObject({
      guideVersion: PRODUCT_GUIDE_VERSION,
      screen: "tasks",
      label: "Task e follow-up",
      field: { id: "dueAt", requirement: "optional" },
      issue: "required",
    });
    expect(result?.issueExplanation).toContain("Do not claim");
    expect(result).not.toHaveProperty("fields");
    const overview = resolveProductAssistance({ screen: "workstreams" });
    expect(overview?.fields).toEqual(productScreens.workstreams.fields);
    expect(overview).not.toHaveProperty("field");
  });

  it("fails closed for malformed saved metadata", () => {
    for (const input of [
      undefined,
      null,
      [],
      "email",
      {},
      { screen: "email", field: null },
      { screen: "email", issue: "constructor" },
      { screen: "email", issue: null },
    ])
      expect(resolveProductAssistance(input)).toBeNull();
  });

  it("keeps actual form prerequisites and privacy limits explicit", () => {
    const brief = resolveProductAssistance({ screen: "artifacts" });
    expect(brief?.instructions).toContain("at least one accepted information");
    expect(
      productScreens.tasks.fields.find((f) => f.id === "reason")?.requirement,
    ).toBe("conditional");
    expect(
      productScreens.email.fields.find((f) => f.id === "subject")?.requirement,
    ).toBe("optional");
    expect(
      productScreens.email.fields.find((f) => f.id === "to")?.explanation,
    ).toContain("20 unique recipients in total");
    expect(productScreens.email.instructions).toContain(
      "private to their owner",
    );
    expect(productScreens.information.instructions).toContain(
      "independently of project mandates",
    );
    expect(productScreens.workspace_links.instructions).toContain(
      "does not merge",
    );
  });
});

const environmentKeys = [
  "AI_MODE",
  "AI_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OLLAMA_MODEL",
  "RESEARCH_PROVIDER",
  "BRAVE_SEARCH_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MAIL_PROVIDER",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "TRANSCRIPTION_PROVIDER",
  "TRANSCRIPTION_MODEL",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_STORAGE_BUCKET",
  "CALL_STORAGE_ACCESS_KEY",
  "CALL_STORAGE_SECRET_KEY",
  "CALL_STORAGE_REGION",
] as const;
function clearConfiguration() {
  for (const key of environmentKeys) vi.stubEnv(key, undefined);
}
function database(rows: { contributes: boolean }[] = []) {
  const query = vi.fn<
    (sql: string, parameters: unknown[]) => Promise<{ rows: typeof rows }>
  >(async () => ({ rows }));
  return { tx: { query } as unknown as Tx, query };
}

describe("runtime product capabilities", () => {
  it("reports missing configuration without hiding internal preparation or claiming authority", async () => {
    clearConfiguration();
    const { tx, query } = database([{ contributes: true }]);
    const result = await productCapabilities(tx, "workspace-a", "person-a");
    expect(Object.values(result.configuration)).toEqual(Array(9).fill(false));
    expect(result.participation.canContribute).toBe(true);
    expect(
      result.actions.find((a) => a.id === "workstream.create"),
    ).toMatchObject({ available: true, execute: "conversation" });
    expect(result.actions.find((a) => a.id === "email.draft")).toMatchObject({
      available: true,
      prepare: true,
    });
    expect(result.actions.find((a) => a.id === "email.send")).toMatchObject({
      available: false,
      prepare: true,
      execute: "commit_point",
    });
    expect(result.boundaries.join(" ")).toContain("every command revalidates");
    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("m.workspace_id=$1"),
      ["workspace-a", "person-a"],
    );
  });

  it("only queries current eligible membership, never private service state", async () => {
    clearConfiguration();
    const { tx, query } = database([{ contributes: false }]);
    const result = await productCapabilities(tx, "workspace-a", "person-a");
    expect(result.participation).toEqual({
      hasHumanActor: true,
      activeEligibleMember: true,
      canContribute: false,
    });
    expect(result.actions.every((a) => !a.available && a.explain)).toBe(true);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('u."emailVerified"');
    expect(sql).toContain("m.active");
    expect(sql).toContain("u.eligible");
    expect(sql).not.toMatch(/connection|draft|observation|credential|secret/i);
  });

  it("does not infer contribution from an actor id or an autonomous trigger", async () => {
    clearConfiguration();
    const { tx, query } = database();
    const absent = await productCapabilities(
      tx,
      "workspace-a",
      "former-member",
    );
    expect(absent.participation).toMatchObject({
      activeEligibleMember: false,
      canContribute: false,
    });
    expect(absent.actions.every((a) => !a.available)).toBe(true);
    query.mockClear();
    const autonomous = await productCapabilities(tx, "workspace-a", null);
    expect(autonomous.participation).toEqual({
      hasHumanActor: false,
      activeEligibleMember: false,
      canContribute: false,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports presence without network calls, credential values or private account claims", async () => {
    clearConfiguration();
    const sentinel = "private-credential-sentinel";
    const configured = {
      AI_MODE: "openai",
      AI_MODEL: "configured-test-model",
      OPENAI_API_KEY: sentinel,
      RESEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: sentinel,
      GOOGLE_OAUTH_CLIENT_ID: sentinel,
      GOOGLE_OAUTH_CLIENT_SECRET: sentinel,
      BETTER_AUTH_SECRET: "a".repeat(40),
      BETTER_AUTH_URL: "https://workspace.example.test",
      MAIL_PROVIDER: "resend",
      RESEND_API_KEY: sentinel,
      MAIL_FROM: "private@example.test",
      TRANSCRIPTION_PROVIDER: "openai",
      TRANSCRIPTION_MODEL: "configured-transcription-model",
      LIVEKIT_URL: "wss://private.example.test",
      LIVEKIT_API_KEY: sentinel,
      LIVEKIT_API_SECRET: sentinel,
      CALL_STORAGE_BUCKET: sentinel,
      CALL_STORAGE_ACCESS_KEY: sentinel,
      CALL_STORAGE_SECRET_KEY: sentinel,
      CALL_STORAGE_REGION: "region-sentinel",
    };
    for (const [key, value] of Object.entries(configured))
      vi.stubEnv(key, value);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No provider calls allowed"));
    const { tx } = database([{ contributes: true }]);
    const result = await productCapabilities(tx, "workspace-a", "person-a");
    expect(Object.values(result.configuration)).toEqual(Array(9).fill(true));
    expect(fetch).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    for (const secret of [
      sentinel,
      "private@example.test",
      "private.example.test",
      "configured-test-model",
      "region-sentinel",
    ])
      expect(serialized).not.toContain(secret);
    expect(result.boundaries.join(" ")).toContain(
      "never verified connectivity",
    );
    expect(result.actions.find((a) => a.id === "email.send")?.limits).toContain(
      "Private connection state is unknown",
    );
  });

  it("treats malformed Google configuration as unavailable without leaking it", async () => {
    clearConfiguration();
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
    vi.stubEnv("BETTER_AUTH_URL", "not a valid url");
    const { tx } = database([{ contributes: true }]);
    const result = await productCapabilities(tx, "workspace-a", "person-a");
    expect(result.configuration.email).toBe(false);
    expect(result.configuration.calendar).toBe(false);
    expect(JSON.stringify(result)).not.toContain("not a valid url");
  });
});
