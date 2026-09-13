import { z } from "zod";
import {
  emailMessageSchema,
  emailObservationSchema,
  emailReceiptSchema,
  type EmailMessage,
} from "../contracts/email.ts";
import type { EmailEffect, EmailProvider } from "./email-provider.ts";
import { EmailNoEffect } from "./email-provider.ts";
import { googleCredentialToken } from "./google-credentials.ts";
import {
  googleJSON,
  GoogleHTTPError,
  googleHash,
  type GoogleToken,
} from "./google-http.ts";
import { pool } from "./db.ts";
import { requireThat } from "./errors.ts";

type Part = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: Part[];
};
const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string().max(32000) }))
      .max(500)
      .optional(),
    body: z
      .object({
        attachmentId: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        data: z.string().optional(),
      })
      .optional(),
    parts: z.array(partSchema).max(100).optional(),
  }),
);
const fullSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).optional(),
  payload: partSchema,
});
const endpoint = "https://gmail.googleapis.com/gmail/v1/users/me";
const hash = googleHash;
const headersOf = (p: Part, name: string) =>
  (p.headers ?? [])
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value);
function charset(contentType: string) {
  return /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ?? "utf-8";
}
function decode(bytes: Buffer, encoding: string) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new EmailNoEffect("GOOGLE_EMAIL_ENCODING_UNSUPPORTED");
  }
}
function encodedHeader(value: string) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,
      (_whole, cs: string, kind: string, data: string) => {
        const bytes =
          kind.toUpperCase() === "B"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data
                  .replaceAll("_", " ")
                  .replace(/=([0-9a-f]{2})/gi, (_m, hex: string) =>
                    String.fromCharCode(parseInt(hex, 16)),
                  ),
                "latin1",
              );
        return decode(bytes, cs);
      },
    );
}
// Google already parses MIME. This only recognizes bounded mailbox header syntax, not a MIME grammar.
function addresses(value: string) {
  if (!value.trim()) return [];
  const entries: string[] = [];
  let start = 0,
    quoted = false,
    angle = false,
    escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === "<") angle = true;
      if (c === ">") angle = false;
      if (c === "," && !angle) {
        entries.push(value.slice(start, i));
        start = i + 1;
      }
    }
  }
  requireThat(!quoted && !angle, "GOOGLE_EMAIL_ADDRESS_UNSUPPORTED", 422);
  entries.push(value.slice(start));
  return entries.map((s) => {
    const match = s.match(/<([^<>]+)>\s*$/);
    return z.email().parse((match ? match[1] : s).trim().toLowerCase());
  });
}
const wrappedBase64 = (bytes: Buffer) =>
  bytes
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
const encodedWord = (value: string) => {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  chunks.push(chunk);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c).toString("base64")}?=`)
    .join("\r\n ");
};
function cleanBody(body: string) {
  return body.replace(/\r\n/g, "\n");
}
export function googleEmailMIME(effect: EmailEffect, messageId: string) {
  const e = effect.envelope,
    boundary = `miriam_${hash(effect.operationKey).slice(0, 40)}`;
  const lines = [
    `From: ${e.sender}`,
    `To: ${e.to.join(", ")}`,
    `Cc: ${e.cc.join(", ")}`,
    `Bcc: ${e.bcc.join(", ")}`,
    `Subject: ${encodedWord(e.subject)}`,
    `Message-ID: ${messageId}`,
    `X-Miriam-Envelope-Hash: ${effect.envelopeHash}`,
    "MIME-Version: 1.0",
  ];
  if (e.kind === "reply") {
    requireThat(
      effect.target?.internetMessageId && effect.target.threadId,
      "GOOGLE_EMAIL_REPLY_METADATA_REQUIRED",
      422,
    );
    lines.push(
      `In-Reply-To: ${effect.target.internetMessageId}`,
      `References: ${[...effect.target.references, effect.target.internetMessageId].join(" ")}`,
    );
  }
  const text = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrappedBase64(Buffer.from(e.body)),
  ].join("\r\n");
  if (!effect.attachments.length) return `${lines.join("\r\n")}\r\n${text}`;
  lines.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    text,
  );
  for (const a of effect.attachments) {
    requireThat(
      hash(a.bytes) === a.hash &&
        /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(a.mediaType),
      "GOOGLE_EMAIL_ATTACHMENT_INVALID",
      422,
    );
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mediaType}`,
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(a.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrappedBase64(a.bytes),
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}
function expected(effect: EmailEffect) {
  const e = effect.envelope;
  return {
    sender: e.sender,
    to: e.to,
    cc: e.cc,
    bcc: e.bcc,
    subject: e.subject,
    body: cleanBody(e.body),
    attachments: effect.attachments.map((a) => ({
      filename: a.filename,
      hash: a.hash,
      size: a.bytes.length,
    })),
    kind: e.kind,
    targetMessageId: effect.target?.internetMessageId ?? null,
  };
}

export function googleEmailProvider(
  token: GoogleToken = (id, signal) =>
    googleCredentialToken(id, "email", signal),
  fetcher: typeof fetch = fetch,
): EmailProvider {
  async function request(
    account: string,
    url: string | URL,
    signal: AbortSignal,
    init: RequestInit = {},
  ) {
    const auth = await token(account, signal);
    return googleJSON(
      url,
      {
        ...init,
        signal,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      fetcher,
    );
  }
  async function identity(account: string, signal: AbortSignal) {
    const auth = await token(account, signal),
      profile = z
        .object({ emailAddress: z.email().toLowerCase() })
        .parse(await request(account, `${endpoint}/profile`, signal));
    requireThat(
      auth.email === profile.emailAddress,
      "GOOGLE_MAILBOX_IDENTITY_MISMATCH",
      403,
    );
    return {
      accountRef: account,
      sender: profile.emailAddress,
      canRead: auth.scopes.includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ),
      canSendSelf: auth.scopes.includes(
        "https://www.googleapis.com/auth/gmail.send",
      ),
    };
  }
  async function readFull(account: string, id: string, signal: AbortSignal) {
    const raw = fullSchema.parse(
      await request(
        account,
        `${endpoint}/messages/${encodeURIComponent(id)}?format=full`,
        signal,
      ),
    );
    requireThat(raw.id === id, "GOOGLE_EMAIL_IDENTITY_MISMATCH", 502);
    const p = raw.payload,
      attachments: {
        id: string;
        filename: string;
        mediaType: string;
        size: number;
        hash: string;
        bytes: Buffer;
      }[] = [];
    const plain: string[] = [],
      html: string[] = [];
    let visited = 0,
      total = 0;
    async function parts(part: Part, depth: number) {
      requireThat(
        depth <= 20 && ++visited <= 200,
        "GOOGLE_EMAIL_STRUCTURE_UNSUPPORTED",
        422,
      );
      const body = part.body ?? {},
        mime = part.mimeType ?? "application/octet-stream";
      if (part.parts?.length && !part.filename) {
        for (const c of part.parts) await parts(c, depth + 1);
        return;
      }
      requireThat(
        (body.size ?? 0) <= 1048576,
        "GOOGLE_EMAIL_PART_TOO_LARGE",
        413,
      );
      let bytes = Buffer.from(body.data ?? "", "base64url");
      if (body.attachmentId) {
        const v = z
          .object({
            data: z.string(),
            size: z.number().int().nonnegative().max(1048576),
          })
          .parse(
            await request(
              account,
              `${endpoint}/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(body.attachmentId)}`,
              signal,
            ),
          );
        bytes = Buffer.from(v.data, "base64url");
        requireThat(
          bytes.length === v.size,
          "GOOGLE_EMAIL_ATTACHMENT_INVALID",
          502,
        );
      }
      total += bytes.length;
      requireThat(total <= 10 * 1048576, "GOOGLE_EMAIL_MESSAGE_TOO_LARGE", 413);
      if (part.filename || !["text/plain", "text/html"].includes(mime)) {
        if (!bytes.length && !part.filename) return;
        attachments.push({
          id: body.attachmentId ?? `part:${part.partId ?? visited}`,
          filename: part.filename || `allegato-${visited}`,
          mediaType: mime,
          size: bytes.length,
          hash: hash(bytes),
          bytes,
        });
        return;
      }
      const text = decode(
        bytes,
        charset(headersOf(part, "content-type")[0] ?? ""),
      );
      (mime === "text/plain" ? plain : html).push(text);
    }
    await parts(p, 0);
    const from = addresses(headersOf(p, "from").join(","));
    requireThat(from.length === 1, "GOOGLE_EMAIL_ADDRESS_UNSUPPORTED", 422);
    const body = plain.length
      ? plain.join("\n")
      : html.length
        ? `[Contenuto HTML originale; nessuna risorsa remota caricata]\n${html.join("\n")}`
        : "";
    const semantic = {
      from: from[0],
      to: addresses(headersOf(p, "to").join(",")),
      cc: addresses(headersOf(p, "cc").join(",")),
      replyTo: addresses(headersOf(p, "reply-to").join(",")),
      subject: encodedHeader(headersOf(p, "subject")[0] ?? ""),
      body,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mediaType: a.mediaType,
        size: a.size,
        hash: a.hash,
      })),
    };
    const message = emailMessageSchema.parse({
      id: raw.id,
      threadId: raw.threadId,
      revision: hash(JSON.stringify(semantic)),
      internetMessageId: headersOf(p, "message-id")[0] ?? null,
      references: headersOf(p, "references")[0]?.match(/<[^<>\s]+>/g) ?? [],
      sentAt: new Date(Number(raw.internalDate)).toISOString(),
      ...semantic,
    });
    return {
      message,
      attachments,
      raw,
      bcc: addresses(headersOf(p, "bcc").join(",")),
    };
  }
  async function bounded(
    account: string,
    query: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) {
    const url = new URL(`${endpoint}/messages`);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "10");
    if (cursor) url.searchParams.set("pageToken", cursor);
    const result = z
      .object({
        messages: z
          .array(z.object({ id: z.string() }))
          .max(10)
          .optional(),
        nextPageToken: z.string().optional(),
      })
      .parse(await request(account, url, signal));
    const messages: EmailMessage[] = [];
    for (const m of result.messages ?? [])
      messages.push((await readFull(account, m.id, signal)).message);
    return emailObservationSchema.parse({
      messages,
      complete: !result.nextPageToken,
      nextCursor: result.nextPageToken ?? null,
    });
  }
  return {
    key: "google-gmail",
    discover: identity,
    async checkAccess(access, signal) {
      const i = await identity(access.accountRef, signal);
      requireThat(
        i.sender === access.sender,
        "GOOGLE_MAILBOX_IDENTITY_MISMATCH",
        403,
      );
      return i;
    },
    async search(access, query, cursor, signal) {
      await identity(access.accountRef, signal);
      return bounded(access.accountRef, query, cursor, signal);
    },
    async fetch(access, mode, targetId, cursor, signal) {
      await identity(access.accountRef, signal);
      if (mode === "message")
        return {
          messages: [
            (await readFull(access.accountRef, targetId, signal)).message,
          ],
          complete: true,
          nextCursor: null,
        };
      // Gmail's thread endpoint is unpaged; reject oversize rather than claim a truncated complete thread.
      requireThat(!cursor, "GOOGLE_EMAIL_THREAD_CURSOR_UNSUPPORTED", 422);
      const t = z
        .object({
          id: z.string(),
          messages: z.array(z.object({ id: z.string() })).max(50),
        })
        .parse(
          await request(
            access.accountRef,
            `${endpoint}/threads/${encodeURIComponent(targetId)}?format=minimal`,
            signal,
          ),
        );
      requireThat(t.id === targetId, "GOOGLE_EMAIL_IDENTITY_MISMATCH", 502);
      const messages: EmailMessage[] = [];
      for (const m of t.messages)
        messages.push(
          (await readFull(access.accountRef, m.id, signal)).message,
        );
      return { messages, complete: true, nextCursor: null };
    },
    async attachment(access, message, attachmentId, signal) {
      const current = await readFull(access.accountRef, message.id, signal);
      requireThat(
        current.message.revision === message.revision,
        "GOOGLE_EMAIL_SOURCE_CHANGED",
        409,
      );
      const a = current.attachments.find((a) => a.id === attachmentId);
      requireThat(a, "GOOGLE_EMAIL_ATTACHMENT_NOT_FOUND", 404);
      return a.bytes;
    },
    async send(access, effect, signal) {
      let authorization, raw: string;
      const messageId = `<${hash(`${access.accountRef}:${effect.operationKey}`)}@miriam.invalid>`;
      try {
        const i = await identity(access.accountRef, signal);
        requireThat(
          i.canSendSelf && i.sender === effect.envelope.sender,
          "GOOGLE_EMAIL_SENDER_INVALID",
          403,
        );
        authorization = await token(access.accountRef, signal);
        raw = googleEmailMIME(effect, messageId);
      } catch {
        throw new EmailNoEffect("GOOGLE_EMAIL_PREFLIGHT_FAILED");
      }
      const saved = await pool.query(
        "INSERT INTO google_email_delivery(credential_id,operation_key,envelope_hash,internet_message_id,expected,status) VALUES($1,$2,$3,$4,$5,'sending') ON CONFLICT(credential_id,operation_key) DO UPDATE SET status='sending' WHERE google_email_delivery.status='rejected' AND google_email_delivery.envelope_hash=EXCLUDED.envelope_hash RETURNING operation_key",
        [
          access.accountRef,
          effect.operationKey,
          effect.envelopeHash,
          messageId,
          expected(effect),
        ],
      );
      if (!saved.rowCount) {
        const old = (
          await pool.query(
            "SELECT * FROM google_email_delivery WHERE credential_id=$1 AND operation_key=$2",
            [access.accountRef, effect.operationKey],
          )
        ).rows[0];
        requireThat(
          old?.envelope_hash === effect.envelopeHash,
          "GOOGLE_EMAIL_OPERATION_MISMATCH",
          409,
        );
        if (old.status === "accepted")
          return emailReceiptSchema.parse(old.receipt);
        throw new Error("GOOGLE_EMAIL_OUTCOME_UNKNOWN");
      }
      try {
        const sent = z
          .object({
            id: z.string().min(1),
            threadId: z.string().nullable().optional(),
          })
          .parse(
            await googleJSON(
              `${endpoint}/messages/send`,
              {
                method: "POST",
                signal,
                headers: {
                  Authorization: `Bearer ${authorization.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  raw: Buffer.from(raw).toString("base64url"),
                  ...(effect.envelope.kind === "reply"
                    ? { threadId: effect.target!.threadId }
                    : {}),
                }),
              },
              fetcher,
            ),
          );
        const receipt = emailReceiptSchema.parse({
          operationKey: effect.operationKey,
          envelopeHash: effect.envelopeHash,
          providerMessageId: sent.id,
          providerThreadId: sent.threadId ?? null,
          acceptedAt: new Date().toISOString(),
          evidence: "provider_accepted",
        });
        await pool.query(
          "UPDATE google_email_delivery SET status='accepted',receipt=$3 WHERE credential_id=$1 AND operation_key=$2",
          [access.accountRef, effect.operationKey, receipt],
        );
        return receipt;
      } catch (error) {
        if (
          error instanceof GoogleHTTPError &&
          [400, 401, 403, 404, 413, 429].includes(error.httpStatus)
        ) {
          await pool.query(
            "UPDATE google_email_delivery SET status='rejected' WHERE credential_id=$1 AND operation_key=$2",
            [access.accountRef, effect.operationKey],
          );
          throw new EmailNoEffect(error.code);
        }
        throw error;
      }
    },
    async reconcile(access, operationKey, envelopeHash, signal) {
      await identity(access.accountRef, signal);
      const saved = (
        await pool.query(
          "SELECT * FROM google_email_delivery WHERE credential_id=$1 AND operation_key=$2 AND envelope_hash=$3",
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
          proof: "Google rejected this exact request before acceptance.",
        };
      const url = new URL(`${endpoint}/messages`);
      url.searchParams.set(
        "q",
        `in:sent rfc822msgid:${saved.internet_message_id}`,
      );
      url.searchParams.set("maxResults", "10");
      const list = z
        .object({
          messages: z
            .array(z.object({ id: z.string() }))
            .max(10)
            .optional(),
        })
        .parse(await request(access.accountRef, url, signal));
      for (const m of list.messages ?? []) {
        const v = await readFull(access.accountRef, m.id, signal),
          e = saved.expected;
        // Labels + Message-ID + exact content/envelope/attachment hashes are positive evidence; absence is never proof.
        const matches =
          v.raw.labelIds?.includes("SENT") &&
          v.message.internetMessageId === saved.internet_message_id &&
          headersOf(v.raw.payload, "x-miriam-envelope-hash")[0] ===
            envelopeHash &&
          v.message.from === e.sender &&
          JSON.stringify(v.message.to) === JSON.stringify(e.to) &&
          JSON.stringify(v.message.cc) === JSON.stringify(e.cc) &&
          JSON.stringify(v.bcc) === JSON.stringify(e.bcc) &&
          v.message.subject === e.subject &&
          cleanBody(v.message.body) === e.body &&
          JSON.stringify(
            v.attachments.map((a) => ({
              filename: a.filename,
              hash: a.hash,
              size: a.size,
            })),
          ) === JSON.stringify(e.attachments) &&
          (e.kind !== "reply" ||
            headersOf(v.raw.payload, "in-reply-to")[0] === e.targetMessageId);
        if (matches) {
          const receipt = emailReceiptSchema.parse({
            operationKey,
            envelopeHash,
            providerMessageId: v.message.id,
            providerThreadId: v.message.threadId,
            acceptedAt: v.message.sentAt,
            evidence: "provider_accepted",
          });
          await pool.query(
            "UPDATE google_email_delivery SET status='accepted',receipt=$3 WHERE credential_id=$1 AND operation_key=$2",
            [access.accountRef, operationKey, receipt],
          );
          return { outcome: "accepted", receipt };
        }
      }
      return { outcome: "unknown" };
    },
  };
}
