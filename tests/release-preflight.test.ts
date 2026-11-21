import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configurationPresence,
  migrationChecks,
  preflightConnection,
  preflightMain,
  runReleasePreflight,
} from "../scripts/release-preflight";

afterEach(() => vi.restoreAllMocks());

describe("read-only release preflight", () => {
  it("requires explicit remote inspection and rejects connection-string host overrides", () => {
    expect(() =>
      preflightConnection("postgres://test:secret@db.example.test/app"),
    ).toThrow("REMOTE_DATABASE_READ_REQUIRES_EXPLICIT_FLAG");
    expect(
      preflightConnection(
        "postgres://test:secret@db.example.test/app?sslmode=verify-full",
        { allowRemoteRead: true },
      ).target,
    ).toBe("remote-explicit");
    expect(() =>
      preflightConnection(
        "postgres://test:secret@127.0.0.1/app?host=db.example.test",
        { allowRemoteRead: true },
      ),
    ).toThrow("DATABASE_URL_QUERY_OPTION_REJECTED");
    expect(() =>
      preflightConnection(
        "postgres://test:secret@127.0.0.1/app?options=-csearch_path=other",
      ),
    ).toThrow("DATABASE_URL_QUERY_OPTION_REJECTED");
    expect(() =>
      preflightConnection("https://db.example.test/app", {
        allowRemoteRead: true,
      }),
    ).toThrow("DATABASE_URL_INVALID");
    expect(() => preflightConnection("postgres:///app")).toThrow(
      "DATABASE_URL_INVALID",
    );
  });

  it("selects only the isolated local test database without a DNS hostname override", () => {
    const value = preflightConnection(
      "postgres://test:secret@localhost:54329/app",
      { testDatabase: true },
    );
    const url = new URL(value.connectionString);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/miriam_test");
    expect(() =>
      preflightConnection("postgres://test:secret@db.example.test/app", {
        testDatabase: true,
        allowRemoteRead: true,
      }),
    ).toThrow("REMOTE_DATABASE_READ_REQUIRES_EXPLICIT_FLAG");
  });

  it("reports presence only and sanitizes failures without echoing credentials or arguments", async () => {
    const secret = "must-never-appear-in-a-report";
    const flags = configurationPresence({
      OPENAI_API_KEY: secret,
      BETTER_AUTH_SECRET: secret,
      MAIL_FROM: "private@example.test",
      AI_MODE: "unconfigured",
      WEB_PUSH_ENABLED: "true",
      NATIVE_PUSH_ENABLED: "true",
      APNS_PRIVATE_KEY: secret,
      FCM_PROJECT_ID: "test-installation",
    });
    expect(flags.variablesPresent.OPENAI_API_KEY).toBe(true);
    expect(flags.variablesPresent.ANTHROPIC_API_KEY).toBe(false);
    expect(flags.webPushEnabled).toBe(true);
    expect(flags.nativePushEnabled).toBe(true);
    expect(flags.variablesPresent.APNS_PRIVATE_KEY).toBe(true);
    expect(flags.variablesPresent.FCM_PROJECT_ID).toBe(true);
    expect(flags.variablesPresent.FCM_PRIVATE_KEY).toBe(false);
    expect(JSON.stringify(flags)).not.toContain(secret);
    expect(JSON.stringify(flags)).not.toContain("private@example.test");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await preflightMain([], {
        DATABASE_URL: `postgres://person:${secret}@db.example.test/app`,
      }),
    ).toBe(1);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("REMOTE_DATABASE_READ_REQUIRES_EXPLICIT_FLAG"),
    );
    expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(output.mock.calls)).not.toContain("db.example.test");
    output.mockClear();
    expect(await preflightMain([secret], {})).toBe(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
  });

  it("checks exact migration bytes, pending files and unknown recorded names without disclosing them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rimiam-preflight-"));
    try {
      await writeFile(join(dir, "001_first.sql"), "SELECT 1;\n");
      await writeFile(join(dir, "002_second.sql"), "SELECT 2;\n");
      await writeFile(join(dir, "003-third.sql"), "SELECT 3;\n");
      await writeFile(join(dir, "notes.txt"), "Not a migration");
      const report = await migrationChecks(
        [
          {
            name: "001_first.sql",
            checksum: createHash("sha256").update("SELECT 1;\n").digest("hex"),
          },
          { name: "002_second.sql", checksum: "mismatched" },
          {
            name: "private-unknown-ledger-entry",
            checksum: "not-repository-code",
          },
        ],
        dir,
      );
      expect(report).toEqual({
        localFiles: 3,
        recorded: 3,
        pending: ["003-third.sql"],
        mismatched: ["002_second.sql"],
        unrecognizedAppliedCount: 1,
      });
      expect(JSON.stringify(report)).not.toContain(
        "private-unknown-ledger-entry",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("collects aggregates under PostgreSQL read-only enforcement without provider calls or private rows", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("External calls forbidden"));
    const report = await runReleasePreflight({
      connectionString: process.env.DATABASE_URL!,
      testDatabase: true,
      environment: { OPENAI_API_KEY: "synthetic-secret-not-to-echo" },
    });
    expect(report.readOnlyTransaction).toBe(true);
    expect(report.target).toBe("loopback");
    expect(report.migrations.ledgerPresent).toBe(true);
    expect(report.migrations.mismatched).toEqual([]);
    expect(report.queue).toMatchObject({ available: true });
    expect(report.domainStates.account_delivery).toMatchObject({
      available: true,
    });
    expect(report.domainStates.email_send).toMatchObject({ available: true });
    expect(report.domainStates.call_recording).toMatchObject({
      available: true,
    });
    expect(report.followups).toMatchObject({ available: true });
    expect(JSON.stringify(report)).not.toContain(
      "synthetic-secret-not-to-echo",
    );
    expect(JSON.stringify(report)).not.toMatch(
      /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i,
    );
    expect(JSON.stringify(report)).not.toContain("@example.test");
    expect(fetch).not.toHaveBeenCalled();
  });
});
