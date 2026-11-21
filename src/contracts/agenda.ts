import { z } from "zod";
import { taskContentSchema } from "./tasks.ts";

export const agendaQuerySchema = z.object({
  day: z.iso.date(),
  zone: taskContentSchema.shape.timeZone,
});
const common = {
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  personal: z.boolean(),
  version: z.number().int().positive(),
  title: z.string(),
};
export const agendaItemSchema = z.object({
  ...common,
  kind: z.enum(["event", "reminder"]),
  at: z.iso.datetime(),
  until: z.iso.datetime().nullable(),
  owner: z.string(),
  recurring: z.boolean(),
  rsvp: z.enum(["pending", "accepted"]).nullable(),
});
export const agendaViewSchema = z.object({
  hasLinkedCalendar: z.boolean().optional(),
  items: z.array(agendaItemSchema),
  previous: z.array(
    z.object({ ...common, count: z.number().int().positive() }),
  ),
  offers: z.array(
    z.object({
      ...common,
      description: z.string(),
      due: z.iso.datetime().nullable(),
    }),
  ),
  before: z.iso.datetime(),
});
export const agendaDestinationSchema = z.object({
  contextRevision: z.number().int().nonnegative(),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AgendaView = z.infer<typeof agendaViewSchema>;

export const taskOfferLineSchema = z.object({
  taskId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  due: z.string().nullable(),
  person: z.string(),
  personName: z.string(),
  acceptedBy: z.string().nullable(),
  status: z.enum(["accepted", "declined", "pending", "outdated"]),
});
export type TaskOffer = z.infer<typeof taskOfferLineSchema>;
export const reminderLineSchema = z.object({
  audience: z.enum(["personal", "space"]),
  content: z.string(),
  day: z.string().nullable(),
  zone: z.string(),
  destination: z.uuid().nullable(),
  id: z.uuid().nullable(),
  at: z.string().nullable(),
  version: z.number().int().positive().nullable(),
  closed: z.boolean(),
  recurring: z.boolean(),
});
export type ReminderLineData = z.infer<typeof reminderLineSchema>;
export const workspaceScheduleSchema = z.object({
  entries: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["task", "followup"]),
      title: z.string(),
      at: z.string().nullable(),
    }),
  ),
  more: z.boolean(),
});
