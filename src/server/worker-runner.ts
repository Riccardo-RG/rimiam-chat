import { processCall, recoverCalls, reconcileCalls } from "./call-worker.ts";
import { transcribeCallRecording } from "./call-transcripts.ts";
import { processAccountMail, recoverAccountMail } from "./account-delivery.ts";
import {
  processInvitationMail,
  recoverInvitationMail,
} from "./invitation-delivery.ts";
import { processFollowup, recoverFollowups } from "./tasks-worker.ts";
import { processDocument, recoverDocuments } from "./media-worker.ts";
import { run } from "graphile-worker";
import { z } from "zod";
import { pool } from "./db.ts";
import { processActiveWork, recoverActiveWork } from "./active-work-worker.ts";
import type { AnalysisSpecialist } from "./analysis-specialist.ts";
import {
  processInterpretation,
  recoverExpiredInterpretations,
  type Interpreter,
} from "./interpretation.ts";
import { processResearch, recoverResearch } from "./research.ts";
import type { ResearchProvider } from "./research-provider.ts";
import {
  processCalendarAction,
  processCalendarRead,
  recoverCalendar,
} from "./calendar-worker.ts";
import type { CalendarProvider } from "./calendar-provider.ts";
import type { EmailProvider } from "./email-provider.ts";
import {
  processEmailSend,
  processEmailRead,
  recoverEmail,
} from "./email-worker.ts";
export async function runWorker(
  interpreter: Interpreter,
  researchProvider?: ResearchProvider,
  calendarProvider?: CalendarProvider,
  emailProvider?: EmailProvider,
  analysisSpecialist?: AnalysisSpecialist,
) {
  const runner = await run({
    pgPool: pool,
    concurrency: 2,
    pollInterval: 1000,
    parsedCronItems: [],
    taskList: {
      call_transcribe: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await transcribeCallRecording(id);
      },
      audio_call: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await processCall(id);
      },
      invitation_mail: async (payload) => {
        const { invitationId } = z
          .object({ invitationId: z.uuid() })
          .parse(payload);
        await processInvitationMail(invitationId);
      },
      document_extract: async (payload) => {
        const { sourceId } = z.object({ sourceId: z.uuid() }).parse(payload);
        await processDocument(sourceId);
      },
      active_work: async (payload) => {
        const p = z
          .object({ workspaceId: z.uuid(), id: z.uuid() })
          .parse(payload);
        await processActiveWork(p.workspaceId, p.id, analysisSpecialist);
      },
      followup_due: async (payload) => {
        const p = z
          .object({
            workspaceId: z.uuid(),
            id: z.uuid(),
            version: z.number().int().positive(),
          })
          .parse(payload);
        await processFollowup(p.workspaceId, p.id, p.version);
      },
      email_send: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await processEmailSend(id, emailProvider);
      },
      email_read: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await processEmailRead(id, emailProvider);
      },
      calendar_execute: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await processCalendarAction(id, calendarProvider);
      },
      calendar_read: async (payload) => {
        const { id } = z.object({ id: z.uuid() }).parse(payload);
        await processCalendarRead(id, calendarProvider);
      },
      account_mail: async (payload) => {
        const input = z.object({ deliveryId: z.uuid() }).parse(payload);
        await processAccountMail(input.deliveryId);
      },
      research: async (payload) => {
        const input = z.object({ workId: z.uuid() }).parse(payload);
        await processResearch(input.workId, researchProvider);
      },
      interpret: async (payload) => {
        const input = z.object({ interpretationId: z.uuid() }).parse(payload);
        await processInterpretation(input.interpretationId, interpreter);
      },
    },
  });
  console.log(
    "MIRIAM worker ready (interpretation, research and account delivery queues)",
  );
  await recoverExpiredInterpretations();
  await recoverResearch();
  await recoverAccountMail();
  await recoverInvitationMail();
  await recoverCalendar();
  await recoverEmail();
  await recoverFollowups();
  await recoverActiveWork(analysisSpecialist);
  await recoverDocuments();
  await recoverCalls();
  let reconcilingCalls = false;
  const callRecovery = setInterval(() => {
    if (reconcilingCalls) return;
    reconcilingCalls = true;
    void reconcileCalls()
      .catch(() => console.error("Call recovery failed"))
      .finally(() => {
        reconcilingCalls = false;
      });
  }, 3000);
  const recovery = setInterval(() => {
    void recoverCalls().catch(() =>
      console.error("Call transcription recovery failed"),
    );
    void recoverInvitationMail().catch(() =>
      console.error("Invitation delivery recovery failed"),
    );
    void recoverDocuments().catch(() =>
      console.error("Document recovery failed"),
    );
    void recoverActiveWork(analysisSpecialist).catch(() =>
      console.error("Active Work recovery failed"),
    );
    void recoverFollowups().catch(() =>
      console.error("Follow-up recovery failed"),
    );
    void recoverEmail().catch(() => console.error("Email recovery failed"));
    void recoverCalendar().catch(() =>
      console.error("Calendar recovery failed"),
    );
    void recoverAccountMail().catch(() =>
      console.error("Account delivery recovery failed"),
    );
    void recoverResearch().catch(() =>
      console.error("Research recovery failed"),
    );
    void recoverExpiredInterpretations().catch(() =>
      console.error("Interpretation recovery failed"),
    );
  }, 30000);
  try {
    await runner.promise;
  } finally {
    clearInterval(recovery);
    clearInterval(callRecovery);
    await pool.end();
  }
}
