import { z } from "zod";
import {
  emailMessageSchema,
  emailObservationSchema,
  emailReceiptSchema,
  type EmailMessage,
} from "../contracts/email.ts";
import { reserveEmailDelivery } from "./email-delivery.ts";
import { pool } from "./db.ts";
import {
  EmailNoEffect,
  type EmailAccess,
  type EmailProvider,
  type EmailReceipt,
} from "./email-provider.ts";
import { emailMIME, cleanBody } from "./email-mime.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  integrationCredentialToken,
  encryptGoogleSecret,
  decryptGoogleSecret,
  microsoftMailboxIdentity,
} from "./google-credentials.ts";
import {
  googleHash as hash,
  microsoftJSON,
  MicrosoftHTTPError,
  type GoogleToken,
} from "./google-http.ts";

const root = "https://graph.microsoft.com/v1.0/me";
const recipient = z.object({
  emailAddress: z.object({ address: z.email().toLowerCase() }),
});
const recipients = z.array(recipient).max(200);
const addresses = (people: z.infer<typeof recipients>) =>
  people.map((p) => p.emailAddress.address);
const messageSchema = z.object({
  id: z.string().min(1),
  changeKey: z.string().min(1),
  conversationId: z.string().min(1),
  internetMessageId: z.string().nullable().optional(),
  internetMessageHeaders: z
    .array(z.object({ name: z.string(), value: z.string().max(32000) }))
    .max(500),
  from: recipient,
  toRecipients: recipients,
  ccRecipients: recipients,
  bccRecipients: recipients,
  replyTo: recipients,
  subject: z.string(),
  body: z.object({ contentType: z.literal("text"), content: z.string() }),
  sentDateTime: z.string(),
});
const attachmentMeta = z.object({
  "@odata.type": z.literal("#microsoft.graph.fileAttachment"),
  id: z.string().min(1),
  name: z.string(),
  contentType: z.string().nullable(),
  size: z.number().int().nonnegative().max(1048576),
});
const page = z.object({
  value: z.array(z.object({ id: z.string().min(1) })).max(10),
  "@odata.nextLink": z.string().optional(),
});
function segment(value: string) {
  requireThat(
    value.length > 0 &&
      value !== "." &&
      value !== ".." &&
      !/[\r\n\0]/.test(value),
    "MICROSOFT_EMAIL_INVALID_ID",
    400,
  );
  return encodeURIComponent(value);
}
const projected = (path: string, fields: string) => {
  const url = new URL(root + path);
  url.searchParams.set("$select", fields);
  return url;
};
// Graph owns the entire nextLink, including any service-specific paging parameters.
function mailboxPage(raw: string) {
  const next = new URL(raw);
  const endpoint = new URL(root + "/messages");
  requireThat(
    next.origin === endpoint.origin &&
      next.pathname === endpoint.pathname &&
      !next.username &&
      !next.password &&
      !next.hash,
    "MICROSOFT_EMAIL_INVALID_PAGE",
    502,
  );
  return next;
}
function resumePage(cursor: string, purpose: string) {
  try {
    requireThat(
      /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(
        cursor,
      ) && cursor.length <= 2000,
      "MICROSOFT_EMAIL_INVALID_PAGE",
    );
    return mailboxPage(decryptGoogleSecret(cursor, purpose));
  } catch {
    throw new DomainError("MICROSOFT_EMAIL_INVALID_PAGE", 400);
  }
}
export function microsoftEmailProvider(
  token: GoogleToken = (id, signal) =>
    integrationCredentialToken(id, "email", signal, fetcher, "microsoft"),
  fetcher: typeof fetch = fetch,
): EmailProvider {
  async function identify(id: string, signal: AbortSignal) {
    const auth = await token(id, signal);
    const user = await microsoftMailboxIdentity(
      auth.accessToken,
      signal,
      fetcher,
    );
    requireThat(
      auth.email === user.email && (!auth.subject || auth.subject === user.sub),
      "MICROSOFT_MAILBOX_IDENTITY_MISMATCH",
      403,
    );
    const scopes = new Set(
      auth.scopes.map((s) =>
        s.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, ""),
      ),
    );
    return {
      auth,
      identity: {
        accountRef: id,
        sender: user.email,
        canRead: scopes.has("mail.read"),
        canSendSelf: scopes.has("mail.send"),
      },
    };
  }
  async function accessToken(
    access: EmailAccess,
    signal: AbortSignal,
    scope: "canRead" | "canSendSelf",
  ) {
    const { auth, identity } = await identify(access.accountRef, signal);
    requireThat(
      identity.sender === access.sender && identity[scope],
      "MICROSOFT_MAILBOX_ACCESS_CHANGED",
      403,
    );
    return auth.accessToken;
  }
  function read(url: URL | string, auth: string, signal: AbortSignal) {
    return microsoftJSON(
      url,
      {
        signal,
        headers: {
          Authorization: "Bearer " + auth,
          Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
        },
      },
      fetcher,
      3 * 1024 * 1024,
    );
  }
  async function full(id: string, auth: string, signal: AbortSignal) {
    const path = "/messages/" + segment(id),
      raw = messageSchema.parse(
        await read(
          projected(path, Object.keys(messageSchema.shape).join(",")),
          auth,
          signal,
        ),
      );
    requireThat(raw.id === id, "MICROSOFT_EMAIL_IDENTITY_MISMATCH", 502);
    // hasAttachments excludes inline files. Enumerate metadata independently so the
    // observed version covers inline attachments too, without rendering remote HTML.
    const url = projected(path + "/attachments", "id,name,contentType,size");
    url.searchParams.set("$top", "100");
    const files = z
      .object({
        value: z.array(attachmentMeta).max(100),
        "@odata.nextLink": z.string().optional(),
      })
      .parse(await read(url, auth, signal));
    requireThat(
      !files["@odata.nextLink"] &&
        files.value.reduce((acc, f) => acc + f.size, 0) <= 8 * 1024 * 1024,
      "MICROSOFT_EMAIL_ATTACHMENTS_TOO_LARGE",
      422,
    );
    const attachments = [];
    for (const f of files.value) {
      const item = z
        .object({ id: z.string(), contentBytes: z.base64().max(1398104) })
        .parse(
          await read(
            new URL(root + path + "/attachments/" + segment(f.id)),
            auth,
            signal,
          ),
        );
      const bytes = Buffer.from(item.contentBytes, "base64");
      requireThat(
        item.id === f.id && bytes.length === f.size,
        "MICROSOFT_EMAIL_ATTACHMENT_CHANGED",
        409,
      );
      attachments.push({
        id: f.id,
        filename: f.name,
        mediaType: f.contentType ?? "application/octet-stream",
        size: bytes.length,
        hash: hash(bytes),
        bytes,
      });
    }
    const header = (name: string) =>
      raw.internetMessageHeaders.find((h) => h.name.toLowerCase() === name)
        ?.value;
    const message = emailMessageSchema.parse({
      id,
      threadId: raw.conversationId,
      revision: hash(
        JSON.stringify([raw.changeKey, attachments.map((a) => [a.id, a.hash])]),
      ),
      internetMessageId: raw.internetMessageId ?? null,
      references: header("references")?.match(/<[^<>\s]+>/g) ?? [],
      from: raw.from.emailAddress.address,
      to: addresses(raw.toRecipients),
      cc: addresses(raw.ccRecipients),
      replyTo: addresses(raw.replyTo),
      subject: raw.subject,
      body: raw.body.content,
      sentAt: raw.sentDateTime,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mediaType: a.mediaType,
        size: a.size,
        hash: a.hash,
      })),
    });
    return { message, attachments, bcc: addresses(raw.bccRecipients), header };
  }
  async function list(
    auth: string,
    account: string,
    field: "$search" | "$filter",
    value: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) {
    const url = projected("/messages", "id");
    url.searchParams.set("$top", "10");
    url.searchParams.set(field, value);
    const purpose =
      "outlook-mail-page:" + hash(JSON.stringify([account, field, value]));
    const result = page.parse(
      await read(cursor ? resumePage(cursor, purpose) : url, auth, signal),
    );
    const rawNext = result["@odata.nextLink"];
    const nextCursor = rawNext
      ? encryptGoogleSecret(mailboxPage(rawNext).href, purpose)
      : null;
    requireThat(
      !nextCursor || nextCursor.length <= 2000,
      "MICROSOFT_EMAIL_INVALID_PAGE",
      422,
    );
    const messages: EmailMessage[] = [];
    for (const item of result.value)
      messages.push((await full(item.id, auth, signal)).message);
    return emailObservationSchema.parse({
      messages,
      complete: !nextCursor,
      nextCursor,
    });
  }
  async function storeReceipt(id: string, receipt: EmailReceipt) {
    await pool.query(
      "UPDATE google_email_delivery SET status='accepted',receipt=$3 WHERE credential_id=$1 AND operation_key=$2 AND envelope_hash=$4",
      [id, receipt.operationKey, receipt, receipt.envelopeHash],
    );
    return receipt;
  }
  return {
    key: "microsoft-outlook",
    async discover(id, signal) {
      return (await identify(id, signal)).identity;
    },
    async checkAccess(access, signal) {
      const { identity } = await identify(access.accountRef, signal);
      requireThat(
        identity.sender === access.sender,
        "MICROSOFT_MAILBOX_IDENTITY_MISMATCH",
        403,
      );
      return identity;
    },
    async search(access, query, cursor, signal) {
      const auth = await accessToken(access, signal, "canRead");
      return list(
        auth,
        access.accountRef,
        "$search",
        JSON.stringify(query),
        cursor,
        signal,
      );
    },
    async fetch(access, mode, id, cursor, signal) {
      const auth = await accessToken(access, signal, "canRead");
      if (mode === "thread") {
        const observation = await list(
          auth,
          access.accountRef,
          "$filter",
          "conversationId eq '" + id.replaceAll("'", "''") + "'",
          cursor,
          signal,
        );
        requireThat(
          observation.messages.every((m) => m.threadId === id),
          "MICROSOFT_EMAIL_IDENTITY_MISMATCH",
          502,
        );
        return observation;
      }
      requireThat(!cursor, "MICROSOFT_EMAIL_INVALID_PAGE", 400);
      return {
        messages: [(await full(id, auth, signal)).message],
        complete: true,
        nextCursor: null,
      };
    },
    async attachment(access, message, id, signal) {
      const current = await full(
        message.id,
        await accessToken(access, signal, "canRead"),
        signal,
      );
      requireThat(
        current.message.revision === message.revision,
        "MICROSOFT_EMAIL_SOURCE_CHANGED",
        409,
      );
      const attachment = current.attachments.find((a) => a.id === id);
      requireThat(attachment, "MICROSOFT_EMAIL_ATTACHMENT_NOT_FOUND", 404);
      return attachment.bytes;
    },
    async send(access, effect, signal) {
      const messageId =
        "<" +
        hash(access.accountRef + ":" + effect.operationKey) +
        "@rimiam.invalid>";
      let auth: string, body: string;
      try {
        requireThat(
          access.sender === effect.envelope.sender,
          "MICROSOFT_EMAIL_SENDER_INVALID",
          403,
        );
        auth = await accessToken(access, signal, "canSendSelf");
        body = Buffer.from(emailMIME(effect, messageId)).toString("base64");
        requireThat(
          body.length < 4 * 1024 * 1024,
          "MICROSOFT_EMAIL_TOO_LARGE",
          422,
        );
      } catch {
        throw new EmailNoEffect("MICROSOFT_EMAIL_PREFLIGHT_FAILED");
      }
      const prior = await reserveEmailDelivery(
        access.accountRef,
        effect,
        messageId,
        "MICROSOFT",
      );
      if (prior) return prior;
      const response = await fetcher(root + "/sendMail", {
        method: "POST",
        signal,
        redirect: "error",
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "text/plain",
        },
        body,
      });
      await response.body?.cancel();
      if ([400, 401, 403, 404, 413, 429].includes(response.status)) {
        await pool.query(
          "UPDATE google_email_delivery SET status='rejected' WHERE credential_id=$1 AND operation_key=$2 AND status='sending'",
          [access.accountRef, effect.operationKey],
        );
        throw new EmailNoEffect(new MicrosoftHTTPError(response.status).code);
      }
      requireThat(
        response.status === 202,
        "MICROSOFT_EMAIL_OUTCOME_UNKNOWN",
        502,
      );
      return storeReceipt(
        access.accountRef,
        emailReceiptSchema.parse({
          operationKey: effect.operationKey,
          envelopeHash: effect.envelopeHash,
          providerMessageId: null,
          providerThreadId: null,
          providerRequestId: response.headers.get("request-id"),
          submissionStatus: "accepted_for_processing",
          acceptedAt: new Date().toISOString(),
          evidence: "provider_accepted",
        }),
      );
    },
    async reconcile(access, operationKey, envelopeHash, signal) {
      const auth = await accessToken(access, signal, "canRead");
      const saved = (
        await pool.query(
          "SELECT status,receipt,expected,internet_message_id FROM google_email_delivery WHERE credential_id=$1 AND operation_key=$2 AND envelope_hash=$3",
          [access.accountRef, operationKey, envelopeHash],
        )
      ).rows[0];
      if (!saved) return { outcome: "unknown" };
      if (saved.status === "accepted")
        return {
          outcome: "accepted",
          receipt: emailReceiptSchema.parse(saved.receipt),
        };
      if (saved.status === "rejected")
        return {
          outcome: "not_accepted",
          proof:
            "Microsoft Graph rejected this exact submission before acceptance.",
        };
      const url = projected("/mailFolders/sentitems/messages", "id");
      url.searchParams.set(
        "$filter",
        "internetMessageId eq '" +
          String(saved.internet_message_id).replaceAll("'", "''") +
          "'",
      );
      url.searchParams.set("$top", "10");
      const found = page.parse(await read(url, auth, signal));
      for (const { id } of found.value) {
        const { message: m, bcc, header } = await full(id, auth, signal),
          e = saved.expected;
        if (
          m.internetMessageId === saved.internet_message_id &&
          header("x-miriam-envelope-hash") === envelopeHash &&
          m.from === e.sender &&
          m.subject === e.subject &&
          cleanBody(m.body) === e.body &&
          JSON.stringify([m.to, m.cc, bcc]) ===
            JSON.stringify([e.to, e.cc, e.bcc]) &&
          JSON.stringify(
            m.attachments.map((a) => [a.filename, a.hash, a.size]),
          ) ===
            JSON.stringify(
              (
                e.attachments as {
                  filename: string;
                  hash: string;
                  size: number;
                }[]
              ).map((a) => [a.filename, a.hash, a.size]),
            ) &&
          (e.kind !== "reply" || header("in-reply-to") === e.targetMessageId)
        ) {
          const receipt = await storeReceipt(
            access.accountRef,
            emailReceiptSchema.parse({
              operationKey,
              envelopeHash,
              providerMessageId: m.id,
              providerThreadId: m.threadId,
              acceptedAt: m.sentAt,
              evidence: "provider_accepted",
            }),
          );
          return { outcome: "accepted", receipt };
        }
      }
      return { outcome: "unknown" };
    },
  };
}
