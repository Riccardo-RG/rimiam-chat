import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { member, changed, lockWorkspace } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  callCommandSchemas,
  callViewSchema,
  recordingConsentText,
} from "../contracts/calls.ts";
import {
  callConfigured,
  recordingConfigured,
  callTransport,
  type CallTransport,
} from "./call-provider.ts";
import { analyzeCall } from "./call-transcripts.ts";

export async function callEvent(
  tx: Tx,
  w: string,
  id: string,
  kind: string,
  actor: string | null = null,
  participant: string | null = null,
  consent: string | null = null,
) {
  const call = (
    await tx.query(
      "UPDATE audio_call SET version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING version,recording_epoch",
      [w, id],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO call_event(id,workspace_id,call_id,version,actor_id,participant_id,kind,consent_text,recording_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      w,
      id,
      call.version,
      actor,
      participant,
      kind,
      consent,
      call.recording_epoch,
    ],
  );
  await changed(tx, w, kind);
}
export async function queueCall(tx: Tx, id: string) {
  await tx.query("UPDATE audio_call SET next_reconcile_at=now() WHERE id=$1", [
    id,
  ]);
  await tx.query(
    "SELECT graphile_worker.add_job('audio_call',json_build_object('id',$1::text),max_attempts:=1,job_key:=$2)",
    [id, `call:${id}`],
  );
}
export async function applyCall(
  tx: Tx,
  w: string,
  actor: string,
  c: z.infer<(typeof callCommandSchemas)[number]>,
) {
  await member(tx, w, actor, true, true);
  if (c.type === "call.join") {
    requireThat(callConfigured(), "CALL_CONFIGURATION_REQUIRED", 503);
    let call = (
      await tx.query(
        "SELECT * FROM audio_call WHERE workspace_id=$1 AND state='open'",
        [w],
      )
    ).rows[0];
    if (!call)
      call = (
        await tx.query(
          "INSERT INTO audio_call(id,workspace_id) VALUES($1,$2) RETURNING *",
          [randomUUID(), w],
        )
      ).rows[0];
    const prior = (
      await tx.query(
        "SELECT id FROM call_participant WHERE call_id=$1 AND user_id=$2 AND state<>'left'",
        [call.id, actor],
      )
    ).rows[0];
    if (prior) return { callId: call.id, participantId: prior.id };
    const membership = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    const participant = randomUUID();
    await tx.query(
      "INSERT INTO call_participant(id,workspace_id,call_id,user_id,membership_version,state) VALUES($1,$2,$3,$4,$5,'waiting')",
      [participant, w, call.id, actor, membership.version],
    );
    await callEvent(tx, w, call.id, "call.join_requested", actor, participant);
    await queueCall(tx, call.id);
    return { callId: call.id, participantId: participant };
  }
  const call = (
    await tx.query("SELECT * FROM audio_call WHERE workspace_id=$1 AND id=$2", [
      w,
      c.callId,
    ])
  ).rows[0];
  requireThat(call, "CALL_NOT_FOUND", 404);
  if (c.type === "call.analyze") return analyzeCall(tx, w, actor, call.id);
  if (c.type === "call.transcription.retry") {
    await tx.query(
      "UPDATE call_transcription SET status='queued',error_code=NULL WHERE workspace_id=$1 AND recording_id IN (SELECT id FROM call_recording WHERE call_id=$2) AND status IN ('failed','needs_configuration')",
      [w, call.id],
    );
    await queueCall(tx, call.id);
    return { callId: call.id };
  }
  const p = (
    await tx.query(
      "SELECT * FROM call_participant WHERE call_id=$1 AND user_id=$2 AND state<>'left'",
      [call.id, actor],
    )
  ).rows[0];
  requireThat(p, "CALL_PARTICIPATION_REQUIRED", 403);
  if (c.type === "call.leave") {
    await tx.query("UPDATE call_participant SET state='leaving' WHERE id=$1", [
      p.id,
    ]);
  } else if (c.type === "call.recording.request") {
    requireThat(
      recordingConfigured(),
      "CALL_RECORDING_CONFIGURATION_REQUIRED",
      503,
    );
    if (!call.recording_requested) {
      await tx.query(
        "UPDATE audio_call SET recording_requested=true,recording_epoch=recording_epoch+1,error_code=NULL WHERE id=$1",
        [call.id],
      );
    }
  } else if (c.type === "call.recording.consent") {
    requireThat(
      call.recording_requested && c.epoch === call.recording_epoch,
      "RECORDING_CONSENT_STALE",
      409,
    );
    requireThat(p.state === "admitted", "CALL_ADMISSION_PENDING", 409);
    await tx.query("UPDATE call_participant SET consent_epoch=$2 WHERE id=$1", [
      p.id,
      c.epoch,
    ]);
  } else if (c.type === "call.recording.withdraw") {
    await tx.query(
      "UPDATE call_participant SET consent_epoch=NULL,state='leaving' WHERE id=$1",
      [p.id],
    );
    await tx.query(
      "UPDATE audio_call SET recording_requested=false WHERE id=$1",
      [call.id],
    );
  }
  await callEvent(
    tx,
    w,
    call.id,
    c.type,
    actor,
    p.id,
    c.type === "call.recording.consent" ? recordingConsentText : null,
  );
  await queueCall(tx, call.id);
  return { callId: call.id };
}

// POST, authenticated and origin-checked by API. Tokens are never persisted or journaled.
export async function callConnection(
  actor: string,
  w: string,
  id: string,
  transport: CallTransport = callTransport(),
) {
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await member(tx, w, actor, true, true);
    const p = (
      await tx.query(
        `SELECT p.* FROM call_participant p JOIN audio_call c ON c.id=p.call_id
      JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=p.user_id
      WHERE p.workspace_id=$1 AND p.call_id=$2 AND p.user_id=$3 AND p.state='admitted' AND c.state='open' AND m.version=p.membership_version`,
        [w, id, actor],
      )
    ).rows[0];
    requireThat(p, "CALL_ADMISSION_PENDING", 409);
    await tx.query(
      "UPDATE call_participant SET heartbeat_at=now() WHERE id=$1",
      [p.id],
    );
    return {
      ...(await transport.connect(id, p.id)),
      participantId: p.id,
      callId: id,
    };
  });
}

// Exit/withdrawal must not depend on an AI/transcription worker being available.
// The receipt still describes the domain act, not a fabricated transport outcome.
export async function flushCallExit(
  actor: string,
  w: string,
  command: unknown,
) {
  const c = z
    .object({
      type: z.enum(["call.leave", "call.recording.withdraw"]),
      callId: z.uuid(),
    })
    .safeParse(command);
  if (!c.success || !callConfigured()) return;
  const p = await transaction(async (tx) => {
    await member(tx, w, actor);
    return (
      await tx.query(
        "SELECT id FROM call_participant WHERE workspace_id=$1 AND call_id=$2 AND user_id=$3 AND state='leaving'",
        [w, c.data.callId, actor],
      )
    ).rows[0];
  });
  if (!p) return;
  try {
    await callTransport().remove(c.data.callId, p.id);
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const ended = await tx.query(
        "UPDATE call_participant SET state='left',left_at=now() WHERE id=$1 AND state='leaving' RETURNING id",
        [p.id],
      );
      if (ended.rowCount)
        await callEvent(tx, w, c.data.callId, "call.left", actor, p.id);
      await queueCall(tx, c.data.callId);
    });
  } catch {
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      await tx.query(
        "UPDATE audio_call SET error_code='CALL_TRANSPORT_UNAVAILABLE' WHERE id=$1",
        [c.data.callId],
      );
      await queueCall(tx, c.data.callId);
    });
  }
}
export async function callView(actor: string, w: string) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const calls = (
      await tx.query(
        `SELECT id,version,state,recording_requested AS "recordingRequested",recording_epoch AS epoch,error_code AS "errorCode"
      FROM audio_call WHERE workspace_id=$1 ORDER BY created_at DESC`,
        [w],
      )
    ).rows;
    for (const c of calls) {
      c.participants = (
        await tx.query(
          `SELECT p.id,p.user_id AS "userId",u.name,p.state,(p.consent_epoch=$2 AND $3) IS TRUE AS consented FROM call_participant p JOIN "user" u ON u.id=p.user_id WHERE p.call_id=$1 ORDER BY p.joined_at`,
          [c.id, c.epoch, c.recordingRequested],
        )
      ).rows;
      c.recordings = (
        await tx.query(
          `SELECT r.id,r.participant_id AS "participantId",r.consent_epoch AS "consentEpoch",ce.version AS "consentEventVersion",r.state,(r.capture_fenced_at IS NOT NULL) AS "captureFenced",t.status AS "transcriptionStatus",coalesce(t.error_code,r.error_code) AS "errorCode",r.created_at::text AS "createdAt",r.ended_at::text AS "endedAt" FROM call_recording r LEFT JOIN call_transcription t ON t.recording_id=r.id LEFT JOIN call_recording_consent rc ON rc.recording_id=r.id LEFT JOIN call_event ce ON ce.id=rc.consent_event_id WHERE r.call_id=$1 ORDER BY r.created_at`,
          [c.id],
        )
      ).rows;
      for (const r of c.recordings)
        r.segments = (
          await tx.query(
            `SELECT id,ordinal,content,qualification,start_seconds AS "startSeconds" FROM call_transcript_segment WHERE recording_id=$1 ORDER BY ordinal`,
            [r.id],
          )
        ).rows;
      c.events = (
        await tx.query(
          `SELECT version,kind,actor_id AS "actorId",participant_id AS "participantId",recording_epoch AS epoch,consent_text AS "consentText",created_at::text AS "createdAt" FROM call_event WHERE call_id=$1 ORDER BY version`,
          [c.id],
        )
      ).rows;
      c.analysisRequested = !!(
        await tx.query("SELECT 1 FROM call_analysis_request WHERE call_id=$1", [
          c.id,
        ])
      ).rowCount;
    }
    return callViewSchema.parse({
      configured: callConfigured(),
      recordingConfigured: recordingConfigured(),
      consentText: recordingConsentText,
      calls,
    });
  });
}
