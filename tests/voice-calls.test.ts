import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { transcribeCallRecording } from "../src/server/call-transcripts";
import { retrieveSources } from "../src/server/interpretation";
import { voiceResearchQuery } from "../src/shared/voice-research";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { voiceMessages } from "../src/server/voice";
import { processDocument } from "../src/server/media-worker";
import { processCall, recoverCalls } from "../src/server/call-worker";
import { callConnection, callView } from "../src/server/calls";
import { recordingConsentText } from "../src/contracts/calls";
import type { CallTransport } from "../src/server/call-provider";
import {
  claimInterpretation,
  publishInterpretation,
} from "../src/server/interpretation";

afterAll(() => pool.end());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function person() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, `${id}@example.test`],
  );
  return id;
}
async function fixture() {
  const a = await person(),
    b = await person(),
    c = await person(),
    w = (await createWorkspace(a, "Calls", randomUUID())).id;
  for (const who of [b, c]) {
    const invite = await execute(a, w, randomUUID(), {
      type: "invitation.create",
      email: `${who}@example.test`,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(who, String(invite.token), true);
  }
  return { a, b, c, w };
}
function provider() {
  const people: { identity: string; tracks: string[] }[] = [],
    recordings: {
      id: string;
      key: string;
      state: "active" | "stopping" | "complete" | "failed";
    }[] = [];
  const removed: string[] = [];
  const transport: CallTransport = {
    async connect(_r, identity) {
      if (!people.some((p) => p.identity === identity))
        people.push({ identity, tracks: [`track-${identity}`] });
      return { url: "wss://test.invalid", token: "test-only" };
    },
    async participants() {
      return people;
    },
    async remove(_r, identity) {
      removed.push(identity);
      const i = people.findIndex((p) => p.identity === identity);
      if (i >= 0) people.splice(i, 1);
    },
    async recordings() {
      return recordings;
    },
    async start(_r, _t, key) {
      const id = randomUUID();
      recordings.push({ id, key, state: "active" });
      return id;
    },
    async stop(id) {
      recordings.find((r) => r.id === id)!.state = "stopping";
    },
  };
  return { transport, people, recordings, removed };
}
function configured() {
  for (const key of [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "CALL_STORAGE_BUCKET",
    "CALL_STORAGE_REGION",
    "CALL_STORAGE_ACCESS_KEY",
    "CALL_STORAGE_SECRET_KEY",
  ])
    vi.stubEnv(key, "test-only");
}
const tick = (id: string, p: CallTransport) => processCall(id, p);
const act = (a: string, w: string, type: string, callId?: string, extra = {}) =>
  execute(a, w, randomUUID(), {
    type,
    ...(callId ? { callId } : {}),
    ...extra,
  });
async function consent(a: string, w: string, id: string) {
  const view = await callView(a, w);
  return act(a, w, "call.recording.consent", id, {
    epoch: view.calls[0].epoch,
    consentText: recordingConsentText,
  });
}

it("voice retains original history, explicit address and unaccepted transcript; receipts deduplicate", async () => {
  const { a, w } = await fixture(),
    command = randomUUID();
  const input = {
    type: "voice.send",
    filename: "voice.wav",
    bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
    mode: "miriam",
    allowModelProcessing: true,
  };
  const first = await execute(a, w, command, input);
  expect(await execute(a, w, command, input)).toEqual(first);
  await processDocument(String(first.sourceId), {
    async extract() {
      return {
        text: "Come possiamo aprire il locale?",
        qualification: "Trascrizione fallibile",
        provider: "test-only",
      };
    },
  });
  const voices = await voiceMessages(a, w);
  expect(voices.messages[0].transcript).toBe("Come possiamo aprire il locale?");
  const i = (
    await pool.query("SELECT id FROM interpretation WHERE source_id=$1", [
      first.sourceId,
    ])
  ).rows[0];
  const claim = await claimInterpretation(i.id);
  expect(claim?.context.trigger.qualification).toContain(
    "esplicitamente indirizzato",
  );
  await publishInterpretation(claim!, {
    proposals: [],
    needsMore: [],
    response: {
      mode: "respond",
      text: "Partiamo dai requisiti del locale.",
      sourceIds: [String(first.sourceId)],
    },
  });
  expect(
    (
      await pool.query("SELECT content FROM message WHERE id=$1", [
        first.messageId,
      ])
    ).rows[0].content,
  ).toBe("Messaggio vocale a RIMIAM");
  expect(
    (
      await pool.query(
        "SELECT 1 FROM message WHERE reply_to_source_id=$1 AND actor_kind='miriam'",
        [first.sourceId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM accepted_information WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
});
it("requires all personal consents; new admission waits for confirmed stop; withdrawal is prospective", async () => {
  configured();
  const { a, b, c, w } = await fixture(),
    p = provider();
  const first = await act(a, w, "call.join"),
    id = String(first.callId);
  await act(b, w, "call.join");
  await tick(id, p.transport);
  await callConnection(a, w, id, p.transport);
  await callConnection(b, w, id, p.transport);
  await act(a, w, "call.recording.request", id);
  await consent(a, w, id);
  await tick(id, p.transport);
  expect(p.recordings).toHaveLength(0);
  await consent(b, w, id);
  await tick(id, p.transport);
  expect(p.recordings).toHaveLength(2);
  const captured = (await callView(a, w)).calls[0];
  for (const recording of captured.recordings) {
    const consentEvent = captured.events.find(
      (e) => e.version === recording.consentEventVersion,
    )!;
    expect(consentEvent.participantId).toBe(recording.participantId);
    expect(consentEvent.epoch).toBe(recording.consentEpoch);
    expect(consentEvent.consentText).toBe(recordingConsentText);
  }
  await act(c, w, "call.join");
  await tick(id, p.transport);
  expect(p.recordings.every((r) => r.state === "stopping")).toBe(true);
  await expect(callConnection(c, w, id, p.transport)).rejects.toThrow(
    "CALL_ADMISSION_PENDING",
  );
  p.recordings.forEach((r) => (r.state = "complete"));
  await tick(id, p.transport);
  await callConnection(c, w, id, p.transport);
  await tick(id, p.transport);
  expect(p.recordings).toHaveLength(2);
  await consent(c, w, id);
  await tick(id, p.transport);
  expect(p.recordings).toHaveLength(5);
  await act(b, w, "call.recording.withdraw", id);
  await tick(id, p.transport);
  expect(p.recordings.filter((r) => r.state === "active")).toHaveLength(0);
  expect(
    (await pool.query("SELECT 1 FROM call_recording WHERE call_id=$1", [id]))
      .rowCount,
  ).toBe(5);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM call_event WHERE call_id=$1 AND consent_text=$2",
        [id, recordingConsentText],
      )
    ).rowCount,
  ).toBe(3);
  expect(
    (
      await pool.query("SELECT 1 FROM call_analysis_request WHERE call_id=$1", [
        id,
      ])
    ).rowCount,
  ).toBe(0);
});
it("does not record on stale/proxy consent; departure preserves other consents and ends invalid access", async () => {
  configured();
  const { a, b, w } = await fixture(),
    p = provider();
  const { id: other } = await createWorkspace(b, "Other", randomUUID());
  const id = String((await act(a, w, "call.join")).callId);
  await act(b, w, "call.join");
  await tick(id, p.transport);
  await callConnection(a, w, id, p.transport);
  await callConnection(b, w, id, p.transport);
  await act(a, w, "call.recording.request", id);
  await expect(
    act(a, w, "call.recording.consent", id, {
      epoch: 99,
      consentText: recordingConsentText,
    }),
  ).rejects.toThrow("RECORDING_CONSENT_STALE");
  await expect(
    act(a, w, "call.recording.consent", id, {
      epoch: 1,
      consentText: recordingConsentText,
      personId: b,
    }),
  ).rejects.toThrow();
  await expect(callConnection(b, other, id, p.transport)).rejects.toThrow(
    "CALL_ADMISSION_PENDING",
  );
  await consent(a, w, id);
  await consent(b, w, id);
  await tick(id, p.transport);
  await act(a, w, "call.leave", id);
  await tick(id, p.transport);
  expect(p.removed).toContain(
    (await callView(b, w)).calls[0].participants.find((x) => x.userId === a)!
      .id,
  );
  expect(
    (await callView(b, w)).calls[0].participants.find((x) => x.userId === b)!
      .consented,
  ).toBe(true);
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [b]);
  await tick(id, p.transport);
  expect(p.people).toHaveLength(0);
});
it("uncertain recording start is never retried or silently treated as stopped", async () => {
  configured();
  const { a, w } = await fixture(),
    p = provider();
  let starts = 0;
  p.transport.start = async () => {
    starts++;
    throw new Error("unknown transport outcome");
  };
  const id = String((await act(a, w, "call.join")).callId);
  await tick(id, p.transport);
  await callConnection(a, w, id, p.transport);
  await act(a, w, "call.recording.request", id);
  await consent(a, w, id);
  await tick(id, p.transport);
  await tick(id, p.transport);
  expect(starts).toBe(1);
  expect((await callView(a, w)).calls[0].recordings[0].state).toBe("unknown");
  expect((await callView(a, w)).calls[0].recordings[0].captureFenced).toBe(
    true,
  );
  expect(p.people).toHaveLength(0);
});

it("late recording starts cannot override withdrawal; recovery preserves consent and completed intervals", async () => {
  configured();
  const { a, w } = await fixture(),
    p = provider();
  const id = String((await act(a, w, "call.join")).callId);
  await tick(id, p.transport);
  await callConnection(a, w, id, p.transport);
  await act(a, w, "call.recording.request", id);
  await consent(a, w, id);
  const start = p.transport.start;
  let starts = 0;
  p.transport.start = async (...args) => {
    starts++;
    await act(a, w, "call.recording.withdraw", id);
    return start(...args);
  };
  await tick(id, p.transport);
  expect(p.recordings[0].state).toBe("stopping");
  p.recordings[0].state = "complete";
  // A new worker invocation has only durable state and provider observations.
  await Promise.all([tick(id, p.transport), tick(id, p.transport)]);
  expect(p.people).toHaveLength(0);
  expect(starts).toBe(1);
  const recording = (await callView(a, w)).calls[0].recordings[0];
  await pool.query(
    "UPDATE call_transcription SET status='processing',attempt_id=$2,lease_until=now()-interval '1 minute' WHERE recording_id=$1",
    [recording.id, randomUUID()],
  );
  await recoverCalls();
  expect(
    (
      await pool.query(
        "SELECT status,attempt_id FROM call_transcription WHERE recording_id=$1",
        [recording.id],
      )
    ).rows[0],
  ).toEqual({ status: "queued", attempt_id: null });
  expect((await callView(a, w)).calls[0].recordingRequested).toBe(false);
  await tick(id, p.transport);
  expect(starts).toBe(1);
});

it("recording consent yields only immutable raw transcript; analysis is a separate attributed post-call act", async () => {
  configured();
  const { a, b, w } = await fixture(),
    p = provider();
  const id = String((await act(a, w, "call.join")).callId);
  await tick(id, p.transport);
  await callConnection(a, w, id, p.transport);
  await act(a, w, "call.recording.request", id);
  await consent(a, w, id);
  await tick(id, p.transport);
  await act(a, w, "call.leave", id);
  p.recordings.forEach((r) => (r.state = "complete"));
  await tick(id, p.transport);
  const recording = (await callView(b, w)).calls[0].recordings[0].id;
  const audio = readFileSync(
    new URL("./fixtures/call-tone.mp3", import.meta.url),
  );
  const get = vi.spyOn(S3Client.prototype, "send").mockImplementation(
    async () =>
      ({
        VersionId: "immutable-test-version",
        Body: {
          transformToWebStream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(audio);
                controller.close();
              },
            }),
        },
      }) as never,
  );
  let inferences = 0;
  await transcribeCallRecording(recording, {
    async extract() {
      inferences++;
      return {
        text: "Il budget discusso è di ottantamila euro.",
        qualification: "Affermazione da verificare contro la traccia",
        provider: "test-only",
      };
    },
  });
  expect(inferences).toBe(1);
  expect(get).toHaveBeenCalledTimes(1);
  const raw = (await callView(b, w)).calls[0].recordings[0];
  expect(raw.transcriptionStatus).toBe("ready");
  expect(raw.segments[0].content).toContain("ottantamila");
  expect(await retrieveSources(w, ["ottantamila"])).toEqual([]);
  expect(
    (
      await pool.query("SELECT 1 FROM interpretation WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(0);
  const proof = (
    await pool.query(
      "SELECT * FROM call_recording_source WHERE recording_id=$1",
      [recording],
    )
  ).rows[0];
  expect(proof.object_version).toBe("immutable-test-version");
  expect(proof.sha256).toHaveLength(64);
  await expect(
    pool.query(
      "UPDATE call_recording_source SET sha256='changed' WHERE recording_id=$1",
      [recording],
    ),
  ).rejects.toThrow();
  const analysis = await act(b, w, "call.analyze", id);
  expect(analysis.workId).toBeTruthy();
  expect((await retrieveSources(w, ["ottantamila"])).length).toBe(1);
  expect(
    (
      await pool.query("SELECT 1 FROM interpretation WHERE workspace_id=$1", [
        w,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM accepted_information WHERE workspace_id=$1",
        [w],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT actor_id FROM call_analysis_request WHERE id=$1",
        [analysis.requestId],
      )
    ).rows[0].actor_id,
  ).toBe(b);
  await transcribeCallRecording(recording, {
    async extract() {
      throw new Error("completed transcription must not replay");
    },
  });
  expect(inferences).toBe(1);
});

it("voice research proposes the exact disclosed query without running a provider", () => {
  expect(
    voiceResearchQuery(
      "Rimiam, per favore cerca sul web le licenze per cocktail bar",
    ),
  ).toBe("le licenze per cocktail bar");
  expect(
    voiceResearchQuery("Mario dice di cercare sul web i suoi documenti"),
  ).toBeNull();
  expect(voiceResearchQuery(null)).toBeNull();
});
