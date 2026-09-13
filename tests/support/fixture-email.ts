// Test-only external mailbox. No runtime imports or real mail delivery.
import { createHash } from "node:crypto";
import type { EmailMessage } from "../../src/contracts/email";
import type {
  EmailProvider,
  EmailAccess,
  EmailEffect,
  EmailReceipt,
  EmailReconciliation,
} from "../../src/server/email-provider";
export class FixtureEmail implements EmailProvider {
  key = "email-test-double";
  writes = 0;
  allow = true;
  loseResponse = false;
  proveAbsence = false;
  revision = "1";
  receipts = new Map<string, EmailReceipt>();
  sent: EmailEffect[] = [];
  beforeCheck?: () => Promise<void>;
  afterRead?: () => Promise<void>;
  afterSend?: () => Promise<void>;
  bytes = Buffer.from("Preventivo privato: 3200 euro.\n");
  async discover(accountRef: string) {
    return { accountRef, sender: accountRef, canRead: true, canSendSelf: true };
  }
  async checkAccess(a: EmailAccess) {
    await this.beforeCheck?.();
    return {
      accountRef: a.accountRef,
      sender: a.sender,
      canRead: this.allow,
      canSendSelf: this.allow,
    };
  }
  message(a: EmailAccess): EmailMessage {
    return {
      id: "message-1",
      threadId: "thread-1",
      revision: this.revision,
      internetMessageId: "<source@example.test>",
      references: ["<prior@example.test>"],
      from: "owner@example.test",
      to: [a.sender],
      cc: [],
      replyTo: ["reply@example.test"],
      subject: "Visita del locale",
      body: "Il locale è disponibile venerdì. Dettaglio privato da non condividere.",
      sentAt: "2026-09-10T10:00:00Z",
      attachments: [
        {
          id: "attachment-1",
          filename: "preventivo.txt",
          mediaType: "text/plain",
          size: this.bytes.length,
          hash: createHash("sha256").update(this.bytes).digest("hex"),
        },
      ],
    };
  }
  async search(a: EmailAccess) {
    await this.afterRead?.();
    return { messages: [this.message(a)], complete: true, nextCursor: null };
  }
  async fetch(a: EmailAccess) {
    return this.search(a);
  }
  async attachment() {
    return Buffer.from(this.bytes);
  }
  async send(a: EmailAccess, e: EmailEffect) {
    const key = a.accountRef + ":" + e.operationKey;
    const prior = this.receipts.get(key);
    if (prior) return structuredClone(prior);
    this.writes++;
    this.sent.push({
      ...e,
      attachments: e.attachments.map((a) => ({
        ...a,
        bytes: Buffer.from(a.bytes),
      })),
    });
    const receipt: EmailReceipt = {
      operationKey: e.operationKey,
      envelopeHash: e.envelopeHash,
      providerMessageId: `sent-${this.writes}`,
      providerThreadId:
        e.envelope.kind === "reply"
          ? e.target!.threadId
          : `sent-thread-${this.writes}`,
      acceptedAt: new Date().toISOString(),
      evidence: "provider_accepted",
    };
    this.receipts.set(key, receipt);
    await this.afterSend?.();
    if (this.loseResponse || e.envelope.subject.includes("[response-loss]"))
      throw Error("Lost response after accepted send");
    return structuredClone(receipt);
  }
  async reconcile(a: EmailAccess, key: string): Promise<EmailReconciliation> {
    const receipt = this.receipts.get(a.accountRef + ":" + key);
    return receipt
      ? { outcome: "accepted", receipt: structuredClone(receipt) }
      : this.proveAbsence
        ? {
            outcome: "not_accepted",
            proof: "Test provider excludes accepted and in-flight writes",
          }
        : { outcome: "unknown" };
  }
}
