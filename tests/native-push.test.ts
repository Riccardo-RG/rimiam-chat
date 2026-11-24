import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { handleAPI } from "../src/server/api";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { createWorkspace } from "../src/server/commands";
import {
  nativePushConfig,
  sendNativeNotification,
} from "../src/server/native-push-provider";
import { processWebPush, pushDeliveryTarget } from "../src/server/web-push";

const keys = generateKeyPairSync("ec", { namedCurve: "P-256" }),
  rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
beforeEach(() => {
  vi.stubEnv("NATIVE_PUSH_ENABLED", "true");
  vi.stubEnv("APNS_TEAM_ID", "ABCDEFGHIJ");
  vi.stubEnv("APNS_KEY_ID", "KEYID12345");
  vi.stubEnv("APNS_BUNDLE_ID", "com.example.rimiam");
  vi.stubEnv("APNS_ENVIRONMENT", "sandbox");
  vi.stubEnv(
    "APNS_PRIVATE_KEY",
    keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  );
  vi.stubEnv("FCM_PROJECT_ID", "rimiam-project");
  vi.stubEnv("FCM_CLIENT_EMAIL", "push@rimiam-project.iam.gserviceaccount.com");
  vi.stubEnv(
    "FCM_PRIVATE_KEY",
    rsa.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  );
  vi.stubEnv("WEB_PUSH_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
const origin = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
function call(
  path: string,
  token: string | null,
  data?: unknown,
  method?: string,
) {
  return handleAPI(
    new Request(origin + "/api/v1/" + path, {
      method: method ?? (data ? "POST" : "GET"),
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        "content-type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
  );
}
async function account() {
  const email = randomUUID() + "@example.test",
    password = "Native-notification-password";
  const user = (
    await auth.api.signUpEmail({
      body: { email, password, name: "Push member" },
    })
  ).user;
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await call("native/session", null, { email, password });
  expect(login.status).toBe(200);
  const token: string = (await login.json()).token;
  return { id: user.id, token, email };
}
let recipient: Awaited<ReturnType<typeof account>>,
  writer: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  recipient = await account();
  writer = await account();
});
it("binds local native opt-ins to the authenticated session, keeps repeated consent idempotent and rechecks the notification tap", async () => {
  const space = (
    await createWorkspace(recipient.id, "Native acceptance", randomUUID())
  ).id;
  const invite = await call(
    "workspaces/" + space + "/commands",
    recipient.token,
    {
      commandId: randomUUID(),
      command: {
        type: "invitation.create",
        email: writer.email,
        fullHistoryDisclosed: true,
      },
    },
  );
  expect(invite.status).toBe(200);
  const incoming = await call("invitations", writer.token);
  const invitations = await incoming.json();
  const join = await call(
    "invitations/" + invitations.invitations[0].id + "/accept",
    writer.token,
    { fullHistoryAccepted: true },
  );
  expect(join.status).toBe(200);
  const input = {
    operation: "enable",
    workspaceId: space,
    consent: true,
    installation: randomUUID(),
    subscription: {
      provider: "apns",
      token:
        randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    },
  };
  const enable = () => call("native/push", recipient.token, input);
  expect((await call("native/push", null, input)).status).toBe(401);
  const registered = await enable();
  expect(registered.status).toBe(200);
  const { deviceId } = await registered.json();
  const pref =
    "native/push?workspace=" + space + "&provider=apns&device=" + deviceId;
  expect(await (await call(pref, writer.token)).json()).toMatchObject({
    deviceId: null,
    optedIn: false,
  });
  expect(await (await call(pref, recipient.token)).json()).toMatchObject({
    deviceId,
    enabled: true,
    optedIn: true,
  });
  const send = () =>
    call("workspaces/" + space + "/commands", writer.token, {
      commandId: randomUUID(),
      command: { type: "message.send", content: "Private group discussion" },
    });
  const msg = await send();
  expect(msg.status).toBe(200);
  const delivery = async () =>
    (
      await pool.query(
        "SELECT * FROM web_push_delivery WHERE device_id=$1 ORDER BY revision DESC LIMIT 1",
        [deviceId],
      )
    ).rows[0];
  const queued = await delivery();
  expect(queued.status).toBe("queued");
  await enable();
  // A newer binary may opt in again while a delivery is already queued.
  expect(
    (
      await call("native/push", recipient.token, {
        ...input,
        localizedAlerts: true,
      })
    ).status,
  ).toBe(200);
  const sender = vi.fn(async () => undefined),
    web = vi.fn(async () => undefined);
  await processWebPush(queued.id, { send: web }, sender);
  await processWebPush(queued.id, { send: web }, sender);
  expect(sender).toHaveBeenCalledTimes(1);
  expect(web).not.toHaveBeenCalled();
  expect(sender).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "apns", localizedAlerts: true }),
    input.subscription.token,
    { id: queued.id, deviceId },
  );
  expect((await delivery()).status).toBe("submitted");
  const target = "native/push/target?id=" + queued.id + "&device=" + deviceId;
  expect(await (await call(target, recipient.token)).json()).toEqual({
    workspaceId: space,
  });
  expect((await call(target, writer.token)).status).toBe(404);
  const session = (
    await pool.query("SELECT session_id FROM web_push_device WHERE id=$1", [
      deviceId,
    ])
  ).rows[0].session_id;
  await expect(
    pushDeliveryTarget(recipient.id, session, queued.id, deviceId),
  ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
  await send();
  expect(
    (
      await call("native/push", recipient.token, {
        operation: "disable",
        provider: "apns",
        workspaceId: space,
        deviceId,
      })
    ).status,
  ).toBe(200);
  await processWebPush((await delivery()).id, { send: web }, sender);
  expect((await delivery()).status).toBe("suppressed");
  expect(sender).toHaveBeenCalledTimes(1);
  expect((await call(target, recipient.token)).status).toBe(404);
});
it("fences stale opt-ins, token ownership and foreign workspaces on native re-registration", async () => {
  const a = recipient,
    b = writer,
    installation = randomUUID(),
    token = randomUUID() + randomUUID();
  const first = (await createWorkspace(a.id, "First", randomUUID())).id;
  const second = (await createWorkspace(a.id, "Second", randomUUID())).id;
  const sharedPhone = (
    await createWorkspace(b.id, "Second account", randomUUID())
  ).id;
  const change = (
    who: string,
    workspaceId: string,
    install = installation,
    deviceToken = token,
  ) =>
    call("native/push", who, {
      operation: "enable",
      workspaceId,
      installation: install,
      consent: true,
      subscription: { provider: "fcm", token: deviceToken },
    });
  const { deviceId } = await (await change(a.token, first)).json();
  expect((await change(a.token, second)).status).toBe(200);
  expect((await change(b.token, first)).status).toBe(403);
  expect((await change(b.token, sharedPhone, randomUUID())).status).toBe(409);
  const rotated = await change(a.token, second, installation, token + "-new");
  expect(rotated.status).toBe(200);
  expect(
    await (
      await call(
        "native/push?workspace=" + first + "&provider=fcm&device=" + deviceId,
        a.token,
      )
    ).json(),
  ).toMatchObject({ enabled: false, optedIn: false });
  expect(
    (await call("native/session", a.token, undefined, "DELETE")).status,
  ).toBe(200);
  expect(
    (await change(b.token, sharedPhone, installation, token + "-new")).status,
  ).toBe(200);
  const prior = await pool.query(
    "SELECT enabled,encrypted_subscription,native_token_hash FROM web_push_device WHERE id=$1",
    [deviceId],
  );
  expect(prior.rows[0].enabled).toBe(false);
  expect(prior.rows[0].encrypted_subscription).not.toContain(token);
  expect(
    (
      await call(
        "native/push?workspace=" + first + "&provider=fcm&device=" + deviceId,
        a.token,
      )
    ).status,
  ).toBe(401);
});
it("uses direct APNs HTTP/2 with a verifiable ES256 token, opaque references and an explicit sandbox", async () => {
  const c = nativePushConfig("apns")!,
    payload = { id: randomUUID(), deviceId: randomUUID() };
  const put = vi.fn<Parameters<typeof sendNativeNotification>[4] & {}>(
    async (origin, headers, body) => {
      expect(origin).toBe("https://api.sandbox.push.apple.com");
      expect(headers["apns-topic"]).toBe("com.example.rimiam");
      expect(headers["apns-collapse-id"]).toBe(payload.id);
      const [h, parts, sig] = String(headers.authorization).slice(7).split(".");
      expect(
        verify(
          "sha256",
          Buffer.from(h + "." + parts),
          { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(sig, "base64url"),
        ),
      ).toBe(true);
      expect(JSON.parse(body)).toEqual({
        body: payload,
        aps: {
          alert: {
            title: "RIMIAM",
            body: "Ci sono aggiornamenti in uno dei tuoi spazi.",
          },
          sound: "default",
        },
      });
      return { status: 200 };
    },
  );
  await sendNativeNotification(c, "a".repeat(64), payload, vi.fn(), put);
  expect(put).toHaveBeenCalledTimes(1);
  await sendNativeNotification(
    { ...c, localizedAlerts: true },
    "a".repeat(64),
    payload,
    vi.fn(),
    async (_url, _headers, body) => {
      expect(JSON.parse(body)).toEqual({
        aps: {
          alert: { title: "RIMIAM", "loc-key": "rimiam_space_activity" },
          sound: "default",
        },
        body: payload,
      });
      return { status: 200 };
    },
  );
  await expect(
    sendNativeNotification(c, "a".repeat(64), payload, vi.fn(), async () => ({
      status: 410,
      reason: "Unregistered",
    })),
  ).rejects.toMatchObject({ statusCode: 410 });
  await expect(
    sendNativeNotification(c, "a".repeat(64), payload, vi.fn(), async () => ({
      status: 403,
      reason: "InvalidProviderToken",
    })),
  ).rejects.not.toHaveProperty("statusCode");
});
it("sends a scoped, signed FCM v1 request, classifies token expiry and leaves credentials server-side", async () => {
  const c = nativePushConfig("fcm")!,
    payload = { id: randomUUID(), deviceId: randomUUID() };
  const remote = vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.redirect).toBe("error");
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = (init?.body as URLSearchParams).get("assertion")!;
      const [h, v, sig] = assertion.split(".");
      expect(
        verify(
          "sha256",
          Buffer.from(h + "." + v),
          rsa.publicKey,
          Buffer.from(sig, "base64url"),
        ),
      ).toBe(true);
      expect(JSON.parse(Buffer.from(v, "base64url").toString()).scope).toBe(
        "https://www.googleapis.com/auth/firebase.messaging",
      );
      return Response.json({ access_token: "scoped-token", expires_in: 3300 });
    }
    expect(url).toBe(
      "https://fcm.googleapis.com/v1/projects/rimiam-project/messages:send",
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer scoped-token",
    );
    const msg = JSON.parse(String(init?.body)).message;
    expect(msg.data).toEqual(payload);
    expect(msg.android.notification.channel_id).toBe("rimiam-updates");
    expect(msg.notification).toEqual({
      title: "RIMIAM",
      body: "Ci sono aggiornamenti in uno dei tuoi spazi.",
    });
    return Response.json({ name: "projects/rimiam-project/messages/one" });
  });
  await sendNativeNotification(c, "token", payload, remote);
  expect(remote).toHaveBeenCalledTimes(2);
  await sendNativeNotification(
    { ...c, localizedAlerts: true },
    "token",
    payload,
    async (url, init) => {
      if (String(url).includes("oauth2.googleapis.com"))
        return remote(url, init);
      const msg = JSON.parse(String(init?.body)).message;
      expect(msg.data).toEqual(payload);
      expect(msg.notification).toEqual({ title: "RIMIAM" });
      expect(msg.android.notification.body_loc_key).toBe(
        "rimiam_space_activity",
      );
      return Response.json({ name: "projects/rimiam-project/messages/two" });
    },
  );
  const expired = async () =>
    Response.json(
      {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      },
      { status: 404 },
    );
  await expect(
    sendNativeNotification(c, "token", payload, expired),
  ).rejects.toMatchObject({ statusCode: 410 });
  await expect(
    sendNativeNotification(c, "token", payload, async () =>
      Response.json({}, { status: 404 }),
    ),
  ).rejects.not.toHaveProperty("statusCode");
});
