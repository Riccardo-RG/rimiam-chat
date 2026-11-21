import { z } from "zod";
export const privateConsultationInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ask"),
      id: z.uuid(),
      expectedActorId: z.string().min(1),
      kind: z.literal("context"),
      question: z.string().trim().min(1).max(2000),
      parentId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("document"),
      id: z.uuid(),
      expectedActorId: z.string().min(1),
      kind: z.literal("document"),
      question: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("summarize"),
      id: z.uuid(),
      expectedActorId: z.string().min(1),
      kind: z.literal("recap"),
      anchorId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("resume"),
      id: z.uuid(),
      expectedActorId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("share"),
      id: z.uuid(),
      expectedActorId: z.string().min(1),
    })
    .strict(),
]);
export type ConsultationInput = z.infer<typeof privateConsultationInput>;
export type ConsultationRef = {
  kind: string;
  id: string;
  version: number;
  label: string;
};
export type ConsultationReceipt = { id: string; createdAt: string };
export interface ConsultationTurn extends ConsultationReceipt {
  kind: "context" | "recap" | "document";
  documentWorkspaceId?: string | null;
  documentSourceId?: string | null;
  question: string;
  answer: string;
  references: ConsultationRef[];
  personalIds: string[];
  sharedMessageId: string | null;
}
export interface PrivateConsultation extends ConsultationTurn {
  history?: ConsultationTurn[];
}
