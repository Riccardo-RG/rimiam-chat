import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  openPersonalSpace,
} from "../src/server/commands";
import { handleGoogleIntegration } from "../src/server/google-oauth";
import {
  googleScopes,
  googleCredentialToken,
  integrationCredentialToken,
  integrationCapabilities,
  encryptGoogleSecret,
  decryptGoogleSecret,
} from "../src/server/google-credentials";
import { emailView } from "../src/server/email-queries";
import { processEmailSend } from "../src/server/email-worker";
import { configuredEmailProvider } from "../src/server/email-provider";
import { googleCalendarProvider } from "../src/server/google-calendar";
import {
  googleEmailProvider,
  googleEmailMIME,
} from "../src/server/google-email";
import { googleHash, type GoogleToken } from "../src/server/google-http";
import { calendarView } from "../src/server/calendar-queries";
import { processCalendarRead } from "../src/server/calendar-worker";
import { CalendarNoEffect } from "../src/server/calendar-provider";
import type { EmailEffect } from "../src/server/email-provider";

const origin = "http://127.0.0.1:3000",
  password = "Google-fixture-test-2026!";
const json = (value: unknown, status = 200) => Response.json(value, { status });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
async function human() {
  const email = `${randomUUID()}@example.test`;
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Google integration test" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const signed = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [
      signed.response.token,
    ])
  ).rows[0].id as string;
  const w = (await createWorkspace(user.id, "Google test", randomUUID())).id;
  return { user, email, cookie, session, w };
}
function configured() {
  vi.stubEnv("GOOGLE_OAUTH_CAPABILITIES", undefined);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv(
    "GOOGLE_OAUTH_REDIRECT_URI",
    `${origin}/api/v1/integrations/google/callback`,
  );
}
async function prepareIntegration(
  t: Awaited<ReturnType<typeof human>>,
  capability: "calendar" | "email",
  provider = "google",
) {
  return (await handleGoogleIntegration(
    new Request(`${origin}/api/v1/workspaces/${t.w}/${provider}-connect`, {
      method: "POST",
      headers: {
        Cookie: t.cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ capability }),
    }),
  ))!;
}
async function begin(
  t: Awaited<ReturnType<typeof human>>,
  capability: "calendar" | "email",
  provider = "google",
) {
  const response = await prepareIntegration(t, capability, provider);
  expect(response.status).toBe(200);
  const start = await response.json();
  const launch = (await handleGoogleIntegration(
    new Request(start.authorizationUrl),
  ))!;
  expect(launch.status).toBe(303);
  const location = new URL(launch.headers.get("location")!);
  return {
    start,
    location,
    state: location.searchParams.get("state")!,
    cookie: launch.headers.get("set-cookie")!.split(";")[0],
  };
}
function callback(state: string, cookie: string, provider = "google") {
  const u = new URL(`${origin}/api/v1/integrations/${provider}/callback`);
  u.searchParams.set("state", state);
  u.searchParams.set("code", "fixture-authorization-code");
  return new Request(u, { headers: { Cookie: cookie } });
}

function microsoftConfigured() {
  vi.stubEnv("MICROSOFT_MAIL_CLIENT_ID", "test-mail-client");
  vi.stubEnv("MICROSOFT_MAIL_CLIENT_SECRET", "test-mail-secret");
  vi.stubEnv(
    "MICROSOFT_MAIL_REDIRECT_URI",
    `${origin}/api/v1/integrations/microsoft/callback`,
  );
}

function microsoftTransport(
  mail: string | null,
  scope = "User.Read Mail.Read Mail.Send",
) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const u = new URL(String(input));
    expect(init?.redirect).toBe("error");
    if (
      u.origin === "https://login.microsoftonline.com" &&
      u.pathname === "/common/oauth2/v2.0/token"
    ) {
      const form = init!.body as URLSearchParams;
      expect(form.get("client_id")).toBe("test-mail-client");
      if (form.get("grant_type") === "authorization_code") {
        expect(form.get("code_verifier")).toHaveLength(43);
        expect(form.get("redirect_uri")).toBe(
          `${origin}/api/v1/integrations/microsoft/callback`,
        );
      } else {
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("fixture-outlook-refresh");
      }
      return json({
        token_type: "Bearer",
        access_token: "fixture-outlook-access",
        refresh_token: "fixture-outlook-refresh",
        expires_in: 3600,
        scope,
      });
    }
    if (u.origin === "https://graph.microsoft.com" && u.pathname === "/v1.0/me")
      return json({
        id: "test-microsoft-object",
        mail,
        userPrincipalName: "alias@example.test",
      });
    throw Error("Unexpected network request");
  });
}

describe("Private calendar synchronization", () => {
  it("binds the Outlook consent to its own calendar, retains private observations and fences disconnect", async () => {
    microsoftConfigured();
    const person = await human(),
      other = await human(),
      account = {
        ...person,
        w: (await openPersonalSpace(person.user.id, person.session)).id,
      };
    const flow = await begin(account, "calendar", "microsoft");
    expect(flow.location.searchParams.get("scope")?.split(" ").sort()).toEqual(
      ["Calendars.ReadBasic", "User.Read", "offline_access"].sort(),
    );
    const identity = microsoftTransport(
      account.email,
      "User.Read Calendars.ReadBasic",
    );
    const resource = {
      id: "calendar-one",
      name: "La mia agenda",
      owner: { address: account.email },
    };
    let title = "Appuntamento privato",
      pageReads = 0,
      removed = false;
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/v1.0/me/calendars")) {
        expect(init?.method ?? "GET").toBe("GET");
        if (url.pathname.endsWith("/calendarView")) {
          pageReads++;
          return json({
            value: removed
              ? []
              : [
                  {
                    id: "item-one",
                    changeKey: title,
                    subject: title,
                    start: {
                      dateTime: "2026-11-20T09:00:00.0000000",
                      timeZone: "UTC",
                    },
                    end: {
                      dateTime: "2026-11-20T10:00:00.0000000",
                      timeZone: "UTC",
                    },
                    isCancelled: false,
                    showAs: "busy",
                  },
                ],
          });
        }
        return json(
          url.pathname.endsWith("/calendars")
            ? {
                value: [
                  resource,
                  {
                    ...resource,
                    id: "other",
                    owner: { address: "else@example.test" },
                  },
                ],
              }
            : resource,
        );
      }
      return identity(input, init);
    };
    expect(
      await (await handleGoogleIntegration(
        callback(flow.state, flow.cookie, "microsoft"),
        transport,
      ))!.text(),
    ).toContain("calendars=1");
    const start = "2026-11-19T00:00:00.000Z",
      end = "2026-11-22T00:00:00.000Z";
    const read = () => calendarView(account.user.id, account.w, start, end);
    const connection = (await read()).connections[0];
    expect(connection).toMatchObject({
      provider: "microsoft-calendar",
      resources: [{ label: resource.name, canRead: true, canWriteSelf: false }],
    });
    const resourceId = connection.resources[0].id;
    const act = (c: unknown) =>
      execute(account.user.id, account.w, randomUUID(), c, account.session);
    const queue = () =>
      act({
        type: "calendar.read",
        connectionId: connection.id,
        resourceId,
        mode: "events",
        start,
        end,
      });
    vi.stubGlobal("fetch", transport);
    try {
      for (const value of ["Appuntamento privato", "Orario rivisto"]) {
        title = value;
        const job = await queue();
        await processCalendarRead(job.readId);
        expect(
          (await read()).observations[0].data.events[0].payload.title,
        ).toBe(value);
      }
      expect(pageReads).toBe(2);
      expect((await read()).temporal).toEqual([]);
      await act({
        type: "temporal.create",
        payload: {
          title: "Incontro interno",
          start: "2026-11-20T09:15:00Z",
          end: "2026-11-20T09:45:00Z",
          timeZone: "UTC",
        },
        reason: "Un appuntamento personale",
        representSelf: true,
        expectedContextRevision: (await read()).contextRevision,
      });
      expect((await read()).alerts.map((alert) => alert.kind)).toEqual([
        "overlap",
      ]);
      removed = true;
      const latest = await queue();
      await processCalendarRead(latest.readId);
      const refreshed = await read();
      expect(refreshed.observations[0].data.events).toEqual([]);
      expect(refreshed.observations[1].data.events).toHaveLength(1);
      expect(refreshed.alerts).toEqual([]);
      await expect(
        calendarView(other.user.id, account.w, start, end),
      ).rejects.toThrow();
      const queued = await queue();
      await act({
        type: "calendar.disconnect",
        connectionId: connection.id,
        expectedVersion: 1,
      });
      await processCalendarRead(queued.readId);
      expect((await read()).observations).toEqual([]);
      expect(pageReads).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("asks only for owned-event read access when connecting Google from Home", async () => {
    configured();
    const person = await human(),
      account = {
        ...person,
        w: (await openPersonalSpace(person.user.id, person.session)).id,
      };
    const flow = await begin(account, "calendar"),
      scopes = flow.location.searchParams.get("scope")!.split(" ");
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/calendar.events.owned.readonly",
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.events.owned",
    );
    const original = oauthFetch("calendar", account.email);
    const response = await handleGoogleIntegration(
      callback(flow.state, flow.cookie),
      async (request, options) => {
        if (new URL(String(request)).pathname === "/token")
          return json({
            access_token: "test-token",
            refresh_token: "test-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: scopes.join(" "),
          });
        return original(request, options);
      },
    );
    expect(response?.status).toBe(200);
    const view = await calendarView(
      person.user.id,
      account.w,
      "2026-11-20T00:00:00Z",
      "2026-11-23T00:00:00Z",
    );
    expect(view.connections[0].resources[0].canWriteSelf).toBe(false);
  });
});
describe("Microsoft mailbox consent and provider isolation", () => {
  it("dispatches the exact authorized workspace draft once through its OAuth-connected Outlook mailbox", async () => {
    microsoftConfigured();
    const t = await human();
    const flow = await begin(t, "email", "microsoft");
    const identity = microsoftTransport(t.email);
    const grant = await handleGoogleIntegration(
      callback(flow.state, flow.cookie, "microsoft"),
      identity,
    );
    expect(grant?.status).toBe(200);
    const view = () => emailView(t.user.id, t.w);
    const command = (input: unknown) =>
      execute(t.user.id, t.w, randomUUID(), input, t.session);
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== "https://graph.microsoft.com/v1.0/me/sendMail")
          return identity(input, init);
        expect(init?.method).toBe("POST");
        sent.push(Buffer.from(String(init?.body), "base64").toString("utf8"));
        return new Response(null, {
          status: 202,
          headers: { "request-id": "outlook-submission-trace" },
        });
      },
    );
    try {
      const envelope = {
        sender: t.email,
        to: ["recipient@example.test"],
        cc: [],
        bcc: [],
        subject: "Ciao",
        body: "La mia bozza",
        attachments: [],
        kind: "new",
        target: null,
      };
      const draft = await command({
        type: "email.draft.create",
        connectionId: (await view()).connections[0].id,
        envelope,
        reason: "Scrivo per me",
      });
      const action = await command({
        type: "email.propose",
        draftId: draft.draftId,
        version: 1,
        discloseToRecipients: true,
      });
      await processEmailSend(action.actionId);
      expect(sent).toHaveLength(0);
      const state = await view();
      await command({
        type: "email.authorize",
        actionId: action.actionId,
        version: 1,
        expectedContextRevision: state.contextRevision,
        expectedAccessRevision: state.accessRevision,
        representSelf: true,
        discloseToRecipients: true,
      });
      await Promise.all([
        processEmailSend(action.actionId),
        processEmailSend(action.actionId),
      ]);
      await processEmailSend(action.actionId);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("To: recipient@example.test");
      expect(sent[0]).toContain(Buffer.from(envelope.body).toString("base64"));
      expect((await view()).actions[0]).toMatchObject({
        status: "SUCCEEDED",
        receipt: {
          evidence: "provider_accepted",
          submissionStatus: "accepted_for_processing",
          providerMessageId: null,
          providerThreadId: null,
          providerRequestId: "outlook-submission-trace",
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("binds consent to the same issuer, browser, verified address and mailbox-only scopes; routes the persisted connection and rotates its credential", async () => {
    configured();
    microsoftConfigured();
    const t = await human();
    const flow = await begin(t, "email", "microsoft");
    expect(flow.location.origin).toBe("https://login.microsoftonline.com");
    expect(flow.location.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(flow.location.searchParams.get("scope")!.split(" ").sort()).toEqual(
      ["offline_access", "User.Read", "Mail.Read", "Mail.Send"].sort(),
    );
    expect(flow.location.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(flow.location.searchParams.get("access_type")).toBeNull();
    const fetcher = microsoftTransport(t.email);
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie),
        fetcher,
      ))!.status,
    ).toBe(400);
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, "other", "microsoft"),
        fetcher,
      ))!.status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const connected = (await handleGoogleIntegration(
      callback(flow.state, flow.cookie, "microsoft"),
      fetcher,
    ))!;
    expect(connected.status).toBe(200);
    expect(await connected.text()).toContain("panel=email");
    const credential = (
      await pool.query(
        "SELECT * FROM google_credential WHERE workspace_id=$1 AND provider='microsoft'",
        [t.w],
      )
    ).rows[0];
    expect(credential).toMatchObject({
      status: "active",
      google_subject: "test-microsoft-object",
      person_id: t.user.id,
      email: t.email,
    });
    expect(credential.access_cipher).not.toContain("fixture-outlook-access");
    expect((await emailView(t.user.id, t.w)).connections).toEqual([
      expect.objectContaining({
        provider: "microsoft-outlook",
        sender: t.email,
        active: true,
        canRead: true,
        canSend: true,
      }),
    ]);
    expect(configuredEmailProvider("microsoft-outlook")?.key).toBe(
      "microsoft-outlook",
    );
    expect(configuredEmailProvider("google-gmail")?.key).toBe("google-gmail");
    expect(configuredEmailProvider("unknown")).toBeUndefined();
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie, "microsoft"),
        fetcher,
      ))!.status,
    ).toBe(400);
    const signal = AbortSignal.timeout(10000);
    await expect(
      googleCredentialToken(credential.id, "email", signal, fetcher),
    ).rejects.toThrow("GOOGLE_CONNECTION_UNAVAILABLE");
    await expect(
      integrationCredentialToken(
        credential.id,
        "calendar",
        signal,
        fetcher,
        "microsoft",
      ),
    ).rejects.toThrow("MICROSOFT_CONNECTION_UNAVAILABLE");
    await pool.query(
      "UPDATE google_credential SET expires_at=now() WHERE id=$1",
      [credential.id],
    );
    const refreshed = await integrationCredentialToken(
      credential.id,
      "email",
      signal,
      fetcher,
      "microsoft",
    );
    expect(refreshed).toMatchObject({
      email: t.email,
      subject: "test-microsoft-object",
      accessToken: "fixture-outlook-access",
    });
    await execute(
      t.user.id,
      t.w,
      randomUUID(),
      {
        type: "email.disconnect",
        connectionId: credential.mailbox_connection_id,
        expectedVersion: 1,
      },
      t.session,
    );
    expect(
      (
        await pool.query(
          "SELECT status,access_cipher,refresh_cipher FROM google_credential WHERE id=$1",
          [credential.id],
        )
      ).rows[0],
    ).toEqual({ status: "revoked", access_cipher: null, refresh_cipher: null });
    await expect(
      integrationCredentialToken(
        credential.id,
        "email",
        signal,
        fetcher,
        "microsoft",
      ),
    ).rejects.toThrow("MICROSOFT_CONNECTION_UNAVAILABLE");
  });
  it("does not accept mail consent as a calendar grant, missing mail grants or an unverified mailbox", async () => {
    microsoftConfigured();
    const t = await human();
    const calendar = await begin(t, "calendar", "microsoft");
    expect(
      (
        await handleGoogleIntegration(
          callback(calendar.state, calendar.cookie, "microsoft"),
          microsoftTransport(t.email),
        )
      )?.status,
    ).toBe(400);
    for (const fetcher of [
      microsoftTransport(t.email, "User.Read Mail.Send"),
      microsoftTransport("someone-else@example.test"),
      microsoftTransport(null),
    ]) {
      const flow = await begin(t, "email", "microsoft");
      expect(
        (await handleGoogleIntegration(
          callback(flow.state, flow.cookie, "microsoft"),
          fetcher,
        ))!.status,
      ).toBe(400);
    }
    expect((await emailView(t.user.id, t.w)).connections).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM google_credential WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
});
function oauthFetch(capability: "calendar" | "email", email: string) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const u = new URL(String(input));
    if (u.pathname === "/token") {
      const b = init?.body as URLSearchParams;
      expect(b.get("code_verifier")).toHaveLength(43);
      return json({
        access_token: "fixture-access-only",
        refresh_token: "fixture-refresh-only",
        expires_in: 3600,
        token_type: "Bearer",
        scope: googleScopes[capability].join(" "),
      });
    }
    if (u.pathname === "/v1/userinfo")
      return json({
        sub: "verified-google-subject",
        email,
        email_verified: true,
      });
    if (u.pathname === "/calendar/v3/users/me/calendarList")
      return json({
        items: [
          {
            id: email,
            summary: "Personale",
            accessRole: "owner",
            timeZone: "Europe/Rome",
          },
        ],
      });
    if (u.pathname.endsWith("/profile")) return json({ emailAddress: email });
    throw new Error("UNEXPECTED_TEST_HTTP");
  });
}
async function connected(capability: "calendar" | "email") {
  configured();
  const t = await human(),
    flow = await begin(t, capability),
    transport = oauthFetch(capability, t.email);
  const result = (await handleGoogleIntegration(
    callback(flow.state, flow.cookie),
    transport,
  ))!;
  expect(result.status).toBe(200);
  const credential = (
    await pool.query("SELECT * FROM google_credential WHERE workspace_id=$1", [
      t.w,
    ])
  ).rows[0];
  return { ...t, flow, credential, transport };
}

describe("Google consent and encrypted credential boundary", () => {
  it("offers only the configured new Google grants and retains existing Gmail connections", async () => {
    // This mailbox was authorized before the installation switched to Calendar only.
    const existing = await connected("email");
    const launched = await begin(existing, "email");
    const ticket = await (await prepareIntegration(existing, "email")).json();
    vi.stubEnv("GOOGLE_OAUTH_CAPABILITIES", "calendar");
    vi.stubEnv("MICROSOFT_MAIL_CLIENT_ID", undefined);
    const status = await handleGoogleIntegration(
      new Request(origin + "/api/v1/integrations/google/status", {
        headers: { Cookie: existing.cookie },
      }),
    );
    expect(await status?.json()).toEqual({
      configured: true,
      capabilities: ["calendar"],
    });
    const email = await emailView(existing.user.id, existing.w);
    expect(email.providerConfigured).toBe(false);
    expect(email.connections).toMatchObject([
      { active: true, sender: existing.email },
    ]);
    expect(
      (
        await googleCredentialToken(
          existing.credential.id,
          "email",
          AbortSignal.timeout(1000),
        )
      ).email,
    ).toBe(existing.email);
    const denied = await prepareIntegration(existing, "email");
    expect(denied.status).toBe(503);
    expect((await denied.json()).error.code).toBe("GOOGLE_CAPABILITY_DISABLED");
    expect(
      (await handleGoogleIntegration(new Request(ticket.authorizationUrl)))
        ?.status,
    ).toBe(503);
    const transport = vi.fn<typeof fetch>();
    const callbackReply = await handleGoogleIntegration(
      callback(launched.state, launched.cookie),
      transport,
    );
    expect(callbackReply?.status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
    expect((await prepareIntegration(existing, "calendar")).status).toBe(200);
    for (const [policy, expected] of [
      ["email", ["email"]],
      [" calendar, email ", ["calendar", "email"]],
      ["", []],
      ["calendar,typo", []],
    ] as const) {
      vi.stubEnv("GOOGLE_OAUTH_CAPABILITIES", policy);
      expect(integrationCapabilities("google")).toEqual(expected);
      expect(integrationCapabilities("microsoft")).toEqual([
        "calendar",
        "email",
      ]);
    }
  });
  it("fences concurrent refresh and cannot restore tokens after disconnection during refresh", async () => {
    const t = await connected("email");
    await pool.query(
      "UPDATE google_credential SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [t.credential.id],
    );
    let began!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (began = r)),
      gate = new Promise<void>((r) => (release = r));
    const fetcher: typeof fetch = async () => {
      began();
      await gate;
      return json({
        access_token: "late-access",
        expires_in: 3600,
        token_type: "Bearer",
      });
    };
    const pending = googleCredentialToken(
      t.credential.id,
      "email",
      AbortSignal.timeout(10000),
      fetcher,
    );
    await entered;
    await expect(
      googleCredentialToken(
        t.credential.id,
        "email",
        AbortSignal.timeout(10000),
        fetcher,
      ),
    ).rejects.toThrow("GOOGLE_REFRESH_IN_PROGRESS");
    await execute(
      t.user.id,
      t.w,
      randomUUID(),
      {
        type: "email.disconnect",
        connectionId: t.credential.mailbox_connection_id,
        expectedVersion: 1,
      },
      t.session,
    );
    release();
    await expect(pending).rejects.toThrow("GOOGLE_CONNECTION_UNAVAILABLE");
    const c = (
      await pool.query("SELECT * FROM google_credential WHERE id=$1", [
        t.credential.id,
      ])
    ).rows[0];
    expect(c.status).toBe("revoked");
    expect(c.access_cipher).toBeNull();
    expect(c.refresh_cipher).toBeNull();
  });
  it("a membership change during discovery rolls back connection and finalization atomically", async () => {
    configured();
    const t = await human(),
      flow = await begin(t, "calendar"),
      base = oauthFetch("calendar", t.email);
    const transport: typeof fetch = async (input, init) => {
      if (String(input).includes("/calendarList?"))
        await pool.query(
          "UPDATE membership SET version=version+1 WHERE workspace_id=$1 AND user_id=$2",
          [t.w, t.user.id],
        );
      return base(input, init);
    };
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie),
        transport,
      ))!.status,
    ).toBe(400);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM calendar_connection WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
    const credential = (
      await pool.query(
        "SELECT * FROM google_credential WHERE workspace_id=$1",
        [t.w],
      )
    ).rows[0];
    expect(credential.status).toBe("revoked");
    expect(credential.refresh_cipher).toBeNull();
  });
  it("a forwarded native handoff cannot connect someone else's Google account", async () => {
    configured();
    const t = await human(),
      flow = await begin(t, "email"),
      transport = oauthFetch("email", "someone-else@example.test");
    const result = (await handleGoogleIntegration(
      callback(flow.state, flow.cookie),
      transport,
    ))!;
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("stesso indirizzo email");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM google_credential WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("binds secrets to identity/purpose and refuses tampering", () => {
    const encrypted = encryptGoogleSecret("fixture-only", "a:refresh");
    expect(encrypted).not.toContain("fixture-only");
    expect(decryptGoogleSecret(encrypted, "a:refresh")).toBe("fixture-only");
    expect(() => decryptGoogleSecret(encrypted, "b:refresh")).toThrow(
      "GOOGLE_RECONNECT_REQUIRED",
    );
  });
  it("requires authenticated initiation, browser binding, PKCE and one-time state; no tokens reach clients", async () => {
    configured();
    const t = await human(),
      flow = await begin(t, "calendar"),
      transport = oauthFetch("calendar", t.email);
    expect(flow.location.hostname).toBe("accounts.google.com");
    expect(flow.location.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(flow.location.searchParams.get("scope")).not.toContain("gmail");
    const bad = (await handleGoogleIntegration(
      callback(flow.state, "wrong=browser"),
      transport,
    ))!;
    expect(bad.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
    const result = (await handleGoogleIntegration(
      callback(flow.state, flow.cookie),
      transport,
    ))!;
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain("fixture-access-only");
    const stored = (
      await pool.query(
        "SELECT * FROM google_credential WHERE workspace_id=$1",
        [t.w],
      )
    ).rows[0];
    expect(stored.status).toBe("active");
    expect(stored.access_cipher).not.toContain("fixture-access-only");
    expect(stored.refresh_cipher).not.toContain("fixture-refresh-only");
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie),
        transport,
      ))!.status,
    ).toBe(400);
    expect(
      (await handleGoogleIntegration(new Request(flow.start.authorizationUrl)))!
        .status,
    ).toBe(400);
    const csrf = (await handleGoogleIntegration(
      new Request(`${origin}/api/v1/workspaces/${t.w}/google-connect`, {
        method: "POST",
        headers: {
          Cookie: t.cookie,
          Origin: "https://other.example",
          "Content-Type": "application/json",
        },
        body: '{"capability":"calendar"}',
      }),
    ))!;
    expect(csrf.status).toBe(403);
  });
  it("ended session or membership cannot finish a pending consent or revive a connection", async () => {
    configured();
    const t = await human(),
      flow = await begin(t, "email"),
      transport = oauthFetch("email", t.email);
    await pool.query("DELETE FROM session WHERE id=$1", [t.session]);
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie),
        transport,
      ))!.status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT 1 FROM google_credential WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("refreshes with current permissions and destroys usable secrets on the existing disconnect command", async () => {
    const t = await connected("email");
    await pool.query(
      "UPDATE google_credential SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [t.credential.id],
    );
    const refresh = vi.fn<typeof fetch>(async (_url, init) => {
      expect((init?.body as URLSearchParams).get("grant_type")).toBe(
        "refresh_token",
      );
      return json({
        access_token: "new-fixture-access",
        expires_in: 3600,
        token_type: "Bearer",
      });
    });
    const token = await googleCredentialToken(
      t.credential.id,
      "email",
      AbortSignal.timeout(10000),
      refresh,
    );
    expect(token.accessToken).toBe("new-fixture-access");
    await execute(
      t.user.id,
      t.w,
      randomUUID(),
      {
        type: "email.disconnect",
        connectionId: t.credential.mailbox_connection_id,
        expectedVersion: 1,
      },
      t.session,
    );
    const revoked = (
      await pool.query("SELECT * FROM google_credential WHERE id=$1", [
        t.credential.id,
      ])
    ).rows[0];
    expect(revoked.status).toBe("revoked");
    expect(revoked.access_cipher).toBeNull();
    expect(revoked.refresh_cipher).toBeNull();
    await expect(
      googleCredentialToken(
        t.credential.id,
        "email",
        AbortSignal.timeout(10000),
        refresh,
      ),
    ).rejects.toThrow("GOOGLE_CONNECTION_UNAVAILABLE");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("provider denied scopes never establish usable Calendar or mailbox access", async () => {
    configured();
    const t = await human(),
      flow = await begin(t, "calendar");
    const transport = vi.fn<typeof fetch>(async () =>
      json({
        access_token: "fixture",
        refresh_token: "fixture",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid",
      }),
    );
    expect(
      (await handleGoogleIntegration(
        callback(flow.state, flow.cookie),
        transport,
      ))!.status,
    ).toBe(400);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM calendar_connection WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
});

describe("Google Calendar real HTTP adapter with isolated deterministic transport", () => {
  const payload = {
    title: "Visita",
    start: "2026-10-10T10:00:00Z",
    end: "2026-10-10T11:00:00Z",
    timeZone: "Europe/Rome",
  };
  const access = {
    connectionId: randomUUID(),
    accountRef: randomUUID(),
    resourceId: "owner@example.test",
  };
  const token: GoogleToken = async () => ({
    accessToken: "fixture",
    email: access.resourceId,
    scopes: googleScopes.calendar,
  });
  it("uses owned resources, deterministic IDs, suppressed notices and exact conditional updates", async () => {
    let event: Record<string, unknown> | undefined;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const u = new URL(String(input));
      if (u.pathname.includes("/calendarList/"))
        return json({
          id: access.resourceId,
          accessRole: "owner",
          summary: "My calendar",
        });
      if (init?.method === "POST") {
        const b = JSON.parse(String(init.body));
        expect(b.id).toBe(googleHash("operation-one"));
        expect(b.attendees).toBeUndefined();
        expect(b.reminders).toEqual({ useDefault: false, overrides: [] });
        expect(u.searchParams.get("sendUpdates")).toBe("none");
        event = { ...b, etag: '"v1"', organizer: { self: true } };
        return json(event);
      }
      if (init?.method === "PATCH") {
        expect(new Headers(init.headers).get("if-match")).toBe('"v1"');
        return json({}, 412);
      }
      return json(event);
    });
    const p = googleCalendarProvider(token, transport),
      effect = {
        operationKey: "operation-one",
        operation: "create" as const,
        payload,
      };
    const created = await p.create(access, effect, AbortSignal.timeout(10000));
    expect(created.operationKey).toBe(effect.operationKey);
    await expect(
      p.update(
        access,
        {
          ...effect,
          operation: "update",
          externalId: created.id,
          expectedRevision: created.revision,
        },
        AbortSignal.timeout(10000),
      ),
    ).rejects.toBeInstanceOf(CalendarNoEffect);
    expect(
      (await p.reconcile(access, effect, AbortSignal.timeout(10000))).outcome,
    ).toBe("applied");
  });
  it("cannot prove success from a missing event or write to a merely shared writable calendar", async () => {
    const absent = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/calendarList/")
        ? json({ id: access.resourceId, accessRole: "owner" })
        : json({}, 404),
    );
    expect(
      (
        await googleCalendarProvider(token, absent).reconcile(
          access,
          { operationKey: "absent", operation: "create", payload },
          AbortSignal.timeout(10000),
        )
      ).outcome,
    ).toBe("unknown");
    const writer = vi.fn<typeof fetch>(async () =>
      json({ id: access.resourceId, accessRole: "writer" }),
    );
    await expect(
      googleCalendarProvider(token, writer).create(
        access,
        { operationKey: "no", operation: "create", payload },
        AbortSignal.timeout(10000),
      ),
    ).rejects.toBeInstanceOf(CalendarNoEffect);
    expect(writer).toHaveBeenCalledTimes(1);
  });
});

describe("Gmail exact envelope, private source and unknown outcome", () => {
  it("requires a matching sent envelope to resolve an unknown send and then reuses its receipt", async () => {
    const t = await connected("email"),
      id = t.credential.id;
    const token: GoogleToken = async () => ({
      accessToken: "fixture",
      email: t.email,
      scopes: googleScopes.email,
    });
    const effect: EmailEffect = {
      authorizedAt: "2026-11-20T09:12:30Z",
      operationKey: randomUUID(),
      envelopeHash: "e".repeat(64),
      target: null,
      attachments: [],
      envelope: {
        sender: t.email,
        to: ["r@example.test"],
        cc: [],
        bcc: [],
        subject: "Subject",
        body: "Body",
        kind: "new",
        target: null,
        attachments: [],
      },
    };
    let sentMessageId = "",
      sends = 0;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const u = String(input);
      if (u.endsWith("/profile")) return json({ emailAddress: t.email });
      if (u.endsWith("/messages/send")) {
        sends++;
        const raw = Buffer.from(
          JSON.parse(String(init?.body)).raw,
          "base64url",
        ).toString();
        sentMessageId = /Message-ID: ([^\r\n]+)/.exec(raw)![1];
        throw new Error("Lost receipt");
      }
      if (u.includes("/messages?")) return json({ messages: [{ id: "sent" }] });
      return json({
        id: "sent",
        threadId: "thread",
        internalDate: String(Date.now()),
        labelIds: ["SENT"],
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: t.email },
            { name: "To", value: "r@example.test" },
            { name: "Subject", value: "Subject" },
            { name: "Message-ID", value: sentMessageId },
            { name: "X-Miriam-Envelope-Hash", value: effect.envelopeHash },
          ],
          body: { size: 4, data: Buffer.from("Body").toString("base64url") },
        },
      });
    });
    const p = googleEmailProvider(token, transport),
      access = {
        connectionId: t.credential.mailbox_connection_id,
        accountRef: id,
        sender: t.email,
      };
    await expect(
      p.send(access, effect, AbortSignal.timeout(10000)),
    ).rejects.toThrow("Lost receipt");
    const resolution = await p.reconcile(
      access,
      effect.operationKey,
      effect.envelopeHash,
      AbortSignal.timeout(10000),
    );
    expect(resolution.outcome).toBe("accepted");
    const receipt = await p.send(access, effect, AbortSignal.timeout(10000));
    expect(receipt.providerMessageId).toBe("sent");
    expect(sends).toBe(1);
  });
  it("parses structured text/headers/attachments without remote HTML fetch or Shared State writes", async () => {
    const token: GoogleToken = async () => ({
      accessToken: "fixture",
      email: "a@example.test",
      scopes: googleScopes.email,
    });
    const bytes = Buffer.from("private bytes"),
      transport = vi.fn<typeof fetch>(async (input) => {
        const u = String(input);
        if (u.endsWith("/profile"))
          return json({ emailAddress: "a@example.test" });
        if (u.includes("/attachments/"))
          return json({
            data: bytes.toString("base64url"),
            size: bytes.length,
          });
        return json({
          id: "message",
          threadId: "thread",
          internalDate: "1780000000000",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: '"Sender, name" <sender@example.test>' },
              { name: "To", value: "a@example.test" },
              { name: "Subject", value: "=?UTF-8?B?Q2lhbyDDqA==?=" },
            ],
            parts: [
              {
                partId: "0",
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("Hello private").toString("base64url"),
                  size: 13,
                },
              },
              {
                partId: "1",
                mimeType: "text/plain",
                filename: "private.txt",
                body: { attachmentId: "attachment", size: bytes.length },
              },
            ],
          },
        });
      });
    const p = googleEmailProvider(token, transport),
      access = {
        connectionId: randomUUID(),
        accountRef: randomUUID(),
        sender: "a@example.test",
      };
    const read = await p.fetch(
      access,
      "message",
      "message",
      undefined,
      AbortSignal.timeout(10000),
    );
    expect(read.messages[0].body).toBe("Hello private");
    expect(read.messages[0].from).toBe("sender@example.test");
    expect(read.messages[0].subject).toBe("Ciao è");
    expect(read.messages[0].attachments[0].hash).toBe(googleHash(bytes));
    expect(
      await p.attachment(
        access,
        read.messages[0],
        "attachment",
        AbortSignal.timeout(10000),
      ),
    ).toEqual(bytes);
  });
  it("response loss is durable uncertainty: no second send, search absence is not success or permission to retry", async () => {
    const t = await connected("email"),
      id = t.credential.id;
    const token: GoogleToken = async () => ({
      accessToken: "fixture",
      email: t.email,
      scopes: googleScopes.email,
    });
    let sends = 0;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const u = String(input);
      if (u.endsWith("/profile")) return json({ emailAddress: t.email });
      if (u.endsWith("/messages/send")) {
        sends++;
        const b = JSON.parse(String(init?.body));
        const raw = Buffer.from(b.raw, "base64url").toString();
        expect(raw).toContain("Bcc: private@example.test");
        expect(raw).not.toContain("forwarded");
        throw new Error("Response lost after provider acceptance");
      }
      if (u.includes("/messages?")) return json({ messages: [] });
      throw new Error("UNEXPECTED_TEST_HTTP");
    });
    const effect: EmailEffect = {
      authorizedAt: "2026-11-20T09:12:30Z",
      operationKey: randomUUID(),
      envelopeHash: "a".repeat(64),
      target: null,
      attachments: [],
      envelope: {
        sender: t.email,
        to: ["recipient@example.test"],
        cc: [],
        bcc: ["private@example.test"],
        subject: "Exact subject",
        body: "Exact body",
        kind: "new",
        target: null,
        attachments: [],
      },
    };
    const p = googleEmailProvider(token, transport),
      access = {
        connectionId: t.credential.mailbox_connection_id,
        accountRef: id,
        sender: t.email,
      };
    await expect(
      p.send(access, effect, AbortSignal.timeout(10000)),
    ).rejects.toThrow("Response lost");
    await expect(
      p.send(access, effect, AbortSignal.timeout(10000)),
    ).rejects.toThrow("GOOGLE_EMAIL_OUTCOME_UNKNOWN");
    expect(sends).toBe(1);
    expect(
      (
        await p.reconcile(
          access,
          effect.operationKey,
          effect.envelopeHash,
          AbortSignal.timeout(10000),
        )
      ).outcome,
    ).toBe("unknown");
    const record = (
      await pool.query(
        "SELECT * FROM google_email_delivery WHERE credential_id=$1",
        [id],
      )
    ).rows[0];
    expect(record.status).toBe("sending");
    expect(record.receipt).toBeNull();
  });
  it("encodes exact attachments and UTF-8 subject without adding recipients, signatures or quoted text", () => {
    const bytes = Buffer.from([0, 1, 255]);
    const effect: EmailEffect = {
      authorizedAt: "2026-11-20T09:12:30Z",
      operationKey: "mime",
      envelopeHash: "b".repeat(64),
      target: null,
      envelope: {
        sender: "a@example.test",
        to: ["b@example.test"],
        cc: [],
        bcc: [],
        subject: "è".repeat(100),
        body: "\nexact\n",
        kind: "new",
        target: null,
        attachments: [],
      },
      attachments: [
        {
          filename: "résumé.txt",
          mediaType: "text/plain",
          hash: googleHash(bytes),
          bytes,
        },
      ],
    };
    const raw = googleEmailMIME(effect, "<test@miriam.invalid>");
    expect(raw).toContain("Date: Fri, 20 Nov 2026 09:12:30 +0000\r\n");
    expect(raw).not.toMatch(/^(Cc|Bcc):/m);
    expect(raw).toContain(bytes.toString("base64"));
    expect(raw).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.txt");
    expect(raw).toContain(Buffer.from(effect.envelope.body).toString("base64"));
    expect(raw).not.toContain("In-Reply-To");
    expect(raw.split("\r\n").every((line) => line.length < 998)).toBe(true);
  });
});
