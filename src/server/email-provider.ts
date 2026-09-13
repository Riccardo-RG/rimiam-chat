import { z } from "zod";
import { googleConfiguration } from "./google-credentials.ts";
import { googleEmailProvider } from "./google-email.ts";
import type {
  EmailEnvelope,
  EmailMessage,
  emailObservationSchema,
  emailReceiptSchema,
} from "../contracts/email.ts";
export const mailboxIdentitySchema = z
  .object({
    accountRef: z.string().min(1).max(500),
    sender: z.email().toLowerCase(),
    canRead: z.boolean(),
    canSendSelf: z.boolean(),
  })
  .strict();
export type MailboxIdentity = z.infer<typeof mailboxIdentitySchema>;
export type EmailAccess = {
  connectionId: string;
  accountRef: string;
  sender: string;
};
export type EmailReceipt = z.infer<typeof emailReceiptSchema>;
export type EmailEffect = {
  operationKey: string;
  envelopeHash: string;
  envelope: EmailEnvelope;
  target: EmailMessage | null;
  attachments: {
    filename: string;
    mediaType: string;
    hash: string;
    bytes: Buffer;
  }[];
};
export type EmailReconciliation =
  | { outcome: "accepted"; receipt: EmailReceipt }
  | { outcome: "not_accepted"; proof: string }
  | { outcome: "unknown" };
export class EmailNoEffect extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
// Adapter must send ONLY the approved envelope and bytes, including BCC. No implicit quoted
// content, signature, recipients, forwarded attachments or provider-draft side effects.
// Its operation key must be idempotent, or reconciliation must prove no accepted/in-flight send
// before any retry. Search absence alone is insufficient. Unknown remains unknown.
export interface EmailProvider {
  key: string;
  discover(
    verifiedAccountRef: string,
    signal: AbortSignal,
  ): Promise<MailboxIdentity>;
  checkAccess(
    access: EmailAccess,
    signal: AbortSignal,
  ): Promise<MailboxIdentity>;
  search(
    access: EmailAccess,
    query: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<z.infer<typeof emailObservationSchema>>;
  fetch(
    access: EmailAccess,
    mode: "message" | "thread",
    targetId: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<z.infer<typeof emailObservationSchema>>;
  attachment(
    access: EmailAccess,
    message: EmailMessage,
    attachmentId: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
  // kind and target preserve new/reply/forward semantics; this is not sendEmail(to,body).
  send(
    access: EmailAccess,
    effect: EmailEffect,
    signal: AbortSignal,
  ): Promise<EmailReceipt>;
  reconcile(
    access: EmailAccess,
    operationKey: string,
    envelopeHash: string,
    signal: AbortSignal,
  ): Promise<EmailReconciliation>;
}
export function configuredEmailProvider(): EmailProvider | undefined {
  return googleConfiguration() ? googleEmailProvider() : undefined;
}
