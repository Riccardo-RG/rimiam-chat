import { randomUUID, createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { readDocument } from "../src/server/sources";
import { snapshot } from "../src/server/queries";
import {
  processInterpretation,
  retrieveSources,
  configuredInterpreter,
} from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";
import { processResearch, recoverResearch } from "../src/server/research";
import {
  braveResearchProvider,
  type ResearchProvider,
} from "../src/server/research-provider";

async function user() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [id, `Person ${id}`, `${id}@example.test`],
  );
  return id;
}
async function setup() {
  const a = await user(),
    b = await user(),
    w = (await createWorkspace(a, "Source tests", randomUUID())).id;
  return { a, b, w };
}
async function join(a: string, b: string, w: string) {
  const invite = await execute(a, w, randomUUID(), {
    type: "invitation.create",
    email: `${b}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b, invite.token as string, true);
}
const upload = (
  a: string,
  w: string,
  content = "Il locale costa €3.200 al mese.",
  extra: Record<string, unknown> = {},
) =>
  execute(a, w, randomUUID(), {
    type: "document.upload",
    filename: "contratto.txt",
    bytesBase64: Buffer.from(content).toString("base64"),
    ...extra,
  });
const request = (a: string, w: string, query = "Costo licenza cocktail bar") =>
  execute(a, w, randomUUID(), {
    type: "research.request",
    query,
    discloseQuery: true,
  });
const provider: ResearchProvider = {
  name: "test-provider",
  async search() {
    return [
      {
        title: "Costi licenza",
        url: "https://example.test/licenza",
        excerpt: "La licenza costa circa €2.000.",
      },
    ];
  },
};
afterAll(() => pool.end());

describe("Document sources and retained provenance", () => {
  it("keeps exact original bytes and version history; upload never accepts claims, changes obligations or fabricates a message", async () => {
    const { a, b, w } = await setup();
    const bytes = "Il locale costa €3.200 al mese.\r\n";
    const first = await upload(a, w, bytes);
    expect((await snapshot(a, w)).messages).toHaveLength(0);
    expect((await snapshot(a, w)).information).toHaveLength(0);
    expect(
      (await readDocument(a, w, first.sourceId as string)).original_bytes,
    ).toEqual(Buffer.from(bytes));
    expect((await snapshot(a, w)).sources[0].content_hash).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    await expect(readDocument(b, w, first.sourceId as string)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await join(a, b, w);
    // Admission explicitly includes earlier files, as well as historical messages.
    expect(
      (await readDocument(b, w, first.sourceId as string)).original_bytes,
    ).toEqual(Buffer.from(bytes));
    await processInterpretation(
      first.interpretationId as string,
      fixtureInterpreter,
    );
    let state = await snapshot(b, w);
    const c = state.candidates[0];
    expect(c.author_name).toBe("Documento: contratto.txt");
    expect(c.source_ids).toEqual([first.sourceId]);
    await execute(b, w, randomUUID(), {
      type: "information.accept",
      candidateId: c.id,
      descriptiveOnly: true,
    });
    const second = await upload(b, w, "Il locale costa €3.400 al mese.", {
      previousSourceId: first.sourceId,
    });
    expect(second.documentId).toBe(first.documentId);
    expect(second.version).toBe(2);
    await expect(
      upload(a, w, "Nuova versione concorrente", {
        previousSourceId: first.sourceId,
      }),
    ).rejects.toThrow("DOCUMENT_VERSION_STALE");
    state = await snapshot(a, w);
    expect(state.sources).toHaveLength(2);
    expect(state.information[0].content).toContain("3.200");
    expect(state.commitments).toHaveLength(0);
    expect(
      (await retrieveSources(w, ["3.400"])).some(
        (s) => s.id === second.sourceId && s.kind === "document",
      ),
    ).toBe(true);
    await expect(
      pool.query("UPDATE external_source SET title='Changed' WHERE id=$1", [
        first.sourceId,
      ]),
    ).rejects.toThrow("immutable");
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await expect(readDocument(b, w, first.sourceId as string)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
  });
  it("deduplicates transport retries and rejects cross-workspace versions and source links", async () => {
    const { a, b, w } = await setup();
    const other = (await createWorkspace(b, "Other", randomUUID())).id;
    const cmd = {
      type: "document.upload",
      filename: "note.md",
      bytesBase64: Buffer.from("Test source").toString("base64"),
    };
    const key = randomUUID();
    const one = await execute(a, w, key, cmd),
      two = await execute(a, w, key, cmd);
    expect(two).toEqual(one);
    expect((await snapshot(a, w)).sources).toHaveLength(1);
    await expect(
      execute(a, w, key, { ...cmd, filename: "different.md" }),
    ).rejects.toThrow("COMMAND_ID_REUSED");
    await expect(
      upload(b, other, "Copy", { previousSourceId: one.sourceId }),
    ).rejects.toThrow("DOCUMENT_VERSION_STALE");
    await expect(
      readDocument(b, other, one.sourceId as string),
    ).rejects.toThrow("SOURCE_NOT_FOUND");
    expect(await retrieveSources(other, ["Test source"])).toHaveLength(0);
    await expect(
      upload(a, w, "binary", { filename: "../x.txt" }),
    ).rejects.toThrow("DOCUMENT_FORMAT_UNSUPPORTED");
    await expect(
      upload(a, w, "binary", { filename: "evil.html" }),
    ).rejects.toThrow("DOCUMENT_FORMAT_UNSUPPORTED");
    await expect(
      upload(a, w, "binary", { bytesBase64: "/w==" }),
    ).rejects.toThrow("INVALID_DOCUMENT_ENCODING");
    await expect(
      upload(a, w, "binary", { bytesBase64: "@@@" }),
    ).rejects.toThrow();
    await expect(upload(a, w, "a".repeat(200001))).rejects.toThrow(
      "INVALID_DOCUMENT_TEXT",
    );
  });
});

describe("Research work, execution boundary and reintegration", () => {
  it("persists one invocation/result on duplicate delivery; interpreted evidence requires explicit editorial acceptance", async () => {
    const { a, w } = await setup();
    let calls = 0;
    let sent = "";
    const work = await request(a, w);
    await processResearch(work.workId as string, {
      ...provider,
      async search(q) {
        calls++;
        sent = q;
        return provider.search(q);
      },
    });
    await processResearch(work.workId as string, provider);
    expect(calls).toBe(1);
    expect(sent).toBe("Costo licenza cocktail bar");
    let state = await snapshot(a, w);
    expect(state.research[0].status).toBe("completed");
    expect(state.sources).toHaveLength(1);
    expect(state.information).toHaveLength(0);
    expect(state.commitments).toHaveLength(0);
    const source = state.sources[0];
    expect(source.kind).toBe("web");
    expect(source.url).toBe("https://example.test/licenza");
    const inference = state.interpretations.find(
      (i) => i.source_id === source.id,
    )!;
    await processInterpretation(inference.id, fixtureInterpreter);
    state = await snapshot(a, w);
    await execute(a, w, randomUUID(), {
      type: "information.accept",
      candidateId: state.candidates[0].id,
      descriptiveOnly: true,
    });
    state = await snapshot(a, w);
    expect(state.information[0].qualification).toBeTruthy();
    expect(state.versions[0].candidate_id).toBe(state.candidates[0].id);
    expect(state.candidates[0].source_ids).toContain(source.id);
    expect(state.researchEvents.map((e) => e.status)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
  });
  it("does not call a provider after access/eligibility changed or for an unapproved disclosure", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    await expect(
      execute(b, w, randomUUID(), {
        type: "research.request",
        query: "Query",
        discloseQuery: false,
      }),
    ).rejects.toThrow();
    const work = await request(b, w);
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    let calls = 0;
    await processResearch(work.workId as string, {
      ...provider,
      async search() {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
    expect((await snapshot(a, w)).research[0].status).toBe("stale");
    const second = await request(a, w);
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [a]);
    await processResearch(second.workId as string, {
      ...provider,
      async search() {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
  });
  it("keeps changed-context results historical; never publishes after cancellation", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    let release!: (r: Awaited<ReturnType<ResearchProvider["search"]>>) => void;
    let begun!: () => void;
    const started = new Promise<void>((r) => (begun = r));
    const work = await request(a, w);
    const running = processResearch(work.workId as string, {
      ...provider,
      async search() {
        begun();
        return new Promise((r) => (release = r));
      },
    });
    await started;
    await execute(a, w, randomUUID(), {
      type: "goal.establish",
      content: "Nuovo intento esplicito",
    });
    release(await provider.search("query"));
    await running;
    let state = await snapshot(a, w);
    expect(state.research[0].status).toBe("stale");
    expect(state.sources).toHaveLength(1);
    expect(state.interpretations).toHaveLength(0);
    const work2 = await request(b, w);
    let release2!: (r: Awaited<ReturnType<ResearchProvider["search"]>>) => void;
    let begun2!: () => void;
    const started2 = new Promise<void>((r) => (begun2 = r));
    const running2 = processResearch(work2.workId as string, {
      ...provider,
      async search() {
        begun2();
        return new Promise((r) => (release2 = r));
      },
    });
    await started2;
    await expect(
      execute(a, w, randomUUID(), {
        type: "research.cancel",
        workId: work2.workId,
      }),
    ).rejects.toThrow("WORK_REQUESTER_REQUIRED");
    await execute(b, w, randomUUID(), {
      type: "research.cancel",
      workId: work2.workId,
    });
    release2(await provider.search("q"));
    await running2;
    state = await snapshot(a, w);
    expect(state.sources).toHaveLength(1);
    expect(state.research.find((r) => r.id === work2.workId)?.status).toBe(
      "cancelled",
    );
  });
  it("does not revive a completed departure when the requester rejoins during a provider call", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const work = await request(b, w);
    let release!: (r: Awaited<ReturnType<ResearchProvider["search"]>>) => void;
    let begin!: () => void;
    const started = new Promise<void>((r) => (begin = r));
    const running = processResearch(work.workId as string, {
      ...provider,
      async search() {
        begin();
        return new Promise((r) => (release = r));
      },
    });
    await started;
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await join(a, b, w);
    release(await provider.search("q"));
    await running;
    const state = await snapshot(a, w);
    expect(state.research[0].status).toBe("stale");
    expect(state.sources).toHaveLength(0);
  });
  it("recovers expired work and fences late callbacks against a new attempt", async () => {
    const { a, w } = await setup();
    const work = await request(a, w);
    let release!: (r: Awaited<ReturnType<ResearchProvider["search"]>>) => void;
    let begun!: () => void;
    const started = new Promise<void>((r) => (begun = r));
    const running = processResearch(work.workId as string, {
      ...provider,
      async search() {
        begun();
        return new Promise((r) => (release = r));
      },
    });
    await started;
    await pool.query(
      "UPDATE research_work SET lease_until=now()-interval '1 second' WHERE id=$1",
      [work.workId],
    );
    await recoverResearch();
    await execute(a, w, randomUUID(), {
      type: "research.retry",
      workId: work.workId,
    });
    await processResearch(work.workId as string, provider);
    release(await provider.search("query"));
    await running;
    const state = await snapshot(a, w);
    expect(state.research[0].status).toBe("completed");
    expect(state.sources).toHaveLength(1);
    expect(
      state.researchEvents.some((e) => e.detail === "RESEARCH_INTERRUPTED"),
    ).toBe(true);
  });
  it("records missing configuration without fake results; malformed output fails without partial source publication", async () => {
    const { a, w } = await setup();
    const work = await request(a, w);
    const original = process.env.RESEARCH_PROVIDER;
    delete process.env.RESEARCH_PROVIDER;
    try {
      await processResearch(work.workId as string);
    } finally {
      if (original) process.env.RESEARCH_PROVIDER = original;
    }
    expect((await snapshot(a, w)).research[0].status).toBe(
      "needs_configuration",
    );
    await execute(a, w, randomUUID(), {
      type: "research.retry",
      workId: work.workId,
    });
    await processResearch(work.workId as string, {
      ...provider,
      async search() {
        return [
          { title: "Injection", url: "javascript:alert(1)", excerpt: "Unsafe" },
        ];
      },
    });
    const state = await snapshot(a, w);
    expect(state.research[0].status).toBe("failed");
    expect(state.sources).toHaveLength(0);
    expect(state.information).toHaveLength(0);
    await expect(
      configuredInterpreter().interpret({} as never),
    ).rejects.toThrow("AI_CONFIGURATION_REQUIRED");
  });
});

describe("Real Brave adapter with deterministic HTTP transport", () => {
  it("uses the fixed provider endpoint and exact query, sends no Workspace context, validates results", async () => {
    let seen: URL | undefined;
    let headers: Headers | undefined;
    const adapter = braveResearchProvider(
      "fake-test-key",
      async (input, init) => {
        seen = new URL(String(input));
        headers = new Headers(init?.headers);
        return Response.json({
          web: {
            results: [
              {
                title: "Source",
                url: "https://example.test",
                description: "Reported value",
              },
            ],
          },
        });
      },
    );
    expect(await adapter.search("licenza Milano")).toEqual([
      {
        title: "Source",
        url: "https://example.test",
        excerpt: "Reported value",
      },
    ]);
    expect(seen?.origin).toBe("https://api.search.brave.com");
    expect(seen?.searchParams.get("q")).toBe("licenza Milano");
    expect(headers?.get("X-Subscription-Token")).toBe("fake-test-key");
    expect(headers?.has("Cookie")).toBe(false);
  });
  it("rejects unsafe URLs, credentials embedded in URLs, rate limits and oversized results without retries", async () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///tmp/file",
      "https://user:password@example.test",
    ]) {
      await expect(
        braveResearchProvider("fake", async () =>
          Response.json({
            web: { results: [{ title: "Source", url, description: "text" }] },
          }),
        ).search("q"),
      ).rejects.toThrow();
    }
    let calls = 0;
    await expect(
      braveResearchProvider("fake", async () => {
        calls++;
        return new Response("", { status: 429 });
      }).search("q"),
    ).rejects.toThrow("RESEARCH_RATE_LIMITED");
    expect(calls).toBe(1);
    await expect(
      braveResearchProvider(
        "fake",
        async () => new Response("x".repeat(1048577)),
      ).search("q"),
    ).rejects.toThrow("RESEARCH_INVALID_RESULT");
  });
});

describe("Open questions and attributable working answers", () => {
  it("preserves the question/source/history without accepting its premises; versions working answers and fences stale updates", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const sent = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Quanto costa il locale?",
    });
    await processInterpretation(
      sent.interpretationId as string,
      fixtureInterpreter,
    );
    let state = await snapshot(a, w);
    const candidate = state.candidates[0];
    expect(candidate.classification).toBe("question");
    await expect(
      execute(b, w, randomUUID(), {
        type: "information.accept",
        candidateId: candidate.id,
        descriptiveOnly: true,
      }),
    ).rejects.toThrow();
    const cmd = {
      type: "question.open",
      sourceId: candidate.source_id,
      content: candidate.content,
      candidateId: candidate.id,
    };
    const key = randomUUID(),
      opened = await execute(b, w, key, cmd);
    expect(await execute(b, w, key, cmd)).toEqual(opened);
    state = await snapshot(a, w);
    expect(state.questions).toHaveLength(1);
    expect(state.information).toHaveLength(0);
    expect(state.commitments).toHaveLength(0);
    const asked = await execute(a, w, randomUUID(), {
      type: "research.request",
      query: "affitto locale",
      discloseQuery: true,
      questionId: opened.questionId,
      questionVersion: 1,
    });
    expect(
      (await snapshot(a, w)).research.find((r) => r.id === asked.workId)
        ?.question_id,
    ).toBe(opened.questionId);
    const doc = await upload(a, w);
    await processInterpretation(
      doc.interpretationId as string,
      fixtureInterpreter,
    );
    state = await snapshot(a, w);
    const descriptive = state.candidates.find(
      (c) => c.source_id === doc.sourceId,
    )!;
    await execute(b, w, randomUUID(), {
      type: "information.accept",
      candidateId: descriptive.id,
      descriptiveOnly: true,
    });
    state = await snapshot(a, w);
    const info = state.information[0];
    const answer = {
      type: "question.answer",
      questionId: opened.questionId,
      expectedVersion: 1,
      informationId: info.id,
      informationVersion: 1,
      reason: "Il contratto è il riferimento di lavoro corrente.",
    };
    await execute(a, w, randomUUID(), answer);
    await expect(execute(b, w, randomUUID(), answer)).rejects.toThrow(
      "QUESTION_VERSION_STALE",
    );
    await execute(b, w, randomUUID(), {
      type: "question.reopen",
      questionId: opened.questionId,
      expectedVersion: 2,
      reason: "Chiarire se include le spese.",
    });
    state = await snapshot(a, w);
    expect(state.questions[0].status).toBe("open");
    expect(state.questionHistory).toHaveLength(3);
    expect(state.questionHistory[1].answer_information_id).toBe(info.id);
    expect(state.information).toHaveLength(1);
    expect(state.commitments).toHaveLength(0);
    await expect(
      pool.query("DELETE FROM question_version WHERE workspace_id=$1", [w]),
    ).rejects.toThrow("immutable");
    const other = (await createWorkspace(b, "Other questions", randomUUID()))
      .id;
    await expect(
      execute(b, other, randomUUID(), {
        type: "question.open",
        sourceId: candidate.source_id,
        content: "Copy?",
      }),
    ).rejects.toThrow("SOURCE_NOT_FOUND");
    await expect(execute(b, other, randomUUID(), answer)).rejects.toThrow(
      "QUESTION_NOT_FOUND",
    );
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await expect(execute(b, w, randomUUID(), answer)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
  });
});
