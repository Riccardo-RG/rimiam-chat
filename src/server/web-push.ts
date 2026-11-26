import { readNativeCredential } from "./native-push-credential.ts";
import {
  lockPushRegistrations,
  requirePushDeviceSlot,
  resetDeviceOptIns,
  optIntoWorkspace,
} from "./push-registration.ts";
import {
  nativePushConfig,
  nativePushSender,
  nativeSenderHash,
  sendNativeNotification,
} from "./native-push-provider.ts";
import type { NativePushProvider } from "../contracts/native-push.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sendNotification } from "web-push";
import { pool, transaction, type Tx } from "./db.ts";
import {
  authenticatedSession,
  eligible,
  member,
  lockWorkspace,
} from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { encryptAccountLink, decryptAccountLink } from "./account-delivery.ts";
import {
  pushConfiguration,
  pushHash,
  pushSubscriptionSchema,
  type BrowserPushSubscription,
} from "./web-push-config.ts";
import {
  queuePushDelivery,
  sharedReminderForMessage,
} from "./web-push-outbox.ts";
import { followupAt, followupValid } from "./tasks-state.ts";

const associated = (id: string) => `web-push-subscription:${id}`;
function sameSubscription(
  id: string,
  encrypted: string,
  subscription: BrowserPushSubscription,
) {
  try {
    const previous = pushSubscriptionSchema.parse(
      JSON.parse(decryptAccountLink(encrypted, associated(id))),
    );
    return (
      previous.endpoint === subscription.endpoint &&
      previous.keys.auth === subscription.keys.auth &&
      previous.keys.p256dh === subscription.keys.p256dh
    );
  } catch {
    return false;
  }
}
export const pushPreferenceSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("enable"),
      workspaceId: z.uuid(),
      expectedActorId: z.string().min(1),
      expectedSessionId: z.string().min(1),
      consent: z.literal(true),
      subscription: pushSubscriptionSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("disable"),
      workspaceId: z.uuid(),
      expectedActorId: z.string().min(1),
      expectedSessionId: z.string().min(1),
      deviceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("disable_device"),
      expectedActorId: z.string().min(1),
      expectedSessionId: z.string().min(1),
      deviceId: z.uuid(),
    })
    .strict(),
]);

export async function pushPreferences(
  actor: string,
  session: string,
  workspace: string,
  device?: string,
) {
  z.uuid().parse(workspace);
  if (device) z.uuid().parse(device);
  return transaction(async (tx) => {
    await member(tx, workspace, actor);
    await authenticatedSession(tx, actor, session);
    const configuration = pushConfiguration();
    const row = device
      ? (
          await tx.query(
            `SELECT d.id,d.session_id=$3 AND p.enabled AND m.version=p.membership_version AS opted_in,
       d.enabled AND d.session_id=$3 AND p.enabled AND m.version=p.membership_version AND d.vapid_key_hash=$4 AS enabled,
       (SELECT json_build_object('status', o.status, 'at', COALESCE(o.finished_at, o.created_at))
        FROM web_push_delivery o WHERE o.device_id=d.id AND o.workspace_id=p.workspace_id
         AND o.device_version=d.version AND o.preference_version=p.version AND p.enabled AND m.version=p.membership_version
        ORDER BY o.revision DESC LIMIT 1) AS last_delivery
       FROM web_push_device d LEFT JOIN web_push_opt_in p ON p.device_id=d.id AND p.workspace_id=$2
       LEFT JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=d.user_id
       WHERE d.id=$1 AND d.user_id=$5 AND d.session_id=$3 AND d.transport='web'`,
            [
              device,
              workspace,
              session,
              configuration ? pushHash(configuration.publicKey) : "",
              actor,
            ],
          )
        ).rows[0]
      : undefined;
    return {
      configured: !!configuration,
      publicKey: configuration?.publicKey ?? null,
      deviceId: row?.id ?? null,
      enabled: !!row?.enabled,
      optedIn: !!row?.opted_in,
      lastDelivery: row?.last_delivery ?? null,
    };
  });
}

export async function setPushPreference(
  actor: string,
  session: string,
  raw: unknown,
) {
  const input = pushPreferenceSchema.parse(raw);
  requireThat(
    input.expectedActorId === actor && input.expectedSessionId === session,
    "AUTH_CONTEXT_CHANGED",
    409,
  );
  const configuration = pushConfiguration();
  if (input.operation === "enable")
    requireThat(configuration, "PUSH_CONFIGURATION_REQUIRED", 503);
  return transaction(async (tx) => {
    if (input.operation !== "disable_device") {
      await lockWorkspace(tx, input.workspaceId);
      await member(tx, input.workspaceId, actor, false, true);
    } else await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, session);
    if (input.operation !== "enable") {
      const device = (
        await tx.query(
          "SELECT id FROM web_push_device WHERE id=$1 AND user_id=$2 AND session_id=$3 AND transport='web' FOR UPDATE",
          [input.deviceId, actor, session],
        )
      ).rows[0];
      requireThat(device, "PUSH_DEVICE_NOT_FOUND", 404);
      if (input.operation === "disable_device")
        await tx.query(
          "UPDATE web_push_device SET enabled=false,version=version+1,updated_at=now() WHERE id=$1",
          [device.id],
        );
      else
        await tx.query(
          "UPDATE web_push_opt_in SET enabled=false,version=version+1 WHERE device_id=$1 AND workspace_id=$2",
          [device.id, input.workspaceId],
        );
      return { deviceId: device.id as string, enabled: false };
    }
    const hash = pushHash(input.subscription.endpoint);
    await lockPushRegistrations(tx, actor);
    // Endpoint serialization prevents races between two accounts registering a
    // shared browser. An endpoint is never silently reassigned to another person.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `web-push:${hash}`,
    ]);
    await authenticatedSession(tx, actor, session);
    let device = (
      await tx.query(
        "SELECT id,user_id,session_id,enabled,vapid_key_hash,encrypted_subscription FROM web_push_device WHERE endpoint_hash=$1 FOR UPDATE",
        [hash],
      )
    ).rows[0];
    requireThat(
      !device || device.user_id === actor,
      "PUSH_DEVICE_ACCOUNT_CHANGED",
      409,
    );
    if (!device?.enabled) await requirePushDeviceSlot(tx, actor);
    if (!device) {
      device = { id: randomUUID(), user_id: actor };
      await tx.query(
        "INSERT INTO web_push_device(id,user_id,session_id,endpoint_hash,encrypted_subscription,vapid_key_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          device.id,
          actor,
          session,
          hash,
          encryptAccountLink(
            JSON.stringify(input.subscription),
            associated(device.id),
          ),
          pushHash(configuration!.publicKey),
        ],
      );
    } else if (
      !device.enabled ||
      device.session_id !== session ||
      device.vapid_key_hash !== pushHash(configuration!.publicKey) ||
      !sameSubscription(
        device.id,
        device.encrypted_subscription,
        input.subscription,
      )
    ) {
      await resetDeviceOptIns(tx, device.id);
      await tx.query(
        "UPDATE web_push_device SET session_id=$2,encrypted_subscription=$3,vapid_key_hash=$4,enabled=true,version=version+1,updated_at=now() WHERE id=$1",
        [
          device.id,
          session,
          encryptAccountLink(
            JSON.stringify(input.subscription),
            associated(device.id),
          ),
          pushHash(configuration!.publicKey),
        ],
      );
    }
    await optIntoWorkspace(tx, device.id, input.workspaceId, actor);
    return { deviceId: device.id as string, enabled: true };
  });
}

async function accessibleDelivery(tx: Tx, id: string) {
  const row = (
    await tx.query(
      `SELECT o.*,d.transport,d.user_id,d.session_id,d.encrypted_subscription,d.vapid_key_hash,d.enabled AS device_enabled,d.version AS current_device_version,
      p.enabled AS opted_in,p.version AS current_preference_version,p.membership_version,m.active,m.version AS current_membership_version,
      u.eligible,u."emailVerified" AS verified,s."expiresAt" AS expires_at
     FROM web_push_delivery o JOIN web_push_device d ON d.id=o.device_id
     JOIN web_push_opt_in p ON p.device_id=d.id AND p.workspace_id=o.workspace_id
     JOIN membership m ON m.workspace_id=o.workspace_id AND m.user_id=d.user_id
     JOIN "user" u ON u.id=d.user_id LEFT JOIN session s ON s.id=d.session_id AND s."userId"=d.user_id WHERE o.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) return null;
  const key =
    row.transport === "web" ? pushConfiguration()?.publicKey : undefined;
  const native =
    row.transport === "web" ? null : nativePushSender(row.transport);
  const sender = native ? nativeSenderHash(native) : key ? pushHash(key) : null;
  const allowed =
    row.device_enabled &&
    row.opted_in &&
    row.active &&
    row.eligible &&
    row.verified &&
    row.device_version === row.current_device_version &&
    row.preference_version === row.current_preference_version &&
    row.membership_version === row.current_membership_version &&
    row.expires_at &&
    row.expires_at > new Date() &&
    row.created_at.getTime() > Date.now() - 3_600_000 &&
    sender &&
    row.vapid_key_hash === sender;
  if (!allowed) return { row, allowed: false };
  let relevant = true;
  if (row.kind.startsWith("work.")) {
    relevant = !!(
      await tx.query(
        "SELECT 1 FROM active_work WHERE workspace_id=$1 AND id=$2 AND contract_version=$3 AND phase=$4 AND validity='current'",
        [
          row.workspace_id,
          row.reference_id,
          row.reference_version,
          row.kind === "work.completed" ? "completed" : "needs_input",
        ],
      )
    ).rowCount;
  } else if (row.kind === "personal_research") {
    relevant = !!(
      await tx.query(
        "SELECT 1 FROM personal_research_preference p JOIN personal_research_brief b ON b.work_id=p.work_id AND b.generation=$3 AND b.status='ready' WHERE p.workspace_id=$1 AND p.work_id=$2 AND p.actor_id=$4 AND p.notify AND p.read_at IS NULL",
        [
          row.workspace_id,
          row.reference_id,
          row.reference_version,
          row.user_id,
        ],
      )
    ).rowCount;
  } else if (row.kind === "followup" || row.kind === "followup.chat") {
    const shared = row.kind === "followup.chat";
    const reminderId = shared
      ? await sharedReminderForMessage(
          tx,
          row.workspace_id,
          row.reference_id,
          row.reference_version,
        )
      : row.reference_id;
    if (!reminderId) return { row, allowed: false };
    const followup = await followupAt(tx, row.workspace_id, reminderId);
    relevant =
      followup.version === row.reference_version &&
      followup.status === "active" &&
      (shared || followup.owner_id === row.user_id) &&
      (await followupValid(tx, followup));
  }
  return { row, allowed: relevant };
}

// Checked by the service worker before showing and again when opening. The push
// payload contains only opaque delivery IDs; it is not an authenticated data API.
export async function workspaceForPush(
  actor: string,
  session: string,
  id: string,
  device: string,
  channel: "web" | "native",
  includeMessage = false,
) {
  z.uuid().parse(id);
  z.uuid().parse(device);
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, session);
    const view = await accessibleDelivery(tx, id);
    requireThat(
      view?.allowed &&
        view.row.user_id === actor &&
        view.row.session_id === session &&
        view.row.device_id === device &&
        (channel === "native"
          ? view.row.transport !== "web"
          : view.row.transport === "web"),
      "PUSH_DELIVERY_UNAVAILABLE",
      404,
    );
    await member(tx, view.row.workspace_id, actor);
    const workspaceId = view.row.workspace_id as string;
    if (
      includeMessage &&
      ["message", "result", "followup.chat"].includes(view.row.kind)
    ) {
      const original = await tx.query<{ id: string }>(
        "SELECT id FROM message WHERE workspace_id=$1 AND id=$2",
        [workspaceId, view.row.reference_id],
      );
      if (original.rows[0])
        return { workspaceId, messageId: original.rows[0].id };
    }
    return { workspaceId };
  });
}

export async function pushDeliveryTarget(
  actor: string,
  session: string,
  id: string,
  device: string,
) {
  const { workspaceId } = await workspaceForPush(
    actor,
    session,
    id,
    device,
    "web",
  );
  return { url: `/?workspace=${workspaceId}` };
}

export interface PushTransport {
  send(
    subscription: BrowserPushSubscription,
    payload: { id: string; deviceId: string },
  ): Promise<void>;
}
function configuredPushTransport(): PushTransport | null {
  const configuration = pushConfiguration();
  if (!configuration) return null;
  return {
    async send(subscription, payload) {
      pushSubscriptionSchema.parse(subscription);
      await sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: configuration,
        TTL: 3600,
        urgency: "normal",
        timeout: 5000,
        topic: pushHash(payload.id).slice(0, 32),
      });
    },
  };
}

export async function processWebPush(
  id: string,
  supplied?: PushTransport,
  nativeSend: typeof sendNativeNotification = sendNativeNotification,
) {
  z.uuid().parse(id);
  const lookup = (
    await pool.query(
      "SELECT o.workspace_id,d.transport FROM web_push_delivery o JOIN web_push_device d ON d.id=o.device_id WHERE o.id=$1",
      [id],
    )
  ).rows[0];
  if (!lookup) return;
  const transport =
    lookup.transport === "web" ? (supplied ?? configuredPushTransport()) : null;
  const native =
    lookup.transport === "web"
      ? null
      : nativePushConfig(lookup.transport as NativePushProvider);
  if (!native && !transport) return;
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, lookup.workspace_id);
    await tx.query("SELECT id FROM web_push_delivery WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const view = await accessibleDelivery(tx, id);
    if (
      !view ||
      ["submitted", "suppressed", "failed"].includes(view.row.status) ||
      (view.row.status === "sending" && view.row.lease_until > new Date()) ||
      view.row.next_attempt_at > new Date()
    )
      return null;
    if (!view.allowed || view.row.attempts >= 5) {
      await tx.query(
        "UPDATE web_push_delivery SET status='suppressed',lease_until=NULL,finished_at=now(),error_code='PUSH_NO_LONGER_APPLICABLE' WHERE id=$1",
        [id],
      );
      return null;
    }
    await authenticatedSession(tx, view.row.user_id, view.row.session_id);
    const row = (
      await tx.query(
        "UPDATE web_push_delivery SET status='sending',attempts=attempts+1,lease_until=now()+interval '30 seconds',error_code=NULL WHERE id=$1 RETURNING attempts",
        [id],
      )
    ).rows[0];
    return { ...view.row, attempt: row.attempts as number };
  });
  if (!claim) return;
  let status: "submitted" | "queued" | "failed" | "suppressed" = "submitted";
  let errorCode: string | null = null;
  let expired = false;
  try {
    const payload = { id, deviceId: claim.device_id };
    if (native) {
      const credential = decryptAccountLink(
        claim.encrypted_subscription,
        "native-push-token:" + claim.device_id,
      );
      const { token, localized } = readNativeCredential(credential);
      await nativeSend(
        localized ? { ...native, localizedAlerts: true } : native,
        token,
        payload,
      );
    } else if (transport) {
      const subscription = pushSubscriptionSchema.parse(
        JSON.parse(
          decryptAccountLink(
            claim.encrypted_subscription,
            associated(claim.device_id),
          ),
        ),
      );
      await transport.send(subscription, payload);
    }
  } catch (error) {
    const code =
      typeof error === "object" && error && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
    expired = code === 404 || code === 410;
    status = expired ? "suppressed" : claim.attempt >= 5 ? "failed" : "queued";
    errorCode = expired ? "PUSH_SUBSCRIPTION_ENDED" : "PUSH_TRANSPORT_FAILED";
  }
  await transaction(async (tx) => {
    const next = new Date(
      Date.now() + Math.min(300, 30 * 2 ** (claim.attempt - 1)) * 1000,
    );
    const updated = await tx.query(
      "UPDATE web_push_delivery SET status=$3,lease_until=NULL,next_attempt_at=$4,error_code=$5,finished_at=CASE WHEN $3='queued' THEN NULL ELSE now() END WHERE id=$1 AND attempts=$2 AND status='sending' RETURNING id",
      [id, claim.attempt, status, next, errorCode],
    );
    if (!updated.rowCount) return;
    if (expired)
      await tx.query(
        "UPDATE web_push_device SET enabled=false,version=version+1,updated_at=now() WHERE id=$1 AND version=$2",
        [claim.device_id, claim.device_version],
      );
    if (status === "queued") await queuePushDelivery(tx, id, next);
  });
}

export async function recoverWebPush() {
  const transports = [
    pushConfiguration() && "web",
    nativePushConfig("apns") && "apns",
    nativePushConfig("fcm") && "fcm",
  ].filter(Boolean);
  if (!transports.length) return;
  const rows = (
    await pool.query(
      "SELECT o.id FROM web_push_delivery o JOIN web_push_device d ON o.device_id=d.id WHERE d.transport=ANY($1::text[]) AND ((status='queued' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<=now())) ORDER BY next_attempt_at LIMIT 100",
      [transports],
    )
  ).rows;
  for (const row of rows)
    await transaction((tx) => queuePushDelivery(tx, row.id));
}
