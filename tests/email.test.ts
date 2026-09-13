import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { establishMailbox } from "../src/server/email-state";
import {
  emailView,
  emailHistory,
  emailAttachment,
} from "../src/server/email-queries";
import {
  processEmailSend,
  processEmailRead,
  recoverEmail,
} from "../src/server/email-worker";
import { emailViewSchema, type EmailEnvelope } from "../src/contracts/email";
import { FixtureEmail } from "./support/fixture-email";
import { composeEmail } from "../src/server/email-composition";
import { handleAPI } from "../src/server/api";
const password = "Email-test-only-2026!";
async function person() {
  const email = `${randomUUID()}@example.test`;
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Email tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [
      login.response.token,
    ])
  ).rows[0].id;
  return {
    id: user.id,
    email,
    session,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function setup() {
  const a = await person(),
    w = (await createWorkspace(a.id, "Email test", randomUUID())).id,
    p = new FixtureEmail(),
    c = await establishMailbox(a.id, w, a.session, p, a.email, "Test mailbox");
  const cmd = (c: unknown, id = randomUUID()) =>
    execute(a.id, w, id, c, a.session);
  const view = () => emailView(a.id, w);
  const envelope: EmailEnvelope = {
    sender: a.email,
    to: ["recipient@example.test"],
    cc: [],
    bcc: ["hidden@example.test"],
    subject: "Visita",
    body: "Posso visitare il locale venerdì?",
    attachments: [],
    kind: "new",
    target: null,
  };
  const draft = () =>
    cmd({
      type: "email.draft.create",
      connectionId: c.connectionId,
      envelope,
      reason: "Draft personale",
    });
  const propose = (id: string, version = 1) =>
    cmd({
      type: "email.propose",
      draftId: id,
      version,
      discloseToRecipients: true,
    });
  const authorize = async (id: string, version = 1) => {
    const v = await view();
    return cmd({
      type: "email.authorize",
      actionId: id,
      version,
      expectedContextRevision: v.contextRevision,
      expectedAccessRevision: v.accessRevision,
      representSelf: true,
      discloseToRecipients: true,
    });
  };
  const read = async () => {
    const r = await cmd({
      type: "email.read",
      connectionId: c.connectionId,
      request: { mode: "search", query: "locale" },
    });
    await processEmailRead(r.readId, p);
    return (await view()).observations[0];
  };
  return { a, w, p, c, cmd, view, envelope, draft, propose, authorize, read };
}
async function invite(t: Awaited<ReturnType<typeof setup>>) {
  const b = await person(),
    i = await t.cmd({
      type: "invitation.create",
      email: b.email,
      fullHistoryDisclosed: true,
    });
  await acceptInvitation(b.id, i.token, true);
  return b;
}
afterAll(() => pool.end());
describe("Workspace Email", () => {
  it("private reads, draft/BCC and private attachments stay outside shared state; disclosure preserves only chosen content and provenance", async () => {
    const t = await setup(),
      b = await invite(t),
      before = (await t.view()).revision,
      o = await t.read();
    await t.draft();
    const read = await t.cmd({
      type: "email.read",
      connectionId: t.c.connectionId,
      request: {
        mode: "attachment",
        observationId: o.id,
        messageId: "message-1",
        attachmentId: "attachment-1",
      },
    });
    await processEmailRead(read.readId, t.p);
    const privateView = await t.view(),
      other = await emailView(b.id, t.w);
    expect(other.observations).toEqual([]);
    expect(other.drafts).toEqual([]);
    expect(other.connections).toEqual([]);
    expect(other.attachments).toEqual([]);
    expect(other.revision).toBe(before);
    await expect(
      emailAttachment(b.id, t.w, privateView.attachments[0].id),
    ).rejects.toThrow("EMAIL_ATTACHMENT_NOT_FOUND");
    const disclosure = await t.cmd({
      type: "email.disclose",
      observationId: o.id,
      messageId: "message-1",
      text: "Il locale è disponibile venerdì.",
      fullHistoryDisclosed: true,
    });
    const source = (
      await pool.query("SELECT * FROM workspace_source WHERE id=$1", [
        disclosure.sourceId,
      ])
    ).rows[0];
    expect(source.content).toBe("Il locale è disponibile venerdì.");
    expect(source.qualification).toContain("non verificato");
    expect((await emailView(b.id, t.w)).disclosures).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT * FROM accepted_information WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
    const file = await t.cmd({
      type: "email.attachment.disclose",
      attachmentId: privateView.attachments[0].id,
      fullHistoryDisclosed: true,
    });
    expect(
      (
        await pool.query(
          "SELECT original_bytes FROM external_source WHERE id=$1",
          [file.sourceId],
        )
      ).rows[0].original_bytes.equals(t.p.bytes),
    ).toBe(true);
  });
  it("a contributing peer cannot inspect, approve or reuse another person's mailbox/draft/attachment", async () => {
    const t = await setup(),
      b = await invite(t),
      o = await t.read(),
      d = await t.draft(),
      a = await t.propose(d.draftId);
    await expect(emailHistory(b.id, t.w, d.draftId)).rejects.toThrow(
      "EMAIL_DRAFT_NOT_FOUND",
    );
    const v = await emailView(b.id, t.w);
    await expect(
      execute(
        b.id,
        t.w,
        randomUUID(),
        {
          type: "email.authorize",
          actionId: a.actionId,
          version: 1,
          expectedContextRevision: v.contextRevision,
          expectedAccessRevision: v.accessRevision,
          representSelf: true,
          discloseToRecipients: true,
        },
        b.session,
      ),
    ).rejects.toThrow("EMAIL_ACTION_NOT_FOUND");
    await expect(
      execute(
        b.id,
        t.w,
        randomUUID(),
        {
          type: "email.read",
          connectionId: t.c.connectionId,
          request: { mode: "search", query: "locale" },
        },
        b.session,
      ),
    ).rejects.toThrow("EMAIL_MAILBOX_ACCESS_DENIED");
    expect(o.request).toEqual({ mode: "search", query: "locale" });
    const r = await t.cmd({
      type: "email.read",
      connectionId: t.c.connectionId,
      request: {
        mode: "attachment",
        observationId: o.id,
        messageId: "message-1",
        attachmentId: "attachment-1",
      },
    });
    await processEmailRead(r.readId, t.p);
    const attachment = (await t.view()).attachments[0];
    const { kind, id, version, hash, filename } = attachment;
    const ref = { kind, id, version, hash, filename };
    const own = await t.cmd({
      type: "email.draft.create",
      connectionId: t.c.connectionId,
      envelope: { ...t.envelope, attachments: [ref] },
      reason: "Explicit private attachment",
    });
    const proposed = await t.propose(own.draftId);
    await t.authorize(proposed.actionId);
    await processEmailSend(proposed.actionId, t.p);
    expect(t.p.sent[0].attachments[0].bytes.equals(t.p.bytes)).toBe(true);
    expect(t.p.sent[0].attachments[0].hash).toBe(hash);
    expect((await emailView(b.id, t.w)).workspaceAttachments).toEqual([]);
    await expect(
      execute(
        b.id,
        t.w,
        randomUUID(),
        {
          type: "email.draft.create",
          connectionId: null,
          envelope: { ...t.envelope, sender: b.email, attachments: [ref] },
          reason: "Not mine",
        },
        b.session,
      ),
    ).rejects.toThrow("EMAIL_ATTACHMENT_STALE_OR_DENIED");
  });
  it("Miriam composition stays a private version-anchored suggestion, cannot send or overwrite a correction, and retains provenance", async () => {
    const t = await setup(),
      b = await invite(t),
      d = await t.draft();
    const input = {
      draftId: d.draftId,
      version: 1,
      instruction: "Rendi il testo più breve",
    };
    let supplied: unknown;
    const composer = {
      async compose(data: unknown) {
        supplied = data;
        return {
          subject: "Visita breve",
          body: "Posso visitare venerdì?",
          needsClarification: null,
        };
      },
    };
    const before = (await t.view()).revision;
    const suggestion = await composeEmail(
      t.a.id,
      t.w,
      t.a.session,
      input,
      composer,
    );
    expect(supplied).toEqual({
      kind: "new",
      subject: t.envelope.subject,
      body: t.envelope.body,
      instruction: input.instruction,
    });
    expect(JSON.stringify(supplied)).not.toContain("hidden@example.test");
    expect((await t.view()).drafts[0].version).toBe(1);
    expect((await t.view()).revision).toBe(before);
    expect((await t.view()).actions).toEqual([]);
    await expect(
      composeEmail(b.id, t.w, b.session, input, composer),
    ).rejects.toThrow("EMAIL_DRAFT_NOT_FOUND");
    await t.cmd({
      type: "email.draft.revise",
      draftId: d.draftId,
      expectedVersion: 1,
      compositionId: suggestion.id,
      connectionId: t.c.connectionId,
      envelope: {
        ...t.envelope,
        subject: suggestion.suggestion.subject,
        body: suggestion.suggestion.body,
      },
      reason: "Ho controllato la proposta di Miriam",
    });
    const history = await emailHistory(t.a.id, t.w, d.draftId);
    expect(history.versions[1].composition_id).toBe(suggestion.id);
    expect(history.compositions[0].instruction).toBe(input.instruction);
    await expect(
      composeEmail(
        t.a.id,
        t.w,
        t.a.session,
        { ...input, version: 2 },
        {
          async compose() {
            await t.cmd({
              type: "email.draft.revise",
              draftId: d.draftId,
              expectedVersion: 2,
              connectionId: t.c.connectionId,
              envelope: t.envelope,
              reason: "Correzione concorrente",
            });
            return {
              subject: "Stale",
              body: "Stale",
              needsClarification: null,
            };
          },
        },
      ),
    ).rejects.toThrow("EMAIL_DRAFT_STALE");
    const needs = await composeEmail(
      t.a.id,
      t.w,
      t.a.session,
      { ...input, version: 3 },
      {
        async compose() {
          return {
            subject: "Unsafe",
            body: "Invented",
            needsClarification: "Quale data?",
          };
        },
      },
    );
    expect(needs.suggestion.body).toBe("");
    await expect(
      t.cmd({
        type: "email.draft.revise",
        draftId: d.draftId,
        expectedVersion: 3,
        compositionId: needs.id,
        connectionId: t.c.connectionId,
        envelope: t.envelope,
        reason: "Insufficient context",
      }),
    ).rejects.toThrow("EMAIL_COMPOSITION_STALE_OR_DENIED");
    expect(t.p.writes).toBe(0);
    await expect(
      composeEmail(t.a.id, t.w, t.a.session, { ...input, version: 3 }),
    ).rejects.toThrow("AI_CONFIGURATION_REQUIRED");
  });
  it("can disconnect an owned connection even when external capabilities are unavailable", async () => {
    const t = await setup();
    t.p.discover = async () => ({
      accountRef: t.a.email,
      sender: t.a.email,
      canRead: false,
      canSendSelf: false,
    });
    const c = await establishMailbox(
      t.a.id,
      t.w,
      t.a.session,
      t.p,
      t.a.email,
      "Revoked external permissions",
    );
    await t.cmd({
      type: "email.disconnect",
      connectionId: c.connectionId,
      expectedVersion: 1,
    });
    expect(
      (await t.view()).connections.find((x) => x.id === c.connectionId)?.active,
    ).toBe(false);
  });
  it("isolates Workspace/account references and refuses fabricated source text or sender authority", async () => {
    const t = await setup(),
      u = await setup(),
      o = await t.read();
    await expect(
      u.cmd({
        type: "email.disclose",
        observationId: o.id,
        messageId: "message-1",
        text: "Il locale",
        fullHistoryDisclosed: true,
      }),
    ).rejects.toThrow("EMAIL_OBSERVATION_NOT_FOUND");
    await expect(
      t.cmd({
        type: "email.disclose",
        observationId: o.id,
        messageId: "message-1",
        text: "Invented content",
        fullHistoryDisclosed: true,
      }),
    ).rejects.toThrow("EMAIL_EXCERPT_NOT_IN_SOURCE");
    await expect(
      t.cmd({
        type: "email.draft.create",
        connectionId: t.c.connectionId,
        envelope: { ...t.envelope, sender: u.a.email },
        reason: "Wrong",
      }),
    ).rejects.toThrow("EMAIL_SENDER_NOT_REPRESENTED");
    await expect(emailView(u.a.id, t.w)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
  });
  it("draft and proposal never send; exact authorization preserves CC/BCC/content and receipt is acceptance, not delivery", async () => {
    const t = await setup(),
      d = await t.draft();
    expect(t.p.writes).toBe(0);
    const a = await t.propose(d.draftId);
    await processEmailSend(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    await t.authorize(a.actionId);
    await Promise.all([
      processEmailSend(a.actionId, t.p),
      processEmailSend(a.actionId, t.p),
    ]);
    expect(t.p.writes).toBe(1);
    expect(t.p.sent[0].envelope).toEqual(t.envelope);
    const v = await t.view();
    expect(v.actions[0].status).toBe("SUCCEEDED");
    expect(v.actions[0].receipt?.evidence).toBe("provider_accepted");
    expect(
      JSON.stringify(await emailHistory(t.a.id, t.w, d.draftId)),
    ).toContain("commit_point");
  });
  it("material draft changes invalidate previous approval; exact command replay cannot duplicate drafts", async () => {
    const t = await setup(),
      key = randomUUID(),
      input = {
        type: "email.draft.create",
        connectionId: t.c.connectionId,
        envelope: t.envelope,
        reason: "One",
      };
    const d = await t.cmd(input, key);
    expect(await t.cmd(input, key)).toEqual(d);
    await expect(t.cmd({ ...input, reason: "Two" }, key)).rejects.toThrow(
      "COMMAND_ID_REUSED",
    );
    const a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    await t.cmd({
      type: "email.draft.revise",
      draftId: d.draftId,
      expectedVersion: 1,
      connectionId: t.c.connectionId,
      envelope: { ...t.envelope, cc: ["another@example.test"] },
      reason: "Change recipient",
    });
    await processEmailSend(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    expect((await t.view()).actions[0].status).toBe("REJECTED");
    expect((await emailHistory(t.a.id, t.w, d.draftId)).versions).toHaveLength(
      2,
    );
  });
  it("reply preserves target thread and forward sends only explicitly selected content and attachments", async () => {
    const t = await setup(),
      o = await t.read();
    for (const kind of ["reply", "forward"] as const) {
      const d = await t.cmd({
        type: "email.draft.create",
        connectionId: t.c.connectionId,
        envelope: {
          ...t.envelope,
          kind,
          target: { observationId: o.id, messageId: "message-1" },
          body:
            kind === "forward"
              ? "Il locale è disponibile venerdì."
              : "Sì, venerdì.",
          attachments: [],
        },
        reason: kind,
      });
      await expect(
        t.cmd({ type: "email.propose", draftId: d.draftId, version: 1 }),
      ).rejects.toThrow();
      const a = await t.propose(d.draftId);
      await t.authorize(a.actionId);
      await processEmailSend(a.actionId, t.p);
    }
    expect(t.p.writes).toBe(2);
    expect(t.p.sent[0].target?.threadId).toBe("thread-1");
    expect(t.p.sent[0].target?.internetMessageId).toBe("<source@example.test>");
    expect(t.p.sent[1].envelope.kind).toBe("forward");
    expect(t.p.sent[1].envelope.body).not.toContain("Dettaglio privato");
    expect(t.p.sent[1].attachments).toEqual([]);
  });
  it("changed thread source blocks reply before Commit Point", async () => {
    const t = await setup(),
      o = await t.read(),
      d = await t.cmd({
        type: "email.draft.create",
        connectionId: t.c.connectionId,
        envelope: {
          ...t.envelope,
          kind: "reply",
          target: { observationId: o.id, messageId: "message-1" },
        },
        reason: "Reply",
      }),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    t.p.revision = "2";
    await processEmailSend(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    expect((await t.view()).actions[0].error).toBe(
      "EMAIL_THREAD_SOURCE_CHANGED",
    );
  });
  it("attachment identity/hash/version are exact and a newer Workspace file invalidates pending send", async () => {
    const t = await setup(),
      file = await t.cmd({
        type: "document.upload",
        filename: "note.txt",
        bytesBase64: Buffer.from("Original version").toString("base64"),
      });
    const attachment = (await t.view()).workspaceAttachments[0];
    const d = await t.cmd({
        type: "email.draft.create",
        connectionId: t.c.connectionId,
        envelope: { ...t.envelope, attachments: [attachment] },
        reason: "Attach",
      }),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    await t.cmd({
      type: "document.upload",
      filename: "note.txt",
      bytesBase64: Buffer.from("Changed version").toString("base64"),
      previousSourceId: file.sourceId,
    });
    await processEmailSend(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    expect((await t.view()).actions[0].error).toBe(
      "EMAIL_ATTACHMENT_STALE_OR_DENIED",
    );
  });
  it.each(["session", "membership", "connection", "eligibility", "context"])(
    "revalidates %s immediately before effect",
    async (mode) => {
      const t = await setup(),
        d = await t.draft(),
        a = await t.propose(d.draftId);
      await t.authorize(a.actionId);
      t.p.beforeCheck = async () => {
        t.p.beforeCheck = undefined;
        if (mode === "session")
          await pool.query("DELETE FROM session WHERE id=$1", [t.a.session]);
        if (mode === "membership")
          await t.cmd({ type: "member.leave", confirmed: true });
        if (mode === "connection")
          await t.cmd({
            type: "email.disconnect",
            connectionId: t.c.connectionId,
            expectedVersion: 1,
          });
        if (mode === "eligibility")
          await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
            t.a.id,
          ]);
        if (mode === "context")
          await t.cmd({ type: "goal.establish", content: "Changed goal" });
      };
      await processEmailSend(a.actionId, t.p);
      expect(t.p.writes).toBe(0);
      expect(
        (
          await pool.query("SELECT status FROM email_send WHERE id=$1", [
            a.actionId,
          ])
        ).rows[0].status,
      ).toBe("FAILED");
    },
  );
  it("read revoked during provider call cannot publish private observations", async () => {
    const t = await setup();
    t.p.afterRead = async () => {
      await t.cmd({
        type: "email.disconnect",
        connectionId: t.c.connectionId,
        expectedVersion: 1,
      });
    };
    const r = await t.cmd({
      type: "email.read",
      connectionId: t.c.connectionId,
      request: { mode: "search", query: "locale" },
    });
    await processEmailRead(r.readId, t.p);
    expect(
      (
        await pool.query(
          "SELECT * FROM email_observation WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("response loss is unknown, never a safe resend; reconciliation records exactly one effect", async () => {
    const t = await setup(),
      d = await t.draft(),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    t.p.loseResponse = true;
    await processEmailSend(a.actionId, t.p);
    expect((await t.view()).actions[0].status).toBe("OUTCOME_UNKNOWN");
    await expect(
      t.cmd({ type: "email.retry", actionId: a.actionId, version: 1 }),
    ).rejects.toThrow("EMAIL_RECONCILIATION_REQUIRED");
    await expect(
      t.cmd({
        type: "email.reject",
        actionId: a.actionId,
        version: 1,
        reason: "Cancel",
      }),
    ).rejects.toThrow("EMAIL_EFFECT_MAY_EXIST");
    await expect(
      t.cmd({
        type: "email.draft.revise",
        draftId: d.draftId,
        expectedVersion: 1,
        connectionId: t.c.connectionId,
        envelope: t.envelope,
        reason: "Retry via revision",
      }),
    ).rejects.toThrow("EMAIL_EFFECT_UNRESOLVED");
    const r = await t.cmd({
      type: "email.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processEmailRead(r.readId, t.p);
    expect((await t.view()).actions[0].status).toBe("SUCCEEDED");
    expect(t.p.writes).toBe(1);
  });
  it("restart recovery cannot manufacture absence; proven no-acceptance allows exact authorized retry", async () => {
    const t = await setup(),
      d = await t.draft(),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    await pool.query(
      "UPDATE email_send SET status='EXECUTING',attempt_id=$2,lease_until=now()-interval '1 minute' WHERE id=$1",
      [a.actionId, randomUUID()],
    );
    await recoverEmail();
    let r = await t.cmd({
      type: "email.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processEmailRead(r.readId, new FixtureEmail());
    expect((await t.view()).actions[0].status).toBe("OUTCOME_UNKNOWN");
    t.p.proveAbsence = true;
    r = await t.cmd({
      type: "email.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processEmailRead(r.readId, t.p);
    await t.cmd({ type: "email.retry", actionId: a.actionId, version: 1 });
    await processEmailSend(a.actionId, t.p);
    expect(t.p.writes).toBe(1);
  });
  it("revocation after dispatch does not erase accepted effect or permit its receipt to leak", async () => {
    const t = await setup(),
      d = await t.draft(),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    t.p.afterSend = async () => {
      await t.cmd({ type: "member.leave", confirmed: true });
    };
    await processEmailSend(a.actionId, t.p);
    expect(
      (
        await pool.query("SELECT status FROM email_send WHERE id=$1", [
          a.actionId,
        ])
      ).rows[0].status,
    ).toBe("SUCCEEDED");
    await expect(t.view()).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  });
  it("normal runtime has no fabricated mailbox/send; common API retains CSRF and private DTO contract", async () => {
    const t = await setup(),
      d = await t.draft(),
      a = await t.propose(d.draftId);
    await t.authorize(a.actionId);
    await processEmailSend(a.actionId);
    expect((await t.view()).actions[0].error).toBe(
      "EMAIL_PROVIDER_UNAVAILABLE",
    );
    const base = process.env.BETTER_AUTH_URL!,
      r = await handleAPI(
        new Request(`${base}/api/v1/workspaces/${t.w}/email`, {
          headers: { Cookie: t.a.cookie },
        }),
      );
    expect(r.status).toBe(200);
    emailViewSchema.parse(await r.json());
    const denied = await handleAPI(
      new Request(`${base}/api/v1/workspaces/${t.w}/commands`, {
        method: "POST",
        headers: {
          Cookie: t.a.cookie,
          Origin: "https://wrong.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commandId: randomUUID(),
          command: {
            type: "email.reject",
            actionId: a.actionId,
            version: 1,
            reason: "No",
          },
        }),
      }),
    );
    expect(denied.status).toBe(403);
  });
});
