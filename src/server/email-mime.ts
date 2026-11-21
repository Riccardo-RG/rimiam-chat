import type { EmailEffect } from "./email-provider.ts";
import { googleHash as hash } from "./google-http.ts";
import { requireThat } from "./errors.ts";

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
export function cleanBody(body: string) {
  return body.replace(/\r\n/g, "\n");
}
export function emailMIME(effect: EmailEffect, messageId: string) {
  const e = effect.envelope,
    boundary = `miriam_${hash(effect.operationKey).slice(0, 40)}`;
  const lines = [
    `Date: ${new Date(effect.authorizedAt).toUTCString().replace(/ GMT$/, " +0000")}`,
    `From: ${e.sender}`,
    ...(e.to.length ? [`To: ${e.to.join(", ")}`] : []),
    ...(e.cc.length ? [`Cc: ${e.cc.join(", ")}`] : []),
    ...(e.bcc.length ? [`Bcc: ${e.bcc.join(", ")}`] : []),
    `Subject: ${encodedWord(e.subject)}`,
    `Message-ID: ${messageId}`,
    `X-Miriam-Envelope-Hash: ${effect.envelopeHash}`,
    "MIME-Version: 1.0",
  ];
  if (e.kind === "reply") {
    requireThat(
      effect.target?.internetMessageId && effect.target.threadId,
      "EMAIL_REPLY_METADATA_REQUIRED",
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
      "EMAIL_ATTACHMENT_INVALID",
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
export function expectedEnvelope(effect: EmailEffect) {
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
