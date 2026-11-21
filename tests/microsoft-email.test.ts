import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { auth } from "../src/server/auth";
import { createWorkspace } from "../src/server/commands";
import { pool } from "../src/server/db";
import { microsoftEmailProvider } from "../src/server/microsoft-email";
import { type GoogleToken, googleHash } from "../src/server/google-http";
import { EmailNoEffect, type EmailEffect } from "../src/server/email-provider";

const email = "sender@example.test",
  signal = () => AbortSignal.timeout(10000);
const token: GoogleToken = async () => ({
  accessToken: "test-only",
  email,
  subject: "stable",
  scopes: ["User.Read", "Mail.Read", "Mail.Send"],
});
const connection = {
  sender: email,
  connectionId: randomUUID(),
  accountRef: randomUUID(),
};
const address = (value: string) => ({ emailAddress: { address: value } });
const mail = {
  id: "item",
  changeKey: "v3",
  conversationId: "thread",
  internetMessageId: "<original@example.test>",
  internetMessageHeaders: [
    { name: "References", value: "<previous@example.test>" },
  ],
  from: address(email),
  toRecipients: [address("reader@example.test")],
  ccRecipients: [],
  bccRecipients: [],
  replyTo: [],
  subject: "Subject",
  body: { contentType: "text", content: "Private text." },
  sentDateTime: "2026-11-20T08:00:00Z",
};
const item = {
  "@odata.type": "#microsoft.graph.fileAttachment",
  id: "file",
  name: "note.txt",
  contentType: "text/plain",
  size: 3,
};
function transport(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer test-only",
    );
    if (url.pathname === "/v1.0/me")
      return Response.json({
        id: "stable",
        mail: email,
        userPrincipalName: "alias@other.test",
      });
    return handler(url, init);
  });
}
async function credential() {
  const { user } = await auth.api.signUpEmail({
    body: {
      email: randomUUID() + "@example.test",
      name: "Mailbox transport",
      password: "Local-mail-fixture-2026!",
    },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const w = await createWorkspace(user.id, "Mailbox transport", randomUUID()),
    id = randomUUID();
  await pool.query(
    "INSERT INTO google_credential(id,workspace_id,person_id,membership_version,capability,google_subject,email,scopes,expires_at,status,provider) VALUES ($1,$2,$3,1,'email','stable',$4,ARRAY['Mail.Read','Mail.Send'],now()+interval '2 hours','active','microsoft')",
    [id, w.id, user.id, email],
  );
  return { ...connection, accountRef: id };
}
function effect(): EmailEffect {
  const bytes = Buffer.from("abc"),
    att = {
      filename: "note.txt",
      hash: googleHash(bytes),
      bytes,
      mediaType: "text/plain",
    };
  return {
    authorizedAt: "2026-11-20T09:12:30Z",
    operationKey: randomUUID(),
    envelopeHash: "a".repeat(64),
    envelope: {
      sender: email,
      to: ["reader@example.test"],
      cc: [],
      bcc: ["audit@example.test"],
      subject: "Preventivo",
      body: "Il testo approvato.",
      attachments: [
        {
          kind: "workspace_source",
          version: 1,
          id: randomUUID(),
          hash: att.hash,
          filename: att.filename,
        },
      ],
      target: null,
      kind: "new",
    },
    target: null,
    attachments: [att],
  };
}
afterAll(() => pool.end());
describe("Microsoft Graph mailbox transport", () => {
  it("verifies the mailbox identity and scopes before reading any messages", async () => {
    const http = transport(() => {
      throw Error("Unexpected operation");
    });
    const p = microsoftEmailProvider(token, http);
    await expect(
      p.discover(connection.accountRef, signal()),
    ).resolves.toMatchObject({
      sender: email,
      canRead: true,
      canSendSelf: true,
    });
    await expect(
      p.search(
        { ...connection, sender: "other@example.test" },
        "x",
        undefined,
        signal(),
      ),
    ).rejects.toThrow("MICROSOFT_MAILBOX_ACCESS_CHANGED");
    const revoked = microsoftEmailProvider(
      async (...args) => ({ ...(await token(...args)), scopes: ["Mail.Send"] }),
      http,
    );
    await expect(
      revoked.fetch(connection, "message", "item", undefined, signal()),
    ).rejects.toThrow("MICROSOFT_MAILBOX_ACCESS_CHANGED");
    expect(
      http.mock.calls.every(
        ([u]) => new URL(String(u)).pathname === "/v1.0/me",
      ),
    ).toBe(true);
  });
  it("pages private matches on the fixed account and checks source versions before disclosing bytes", async () => {
    let revision = "v3",
      unsafe = false;
    const http = transport((u) => {
      if (u.pathname.endsWith("/messages")) {
        expect(u.searchParams.get("$search")).toBe('"Lancio"');
        if (u.searchParams.has("$skip")) {
          expect(u.searchParams.get("$skip")).toBe("12");
          expect(u.searchParams.get("opaque")).toBe("keep");
          return Response.json({ value: [] });
        }
        return Response.json({
          value: [{ id: "item" }],
          "@odata.nextLink": unsafe
            ? "https://unrelated.example.invalid/data"
            : u.href + "&$skip=12&opaque=keep",
        });
      }
      if (u.pathname.endsWith("/messages/item"))
        return Response.json({ ...mail, changeKey: revision });
      if (u.pathname.endsWith("/attachments"))
        return Response.json({ value: [item] });
      if (u.pathname.endsWith("/attachments/file"))
        return Response.json({ id: "file", contentBytes: "YWJj" });
      throw Error("Unexpected operation");
    });
    const p = microsoftEmailProvider(token, http);
    const first = await p.search(connection, "Lancio", undefined, signal());
    expect(first.complete).toBe(false);
    expect(first.messages[0]).toMatchObject({
      id: "item",
      from: email,
      references: ["<previous@example.test>"],
      body: "Private text.",
      attachments: [{ hash: googleHash("abc") }],
    });
    expect(
      await p.search(connection, "Lancio", first.nextCursor!, signal()),
    ).toEqual({ messages: [], nextCursor: null, complete: true });
    await expect(
      p.search(connection, "different search", first.nextCursor!, signal()),
    ).rejects.toThrow("MICROSOFT_EMAIL_INVALID_PAGE");
    await expect(
      p.search(
        { ...connection, accountRef: randomUUID() },
        "Lancio",
        first.nextCursor!,
        signal(),
      ),
    ).rejects.toThrow("MICROSOFT_EMAIL_INVALID_PAGE");
    expect(
      await p.attachment(connection, first.messages[0], "file", signal()),
    ).toEqual(Buffer.from("abc"));
    revision = "v4";
    await expect(
      p.attachment(connection, first.messages[0], "file", signal()),
    ).rejects.toThrow("MICROSOFT_EMAIL_SOURCE_CHANGED");
    unsafe = true;
    await expect(
      p.search(connection, "Lancio", undefined, signal()),
    ).rejects.toThrow("MICROSOFT_EMAIL_INVALID_PAGE");
    await expect(
      p.fetch(connection, "message", "..", undefined, signal()),
    ).rejects.toThrow("MICROSOFT_EMAIL_INVALID_ID");
  });
  it("returns provider acceptance on 202, preserves exact MIME and prevents duplicate submissions", async () => {
    const access = await credential(),
      e = effect();
    let sends = 0;
    const http = transport((u, init) => {
      expect(u.pathname).toBe("/v1.0/me/sendMail");
      expect(init.method).toBe("POST");
      const mime = Buffer.from(String(init.body), "base64").toString();
      expect(mime).toContain("Bcc: audit@example.test\r\n");
      expect(mime).toContain("To: reader@example.test\r\n");
      expect(mime).toContain(Buffer.from(e.envelope.body).toString("base64"));
      expect(mime).toContain("filename*=UTF-8''note.txt");
      sends++;
      return new Response(null, {
        status: 202,
        headers: { "request-id": "graph-operation-123" },
      });
    });
    const p = microsoftEmailProvider(token, http),
      receipt = await p.send(access, e, signal());
    expect(receipt).toMatchObject({
      operationKey: e.operationKey,
      submissionStatus: "accepted_for_processing",
      providerRequestId: "graph-operation-123",
      providerMessageId: null,
      evidence: "provider_accepted",
    });
    // Recreate the adapter as a restarted worker would.
    expect(
      await microsoftEmailProvider(token, http).send(access, e, signal()),
    ).toEqual(receipt);
    expect(
      await p.reconcile(access, e.operationKey, e.envelopeHash, signal()),
    ).toEqual({ outcome: "accepted", receipt });
    await expect(
      p.send(access, { ...e, envelopeHash: "c".repeat(64) }, signal()),
    ).rejects.toThrow("MICROSOFT_EMAIL_OPERATION_MISMATCH");
    expect(sends).toBe(1);
  });
  it("recovers a lost acceptance only when the Sent Items copy proves the exact envelope, including BCC", async () => {
    const access = await credential(),
      e = effect();
    e.attachments = [];
    e.envelope.attachments = [];
    let messageId = "",
      sends = 0,
      observedBcc = "unexpected@example.test";
    const http = transport((u, init) => {
      if (u.pathname.endsWith("/sendMail")) {
        sends++;
        const mime = Buffer.from(String(init.body), "base64").toString();
        messageId = /^Message-ID: (.+)$/m.exec(mime)![1].trim();
        throw new Error("Connection closed after dispatch");
      }
      if (u.pathname.endsWith("/sentitems/messages")) {
        expect(u.searchParams.get("$filter")).toContain(messageId);
        return Response.json({ value: [{ id: mail.id }] });
      }
      if (u.pathname.endsWith("/messages/item"))
        return Response.json({
          ...mail,
          internetMessageId: messageId,
          internetMessageHeaders: [
            { name: "X-Miriam-Envelope-Hash", value: e.envelopeHash },
          ],
          body: { contentType: "text", content: e.envelope.body },
          subject: e.envelope.subject,
          bccRecipients: [address(observedBcc)],
        });
      if (u.pathname.endsWith("/attachments"))
        return Response.json({ value: [] });
      throw new Error("Unexpected operation");
    });
    const p = microsoftEmailProvider(token, http);
    await expect(p.send(access, e, signal())).rejects.toThrow(
      "Connection closed",
    );
    expect(
      await p.reconcile(access, e.operationKey, e.envelopeHash, signal()),
    ).toEqual({ outcome: "unknown" });
    observedBcc = e.envelope.bcc[0];
    const result = await p.reconcile(
      access,
      e.operationKey,
      e.envelopeHash,
      signal(),
    );
    expect(result).toMatchObject({
      outcome: "accepted",
      receipt: {
        providerMessageId: "item",
        providerThreadId: "thread",
        envelopeHash: e.envelopeHash,
      },
    });
    expect(await p.send(access, e, signal())).toMatchObject({
      providerMessageId: "item",
    });
    expect(sends).toBe(1);
  });
  it("keeps an uncertain submission fenced despite an empty sent folder; only a definite rejection is safe to retry", async () => {
    const access = await credential(),
      e = effect(),
      rejected = effect();
    let status = 503,
      sends = 0;
    const p = microsoftEmailProvider(
      token,
      transport((u) => {
        if (u.pathname.endsWith("/sendMail")) {
          sends++;
          return new Response(null, { status });
        }
        if (u.pathname.endsWith("/sentitems/messages"))
          return Response.json({ value: [] });
        throw Error("Unexpected operation");
      }),
    );
    await expect(p.send(access, e, signal())).rejects.toThrow(
      "MICROSOFT_EMAIL_OUTCOME_UNKNOWN",
    );
    expect(
      await p.reconcile(access, e.operationKey, e.envelopeHash, signal()),
    ).toEqual({ outcome: "unknown" });
    await expect(p.send(access, e, signal())).rejects.toThrow(
      "MICROSOFT_EMAIL_OUTCOME_UNKNOWN",
    );
    expect(sends).toBe(1);
    status = 403;
    await expect(p.send(access, rejected, signal())).rejects.toBeInstanceOf(
      EmailNoEffect,
    );
    expect(
      await p.reconcile(
        access,
        rejected.operationKey,
        rejected.envelopeHash,
        signal(),
      ),
    ).toMatchObject({ outcome: "not_accepted" });
    status = 202;
    await expect(p.send(access, rejected, signal())).resolves.toMatchObject({
      submissionStatus: "accepted_for_processing",
      providerRequestId: null,
    });
  });
});
