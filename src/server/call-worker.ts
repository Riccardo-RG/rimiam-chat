import { randomUUID } from "node:crypto";
import { pool, transaction, type Tx } from "./db.ts";
import { lockWorkspace } from "./workspace-state.ts";
import {
  callTransport,
  callConfigured,
  type CallTransport,
} from "./call-provider.ts";
import { callEvent, queueCall } from "./calls.ts";
import { DomainError } from "./errors.ts";

async function state(tx: Tx, id: string) {
  let c = (await tx.query("SELECT * FROM audio_call WHERE id=$1", [id]))
    .rows[0];
  if (!c) return null;
  await lockWorkspace(tx, c.workspace_id);
  // A control command may have committed while this transaction waited for the
  // Workspace lock. Read the consent epoch/request again inside that boundary.
  c = (await tx.query("SELECT * FROM audio_call WHERE id=$1", [id])).rows[0];
  const participants = (
    await tx.query(
      `SELECT p.*, (m.active AND m.contributes AND m.version=p.membership_version AND u.eligible AND u."emailVerified" AND p.heartbeat_at>now()-interval '90 seconds') AS eligible
    FROM call_participant p JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=p.user_id JOIN "user" u ON u.id=p.user_id WHERE p.call_id=$1 AND p.state<>'left'`,
      [id],
    )
  ).rows;
  return { ...c, participants };
}
function canRecord(s: NonNullable<Awaited<ReturnType<typeof state>>>) {
  return (
    s.state === "open" &&
    s.recording_requested &&
    s.participants.length > 0 &&
    s.participants.every(
      (p: { eligible: boolean; state: string; consent_epoch: number }) =>
        p.eligible &&
        p.state === "admitted" &&
        p.consent_epoch === s.recording_epoch,
    )
  );
}
export async function processCall(id: string, transport?: CallTransport) {
  if (!transport && !callConfigured()) return;
  const lock = await pool.connect();
  const key = `audio-call:${id}`;
  try {
    if (
      !(
        await lock.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [key],
        )
      ).rows[0].locked
    )
      return;
    const provider = transport ?? callTransport();
    let s = await transaction((tx) => state(tx, id));
    if (!s) return;
    // Remove ended membership, expired heartbeats and explicit leavers before admission.
    // Cloud invalidates their issued tokens; a new entry always has a fresh opaque identity.
    for (const p of s.participants)
      if (!p.eligible || p.state === "leaving") {
        await provider.remove(id, p.id);
        await transaction(async (tx) => {
          await lockWorkspace(tx, s.workspace_id);
          await tx.query(
            "UPDATE call_participant SET state='left',left_at=now() WHERE id=$1",
            [p.id],
          );
          await callEvent(tx, s.workspace_id, id, "call.left", p.user_id, p.id);
        });
      }
    s = await transaction((tx) => state(tx, id));
    if (!s) return;
    const external = await provider.recordings(id);
    const rows = (
      await pool.query(
        "SELECT * FROM call_recording WHERE call_id=$1 AND state NOT IN ('complete','failed') ORDER BY created_at",
        [id],
      )
    ).rows;
    async function fenceCapture(r: (typeof rows)[number]) {
      await provider.remove(id, r.participant_id);
      await transaction(async (tx) => {
        await lockWorkspace(tx, s.workspace_id);
        await tx.query(
          "UPDATE call_recording SET capture_fenced_at=coalesce(capture_fenced_at,now()) WHERE id=$1",
          [r.id],
        );
        const ended = await tx.query(
          "UPDATE call_participant SET state='left',left_at=coalesce(left_at,now()) WHERE id=$1 AND state<>'left' RETURNING id",
          [r.participant_id],
        );
        if (ended.rowCount)
          await callEvent(
            tx,
            s.workspace_id,
            id,
            "call.capture_fenced",
            null,
            r.participant_id,
          );
      });
    }
    for (const r of rows) {
      const remote = external.find(
        (e) => e.id === r.egress_id || e.key === r.object_key,
      );
      if (remote) {
        const terminal = ["complete", "failed"].includes(remote.state);
        await transaction(async (tx) => {
          await lockWorkspace(tx, s.workspace_id);
          await tx.query(
            "UPDATE call_recording SET egress_id=$2,state=$3,ended_at=CASE WHEN $4 THEN coalesce(ended_at,now()) ELSE NULL END WHERE id=$1",
            [r.id, remote.id, remote.state, terminal],
          );
          if (remote.state === "complete")
            await tx.query(
              "INSERT INTO call_transcription(recording_id,workspace_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [r.id, s.workspace_id],
            );
          if (r.state !== remote.state)
            await callEvent(
              tx,
              s.workspace_id,
              id,
              `call.recording.${remote.state}`,
            );
        });
        const fresh = await transaction((tx) => state(tx, id));
        const person = fresh?.participants.find(
          (p: { id: string }) => p.id === r.participant_id,
        );
        // A leaving participant's track can stop independently. A new arrival or
        // withdrawal stops every interval before admitting/capturing any new audio.
        if (
          !terminal &&
          (!fresh ||
            !canRecord(fresh) ||
            !person ||
            r.consent_epoch !== fresh.recording_epoch)
        ) {
          try {
            await provider.stop(remote.id);
          } catch {
            await fenceCapture(r);
          }
          await pool.query(
            "UPDATE call_recording SET state='stopping' WHERE id=$1 AND state NOT IN ('complete','failed')",
            [r.id],
          );
        }
      } else if (r.state === "prepared") {
        await pool.query(
          "UPDATE call_recording SET state='failed',error_code='CALL_START_NOT_SUBMITTED' WHERE id=$1",
          [r.id],
        );
        await pool.query(
          "UPDATE audio_call SET recording_requested=false WHERE id=$1",
          [id],
        );
      } else if (r.state !== "prepared") {
        // Never replay a start with an uncertain outcome. Reconciliation uses the
        // durable output key. Unknown intervals prevent admission and further starts.
        await pool.query(
          "UPDATE call_recording SET state='unknown',error_code='CALL_RECORDING_OUTCOME_UNKNOWN' WHERE id=$1",
          [r.id],
        );
        if (!r.capture_fenced_at) await fenceCapture(r);
      }
    }
    // Orphan provider work is never accepted as consent provenance.
    const known = new Set(rows.map((r) => r.object_key));
    for (const r of external)
      if (["active", "stopping"].includes(r.state) && !known.has(r.key))
        await provider.stop(r.id);
    const unresolved = (
      await pool.query(
        "SELECT 1 FROM call_recording WHERE call_id=$1 AND state NOT IN ('complete','failed','prepared') AND capture_fenced_at IS NULL",
        [id],
      )
    ).rowCount;
    if (!unresolved)
      await transaction(async (tx) => {
        const current = await state(tx, id);
        if (!current) return;
        for (const p of current.participants)
          if (p.state === "waiting" && p.eligible) {
            await tx.query(
              "UPDATE call_participant SET state='admitted' WHERE id=$1",
              [p.id],
            );
            await callEvent(
              tx,
              current.workspace_id,
              id,
              "call.admitted",
              p.user_id,
              p.id,
            );
          }
        if (current.participants.length === 0 && current.state === "open") {
          await tx.query(
            "UPDATE audio_call SET state='ended',ended_at=now(),recording_requested=false WHERE id=$1",
            [id],
          );
          await callEvent(tx, current.workspace_id, id, "call.ended");
        }
      });
    const connected = await provider.participants(id);
    s = await transaction((tx) => state(tx, id));
    if (!s) return;
    // Unknown identities have no durable admission (nor recordable audio).
    for (const p of connected)
      if (
        !s.participants.some(
          (a: { id: string; state: string }) =>
            a.id === p.identity && a.state === "admitted",
        )
      )
        await provider.remove(id, p.identity);
    const unsafeIntervals = (
      await pool.query(
        "SELECT 1 FROM call_recording WHERE call_id=$1 AND capture_fenced_at IS NULL AND (state IN ('unknown','stopping','starting') OR (state='active' AND consent_epoch<>$2))",
        [id, s.recording_epoch],
      )
    ).rowCount;
    if (canRecord(s) && !s.error_code && !unsafeIntervals)
      for (const p of s.participants) {
        for (const track of connected.find((c) => c.identity === p.id)
          ?.tracks ?? []) {
          const existing = (
            await pool.query(
              "SELECT 1 FROM call_recording WHERE participant_id=$1 AND track_id=$2 AND consent_epoch=$3 AND state<>'complete'",
              [p.id, track, s.recording_epoch],
            )
          ).rowCount;
          if (existing) continue;
          const recording = randomUUID(),
            objectKey = `miriam-calls/${s.workspace_id}/${id}/${recording}.mp3`;
          // Durable intent precedes the external start. No retry can invent new consent.
          await transaction(async (tx) => {
            const fresh = await state(tx, id);
            if (
              !fresh ||
              !canRecord(fresh) ||
              fresh.recording_epoch !== s.recording_epoch
            )
              return;
            const consent = (
              await tx.query(
                "SELECT id FROM call_event WHERE workspace_id=$1 AND call_id=$2 AND participant_id=$3 AND actor_id=$4 AND recording_epoch=$5 AND kind='call.recording.consent' AND consent_text IS NOT NULL ORDER BY version DESC LIMIT 1",
                [s.workspace_id, id, p.id, p.user_id, s.recording_epoch],
              )
            ).rows[0];
            // Current flags alone cannot substitute for the attributable consent act.
            if (!consent) return;
            await tx.query(
              "INSERT INTO call_recording(id,workspace_id,call_id,participant_id,consent_epoch,track_id,object_key,state) VALUES($1,$2,$3,$4,$5,$6,$7,'prepared')",
              [
                recording,
                s.workspace_id,
                id,
                p.id,
                s.recording_epoch,
                track,
                objectKey,
              ],
            );
            await tx.query(
              "INSERT INTO call_recording_consent(recording_id,workspace_id,consent_event_id) VALUES($1,$2,$3)",
              [recording, s.workspace_id, consent.id],
            );
          });
          await transaction(async (tx) => {
            const fresh = await state(tx, id);
            if (
              !fresh ||
              !canRecord(fresh) ||
              fresh.recording_epoch !== s.recording_epoch
            ) {
              await tx.query(
                "UPDATE call_recording SET state='failed',error_code='CONSENT_CHANGED' WHERE id=$1 AND state='prepared'",
                [recording],
              );
              return;
            }
            const prepared = await tx.query(
              "UPDATE call_recording SET state='starting' WHERE id=$1 AND state='prepared' RETURNING id",
              [recording],
            );
            if (prepared.rowCount)
              await callEvent(
                tx,
                s.workspace_id,
                id,
                "call.recording.starting",
              );
          });
          if (
            !(
              await pool.query(
                "SELECT 1 FROM call_recording WHERE id=$1 AND state='starting'",
                [recording],
              )
            ).rowCount
          )
            continue;
          try {
            // Only this consented microphone track, never room-wide audio or video.
            const egressId = await provider.start(id, track, objectKey);
            await pool.query(
              "UPDATE call_recording SET egress_id=$2,state='active' WHERE id=$1",
              [recording, egressId],
            );
            const fresh = await transaction((tx) => state(tx, id));
            if (!fresh || !canRecord(fresh)) await provider.stop(egressId);
          } catch {
            await pool.query(
              "UPDATE call_recording SET state='unknown',error_code='CALL_RECORDING_OUTCOME_UNKNOWN' WHERE id=$1",
              [recording],
            );
          }
        }
      }
    await pool.query(
      "UPDATE audio_call SET error_code=NULL WHERE id=$1 AND error_code IN ('CALL_TRANSPORT_UNAVAILABLE','CALL_CLOUD_CONFIGURATION_REQUIRED','CALL_CONFIGURATION_REQUIRED')",
      [id],
    );
  } catch (e) {
    await pool.query("UPDATE audio_call SET error_code=$2 WHERE id=$1", [
      id,
      e instanceof DomainError ? e.code : "CALL_TRANSPORT_UNAVAILABLE",
    ]);
  } finally {
    await pool.query(
      "UPDATE audio_call SET next_reconcile_at=now()+CASE WHEN state='open' THEN interval '3 seconds' ELSE interval '60 seconds' END WHERE id=$1",
      [id],
    );
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
      key,
    ]);
    lock.release();
  }
  // Recording consent includes transcription, but never interpretation/analysis.
  const pending = (
    await pool.query(
      "SELECT t.recording_id FROM call_transcription t JOIN call_recording r ON r.id=t.recording_id WHERE r.call_id=$1 AND t.status='queued'",
      [id],
    )
  ).rows;
  for (const p of pending)
    await pool.query(
      "SELECT graphile_worker.add_job('call_transcribe',json_build_object('id',$1::text),max_attempts:=1,job_key:=$2)",
      [p.recording_id, `call-transcript:${p.recording_id}`],
    );
}
export async function reconcileCalls() {
  if (!callConfigured()) return;
  const rows = (
    await pool.query(
      "SELECT id FROM audio_call c WHERE next_reconcile_at<=now() AND (state='open' OR EXISTS(SELECT 1 FROM call_recording r WHERE r.call_id=c.id AND r.state NOT IN ('complete','failed')))",
    )
  ).rows;
  for (let i = 0; i < rows.length; i += 4)
    await Promise.allSettled(
      rows.slice(i, i + 4).map((r) => processCall(r.id)),
    );
}
export async function recoverCalls() {
  if (!callConfigured()) return;
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE call_transcription SET status='queued',attempt_id=NULL,lease_until=NULL WHERE status='processing' AND lease_until<now()",
    );
    const rows = (
      await tx.query(
        "SELECT id FROM audio_call c WHERE next_reconcile_at<=now() AND (state='open' OR EXISTS(SELECT 1 FROM call_recording r WHERE r.call_id=c.id AND r.state NOT IN ('complete','failed')) OR EXISTS(SELECT 1 FROM call_transcription t JOIN call_recording r ON r.id=t.recording_id WHERE r.call_id=c.id AND t.status='queued'))",
      )
    ).rows;
    for (const c of rows) await queueCall(tx, c.id);
  });
}
