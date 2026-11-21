import { afterEach, expect, it, vi } from "vitest";
import { api, errors, errorText } from "../src/client/api";

import { translateUi } from "../src/shared/i18n";

afterEach(() => vi.unstubAllGlobals());

it("turns a failed read into actionable feedback without replaying it", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetch);

  await expect(api("/api/workspaces")).rejects.toMatchObject({
    message: "NETWORK_UNAVAILABLE",
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  expect(errors.NETWORK_UNAVAILABLE).toContain("Controlla la connessione");
});

it("never replays a v1 command when its transport outcome is unknown", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError("Connection closed"));
  vi.stubGlobal("fetch", fetch);
  const command = {
    commandId: "command-one",
    expectedActorId: "actor-one",
    command: { type: "test.command" },
  };

  await expect(
    api("/api/v1/workspaces/workspace-one/commands", command),
  ).rejects.toMatchObject({ message: "NETWORK_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(command));
});

it("retries the existing legacy command path once using the exact same request options and body", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Connection closed"))
    .mockResolvedValueOnce(Response.json({ accepted: true }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const command = { commandId: "command-one", text: "Keep this exact content" };

  await expect(
    api("/api/workspaces/workspace-one/commands", command, controller.signal),
  ).resolves.toEqual({ accepted: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  const original = fetch.mock.calls[0];
  const retry = fetch.mock.calls[1];
  expect(retry?.[0]).toBe(original?.[0]);
  expect(retry?.[1]).toBe(original?.[1]);
  expect(retry?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify(command),
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
  });
});

it("stops after one failed legacy retry and keeps the uncertainty readable", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError("Connection closed"));
  vi.stubGlobal("fetch", fetch);

  await expect(
    api("/api/workspaces/workspace-one/commands", { commandId: "command-one" }),
  ).rejects.toMatchObject({ message: "NETWORK_UNAVAILABLE" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(errors.NETWORK_UNAVAILABLE).toContain("verifica prima l’esito");
});

it("preserves cancellation instead of replaying an aborted legacy command", async () => {
  const controller = new AbortController();
  const aborted = new DOMException("The operation was aborted", "AbortError");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => {
      controller.abort();
      throw aborted;
    });
  vi.stubGlobal("fetch", fetch);

  await expect(
    api(
      "/api/workspaces/workspace-one/commands",
      { commandId: "command-one" },
      controller.signal,
    ),
  ).rejects.toBe(aborted);
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves the retry cancellation instead of returning the earlier transport failure", async () => {
  const controller = new AbortController();
  const firstFailure = new TypeError("Connection closed");
  const aborted = new DOMException("The operation was aborted", "AbortError");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(firstFailure)
    .mockImplementationOnce(async () => {
      controller.abort();
      throw aborted;
    });
  vi.stubGlobal("fetch", fetch);

  await expect(
    api(
      "/api/workspaces/workspace-one/commands",
      { commandId: "command-one" },
      controller.signal,
    ),
  ).rejects.toBe(aborted);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  { status: 401, code: "AUTHENTICATION_REQUIRED" },
  { status: 429, code: "REQUEST_RATE_LIMITED" },
  { status: 503, code: "SERVICE_UNAVAILABLE" },
])(
  "maps a non-JSON HTTP $status response to $code without replaying the operation",
  async ({ status, code }) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        "<html>upstream diagnostic, not application feedback</html>",
        {
          status,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      api("/api/workspaces/workspace-one/commands", {
        commandId: "command-one",
      }),
    ).rejects.toMatchObject({ message: code });
    expect(fetch).toHaveBeenCalledOnce();
    expect(errors[code]).toBeTruthy();
    expect(errors[code]).not.toContain("upstream diagnostic");
  },
);

it("keeps an unreadable successful response uncertain without replaying a possibly committed command", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response('{"truncated":', { status: 200 }));
  vi.stubGlobal("fetch", fetch);

  await expect(
    api("/api/workspaces/workspace-one/commands", { commandId: "command-one" }),
  ).rejects.toMatchObject({ message: "INVALID_RESPONSE" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(errors.INVALID_RESPONSE).toContain("verifica l’esito");
});

it.each([
  { error: { code: "STATE_STALE" }, expected: "STATE_STALE" },
  { error: "WORKSPACE_ACCESS_DENIED", expected: "WORKSPACE_ACCESS_DENIED" },
])(
  "retains the existing structured and legacy domain error $expected",
  async ({ error, expected }) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ error }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);

    await expect(api("/api/workspaces/workspace-one")).rejects.toMatchObject({
      message: expected,
    });
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it.each([
  {
    error: { message: "untrusted diagnostic" },
    status: 400,
    expected: "REQUEST_FAILED",
  },
  {
    error: { code: { message: "untrusted diagnostic" } },
    status: 503,
    expected: "SERVICE_UNAVAILABLE",
  },
  {
    error: "upstream service diagnostic",
    status: 503,
    expected: "SERVICE_UNAVAILABLE",
  },
  { error: null, status: 401, expected: "AUTHENTICATION_REQUIRED" },
  { error: "REQUEST_FAILED", status: 500, expected: "SERVICE_UNAVAILABLE" },
])(
  "uses a safe HTTP fallback for an unknown error object ($status)",
  async ({ error, status, expected }) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ error }, { status }));
    vi.stubGlobal("fetch", fetch);

    await expect(api("/api/workspaces/workspace-one")).rejects.toMatchObject({
      message: expected,
    });
  },
);

it("presents unrecognized error codes and authored validation in the active language", () => {
  vi.stubGlobal("document", { documentElement: { lang: "en" } });
  expect(errorText(new Error("UNKNOWN_PROVIDER_CODE"))).toBe(
    errorText(new Error("REQUEST_FAILED")),
  );
  expect(errorText(new Error("UNKNOWN_PROVIDER_CODE"))).not.toContain(
    "UNKNOWN_",
  );
  expect(
    errorText(new Error("La fine deve essere successiva all’inizio.")),
  ).toBe(translateUi("en", "La fine deve essere successiva all’inizio."));
});
