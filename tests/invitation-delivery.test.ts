import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/server/db";
import { encryptAccountLink } from "../src/server/account-delivery";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import {
  processInvitationMail,
  recoverInvitationMail,
} from "../src/server/invitation-delivery";
import { resendInvitationMail } from "../src/server/invitation-mail";

afterAll(() => pool.end());
const settings = {
  apiKey: "test-only",
  from: "invites@example.test",
  origin: "https://miriam.example.test",
};
async function setup(sendEmail = true) {
  const a = randomUUID(),
    b = randomUUID();
  for (const person of [a, b])
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
      [person, `${person}@example.test`],
    );
  const w = (
    await createWorkspace(a, "Private goal and workspace name", randomUUID())
  ).id;
  const commandId = randomUUID(),
    input = {
      type: "invitation.create",
      email: `${b}@example.test`,
      fullHistoryDisclosed: true,
      sendEmail,
    };
  const prior = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = settings.origin;
  let invitation: Record<string, unknown>;
  try {
    invitation = await execute(a, w, commandId, input);
  } finally {
    if (prior === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = prior;
  }
  return {
    a,
    b,
    w,
    id: invitation.invitationId as string,
    token: invitation.token as string,
    commandId,
    input,
  };
}
const delivery = async (id: string) =>
  (
    await pool.query(
      "SELECT * FROM invitation_delivery WHERE invitation_id=$1",
      [id],
    )
  ).rows[0];
const sender = (http: typeof fetch) => resendInvitationMail(settings, http);

describe("Explicit invitation delivery", () => {
  it("recovers an abandoned lease but never resends an uncertain dispatch outside the deduplication window", async () => {
    for (const old of [false, true]) {
      const s = await setup(false),
        transport = sender(async () => Response.json({ id: randomUUID() }));
      const url = settings.origin + "/?invite=" + s.token,
        payload = transport.prepare(`${s.b}@example.test`, url);
      await pool.query(
        "INSERT INTO invitation_delivery(invitation_id,encrypted_link,status,attempts,committed_at,encrypted_payload,lease_until) VALUES($1,$2,'running',1,now()-$4::interval,$3,now()-interval '1 minute')",
        [
          s.id,
          encryptAccountLink(url, JSON.stringify(["invitation", s.id, "link"])),
          encryptAccountLink(
            JSON.stringify(payload),
            JSON.stringify(["invitation", s.id, "payload"]),
          ),
          old ? "2 hours" : "2 minutes",
        ],
      );
      let calls = 0;
      await recoverInvitationMail();
      await processInvitationMail(s.id, {
        ...transport,
        async send(p, key) {
          calls++;
          expect(p).toEqual(payload);
          expect(key).toBe(`invitation/${s.id}`);
          return { deliveryId: randomUUID() };
        },
      });
      expect(calls).toBe(old ? 0 : 1);
      expect((await delivery(s.id)).status).toBe(old ? "unknown" : "submitted");
      if (old) {
        expect((await delivery(s.id)).error_code).toBe(
          "MAIL_RECONCILIATION_REQUIRED",
        );
        await processInvitationMail(s.id, transport);
        expect((await delivery(s.id)).status).toBe("unknown");
      }
    }
  });
  it("requires an explicit delivery act, queues atomically/idempotently and keeps bearer links out of reads and jobs", async () => {
    const linkOnly = await setup(false);
    expect(await delivery(linkOnly.id)).toBeUndefined();
    const s = await setup();
    await execute(s.a, s.w, s.commandId, s.input);
    const d = await delivery(s.id);
    expect(d.status).toBe("queued");
    expect(d.encrypted_link).not.toContain(s.token);
    const state = await snapshot(s.a, s.w);
    expect(state.invitations[0].delivery_status).toBe("queued");
    expect(JSON.stringify(state)).not.toContain(s.token);
    const job = (
      await pool.query(
        "SELECT payload FROM graphile_worker._private_jobs WHERE key=$1",
        [`invitation-mail:${s.id}`],
      )
    ).rows[0];
    expect(job.payload).toEqual({ invitationId: s.id });
    await expect(execute(s.b, s.w, randomUUID(), s.input)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await acceptInvitation(s.b, s.token, true);
    expect((await snapshot(s.b, s.w)).invitations).toEqual([]);
  });
  it("submits only the fixed invitation payload and never claims actual inbox delivery", async () => {
    const s = await setup();
    let calls = 0;
    const transport = sender(async (input, init) => {
      calls++;
      expect(String(input)).toBe("https://api.resend.com/emails");
      expect(init?.redirect).toBe("error");
      const p = JSON.parse(String(init?.body));
      expect(p.to).toEqual([`${s.b}@example.test`]);
      expect(p.text).toContain(s.token);
      expect(p.text).not.toContain("Private goal");
      expect(p.html).toBeUndefined();
      return Response.json({ id: randomUUID() });
    });
    await Promise.all([
      processInvitationMail(s.id, transport),
      processInvitationMail(s.id, transport),
    ]);
    await processInvitationMail(s.id, transport);
    expect(calls).toBe(1);
    expect((await delivery(s.id)).status).toBe("submitted");
    await expect(
      pool.query(
        "UPDATE invitation_delivery SET encrypted_payload='changed' WHERE invitation_id=$1",
        [s.id],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query(
        "DELETE FROM invitation_delivery_event WHERE invitation_id=$1",
        [s.id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("replays an unknown result with the exact committed body/key even if sender config changes", async () => {
    const s = await setup();
    const requests: RequestInit[] = [];
    await expect(
      processInvitationMail(
        s.id,
        sender(async (_, init) => {
          requests.push(init!);
          throw new Error(`secret ${s.token}`);
        }),
      ),
    ).rejects.toThrow("INVITATION_MAIL_DELIVERY_PENDING");
    expect((await delivery(s.id)).status).toBe("unknown");
    await recoverInvitationMail();
    await processInvitationMail(
      s.id,
      resendInvitationMail(
        { ...settings, from: "changed@example.test" },
        async (_, init) => {
          requests.push(init!);
          return Response.json({ id: randomUUID() });
        },
      ),
    );
    expect(requests[0].body).toBe(requests[1].body);
    expect(new Headers(requests[0].headers).get("Idempotency-Key")).toBe(
      new Headers(requests[1].headers).get("Idempotency-Key"),
    );
    expect(
      JSON.stringify(
        (
          await pool.query(
            "SELECT * FROM invitation_delivery_event WHERE invitation_id=$1",
            [s.id],
          )
        ).rows,
      ),
    ).not.toContain(s.token);
  });
  it("recovers an interrupted dispatch without bypassing the current invitation basis", async () => {
    const s = await setup();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
        entered = r;
      }),
      blocked = new Promise<void>((r) => {
        release = r;
      });
    const p = processInvitationMail(
      s.id,
      sender(async () => {
        entered();
        await blocked;
        return Response.json({ id: randomUUID() });
      }),
    );
    await started;
    // Revocation after the dispatch commit cannot unsend an email, but invalidates admission.
    await execute(s.a, s.w, randomUUID(), {
      type: "invitation.revoke",
      invitationId: s.id,
    });
    release();
    await p;
    expect((await delivery(s.id)).status).toBe("submitted");
    await expect(acceptInvitation(s.b, s.token, true)).rejects.toThrow(
      "INVITATION_INVALID",
    );
    const t = await setup();
    await execute(t.a, t.w, randomUUID(), {
      type: "access.relinquish",
      confirmed: true,
    });
    let calls = 0;
    await processInvitationMail(
      t.id,
      sender(async () => {
        calls++;
        return Response.json({ id: randomUUID() });
      }),
    );
    expect(calls).toBe(0);
    expect((await delivery(t.id)).status).toBe("cancelled");
  });
  it("blocks delivery after account ineligibility, revocation or acceptance", async () => {
    for (const kind of ["ineligible", "revoke", "accept"]) {
      const s = await setup();
      if (kind === "ineligible")
        await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [s.a]);
      if (kind === "revoke")
        await execute(s.a, s.w, randomUUID(), {
          type: "invitation.revoke",
          invitationId: s.id,
        });
      if (kind === "accept") await acceptInvitation(s.b, s.token, true);
      let calls = 0;
      await processInvitationMail(
        s.id,
        sender(async () => {
          calls++;
          return Response.json({ id: randomUUID() });
        }),
      );
      expect(calls).toBe(0);
      expect((await delivery(s.id)).status).toBe("cancelled");
    }
  });
  it("keeps missing configuration explicit and recovers without a substitute result", async () => {
    const s = await setup(),
      prior = process.env.MAIL_PROVIDER;
    process.env.MAIL_PROVIDER = "unconfigured";
    try {
      await processInvitationMail(s.id);
    } finally {
      if (prior === undefined) delete process.env.MAIL_PROVIDER;
      else process.env.MAIL_PROVIDER = prior;
    }
    expect((await delivery(s.id)).status).toBe("needs_configuration");
    expect((await delivery(s.id)).committed_at).toBeNull();
    await processInvitationMail(
      s.id,
      sender(async () => Response.json({ id: randomUUID() })),
    );
    expect((await delivery(s.id)).status).toBe("submitted");
  });
  it("rejects unsafe URLs, mismatched origins, extra data, redirects and invalid acknowledgements", async () => {
    let calls = 0;
    const transport = sender(async () => {
      calls++;
      return Response.json({ wrong: "secret" });
    });
    for (const link of [
      "http://miriam.example.test/?invite=" + "x".repeat(43),
      "https://evil.test/?invite=" + "x".repeat(43),
      settings.origin + "/?invite=" + "x".repeat(43) + "&data=private",
    ]) {
      expect(() => transport.prepare("person@example.test", link)).toThrow(
        "MAIL_INVITATION_URL_INVALID",
      );
    }
    expect(calls).toBe(0);
    await expect(
      transport.send(
        transport.prepare(
          "person@example.test",
          settings.origin + "/?invite=" + "x".repeat(43),
        ),
        `invitation/${randomUUID()}`,
      ),
    ).rejects.toThrow("MAIL_DELIVERY_UNCONFIRMED");
  });
});
