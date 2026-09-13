import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { auth } from "../src/server/auth";
import { pool, transaction } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  processActiveWork,
  recoverActiveWork,
  considerAutonomousWork,
} from "../src/server/active-work-worker";
import {
  activeWorkView,
  activeWorkHistory,
} from "../src/server/active-work-queries";
import { fixtureAnalysis } from "./support/fixture-analysis";
import type { AnalysisSpecialist } from "../src/server/analysis-specialist";
import { handleAPI } from "../src/server/api";
import { processInterpretation } from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";
import { DomainError } from "../src/server/errors";
async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Active-Work-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Work tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [
      login.response.token,
    ])
  ).rows[0].id;
  return {
    id: user.id,
    email,
    session,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function setup() {
  const a = await person(),
    b = await person(),
    w = (await createWorkspace(a.id, "Active Work", randomUUID())).id;
  const cmd = (c: unknown, as = a, key = randomUUID()) =>
    execute(as.id, w, key, c, as.session);
  const inv = await cmd({
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, String(inv.token), true);
  const seed = await cmd({
    type: "message.send",
    content:
      "Il locale Milano costa 3000 euro al mese: affermazione da verificare.",
  });
  // Drive the earlier turn before later test commands: production processes conversation in source order.
  await processInterpretation(String(seed.interpretationId), {
    async interpret() {
      return { proposals: [], needsMore: [] };
    },
  });
  const start = () =>
    cmd({ type: "work.converse", text: "Analizza: locali Milano" });
  const view = async (id: string, as = a) =>
    (await activeWorkView(as.id, w)).works.find((x) => x.id === id)!;
  const control = async (id: string, text: string, as = a, revision?: number) =>
    cmd(
      {
        type: "work.converse",
        workId: id,
        expectedRevision: revision ?? (await view(id, as)).revision,
        text,
      },
      as,
    );
  return { a, b, w, cmd, start, view, control };
}
function held() {
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const port: AnalysisSpecialist = {
    name: "held",
    async analyze(input) {
      entered();
      await wait;
      return fixtureAnalysis.analyze(input);
    },
  };
  return { release, started, port };
}
afterAll(() => pool.end());
describe("Active Work / governed Contributions", () => {
  it("preserves safe provider failure codes and cannot report a late failure over a human pause", async () => {
    const t = await setup();
    const id = String((await t.start()).workId);
    await processActiveWork(t.w, id, {
      name: "provider-timeout",
      async analyze() {
        throw new DomainError("AI_TIMEOUT", 504);
      },
    });
    expect(await t.view(id)).toMatchObject({
      phase: "needs_input",
      error: "AI_TIMEOUT",
    });
    expect(
      (await activeWorkHistory(t.a.id, t.w, id)).contributions,
    ).toHaveLength(0);
    await t.control(id, "riprendi");
    let pausedRevision = 0;
    await processActiveWork(t.w, id, {
      name: "late-failure",
      async analyze() {
        await t.control(id, "pausa", t.b);
        pausedRevision = (await t.view(id)).revision;
        throw new Error("sensitive provider body must not be published");
      },
    });
    expect(await t.view(id)).toMatchObject({
      phase: "paused",
      revision: pausedRevision,
      error: null,
    });
    const history = await activeWorkHistory(t.a.id, t.w, id);
    expect(JSON.stringify(history)).not.toContain("sensitive provider body");
    expect(history.contributions).toHaveLength(0);
  });
  it("cannot change an existing adopted commitment through steering or Specialist output", async () => {
    const t = await setup();
    const m = await t.cmd({
      type: "message.send",
      content: "Non spenderemo più di 80000 euro per il locale Milano.",
    });
    await processInterpretation(String(m.interpretationId), fixtureInterpreter);
    const c = (
      await pool.query(
        "SELECT id FROM candidate WHERE workspace_id=$1 AND interpretation_id=$2",
        [t.w, m.interpretationId],
      )
    ).rows[0];
    const p = await t.cmd({
      type: "commitment.propose",
      candidateId: c.id,
      people: [t.a.id],
    });
    const ws = (await pool.query("SELECT * FROM workspace WHERE id=$1", [t.w]))
      .rows[0];
    await t.cmd({
      type: "commitment.approve",
      proposalId: p.proposalId,
      expectedContextRevision: ws.context_revision,
      expectedAccessRevision: ws.access_revision,
      representSelf: true,
    });
    const before = (
      await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [t.w])
    ).rows;
    const id = String((await t.start()).workId);
    await t.control(
      id,
      "ipotesi: budget ipotetico di 100000, senza cambiare gli impegni",
    );
    await processActiveWork(t.w, id, {
      name: "observes-commitment",
      async analyze(input) {
        expect(
          input.inputs.some(
            (i) => i.kind === "commitment" && i.content.includes("80000"),
          ),
        ).toBe(true);
        return fixtureAnalysis.analyze(input);
      },
    });
    expect((await t.view(id)).phase).toBe("completed");
    expect(
      (
        await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [
          t.w,
        ])
      ).rows,
    ).toEqual(before);
    expect(
      (
        await pool.query(
          "SELECT 1 FROM normative_proposal WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("blocks publication on a changed accepted reference and permits explicit compatible refresh", async () => {
    const t = await setup();
    const candidate = async (content: string) => {
      const m = await t.cmd({ type: "message.send", content });
      await processInterpretation(
        String(m.interpretationId),
        fixtureInterpreter,
      );
      return (
        await pool.query(
          "SELECT id FROM candidate WHERE workspace_id=$1 AND interpretation_id=$2",
          [t.w, m.interpretationId],
        )
      ).rows[0].id;
    };
    const first = await candidate("Il locale Milano costa 3000 euro al mese.");
    const accepted = await t.cmd({
      type: "information.accept",
      candidateId: first,
      descriptiveOnly: true,
    });
    const replacement = await candidate(
      "Il locale Milano costa 3500 euro al mese.",
    );
    const id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await t.cmd({
      type: "information.correct",
      informationId: accepted.informationId,
      expectedVersion: 1,
      candidateId: replacement,
      reason: "Correzione esplicita",
      descriptiveOnly: true,
    });
    h.release();
    await running;
    expect((await t.view(id)).issues[0].kind).toBe("context");
    expect((await t.view(id)).contribution).toBeNull();
    await t.control(id, "usa contesto aggiornato", t.b);
    await t.control(id, "riprendi", t.b);
    await processActiveWork(t.w, id, fixtureAnalysis);
    expect((await t.view(id)).phase).toBe("completed");
    const history = await activeWorkHistory(t.a.id, t.w, id);
    expect(
      history.inputs
        .filter((i) => i.kind === "information")
        .map((i) => i.version),
    ).toEqual(expect.arrayContaining([1, 2]));
  });
  it("permits separate works to execute concurrently without a Workspace-wide inference lock", async () => {
    const t = await setup(),
      first = String((await t.start()).workId);
    await t.cmd({
      type: "message.send",
      content: "Il preventivo Roma costa 2500 euro.",
    });
    const second = String(
        (
          await t.cmd({
            type: "work.converse",
            text: "Analizza: preventivo Roma",
          })
        ).workId,
      ),
      h = held();
    const running = processActiveWork(t.w, first, h.port);
    await h.started;
    await processActiveWork(t.w, second, fixtureAnalysis);
    expect((await t.view(second)).phase).toBe("completed");
    expect((await t.view(first)).phase).toBe("working");
    h.release();
    await running;
    expect((await t.view(first)).phase).toBe("completed");
  });
  it("does not borrow the initiator's account and excludes other Workspace material", async () => {
    const t = await setup(),
      other = await setup(),
      id = String((await t.start()).workId);
    await other.cmd({
      type: "message.send",
      content: "Milano PRIVATE-OTHER-WORKSPACE",
    });
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [t.a.id]);
    await processActiveWork(t.w, id, {
      name: "inspect",
      async analyze(input) {
        expect(JSON.stringify(input)).not.toContain("PRIVATE-OTHER-WORKSPACE");
        expect(input.capability).toEqual({
          read: "shared_workspace_projection",
          output: "unadopted_analysis",
          actions: "none",
        });
        return fixtureAnalysis.analyze(input);
      },
    });
    expect((await t.view(id, t.b)).phase).toBe("completed");
    await expect(activeWorkHistory(other.a.id, t.w, id)).rejects.toMatchObject({
      code: "WORKSPACE_ACCESS_DENIED",
    });
    await expect(other.control(id, "pausa", other.a, 1)).rejects.toBeDefined();
  });
  it("rejects Specialist action fields and does not manufacture completion without configuration", async () => {
    const t = await setup(),
      id = String((await t.start()).workId);
    await processActiveWork(t.w, id);
    expect((await t.view(id)).error).toBe("AI_CONFIGURATION_REQUIRED");
    await t.control(id, "riprendi");
    await processActiveWork(t.w, id, {
      name: "overreach",
      async analyze(input) {
        return {
          ...((await fixtureAnalysis.analyze(input)) as object),
          actions: [{ type: "commitment.propose" }],
        };
      },
    });
    expect((await t.view(id)).phase).toBe("needs_input");
    expect(
      (await activeWorkHistory(t.a.id, t.w, id)).contributions,
    ).toHaveLength(0);
    expect(
      (
        await pool.query("SELECT 1 FROM project_act WHERE workspace_id=$1", [
          t.w,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("persists explicit conversational work, provenance and unadopted completed output", async () => {
    const t = await setup();
    const r = await t.cmd({
      type: "message.send",
      content: "Miriam, analizza locali Milano",
    });
    const id = String(r.workId);
    await processActiveWork(t.w, id, fixtureAnalysis);
    const v = await t.view(id);
    expect(v.phase).toBe("completed");
    expect(v.contract.origin).toBe("human");
    expect(v.contribution?.qualification).toContain("non adottata");
    const h = await activeWorkHistory(t.a.id, t.w, id);
    expect(h.inputs.length).toBeGreaterThan(0);
    expect(h.contributions).toHaveLength(1);
    expect(h.events.some((e) => e.kind === "completed")).toBe(true);
    for (const table of [
      "project_act",
      "accepted_information",
      "artifact",
      "workspace_task",
    ]) {
      expect(
        (
          await pool.query(`SELECT 1 FROM ${table} WHERE workspace_id=$1`, [
            t.w,
          ])
        ).rowCount,
      ).toBe(0);
    }
  });
  it("allows peer pause/resume and compatible steering without requester ownership", async () => {
    const t = await setup(),
      id = String((await t.start()).workId);
    await t.control(id, "pausa", t.b);
    expect((await t.view(id)).phase).toBe("paused");
    await t.control(id, "formato: elenco", t.b);
    expect((await t.view(id)).phase).toBe("paused");
    expect((await t.view(id)).contract.version).toBe(2);
    await t.control(id, "riprendi", t.b);
    await processActiveWork(t.w, id, fixtureAnalysis);
    expect((await t.view(id)).phase).toBe("completed");
  });
  it("holds incompatible directions and preserves another member's unresolved objection", async () => {
    const t = await setup(),
      id = String((await t.start()).workId);
    await t.control(id, "reindirizza: locali Roma", t.b);
    let v = await t.view(id);
    expect(v.contract.objective).toBe("locali Milano");
    expect(v.phase).toBe("needs_input");
    const proposed = v.issues[0];
    await t.control(id, "obiezione: non abbandonare Milano", t.a);
    await t.control(id, `confermo: ${proposed.id}`, t.a);
    expect((await t.view(id)).contract.objective).toBe("locali Milano");
    const objection = (await t.view(id)).issues.find(
      (i) => i.kind === "objection",
    )!;
    await expect(
      t.control(id, `ritiro: ${objection.id}`, t.b),
    ).rejects.toMatchObject({ code: "OWN_INSTRUCTION_REQUIRED" });
    await t.control(id, "riprendi", t.b);
    expect((await t.view(id)).phase).toBe("needs_input");
    await t.control(id, `ritiro: ${objection.id}`, t.a);
    await t.control(id, `confermo: ${proposed.id}`, t.a);
    v = await t.view(id);
    expect(v.contract.objective).toBe("locali Roma");
    expect(v.contract.version).toBe(2);
    expect(v.issues).toHaveLength(0);
  });
  it("rejects stale controls and preserves immutable contract/control history", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      v = await t.view(id);
    await t.control(id, "pausa", t.b, v.revision);
    await expect(t.control(id, "ferma", t.a, v.revision)).rejects.toMatchObject(
      { code: "WORK_STATE_STALE" },
    );
    await expect(
      pool.query(
        "UPDATE active_work_contract SET objective='changed' WHERE workspace_id=$1",
        [t.w],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query("DELETE FROM active_work_event WHERE workspace_id=$1", [t.w]),
    ).rejects.toThrow();
  });
  it("fences late results after pause/resume even with the same contract", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await t.control(id, "pausa", t.b);
    await t.control(id, "riprendi", t.b);
    h.release();
    await running;
    expect((await t.view(id)).contribution).toBeNull();
    await processActiveWork(t.w, id, fixtureAnalysis);
    expect((await t.view(id)).phase).toBe("completed");
  });
  it("does not use unrelated workspace changes as work staleness", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await t.cmd({
      type: "message.send",
      content: "Saluti da un altro argomento indipendente.",
    });
    h.release();
    await running;
    expect((await t.view(id)).phase).toBe("completed");
  });
  it("incorporates relevant new sources in the same work and later marks completed output outdated", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await t.cmd({
      type: "message.send",
      content: "Un altro locale Milano costa 3500 euro.",
    });
    h.release();
    await running;
    expect((await t.view(id)).phase).toBe("queued");
    await processActiveWork(t.w, id, fixtureAnalysis);
    await t.cmd({
      type: "message.send",
      content: "Il contratto del locale Milano indica 3200 euro.",
    });
    const v = await t.view(id);
    expect(v.phase).toBe("completed");
    expect(v.validity).toBe("potentially_outdated");
    await recoverActiveWork();
    expect((await t.view(id)).phase).toBe("completed");
  });
  it("preserves anchors across contract revisions and rejects late old-contract publication", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await t.control(id, "ipotesi: solo analisi, nessun acquisto", t.b);
    h.release();
    await running;
    expect((await t.view(id)).contribution).toBeNull();
    await processActiveWork(t.w, id, fixtureAnalysis);
    expect((await t.view(id)).contribution?.body).toContain("nessun acquisto");
  });
  it("retrieves older relevant context on demand and refuses insufficient or invalid output", async () => {
    const t = await setup();
    await t.cmd({
      type: "message.send",
      content: "L'archivio ortensia contiene il preventivo storico.",
    });
    const id = String((await t.start()).workId);
    let calls = 0;
    await processActiveWork(t.w, id, {
      name: "retrieve",
      async analyze(input) {
        calls++;
        if (calls === 1)
          return {
            body: "",
            citations: [],
            needsMore: ["ortensia"],
            needsInput: "",
          };
        expect(input.inputs.some((i) => i.content.includes("ortensia"))).toBe(
          true,
        );
        return fixtureAnalysis.analyze(input);
      },
    });
    expect((await t.view(id)).phase).toBe("completed");
    await t.control(id, "riprendi");
    await processActiveWork(t.w, id, {
      name: "invalid",
      async analyze() {
        return {
          body: "Inventato",
          citations: [`source:${randomUUID()}:1`],
          needsMore: [],
          needsInput: "",
        };
      },
    });
    expect(await t.view(id)).toMatchObject({
      phase: "needs_input",
      error: "INVALID_ANALYSIS_CITATION",
    });
    expect(
      (await activeWorkHistory(t.a.id, t.w, id)).contributions,
    ).toHaveLength(1);
    await t.control(id, "riprendi");
    await processActiveWork(t.w, id, {
      name: "malformed",
      async analyze() {
        return { body: "no validated contract" };
      },
    });
    expect(await t.view(id)).toMatchObject({
      phase: "needs_input",
      error: "AI_OUTPUT_PARSE_ERROR",
    });
    expect(
      (await activeWorkHistory(t.a.id, t.w, id)).contributions,
    ).toHaveLength(1);
    await t.control(id, "riprendi");
    await processActiveWork(t.w, id, {
      name: "insufficient",
      async analyze() {
        return {
          body: "",
          citations: [],
          needsMore: ["manca"],
          needsInput: "",
        };
      },
    });
    expect((await t.view(id)).issues[0].kind).toBe("input");
  });
  it("enforces access, session, contribution and isolation without borrowing a requester account", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      outsider = await person();
    await expect(activeWorkView(outsider.id, t.w)).rejects.toMatchObject({
      code: "WORKSPACE_ACCESS_DENIED",
    });
    await expect(
      execute(t.a.id, t.w, randomUUID(), {
        type: "work.converse",
        text: "pausa",
        workId: id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATED_SESSION_REQUIRED" });
    await pool.query(
      "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
      [t.w, t.b.id],
    );
    await expect(t.control(id, "pausa", t.b)).rejects.toMatchObject({
      code: "WORKSPACE_ACCESS_DENIED",
    });
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [t.a.id]);
    await processActiveWork(t.w, id, fixtureAnalysis);
    await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [t.a.id]);
    expect((await t.view(id)).phase).toBe("needs_input");
  });
  it("does not revive results after all shared analysis eligibility ends mid-inference", async () => {
    const t = await setup(),
      id = String((await t.start()).workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await pool.query(
      'UPDATE "user" SET eligible=false WHERE id=ANY($1::text[])',
      [[t.a.id, t.b.id]],
    );
    h.release();
    await running;
    expect(
      (
        await pool.query(
          "SELECT 1 FROM active_work_contribution WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("recovers expired attempts, deduplicates commands/jobs and preserves a stop", async () => {
    const t = await setup(),
      key = randomUUID();
    const r = await t.cmd(
      { type: "work.converse", text: "Analizza: locali Milano" },
      t.a,
      key,
    );
    expect(
      await t.cmd(
        { type: "work.converse", text: "Analizza: locali Milano" },
        t.a,
        key,
      ),
    ).toEqual(r);
    const id = String(r.workId),
      h = held();
    const running = processActiveWork(t.w, id, h.port);
    await h.started;
    await pool.query(
      "UPDATE active_work SET lease_until=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    await recoverActiveWork();
    h.release();
    await running;
    await Promise.all([
      processActiveWork(t.w, id, fixtureAnalysis),
      processActiveWork(t.w, id, fixtureAnalysis),
    ]);
    expect(
      (await activeWorkHistory(t.a.id, t.w, id)).contributions,
    ).toHaveLength(1);
    await t.control(id, "ferma", t.b);
    await recoverActiveWork();
    await processActiveWork(t.w, id, fixtureAnalysis);
    expect((await t.view(id)).phase).toBe("stopped");
  });
  it("starts bounded autonomous analysis with Miriam provenance and reuses obvious overlap", async () => {
    const t = await setup();
    await t.cmd({
      type: "message.send",
      content: "Confronto locali Milano: seconda fonte disponibile.",
    });
    const m = await t.cmd({
      type: "message.send",
      content: "Confronta i locali Milano",
    });
    await t.cmd({
      type: "question.open",
      sourceId: m.messageId,
      content: "Confronta i locali Milano",
    });
    await transaction((tx) => considerAutonomousWork(tx, t.w, true));
    expect((await activeWorkView(t.a.id, t.w)).works).toHaveLength(0);
    await t.cmd({
      type: "attention.preference",
      mode: "collaborative",
      expectedVersion: 0,
    });
    await transaction((tx) => considerAutonomousWork(tx, t.w, true));
    const first = (await activeWorkView(t.a.id, t.w)).works[0];
    expect(first.contract.origin).toBe("miriam");
    expect(first.contract.actor).toBeNull();
    await t.control(first.id, "ferma", t.b);
    await t.cmd({
      type: "question.open",
      sourceId: m.messageId,
      content: "Confronta i locali Milano",
    });
    await transaction((tx) => considerAutonomousWork(tx, t.w, true));
    const v = await activeWorkView(t.a.id, t.w);
    expect(v.works).toHaveLength(1);
    expect(v.works[0].phase).toBe("stopped");
    const response = await handleAPI(
      new Request(`http://localhost/api/v1/workspaces/${t.w}/active-work`, {
        headers: { cookie: t.a.cookie },
      }),
    );
    expect(response.status).toBe(200);
  });
});
