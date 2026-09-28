import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool, transaction } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { activity } from "../src/server/activity";
import { referenceDetail } from "../src/server/conversation-reference";
import { attentionCommand } from "../src/server/attention";
import { lockWorkspace } from "../src/server/workspace-state";
import { state, messages } from "../src/server/sync";
import {
  claimInterpretation,
  publishInterpretation,
  processInterpretation,
} from "../src/server/interpretation";
import { processDocument } from "../src/server/media-worker";
import { processActiveWork } from "../src/server/active-work-worker";
import { analysisInputs } from "../src/server/active-work-context";
import { fixtureAnalysis } from "./support/fixture-analysis";
import { handleAPI } from "../src/server/api";
import type { ConversationReference } from "../src/contracts/activity";

afterAll(() => pool.end());
async function setup() {
  const email = `${randomUUID()}@example.test`,
    password = "Activity-local-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "RIMIAM tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id;
  const w = (await createWorkspace(user.id, "RIMIAM startup", randomUUID())).id;
  const cmd = (command: unknown, key = randomUUID()) =>
    execute(user.id, w, key, command, session);
  return { actor: user.id, email, password, session, w, cmd };
}
async function done(w: string) {
  await pool.query(
    "UPDATE interpretation SET status='completed' WHERE workspace_id=$1",
    [w],
  );
}
const empty = { proposals: [], needsMore: [] };

it("projects actual immutable events with exact references, stable pagination including timestamp ties, and no invented empty Activity", async () => {
  const t = await setup();
  expect((await activity(t.actor, t.w)).events).toEqual([]);
  await transaction(async (tx) => {
    await lockWorkspace(tx, t.w);
    for (const title of ["Prima beta", "Ricerca utenti"])
      await attentionCommand(tx, t.w, t.actor, {
        type: "workstream.save",
        title,
        description: "Filone condiviso",
      });
  });
  const goal = await t.cmd({
    type: "goal.establish",
    content: "Validare RIMIAM con piccoli gruppi",
  });
  const full = await activity(t.actor, t.w);
  expect(full.events).toHaveLength(3);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await activity(t.actor, t.w, cursor, 1);
    seen.push(...page.events.map((e) => e.eventId));
    cursor = page.next ?? undefined;
  } while (cursor);
  expect(seen).toEqual(full.events.map((e) => e.eventId));
  expect(new Set(seen).size).toBe(3);
  const event = full.events.find((e) => e.reference.id === goal.goalId)!;
  expect(event.reference).toEqual({
    kind: "goal",
    id: goal.goalId,
    version: 1,
    eventId: event.eventId,
  });
  expect(await referenceDetail(t.actor, t.w, event.reference)).toMatchObject({
    current: true,
    event: { eventId: event.eventId },
    provenance: { explicitAdherents: [] },
  });
  await expect(activity(t.actor, t.w, "invalid")).rejects.toThrow(
    "INVALID_CURSOR",
  );
});

it("keeps the proposal event separate from later actual adoption rather than rewriting historical status", async () => {
  const t = await setup();
  const proposal = await t.cmd({
    type: "project.propose",
    kind: "constraint",
    content: "Nessun invio esterno senza conferma",
    people: [t.actor],
    goal: null,
    reason: "Scelta esplicita",
  });
  const original = (await activity(t.actor, t.w)).events.find(
    (e) => e.kind === "commitment.proposed",
  )!;
  expect(
    (await referenceDetail(t.actor, t.w, original.reference)).current,
  ).toBe(false);
  const revision = (await state(t.actor, t.w)).workspace.accessRevision;
  await t.cmd({
    type: "project.approve",
    proposalId: proposal.proposalId,
    expectedAccessRevision: revision,
    representedPersonId: t.actor,
    confirmExactContent: true,
  });
  const events = (await activity(t.actor, t.w)).events;
  expect(events.find((e) => e.eventId === original.eventId)).toEqual(original);
  const adopted = events.find((e) => e.kind === "commitment.adopted")!;
  expect(adopted.eventId).not.toBe(original.eventId);
  const historic = await referenceDetail(t.actor, t.w, original.reference);
  expect(historic).toMatchObject({
    current: true,
    event: { kind: "commitment.proposed" },
  });
  expect(historic.provenance.adoptedAt).toBeTruthy();
  const row = (
    await pool.query(
      "SELECT adopted_at FROM project_act WHERE workspace_id=$1 AND proposal_id=$2",
      [t.w, proposal.proposalId],
    )
  ).rows[0];
  expect(adopted.occurredAt).toBe(row.adopted_at.toISOString());
  const inputs = await transaction((tx) =>
    analysisInputs(tx, t.w, "Verifica i vincoli", []),
  );
  const commitment = inputs.find((input) => input.kind === "commitment")!;
  expect(commitment.id).not.toBe(proposal.proposalId);
  expect(commitment.provenance.reference).toEqual({
    kind: "commitment",
    id: proposal.proposalId,
    version: 1,
  });
  expect(
    await referenceDetail(
      t.actor,
      t.w,
      commitment.provenance.reference as ConversationReference,
    ),
  ).toMatchObject({
    current: true,
    content: "Nessun invio esterno senza conferma",
  });
  await expect(
    referenceDetail(t.actor, t.w, {
      ...original.reference,
      eventId: "goal:fake:1",
    }),
  ).rejects.toThrow("REFERENCE_EVENT_MISMATCH");
});

it("preserves historical reference with attributed text/voice, composes focus, and never adopts through discussion", async () => {
  const t = await setup();
  const stream = await t.cmd({
    type: "workstream.save",
    title: "Interviste",
    description: "Cinque persone",
  });
  const original = (await activity(t.actor, t.w)).events[0].reference;
  await t.cmd({
    type: "workstream.save",
    id: stream.id,
    expectedVersion: 1,
    title: "Interviste mirate",
    description: "Focus aggiornato",
  });
  const before = await state(t.actor, t.w),
    key = randomUUID();
  const command = {
    type: "message.send",
    content: "Miriam, spiegami perché avevamo scelto questo",
    reference: original,
    workstreamFocus: { workstreamId: stream.id, version: 2 },
  };
  const sent = await t.cmd(command, key);
  expect(await t.cmd(command, key)).toEqual(sent);
  const claim = await claimInterpretation(sent.interpretationId);
  expect(claim?.context.objectReference).toMatchObject({
    title: "Interviste",
    content: "Cinque persone",
    current: false,
    reference: original,
    provenance: { currentVersion: 2 },
  });
  await publishInterpretation(claim!, {
    ...empty,
    response: {
      mode: "respond",
      text: "Quella versione organizzava cinque interviste, senza assumere impegni.",
      sourceIds: [sent.messageId],
    },
  });
  const voice = await t.cmd({
    type: "voice.send",
    filename: "reference.wav",
    bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
    mode: "miriam",
    allowModelProcessing: true,
    reference: original,
  });
  await processDocument(voice.sourceId, {
    async extract() {
      return {
        text: "Miriam, fammi capire il riferimento",
        qualification: "Trascrizione fallibile",
        provider: "test-only",
      };
    },
  });
  const vi = (
    await pool.query("SELECT id FROM interpretation WHERE source_id=$1", [
      voice.sourceId,
    ])
  ).rows[0];
  const vc = await claimInterpretation(vi.id);
  expect(vc?.context.objectReference?.reference).toEqual(original);
  const after = await state(t.actor, t.w),
    page = await messages(t.actor, t.w, 0, after.messageSequence, 100);
  expect(
    page.messages.filter((m) => m.reference).map((m) => m.reference),
  ).toEqual([original, original, original]);
  expect(after.goals).toEqual(before.goals);
  expect(after.information).toEqual([]);
  expect(after.commitments).toEqual([]);
  await expect(
    pool.query("DELETE FROM message_context_reference WHERE workspace_id=$1", [
      t.w,
    ]),
  ).rejects.toThrow();
  await expect(
    t.cmd({ ...command, reference: { ...original, version: 2 } }, key),
  ).rejects.toThrow("COMMAND_ID_REUSED");
});

it("fences material reference changes but not unrelated Workspace edits", async () => {
  const t = await setup(),
    stream = await t.cmd({
      type: "workstream.save",
      title: "Beta",
      description: "Primo perimetro",
    });
  const ref = { kind: "workstream", id: stream.id, version: 1 } as const;
  const one = await t.cmd({
    type: "message.send",
    content: "Miriam, spiega questo",
    reference: ref,
  });
  const claim = await claimInterpretation(one.interpretationId);
  await t.cmd({
    type: "workstream.save",
    title: "Altro filone",
    description: "Indipendente",
  });
  expect(await publishInterpretation(claim!, empty)).toBe(true);
  const two = await t.cmd({
    type: "message.send",
    content: "Miriam, è ancora così?",
    reference: ref,
  });
  const late = await claimInterpretation(two.interpretationId);
  await t.cmd({
    type: "workstream.save",
    id: stream.id,
    expectedVersion: 1,
    title: "Beta aggiornata",
    description: "Nuovo perimetro",
  });
  expect(
    await publishInterpretation(late!, {
      ...empty,
      response: {
        mode: "respond",
        text: "Risposta obsoleta",
        sourceIds: [two.messageId],
      },
    }),
  ).toBe(false);
  expect(
    (
      await pool.query(
        "SELECT * FROM miriam_response WHERE interpretation_id=$1",
        [two.interpretationId],
      )
    ).rowCount,
  ).toBe(0);
});

it("resolves the existing shared capability versions and supplies exact source provenance to interpretation and Specialist", async () => {
  const t = await setup();
  const source = await t.cmd({
    type: "message.send",
    content: "Cinque partecipanti hanno disponibilità venerdì",
  });
  await processInterpretation(source.interpretationId, {
    async interpret() {
      return {
        ...empty,
        proposals: [
          {
            subject: "Disponibilità",
            content: "Cinque partecipanti disponibili venerdì",
            classification: "descriptive",
            origin: "attributed",
            qualification: "Dichiarazione da verificare",
            sourceIds: [source.messageId],
          },
        ],
      };
    },
  });
  const candidate = (
    await pool.query("SELECT id FROM candidate WHERE workspace_id=$1", [t.w])
  ).rows[0];
  await t.cmd({
    type: "information.accept",
    candidateId: candidate.id,
    descriptiveOnly: true,
  });
  await t.cmd({
    type: "question.open",
    sourceId: source.messageId,
    content: "Quali domande faremo?",
  });
  await t.cmd({
    type: "task.create",
    content: {
      title: "Preparare domande",
      description: "Prima intervista",
      dueAt: null,
      timeZone: "Europe/Rome",
      suggestedPerson: null,
      references: [],
    },
  });
  const artifact = await t.cmd({
    type: "artifact.compose",
    title: "Scaletta",
    purpose: "Discussione",
    blocks: [{ type: "paragraph", text: "Bozza non adottata" }],
    sourceIds: [source.messageId],
    information: [],
    reason: "Prima bozza",
    nonOperative: true,
  });
  await t.cmd({
    type: "temporal.create",
    payload: {
      title: "Intervista",
      start: "2027-01-10T10:00:00Z",
      end: "2027-01-10T11:00:00Z",
      timeZone: "Europe/Rome",
    },
    reason: "Evento interno",
    sourceMessageId: source.messageId,
    representSelf: true,
    expectedContextRevision: (await state(t.actor, t.w)).workspace
      .contextRevision,
  });
  await t.cmd({
    type: "document.upload",
    filename: "note.txt",
    bytesBase64: Buffer.from("Fonte condivisa di ricerca").toString("base64"),
  });
  const events = (await activity(t.actor, t.w)).events;
  for (const kind of [
    "information",
    "question",
    "task",
    "artifact",
    "scheduled_event",
    "source",
  ]) {
    const event = events.find((e) => e.reference.kind === kind);
    expect(event, kind).toBeDefined();
    const detail = await referenceDetail(t.actor, t.w, event!.reference);
    expect(detail.reference).toEqual(event!.reference);
  }
  await done(t.w);
  const request = await t.cmd({
    type: "message.send",
    content: "Analizza questa scaletta",
    reference: { kind: "artifact", id: artifact.artifactId, version: 1 },
  });
  await processActiveWork(t.w, request.workId, {
    name: "test-reference",
    async analyze(input) {
      expect(input.inputs).toContainEqual(
        expect.objectContaining({
          kind: "reference_artifact",
          id: artifact.artifactId,
          version: 1,
          qualification: expect.stringContaining(
            "Soltanto selectedCurrentlyAdopted",
          ),
        }),
      );
      expect(input.inputs).toContainEqual(
        expect.objectContaining({ kind: "source", id: source.messageId }),
      );
      return fixtureAnalysis.analyze(input);
    },
  });
  const workEvent = (await activity(t.actor, t.w)).events.find(
    (e) => e.kind === "work.completed",
  )!;
  const detail = await referenceDetail(t.actor, t.w, workEvent.reference);
  expect(detail.reference.version).toBeGreaterThan(1);
  expect(detail.provenance.contractVersion).toBe(1);
  expect(detail.provenance.adopted).toBe(false);
  expect(detail.content).toContain("Contribution storica non adottata");
});

it("denies cross-Workspace/ended access and permits retained shared history for admitted members", async () => {
  const t = await setup(),
    other = await setup();
  const goal = await t.cmd({
    type: "goal.establish",
    content: "RIMIAM prima beta",
  });
  const ref = { kind: "goal", id: goal.goalId, version: 1 } as const;
  await expect(activity(other.actor, t.w)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
  await expect(
    other.cmd({ type: "message.send", content: "Spiega", reference: ref }),
  ).rejects.toThrow("REFERENCE_NOT_FOUND");
  const inv = await t.cmd({
    type: "invitation.create",
    email: other.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(other.actor, inv.token, true);
  expect(
    (await activity(other.actor, t.w)).events.some(
      (e) => e.reference.id === goal.goalId,
    ),
  ).toBe(true);
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
    other.actor,
  ]);
  await expect(referenceDetail(other.actor, t.w, ref)).rejects.toThrow();
  await expect(activity(other.actor, t.w)).rejects.toThrow();
});

it("does not expose private drafts or raw call recordings/transcripts through Activity or generic references", async () => {
  const t = await setup(),
    draft = randomUUID(),
    call = randomUUID(),
    participant = randomUUID(),
    recording = randomUUID(),
    segment = randomUUID();
  await pool.query(
    "INSERT INTO email_draft(id,workspace_id,person_id,current_version) VALUES($1,$2,$3,1)",
    [draft, t.w, t.actor],
  );
  await pool.query(
    "INSERT INTO email_draft_version(workspace_id,draft_id,version,envelope,envelope_hash,reason,actor_id) VALUES($1,$2,1,$3,'test','Private',$4)",
    [
      t.w,
      draft,
      { subject: "PRIVATE_EMAIL_CONTENT", body: "Private body" },
      t.actor,
    ],
  );
  await pool.query(
    "INSERT INTO audio_call(id,workspace_id,state) VALUES($1,$2,'ended')",
    [call, t.w],
  );
  await pool.query(
    "INSERT INTO call_participant(id,workspace_id,call_id,user_id,membership_version,state) VALUES($1,$2,$3,$4,1,'left')",
    [participant, t.w, call, t.actor],
  );
  await pool.query(
    "INSERT INTO call_recording(id,workspace_id,call_id,participant_id,consent_epoch,track_id,object_key,state) VALUES($1,$2,$3,$4,1,'test',$5,'complete')",
    [recording, t.w, call, participant, recording],
  );
  await pool.query(
    "INSERT INTO call_transcript_segment(id,workspace_id,recording_id,ordinal,content,provider,qualification,audio_hash,start_seconds) VALUES($1,$2,$3,1,'RAW_CALL_NOT_REQUESTED','test-only','Raw authorised recording, no analysis request','testhash',0)",
    [segment, t.w, recording],
  );
  const events = await activity(t.actor, t.w);
  expect(JSON.stringify(events)).not.toMatch(
    /PRIVATE_EMAIL_CONTENT|RAW_CALL_NOT_REQUESTED/,
  );
  for (const id of [draft, recording, segment]) {
    await expect(
      referenceDetail(t.actor, t.w, { kind: "source", id, version: 1 }),
    ).rejects.toThrow("REFERENCE_NOT_FOUND");
    await expect(
      t.cmd({
        type: "message.send",
        content: "Miriam analizza",
        reference: { kind: "source", id, version: 1 },
      }),
    ).rejects.toThrow("REFERENCE_NOT_FOUND");
  }
  expect(
    (
      await pool.query(
        "SELECT * FROM message_context_reference WHERE workspace_id=$1",
        [t.w],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT * FROM call_analysis_request WHERE workspace_id=$1",
        [t.w],
      )
    ).rowCount,
  ).toBe(0);
});

it("fences Active Work reference metadata changes at the same Goal version and marks historical completion outdated", async () => {
  const t = await setup(),
    other = await setup();
  const goal = await t.cmd({
    type: "goal.establish",
    content: "Validare RIMIAM",
  });
  const request = await t.cmd({
    type: "message.send",
    content: "Analizza questo Goal",
    reference: { kind: "goal", id: goal.goalId, version: 1 },
  });
  const row = async () =>
    (
      await pool.query(
        "SELECT phase,validity FROM active_work WHERE workspace_id=$1 AND id=$2",
        [t.w, request.workId],
      )
    ).rows[0];
  const referenceAnalysis = {
    name: "test-exact-reference",
    async analyze(input: Parameters<typeof fixtureAnalysis.analyze>[0]) {
      const reference = input.inputs.find((i) => i.kind === "reference_goal")!;
      return {
        body: "Analisi della versione del Goal e delle adesioni esplicite fornite.",
        citations: [reference.key],
        needsMore: [],
        needsInput: "",
      };
    },
  };
  await processActiveWork(t.w, request.workId, {
    name: "test-metadata-change",
    async analyze(input) {
      await t.cmd({ type: "goal.adhere", goalId: goal.goalId, version: 1 });
      return referenceAnalysis.analyze(input);
    },
  });
  expect((await row()).phase).toBe("queued");
  expect(
    (
      await pool.query(
        "SELECT 1 FROM active_work_contribution WHERE workspace_id=$1 AND work_id=$2",
        [t.w, request.workId],
      )
    ).rowCount,
  ).toBe(0);
  await processActiveWork(t.w, request.workId, referenceAnalysis);
  expect(await row()).toMatchObject({
    phase: "completed",
    validity: "current",
  });
  const invitation = await t.cmd({
    type: "invitation.create",
    email: other.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(other.actor, invitation.token, true);
  await execute(
    other.actor,
    t.w,
    randomUUID(),
    { type: "goal.adhere", goalId: goal.goalId, version: 1 },
    other.session,
  );
  expect(await row()).toMatchObject({
    phase: "completed",
    validity: "potentially_outdated",
  });
  expect(
    (
      await pool.query(
        "SELECT current_version FROM goal WHERE workspace_id=$1 AND id=$2",
        [t.w, goal.goalId],
      )
    ).rows[0].current_version,
  ).toBe(1);
});

it("serves Activity and exact references through the same authenticated versioned API", async () => {
  const t = await setup(),
    base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  await t.cmd({ type: "goal.establish", content: "RIMIAM beta API" });
  const login = await handleAPI(
    new Request(`${base}/api/v1/native/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: t.email, password: t.password }),
    }),
  );
  const token = (await login.json()).token;
  const get = (path: string) =>
    handleAPI(
      new Request(`${base}/api/v1/workspaces/${t.w}/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  const eventsResponse = await get("activity?limit=1");
  expect(eventsResponse.status).toBe(200);
  const ref: ConversationReference = (await eventsResponse.json()).events[0]
    .reference;
  const query = new URLSearchParams({ ...ref, version: String(ref.version) });
  const detail = await get(`reference?${query}`);
  expect(detail.status).toBe(200);
  expect((await detail.json()).reference).toEqual(ref);
  expect(
    (await get("reference?kind=email_draft&id=" + randomUUID() + "&version=1"))
      .status,
  ).toBe(400);
  expect((await get("activity?before=invalid")).status).toBe(400);
});
