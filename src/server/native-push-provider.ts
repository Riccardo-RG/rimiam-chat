import { createHash, sign } from "node:crypto";
import { connect, type OutgoingHttpHeaders } from "node:http2";
import type { NativePushProvider } from "../contracts/native-push.ts";

const text = {
  title: "RIMIAM",
  body: "Ci sono aggiornamenti in uno dei tuoi spazi.",
};
type Payload = { id: string; deviceId: string };
const pem = (key: string | undefined) => key?.replaceAll("\\n", "\n");
const tokenEndpoint = "https://oauth2.googleapis.com/token";
type AppleSender = {
  provider: "apns";
  team: string;
  bundle: string;
  environment: "sandbox" | "production";
};
type FirebaseSender = { provider: "fcm"; project: string };
type Sender = AppleSender | FirebaseSender;
type Config =
  | (AppleSender & { keyId: string; key: string })
  | (FirebaseSender & { email: string; key: string });
// The HTTP server only needs the public sender identity. Credentials belong on the worker.
export function nativePushSender(provider: NativePushProvider): Sender | null {
  if (process.env.NATIVE_PUSH_ENABLED !== "true") return null;
  if (provider === "fcm") {
    const project = process.env.FCM_PROJECT_ID;
    return project && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)
      ? { provider, project }
      : null;
  }
  const team = process.env.APNS_TEAM_ID,
    bundle = process.env.APNS_BUNDLE_ID,
    environment = process.env.APNS_ENVIRONMENT;
  return team &&
    /^[A-Z0-9]{10}$/.test(team) &&
    bundle &&
    /^[A-Za-z0-9.-]+$/.test(bundle) &&
    (environment === "sandbox" || environment === "production")
    ? { provider, team, bundle, environment }
    : null;
}
export function nativePushConfig(provider: NativePushProvider): Config | null {
  const sender = nativePushSender(provider);
  if (!sender) return null;
  if (sender.provider === "fcm") {
    const key = pem(process.env.FCM_PRIVATE_KEY),
      email = process.env.FCM_CLIENT_EMAIL;
    return key && email ? { ...sender, key, email } : null;
  }
  const key = pem(process.env.APNS_PRIVATE_KEY),
    keyId = process.env.APNS_KEY_ID;
  return key && keyId && /^[A-Z0-9]{10}$/.test(keyId)
    ? { ...sender, key, keyId }
    : null;
}
export function nativeSenderHash(config: Sender) {
  const namespace =
    config.provider === "apns"
      ? [config.team, config.bundle, config.environment]
      : [config.project];
  return createHash("sha256")
    .update([config.provider, ...namespace].join(":"))
    .digest("hex");
}
function signed(header: object, claims: object, key: string, ec = false) {
  const input = [header, claims]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return (
    input +
    "." +
    sign(
      "sha256",
      Buffer.from(input),
      ec ? { key, dsaEncoding: "ieee-p1363" } : key,
    ).toString("base64url")
  );
}
const cache = new Map<
  NativePushProvider,
  { config: string; until: number; token: string }
>();
async function authorization(config: Config, http: typeof fetch) {
  const now = Math.floor(Date.now() / 1000);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");
  const previous = cache.get(config.provider);
  if (previous?.config === fingerprint && previous.until > now + 30)
    return previous.token;
  let token: string, ttl: number;
  if (config.provider === "apns") {
    token = signed(
      { alg: "ES256", kid: config.keyId },
      { iss: config.team, iat: now },
      config.key,
      true,
    );
    ttl = 3000;
  } else {
    const assertion = signed(
      { alg: "RS256", typ: "JWT" },
      {
        iss: config.email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenEndpoint,
        iat: now,
        exp: now + 3600,
      },
      config.key,
    );
    const response = await http(tokenEndpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw Error("FCM_AUTH_UNAVAILABLE");
    const result = await response.json();
    if (
      typeof result.access_token !== "string" ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0
    )
      throw Error("FCM_AUTH_UNAVAILABLE");
    token = result.access_token;
    ttl = Math.min(3600, result.expires_in);
  }
  cache.set(config.provider, { config: fingerprint, until: now + ttl, token });
  return token;
}
type ApplePost = (
  origin: string,
  headers: OutgoingHttpHeaders,
  body: string,
) => Promise<{ status: number; reason?: string }>;
const postApple: ApplePost = (origin, headers, body) =>
  new Promise((resolve, reject) => {
    const session = connect(origin);
    const finish = (error: Error) => {
      session.destroy();
      reject(error);
    };
    session.on("error", finish);
    const req = session.request(headers);
    let status = 0,
      response = "";
    const timer = setTimeout(() => finish(Error("APNS_TIMEOUT")), 5000);
    req.on("response", (h) => {
      status = Number(h[":status"]);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (response.length < 4096) response += chunk;
    });
    req.on("close", () => {
      clearTimeout(timer);
      session.close();
      if (!req.readableEnded) reject(Error("APNS_CONNECTION_ENDED"));
    });
    req.on("error", finish);
    req.on("end", () => {
      let reason: unknown;
      try {
        reason = JSON.parse(response).reason;
      } catch {
        /* Successful APNs responses have no body. */
      }
      resolve({
        status,
        reason: typeof reason === "string" ? reason : undefined,
      });
    });
    req.end(body);
  });
export async function sendNativeNotification(
  registration: Config & { localizedAlerts?: boolean },
  token: string,
  payload: Payload,
  http: typeof fetch = fetch,
  apple: ApplePost = postApple,
) {
  const { localizedAlerts: localized = false, ...config } = registration;
  const credential = await authorization(config, http);
  const resource = "rimiam_space_activity";
  const ended = () =>
    Object.assign(Error("PUSH_TOKEN_ENDED"), { statusCode: 410 });
  if (config.provider === "apns") {
    const result = await apple(
      config.environment === "sandbox"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
      {
        ":method": "POST",
        ":path": "/3/device/" + token,
        authorization: "bearer " + credential,
        "apns-topic": config.bundle,
        "apns-push-type": "alert",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
        "apns-id": payload.id,
        "apns-collapse-id": payload.id,
      },
      // Expo's iOS receiver maps the remote userInfo.body dictionary to content.data.
      JSON.stringify({
        aps: {
          alert: localized ? { title: text.title, "loc-key": resource } : text,
          sound: "default",
        },
        body: payload,
      }),
    );
    if (result.status === 410 && result.reason === "Unregistered")
      throw ended();
    if (result.status !== 200) throw Error("APNS_UNAVAILABLE");
    return;
  }
  const response = await http(
    "https://fcm.googleapis.com/v1/projects/" +
      config.project +
      "/messages:send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + credential,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        message: {
          token,
          notification: localized ? { title: text.title } : text,
          data: payload,
          android: {
            priority: "HIGH",
            ttl: "3600s",
            notification: {
              channel_id: "rimiam-updates",
              tag: payload.id,
              ...(localized && { body_loc_key: resource }),
            },
          },
        },
      }),
    },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    if (
      response.status === 404 &&
      Array.isArray(result?.error?.details) &&
      result.error.details.some(
        (d: Record<string, unknown>) =>
          d["@type"] ===
            "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
          d.errorCode === "UNREGISTERED",
      )
    )
      throw ended();
    throw Error("FCM_UNAVAILABLE");
  }
  const result = await response.json();
  if (
    typeof result?.name !== "string" ||
    !result.name.startsWith("projects/" + config.project + "/messages/")
  )
    throw Error("FCM_RESPONSE_INVALID");
}
