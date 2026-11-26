import {
  lockPushRegistrations,
  requirePushDeviceSlot,
  resetDeviceOptIns,
  optIntoWorkspace,
} from "./push-registration.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  nativePushChange,
  nativePushPreference,
  nativePushProvider,
} from "../contracts/native-push.ts";
import { transaction } from "./db.ts";
import { requireThat } from "./errors.ts";
import { storedNativeCredential } from "./native-push-credential.ts";
import { decryptAccountLink, encryptAccountLink } from "./account-delivery.ts";
import {
  lockWorkspace,
  member,
  authenticatedSession,
} from "./workspace-state.ts";
import { nativePushSender, nativeSenderHash } from "./native-push-provider.ts";
import { pushHash } from "./web-push-config.ts";
import { body } from "./http.ts";
import { workspaceForPush } from "./web-push.ts";

async function changeNativePreference(
  actor: string,
  session: string,
  raw: unknown,
) {
  const input = nativePushChange.parse(raw);
  return transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    await member(tx, input.workspaceId, actor, false, true);
    await authenticatedSession(tx, actor, session);
    if (input.operation === "disable") {
      const result = await tx.query(
        `UPDATE web_push_opt_in p SET enabled=false,version=p.version+1
        FROM web_push_device d WHERE d.id=$1 AND d.user_id=$2 AND d.session_id=$3 AND d.transport=$4
        AND p.workspace_id=$5 AND p.device_id=d.id RETURNING d.id`,
        [input.deviceId, actor, session, input.provider, input.workspaceId],
      );
      requireThat(result.rowCount, "PUSH_DEVICE_NOT_FOUND", 404);
      return { deviceId: input.deviceId, enabled: false };
    }
    const { provider, token } = input.subscription,
      config = nativePushSender(provider);
    requireThat(config, "PUSH_CONFIGURATION_REQUIRED", 503);
    const installation = pushHash(
        "native-installation:" + provider + ":" + input.installation,
      ),
      accountDevice = pushHash(installation + ":" + actor),
      tokenHash = pushHash(provider + ":" + token),
      sender = nativeSenderHash(config);
    await lockPushRegistrations(tx, actor);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "native-push:" + installation,
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "native-token:" + tokenHash,
    ]);
    await authenticatedSession(tx, actor, session);
    // Only possession of the installation secret may retire a former local account's binding.
    await tx.query(
      `UPDATE web_push_device SET enabled=false,version=version+1,updated_at=now()
      WHERE native_installation_hash=$1 AND user_id<>$2 AND enabled`,
      [installation, actor],
    );
    const collision = await tx.query(
      `SELECT 1 FROM web_push_device WHERE transport=$1 AND native_token_hash=$2 AND enabled AND endpoint_hash<>$3`,
      [provider, tokenHash, accountDevice],
    );
    requireThat(!collision.rowCount, "PUSH_DEVICE_ACCOUNT_CHANGED", 409);
    const old = (
      await tx.query(
        `SELECT * FROM web_push_device WHERE endpoint_hash=$1 FOR UPDATE`,
        [accountDevice],
      )
    ).rows[0];
    if (!old?.enabled) await requirePushDeviceSlot(tx, actor);
    const deviceId: string = old?.id ?? randomUUID();
    const credential = storedNativeCredential(
      token,
      input.localizedAlerts === true,
    );
    const tokenPurpose = "native-push-token:" + deviceId;
    if (!old) {
      await tx.query(
        `INSERT INTO web_push_device(id,user_id,session_id,transport,endpoint_hash,native_installation_hash,
        native_token_hash,encrypted_subscription,vapid_key_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          deviceId,
          actor,
          session,
          provider,
          accountDevice,
          installation,
          tokenHash,
          encryptAccountLink(credential, tokenPurpose),
          sender,
        ],
      );
    } else if (
      !old.enabled ||
      old.session_id !== session ||
      old.native_token_hash !== tokenHash ||
      old.vapid_key_hash !== sender
    ) {
      await resetDeviceOptIns(tx, deviceId);
      await tx.query(
        `UPDATE web_push_device SET session_id=$2,native_token_hash=$3,encrypted_subscription=$4,vapid_key_hash=$5,
        enabled=true,version=version+1,updated_at=now() WHERE id=$1`,
        [
          deviceId,
          session,
          tokenHash,
          encryptAccountLink(credential, tokenPurpose),
          sender,
        ],
      );
    } else if (
      decryptAccountLink(old.encrypted_subscription, tokenPurpose) !==
      credential
    ) {
      // Upgrading or downgrading the app changes presentation only. Keep valid
      // per-space opt-ins and outstanding deliveries for this same binding.
      await tx.query(
        "UPDATE web_push_device SET encrypted_subscription=$2 WHERE id=$1",
        [deviceId, encryptAccountLink(credential, tokenPurpose)],
      );
    }
    await optIntoWorkspace(tx, deviceId, input.workspaceId, actor);
    return { deviceId, enabled: true };
  });
}
export async function nativePushRequest(
  request: Request,
  url: URL,
  actor: string,
  session: string,
) {
  if (url.pathname === "/api/v1/native/push/target") {
    requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
    return workspaceForPush(
      actor,
      session,
      url.searchParams.get("id") ?? "",
      url.searchParams.get("device") ?? "",
      "native",
      url.searchParams.get("anchor") === "message",
    );
  }
  if (request.method === "POST") {
    requireThat(
      request.headers.get("content-type")?.includes("application/json"),
      "JSON_REQUIRED",
      415,
    );
    return changeNativePreference(actor, session, await body(request, 8000));
  }
  requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
  const workspace = z.uuid().parse(url.searchParams.get("workspace")),
    device = z.uuid().nullable().parse(url.searchParams.get("device")),
    provider = nativePushProvider.parse(url.searchParams.get("provider")),
    config = nativePushSender(provider);
  return transaction(async (tx) => {
    await member(tx, workspace, actor);
    await authenticatedSession(tx, actor, session);
    const row =
      device &&
      (
        await tx.query(
          `SELECT d.id, d.enabled, d.vapid_key_hash,
      p.enabled AND p.membership_version=m.version AS opted_in FROM web_push_device d
      LEFT JOIN web_push_opt_in p ON d.id=p.device_id AND p.workspace_id=$4
      LEFT JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=d.user_id
      WHERE d.id=$1 AND d.user_id=$2 AND d.session_id=$3 AND d.transport=$5`,
          [device, actor, session, workspace, provider],
        )
      ).rows[0];
    return nativePushPreference.parse({
      configured: !!config,
      deviceId: row?.id ?? null,
      optedIn: !!row?.opted_in,
      enabled: !!(
        config &&
        row?.opted_in &&
        row.enabled &&
        row.vapid_key_hash === nativeSenderHash(config)
      ),
    });
  });
}
