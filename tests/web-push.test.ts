import { randomBytes, randomUUID } from "node:crypto";
import { generateVAPIDKeys } from "web-push";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { pool, transaction } from "../src/server/db";
import { changed, lockWorkspace } from "../src/server/workspace-state";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { pushSubscriptionSchema } from "../src/server/web-push-config";
import {
  pushPreferences,
  setPushPreference,
  processWebPush,
  pushDeliveryTarget,
  recoverWebPush,
  type PushTransport,
} from "../src/server/web-push";
import { processActiveWork } from "../src/server/active-work-worker";
import { processFollowup } from "../src/server/tasks-worker";

const vapid = generateVAPIDKeys();
beforeEach(() => {
  vi.stubEnv("WEB_PUSH_ENABLED", "true");
  vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", vapid.privateKey);
  vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:test@example.test");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
async function person() {
  const id = randomUUID(),
    session = randomUUID(),
    email = `${id}@example.test`;
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, email],
  );
  await pool.query(
    'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
    [session, randomUUID(), id],
  );
  return { id, session, email };
}
function subscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
}
async function setup() {
  const a = await person(),
    b = await person();
  const w = (await createWorkspace(a.id, "Push privacy", randomUUID())).id;
  const invitation = await execute(
    a.id,
    w,
    randomUUID(),
    { type: "invitation.create", email: b.email, fullHistoryDisclosed: true },
    a.session,
  );
  await acceptInvitation(b.id, invitation.token as string, true, b.session);
  const sub = subscription();
  const enable = () =>
    setPushPreference(b.id, b.session, {
      operation: "enable",
      expectedActorId: b.id,
      expectedSessionId: b.session,
      workspaceId: w,
      consent: true,
      subscription: sub,
    });
  const say = (
    content = "Sensitive project text must stay private",
    key = randomUUID(),
  ) => execute(a.id, w, key, { type: "message.send", content }, a.session);
  const deliveries = async () =>
    (
      await pool.query(
        "SELECT * FROM web_push_delivery WHERE workspace_id=$1 ORDER BY created_at,id",
        [w],
      )
    ).rows;
  return { a, b, w, sub, enable, say, deliveries };
}
function transport() {
  const calls: { id: string; deviceId: string }[] = [];
  const sender: PushTransport = {
    async send(_subscription, payload) {
      calls.push(payload);
    },
  };
  return { calls, sender };
}
describe("opt-in Web Push boundary", () => {
  it("keeps an already queued notice when the same device enables another space or repeats its opt-in", async () => {
    const t = await setup(),
      recipient = await t.enable(),
      send = transport();
    await t.say();
    const [notice] = await t.deliveries();
    const other = (await createWorkspace(t.b.id, "Another space", randomUUID()))
      .id;
    await setPushPreference(t.b.id, t.b.session, {
      operation: "enable",
      expectedActorId: t.b.id,
      expectedSessionId: t.b.session,
      workspaceId: other,
      consent: true,
      subscription: t.sub,
    });
    await t.enable();
    await processWebPush(notice.id, send.sender);
    expect(send.calls).toEqual([
      { id: notice.id, deviceId: recipient.deviceId },
    ]);
    const state = await pushPreferences(
      t.b.id,
      t.b.session,
      t.w,
      recipient.deviceId,
    );
    expect(state).toMatchObject({ lastDelivery: { status: "submitted" } });
    expect(
      await pushPreferences(t.a.id, t.a.session, t.w, recipient.deviceId),
    ).toMatchObject({ deviceId: null, lastDelivery: null });
    expect(
      await pushPreferences(t.b.id, t.b.session, other, recipient.deviceId),
    ).toMatchObject({ lastDelivery: null });
  });
  it("does not revive other Workspace opt-ins when a same-account endpoint moves to a new session", async () => {
    const t = await setup(),
      device = await t.enable();
    const other = (await createWorkspace(t.b.id, "Another space", randomUUID()))
      .id;
    const input = {
      operation: "enable",
      expectedActorId: t.b.id,
      workspaceId: other,
      consent: true,
      subscription: t.sub,
    };
    await setPushPreference(t.b.id, t.b.session, {
      ...input,
      expectedSessionId: t.b.session,
    });
    expect(
      (await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId))
        .optedIn,
    ).toBe(true);
    const next = randomUUID();
    await pool.query(
      'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
      [next, randomUUID(), t.b.id],
    );
    await expect(
      setPushPreference(t.b.id, next, {
        ...input,
        expectedSessionId: t.b.session,
      }),
    ).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
    expect(
      await pushPreferences(t.b.id, next, t.w, device.deviceId),
    ).toMatchObject({
      deviceId: null,
      lastDelivery: null,
    });
    await expect(
      setPushPreference(t.b.id, next, {
        operation: "disable",
        workspaceId: t.w,
        deviceId: device.deviceId,
        expectedActorId: t.b.id,
        expectedSessionId: next,
      }),
    ).rejects.toMatchObject({ code: "PUSH_DEVICE_NOT_FOUND" });
    await setPushPreference(t.b.id, next, {
      ...input,
      expectedSessionId: next,
    });
    expect(
      (await pushPreferences(t.b.id, next, other, device.deviceId)).enabled,
    ).toBe(true);
    expect(
      (await pushPreferences(t.b.id, next, t.w, device.deviceId)).optedIn,
    ).toBe(false);
    await t.say();
    expect(await t.deliveries()).toHaveLength(0);
  });
  it("invalidates queued notices when encryption keys change at the same endpoint", async () => {
    const t = await setup();
    const device = await t.enable();
    await t.say();
    const [old] = await t.deliveries();
    await setPushPreference(t.b.id, t.b.session, {
      operation: "enable",
      workspaceId: t.w,
      consent: true,
      expectedActorId: t.b.id,
      expectedSessionId: t.b.session,
      subscription: { ...t.sub, keys: subscription().keys },
    });
    const sending = transport();
    await processWebPush(old.id, sending.sender);
    expect((await t.deliveries())[0].status).toBe("suppressed");
    await t.say("A new notice");
    const [, current] = await t.deliveries();
    await processWebPush(current.id, sending.sender);
    expect(sending.calls).toEqual([
      { id: current.id, deviceId: device.deviceId },
    ]);
  });
  it("keeps opt-out available while provider configuration is absent", async () => {
    const t = await setup(),
      device = await t.enable();
    vi.stubEnv("WEB_PUSH_ENABLED", "false");
    expect(
      await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId),
    ).toMatchObject({
      configured: false,
      enabled: false,
      optedIn: true,
      deviceId: device.deviceId,
    });
    await setPushPreference(t.b.id, t.b.session, {
      operation: "disable",
      workspaceId: t.w,
      expectedActorId: t.b.id,
      expectedSessionId: t.b.session,
      deviceId: device.deviceId,
    });
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    expect(
      (await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId))
        .optedIn,
    ).toBe(false);
    await t.say();
    expect(await t.deliveries()).toHaveLength(0);
  });
  it("applies the device cap to re-enabling a disabled endpoint as well as new registrations", async () => {
    const t = await setup(),
      device = await t.enable();
    for (let i = 0; i < 19; i++)
      await setPushPreference(t.b.id, t.b.session, {
        operation: "enable",
        workspaceId: t.w,
        expectedActorId: t.b.id,
        expectedSessionId: t.b.session,
        consent: true,
        subscription: subscription(),
      });
    await setPushPreference(t.b.id, t.b.session, {
      operation: "disable_device",
      expectedActorId: t.b.id,
      expectedSessionId: t.b.session,
      deviceId: device.deviceId,
    });
    await setPushPreference(t.b.id, t.b.session, {
      operation: "enable",
      workspaceId: t.w,
      expectedActorId: t.b.id,
      expectedSessionId: t.b.session,
      consent: true,
      subscription: subscription(),
    });
    await expect(t.enable()).rejects.toMatchObject({
      code: "PUSH_DEVICE_LIMIT",
    });
  });
  it("retires expired and deleted session bindings before enforcing the device cap", async () => {
    const t = await setup();
    for (let i = 0; i < 20; i++)
      await setPushPreference(t.b.id, t.b.session, {
        operation: "enable",
        workspaceId: t.w,
        expectedActorId: t.b.id,
        expectedSessionId: t.b.session,
        consent: true,
        subscription: subscription(),
      });
    await t.say();
    const queued = await t.deliveries();
    expect(queued).toHaveLength(20);
    const deletedSession = randomUUID(),
      nextSession = randomUUID();
    for (const id of [deletedSession, nextSession])
      await pool.query(
        'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
        [id, randomUUID(), t.b.id],
      );
    await pool.query(
      "UPDATE web_push_device SET session_id=$2 WHERE id IN (SELECT id FROM web_push_device WHERE user_id=$1 ORDER BY id LIMIT 10)",
      [t.b.id, deletedSession],
    );
    await pool.query("DELETE FROM session WHERE id=$1", [deletedSession]);
    await pool.query(
      "UPDATE session SET \"expiresAt\"=now()-interval '1 second' WHERE id=$1",
      [t.b.session],
    );
    await setPushPreference(t.b.id, nextSession, {
      operation: "enable",
      workspaceId: t.w,
      expectedActorId: t.b.id,
      expectedSessionId: nextSession,
      consent: true,
      subscription: subscription(),
    });
    expect(
      (
        await pool.query(
          "SELECT count(*) AS count FROM web_push_device WHERE user_id=$1 AND NOT enabled AND version=2",
          [t.b.id],
        )
      ).rows[0].count,
    ).toBe("20");
    const sent = transport();
    for (const delivery of queued)
      await processWebPush(delivery.id, sent.sender);
    expect(sent.calls).toHaveLength(0);
    expect(
      (await t.deliveries()).every((row) => row.status === "suppressed"),
    ).toBe(true);
  });
  it("accepts only bounded browser-vendor endpoints and valid encryption keys", () => {
    const s = subscription();
    expect(pushSubscriptionSchema.safeParse(s).success).toBe(true);
    for (const endpoint of [
      "http://fcm.googleapis.com/send",
      "https://localhost/send",
      "https://127.0.0.1/send",
      "https://169.254.169.254/",
      "https://fcm.googleapis.com.evil.test/send",
      "https://attacker@fcm.googleapis.com/send",
      "https://fcm.googleapis.com:8443/send",
      "https://fcm.googleapis.com/send#token",
    ])
      expect(pushSubscriptionSchema.safeParse({ ...s, endpoint }).success).toBe(
        false,
      );
    expect(
      pushSubscriptionSchema.safeParse({
        ...s,
        keys: { ...s.keys, p256dh: "a".repeat(87) },
      }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({
        ...s,
        keys: { ...s.keys, auth: "short" },
      }).success,
    ).toBe(false);
  });
  it("requires explicit personal opt-in and preserves encrypted device/workspace isolation", async () => {
    const t = await setup();
    await t.say();
    expect(await t.deliveries()).toHaveLength(0);
    await expect(
      setPushPreference(t.b.id, t.b.session, {
        operation: "enable",
        expectedActorId: t.a.id,
        expectedSessionId: t.a.session,
        workspaceId: t.w,
        consent: true,
        subscription: t.sub,
      }),
    ).rejects.toMatchObject({ code: "AUTH_CONTEXT_CHANGED" });
    const device = await t.enable();
    const row = (
      await pool.query(
        "SELECT encrypted_subscription FROM web_push_device WHERE id=$1",
        [device.deviceId],
      )
    ).rows[0];
    expect(row.encrypted_subscription).not.toContain(t.sub.endpoint);
    expect(row.encrypted_subscription).not.toContain(t.sub.keys.auth);
    expect(
      (await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId))
        .enabled,
    ).toBe(true);
    const foreign = (await createWorkspace(t.a.id, "Foreign", randomUUID())).id;
    await expect(
      pushPreferences(t.b.id, t.b.session, foreign, device.deviceId),
    ).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    await expect(
      setPushPreference(t.a.id, t.a.session, {
        operation: "enable",
        expectedActorId: t.a.id,
        expectedSessionId: t.a.session,
        workspaceId: t.w,
        consent: true,
        subscription: t.sub,
      }),
    ).rejects.toMatchObject({ code: "PUSH_DEVICE_ACCOUNT_CHANGED" });
  });
  it("queues atomically once per change, excludes its author and sends no Workspace content", async () => {
    const t = await setup(),
      device = await t.enable(),
      p = transport();
    const key = randomUUID();
    await t.say(undefined, key);
    await t.say(undefined, key);
    const [delivery] = await t.deliveries();
    expect(await t.deliveries()).toHaveLength(1);
    await Promise.all([
      processWebPush(delivery.id, p.sender),
      processWebPush(delivery.id, p.sender),
    ]);
    await processWebPush(delivery.id, p.sender);
    expect(p.calls).toEqual([{ id: delivery.id, deviceId: device.deviceId }]);
    expect((await t.deliveries())[0].status).toBe("submitted");
    expect(
      await pushDeliveryTarget(
        t.b.id,
        t.b.session,
        delivery.id,
        device.deviceId,
      ),
    ).toEqual({ url: `/?workspace=${t.w}` });
    await expect(
      pushDeliveryTarget(t.a.id, t.a.session, delivery.id, device.deviceId),
    ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
    await execute(
      t.b.id,
      t.w,
      randomUUID(),
      { type: "message.send", content: "My own message" },
      t.b.session,
    );
    expect(await t.deliveries()).toHaveLength(1);
  });
  it("notifies the other member for each exact shared thread message, including voice and a command with an immediate reply", async () => {
    const t = await setup();
    const recipient = await t.enable();
    // Opt in the author too: identifying the automatic reply as the human
    // message would otherwise notify the sender as well as the other member.
    await setPushPreference(t.a.id, t.a.session, {
      operation: "enable",
      workspaceId: t.w,
      expectedActorId: t.a.id,
      expectedSessionId: t.a.session,
      consent: true,
      subscription: subscription(),
    });
    const start = await t.say("@Emme Crea un filone chiamato Lancio");
    expect(start.replyMessageId).toBeTruthy();
    const focus = {
      workstreamId: start.operationResult.workstreamId,
      version: start.operationResult.workstreamVersion,
    };
    const send = (command: unknown) =>
      execute(t.a.id, t.w, randomUUID(), command, t.a.session);
    const text = await send({
      type: "message.send",
      content: "Condivido il piano.",
      workstreamFocus: focus,
    });
    const voice = await send({
      type: "voice.send",
      mode: "message",
      filename: "voice.wav",
      bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
      allowModelProcessing: true,
      workstreamFocus: focus,
    });
    const deliveries = await t.deliveries();
    expect(
      deliveries.map((row) => [row.device_id, row.kind, row.reference_id]),
    ).toEqual(
      [start.messageId, text.messageId, voice.messageId].map((id) => [
        recipient.deviceId,
        "message",
        id,
      ]),
    );
    const p = transport();
    for (const row of deliveries) {
      await processWebPush(row.id, p.sender);
      expect(
        await pushDeliveryTarget(
          t.b.id,
          t.b.session,
          row.id,
          recipient.deviceId,
        ),
      ).toEqual({ url: `/?workspace=${t.w}` });
    }
    expect(p.calls).toEqual(
      deliveries.map((row) => ({ id: row.id, deviceId: recipient.deviceId })),
    );
  });
  it.each(["logout", "membership", "ineligible", "disable"] as const)(
    "fences a queued push after %s",
    async (reason) => {
      const t = await setup(),
        device = await t.enable(),
        p = transport();
      await t.say();
      const [delivery] = await t.deliveries();
      if (reason === "logout")
        await pool.query("DELETE FROM session WHERE id=$1", [t.b.session]);
      if (reason === "membership")
        await execute(
          t.b.id,
          t.w,
          randomUUID(),
          { type: "member.leave", confirmed: true },
          t.b.session,
        );
      if (reason === "ineligible")
        await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
          t.b.id,
        ]);
      if (reason === "disable")
        await setPushPreference(t.b.id, t.b.session, {
          operation: "disable",
          expectedActorId: t.b.id,
          expectedSessionId: t.b.session,
          workspaceId: t.w,
          deviceId: device.deviceId,
        });
      await processWebPush(delivery.id, p.sender);
      expect(p.calls).toHaveLength(0);
      expect((await t.deliveries())[0].status).toBe("suppressed");
      await expect(
        pushDeliveryTarget(t.b.id, t.b.session, delivery.id, device.deviceId),
      ).rejects.toBeDefined();
    },
  );
  it("keeps retry/recovery identity and suppresses duplicate execution after provider acceptance", async () => {
    const t = await setup();
    await t.enable();
    await t.say();
    const [delivery] = await t.deliveries();
    const ids: string[] = [];
    await processWebPush(delivery.id, {
      async send(_s, p) {
        ids.push(p.id);
        throw new Error("network outcome unknown");
      },
    });
    expect((await t.deliveries())[0].status).toBe("queued");
    await pool.query(
      "UPDATE web_push_delivery SET next_attempt_at=now()-interval '1 second',status='sending',lease_until=now()-interval '1 second' WHERE id=$1",
      [delivery.id],
    );
    await recoverWebPush();
    const sender = {
      async send(_s: unknown, p: { id: string }) {
        ids.push(p.id);
      },
    };
    await processWebPush(delivery.id, sender);
    await processWebPush(delivery.id, sender);
    expect(ids).toEqual([delivery.id, delivery.id]);
    expect((await t.deliveries())[0].attempts).toBe(2);
  });
  it("disables an expired subscription and does not enqueue further notices for it", async () => {
    const t = await setup(),
      device = await t.enable();
    await t.say();
    const [delivery] = await t.deliveries();
    await processWebPush(delivery.id, {
      async send() {
        throw { statusCode: 410, body: "Never log this vendor body" };
      },
    });
    expect(
      (await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId))
        .enabled,
    ).toBe(false);
    await t.say("Later message");
    expect(await t.deliveries()).toHaveLength(1);
    expect((await t.deliveries())[0].error_code).toBe(
      "PUSH_SUBSCRIPTION_ENDED",
    );
  });
  it("does not infer opt-in after re-entry and suppresses stale operational work notices", async () => {
    const t = await setup(),
      device = await t.enable(),
      p = transport();
    const started = await execute(
      t.a.id,
      t.w,
      randomUUID(),
      { type: "work.converse", text: "analizza: il materiale condiviso" },
      t.a.session,
    );
    vi.stubEnv("AI_MODE", "unconfigured");
    await processActiveWork(t.w, started.workId as string);
    const workNotice = (await t.deliveries()).find(
      (d) => d.kind === "work.needs_input",
    );
    expect(workNotice).toBeDefined();
    const work = (
      await pool.query("SELECT revision FROM active_work WHERE id=$1", [
        started.workId,
      ])
    ).rows[0];
    await execute(
      t.a.id,
      t.w,
      randomUUID(),
      {
        type: "work.converse",
        workId: started.workId,
        expectedRevision: work.revision,
        text: "pausa",
      },
      t.a.session,
    );
    await processWebPush(workNotice.id, p.sender);
    expect(p.calls).toHaveLength(0);
    await execute(
      t.b.id,
      t.w,
      randomUUID(),
      { type: "member.leave", confirmed: true },
      t.b.session,
    );
    const invitation = await execute(
      t.a.id,
      t.w,
      randomUUID(),
      {
        type: "invitation.create",
        email: t.b.email,
        fullHistoryDisclosed: true,
      },
      t.a.session,
    );
    await acceptInvitation(
      t.b.id,
      invitation.token as string,
      true,
      t.b.session,
    );
    expect(
      (await pushPreferences(t.b.id, t.b.session, t.w, device.deviceId))
        .enabled,
    ).toBe(false);
    const count = (await t.deliveries()).length;
    await t.say();
    expect(await t.deliveries()).toHaveLength(count);
    await t.enable();
    await t.say();
    expect((await t.deliveries()).length).toBe(count + 1);
  });
  it("publishes one opaque reminder notification per opted-in Workspace device on the exact chat occurrence", async () => {
    const t = await setup(),
      push = transport();
    const ownerDevice = await t.enable(),
      teammate = await enableDevice(t.a, t.w);
    const outsider = await person();
    const other = (
      await createWorkspace(outsider.id, "Unrelated space", randomUUID())
    ).id;
    await enableDevice(outsider, other);
    const reminder = await dueReminder(t);
    await Promise.all([
      processFollowup(t.w, reminder, 1),
      processFollowup(t.w, reminder, 1),
    ]);
    const receipt = (
      await pool.query(
        "SELECT message_id FROM followup_delivery WHERE workspace_id=$1 AND followup_id=$2",
        [t.w, reminder],
      )
    ).rows;
    expect(receipt).toHaveLength(1);
    expect(receipt[0].message_id).toBeTruthy();
    const notices = await t.deliveries();
    expect(notices.map((n) => n.device_id).sort()).toEqual(
      [ownerDevice.deviceId, teammate.deviceId].sort(),
    );
    for (const notice of notices) {
      expect(notice).toMatchObject({
        kind: "followup.chat",
        reference_id: receipt[0].message_id,
        reference_version: 1,
      });
      const recipient = notice.device_id === ownerDevice.deviceId ? t.b : t.a;
      expect(
        await pushDeliveryTarget(
          recipient.id,
          recipient.session,
          notice.id,
          notice.device_id,
        ),
      ).toEqual({ url: `/?workspace=${t.w}` });
      await expect(
        pushDeliveryTarget(
          outsider.id,
          outsider.session,
          notice.id,
          notice.device_id,
        ),
      ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
      await processWebPush(notice.id, push.sender);
      await processWebPush(notice.id, push.sender);
    }
    expect(push.calls).toEqual(
      notices.map((n) => ({ id: n.id, deviceId: n.device_id })),
    );
  });

  it("rechecks the recipient's opt-in and the reminder version before dispatch or opening", async () => {
    const t = await setup(),
      push = transport();
    const ownerDevice = await t.enable(),
      teammate = await enableDevice(t.a, t.w);
    const reminder = await dueReminder(t);
    await processFollowup(t.w, reminder, 1);
    const notices = await t.deliveries();
    const a = notices.find((n) => n.device_id === teammate.deviceId)!;
    const b = notices.find((n) => n.device_id === ownerDevice.deviceId)!;
    await setPushPreference(t.a.id, t.a.session, {
      operation: "disable",
      workspaceId: t.w,
      deviceId: teammate.deviceId,
      expectedActorId: t.a.id,
      expectedSessionId: t.a.session,
    });
    await processWebPush(a.id, push.sender);
    await expect(
      pushDeliveryTarget(t.a.id, t.a.session, a.id, a.device_id),
    ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
    await execute(
      t.b.id,
      t.w,
      randomUUID(),
      {
        type: "followup.close",
        followupId: reminder,
        expectedVersion: 1,
        reason: "Already handled",
        status: "done",
      },
      t.b.session,
    );
    await processWebPush(b.id, push.sender);
    await expect(
      pushDeliveryTarget(t.b.id, t.b.session, b.id, b.device_id),
    ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
    expect((await t.deliveries()).map((n) => n.status)).toEqual([
      "suppressed",
      "suppressed",
    ]);
    expect(push.calls).toEqual([]);
  });

  it("keeps a queued pre-chat follow-up personal even when another member has opted in", async () => {
    const t = await setup(),
      push = transport();
    const ownerDevice = await t.enable();
    await enableDevice(t.a, t.w);
    const reminder = await dueReminder(t);
    // Reproduce the durable hint emitted by the one-recipient worker before 043.
    await transaction(async (tx) => {
      await lockWorkspace(tx, t.w);
      await changed(tx, t.w, "followup.delivered", false, false, {
        kind: "followup",
        id: reminder,
        version: 1,
        recipient: t.b.id,
      });
    });
    const notices = await t.deliveries();
    expect(notices).toHaveLength(1);
    const [n] = notices;
    expect(n).toMatchObject({
      kind: "followup",
      reference_id: reminder,
      device_id: ownerDevice.deviceId,
    });
    await expect(
      pushDeliveryTarget(t.a.id, t.a.session, n.id, n.device_id),
    ).rejects.toMatchObject({ code: "PUSH_DELIVERY_UNAVAILABLE" });
    await processWebPush(n.id, push.sender);
    expect(push.calls).toEqual([{ id: n.id, deviceId: ownerDevice.deviceId }]);
  });
});

function enableDevice(
  member: Awaited<ReturnType<typeof person>>,
  workspaceId: string,
) {
  return setPushPreference(member.id, member.session, {
    operation: "enable",
    expectedActorId: member.id,
    expectedSessionId: member.session,
    workspaceId,
    consent: true,
    subscription: subscription(),
  });
}

async function dueReminder(t: Awaited<ReturnType<typeof setup>>) {
  const result = await execute(
    t.b.id,
    t.w,
    randomUUID(),
    {
      type: "followup.create",
      content: "Shared reminder content stays off the lock screen",
      kind: "check",
      remindAt: new Date(Date.now() - 1000).toISOString(),
      timeZone: "Europe/Rome",
      reference: null,
    },
    t.b.session,
  );
  return String(result.followupId);
}
