import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collaborationMode } from "./participation.ts";
import { pool, transaction, type Tx } from "./db.ts";
import { lockWorkspace } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { parseStructuredOutput } from "./structured-llm.ts";
import {
  analysisInputs,
  inputFingerprint,
  materialInputChange,
  sharedWorkAvailable,
  topicTerms,
} from "./active-work-context.ts";
import {
  analysisResultSchema,
  configuredAnalysisSpecialist,
  type AnalysisSpecialist,
} from "./analysis-specialist.ts";
import {
  workAt,
  workEvent,
  fenceWork,
  openIssues,
  issue,
  persistInputs,
  priorInputs,
  queueWork,
} from "./active-work-state.ts";
import { createActiveWork } from "./active-work-commands.ts";
import type { WorkInput } from "../contracts/active-work.ts";

const rounds = z.coerce
  .number()
  .int()
  .min(1)
  .max(12)
  .catch(4)
  .parse(process.env.ACTIVE_WORK_CONTEXT_ROUNDS);
const leaseSeconds = Math.max(300, rounds * 60);
async function inputsFor(tx: Tx, w: string, id: string, extra: string[] = []) {
  const a = await workAt(tx, w, id);
  const remembered = (
    await tx.query(
      "SELECT r.terms FROM active_work_retrieval r JOIN active_work_attempt a USING(workspace_id,work_id,generation) WHERE r.workspace_id=$1 AND r.work_id=$2 AND a.contract_version=$3",
      [w, id, a.contract_version],
    )
  ).rows.flatMap((r) => r.terms as string[]);
  const selected = (
    await tx.query(
      "SELECT DISTINCT i.reference_id,i.provenance->>'documentId' AS document_id FROM active_work_input i JOIN active_work_attempt a USING(workspace_id,work_id,generation) WHERE i.workspace_id=$1 AND i.work_id=$2 AND a.contract_version=$3",
      [w, id, a.contract_version],
    )
  ).rows.flatMap(
    (r) => [r.reference_id, r.document_id].filter(Boolean) as string[],
  );
  const contractSources = (
    await tx.query(
      "SELECT source_id FROM active_work_contract WHERE workspace_id=$1 AND work_id=$2 AND version IN (1,$3) ORDER BY version DESC",
      [w, id, a.contract_version],
    )
  ).rows;
  const initialSource = contractSources.at(-1)?.source_id;
  const inputs = await analysisInputs(
    tx,
    w,
    a.objective,
    a.focus,
    [...new Set([...extra, ...remembered, ...selected])],
    initialSource,
  );
  const explicit = (
    await tx.query(
      `SELECT s.* FROM workspace_source s WHERE s.workspace_id=$1 AND (s.id=$3 OR s.id IN (SELECT source_id FROM active_work_event WHERE workspace_id=$1 AND work_id=$2 AND kind='input'))`,
      [w, id, contractSources[0].source_id],
    )
  ).rows;
  const merged = new Map(inputs.map((i) => [i.key, i]));
  for (const s of explicit) {
    const key = `source:${s.id}:1`;
    if (!merged.has(key))
      merged.set(key, {
        key,
        kind: "source",
        id: s.id,
        version: 1,
        content: s.content,
        qualification: s.qualification,
        provenance: {
          sourceKind: s.kind,
          contributor: s.author_id,
          current: true,
        },
      });
  }
  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export async function reassessActiveWork(tx: Tx, w: string) {
  const rows = (
    await tx.query(
      "SELECT id,phase,validity FROM active_work WHERE workspace_id=$1",
      [w],
    )
  ).rows;
  for (const row of rows) {
    if (!["working", "completed"].includes(row.phase)) continue;
    const attempt = (
      await tx.query(
        "SELECT generation FROM active_work_attempt WHERE workspace_id=$1 AND work_id=$2 ORDER BY generation DESC LIMIT 1",
        [w, row.id],
      )
    ).rows[0];
    if (!attempt) continue;
    if (!(await sharedWorkAvailable(tx, w))) {
      if (row.phase !== "completed") {
        await fenceWork(tx, w, row.id, "needs_input");
        await tx.query(
          "UPDATE active_work SET error_code='WORK_CAPABILITY_UNAVAILABLE' WHERE workspace_id=$1 AND id=$2",
          [w, row.id],
        );
        await workEvent(
          tx,
          w,
          row.id,
          "needs_input",
          "L'analisi condivisa non è attualmente esercitabile. Ripresa soltanto dopo verifica delle condizioni correnti.",
        );
      }
      continue;
    }
    const before = await priorInputs(tx, w, row.id, attempt.generation),
      after = await inputsFor(tx, w, row.id);
    if (!before.length) continue;
    if (row.phase === "completed") {
      if (
        row.validity === "current" &&
        inputFingerprint(before) !== inputFingerprint(after)
      ) {
        await tx.query(
          "UPDATE active_work SET validity='potentially_outdated' WHERE workspace_id=$1 AND id=$2",
          [w, row.id],
        );
        await workEvent(
          tx,
          w,
          row.id,
          "outdated",
          "Materiale pertinente cambiato: il risultato resta completato storicamente, ma è potenzialmente superato.",
        );
      }
    } else if (
      materialInputChange(before, after) &&
      !(await openIssues(tx, w, row.id)).some((i) => i.kind === "context")
    ) {
      await issue(
        tx,
        w,
        row.id,
        "context",
        "Una versione pertinente è cambiata. Chiarisci l'uso dei nuovi dati mantenendo le assunzioni e gli obblighi esistenti.",
      );
    }
  }
}
export async function considerAutonomousWork(
  tx: Tx,
  w: string,
  available: boolean,
) {
  if ((await collaborationMode(tx, w)) === "discreet") return;
  if (!available || !(await sharedWorkAvailable(tx, w))) return;
  const qs = (
    await tx.query(
      `SELECT q.id,v.* FROM open_question q JOIN question_version v ON v.workspace_id=q.workspace_id AND v.question_id=q.id AND v.version=q.current_version WHERE q.workspace_id=$1 AND v.status='open' AND NOT EXISTS(SELECT 1 FROM active_work_initiative i WHERE i.workspace_id=q.workspace_id AND i.question_id=q.id AND i.question_version=q.current_version) ORDER BY v.created_at,q.id`,
      [w],
    )
  ).rows;
  for (const q of qs) {
    if (
      !/(confront|valut|analizz|compar|analys)/i.test(q.content) ||
      topicTerms(q.content).length === 0
    )
      continue;
    const material = await analysisInputs(tx, w, q.content, []);
    if (
      material.filter((i) => i.kind === "source" && i.id !== q.source_id)
        .length < 2
    )
      continue;
    const count = (
      await tx.query(
        "SELECT count(*)::int n FROM active_work WHERE workspace_id=$1 AND phase IN ('queued','working')",
        [w],
      )
    ).rows[0].n;
    if (count >= 4) return;
    const created = await createActiveWork(tx, w, q.content, q.source_id, null);
    await tx.query(
      "INSERT INTO active_work_initiative(workspace_id,question_id,question_version,work_id,outcome) VALUES($1,$2,$3,$4,$5)",
      [
        w,
        q.id,
        q.version,
        created.workId,
        created.continued ? "existing_continuity" : "started",
      ],
    );
  }
}
export async function processActiveWork(
  w: string,
  id: string,
  supplied?: AnalysisSpecialist,
) {
  const specialist = supplied ?? configuredAnalysisSpecialist(w);
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await reassessActiveWork(tx, w);
    const a = await workAt(tx, w, id);
    if (a.phase !== "queued" || (await openIssues(tx, w, id)).length)
      return null;
    if (!(await sharedWorkAvailable(tx, w)) || !specialist) {
      await fenceWork(tx, w, id, "needs_input");
      const error = !specialist
        ? "AI_CONFIGURATION_REQUIRED"
        : "WORK_CAPABILITY_UNAVAILABLE";
      await tx.query(
        "UPDATE active_work SET error_code=$3 WHERE workspace_id=$1 AND id=$2",
        [w, id, error],
      );
      await workEvent(
        tx,
        w,
        id,
        "needs_input",
        !specialist
          ? "Specialist di analisi non configurato; nessun risultato simulato."
          : "Analisi condivisa non disponibile nelle condizioni di accesso correnti.",
      );
      return null;
    }
    const row = (
      await tx.query(
        "UPDATE active_work SET generation=generation+1,phase='working',lease_until=now()+$3*interval '1 second',error_code=NULL WHERE workspace_id=$1 AND id=$2 RETURNING generation",
        [w, id, leaseSeconds],
      )
    ).rows[0];
    const revision = await workEvent(
      tx,
      w,
      id,
      "working",
      "Miriam sta analizzando il materiale condiviso pertinente.",
    );
    const inputs = await inputsFor(tx, w, id);
    await tx.query(
      "INSERT INTO active_work_attempt(workspace_id,work_id,generation,contract_version,control_revision,provider) VALUES($1,$2,$3,$4,$5,$6)",
      [w, id, row.generation, a.contract_version, revision, specialist.name],
    );
    await persistInputs(tx, w, id, row.generation, inputs);
    return {
      generation: row.generation as number,
      version: a.contract_version as number,
      revision,
      inputs,
      contract: {
        objective: a.objective,
        scope: a.scope,
        expectedOutput: a.expected_output,
        anchors: a.anchors,
        focus: a.focus,
      },
    };
  });
  if (!claim || !specialist) return;
  const extra: string[] = [];
  async function guarded<T>(fn: (tx: Tx, inputs: WorkInput[]) => Promise<T>) {
    return transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const a = await workAt(tx, w, id);
      if (
        a.phase !== "working" ||
        a.generation !== claim!.generation ||
        a.contract_version !== claim!.version ||
        a.revision !== claim!.revision ||
        !a.lease_until ||
        a.lease_until <= new Date() ||
        (await openIssues(tx, w, id)).length
      )
        return null;
      if (!(await sharedWorkAvailable(tx, w))) {
        await fenceWork(tx, w, id, "needs_input");
        await workEvent(
          tx,
          w,
          id,
          "needs_input",
          "Accesso non più disponibile: risultato non pubblicato.",
        );
        return null;
      }
      const inputs = await inputsFor(tx, w, id, extra);
      if (materialInputChange(claim!.inputs, inputs)) {
        await issue(
          tx,
          w,
          id,
          "context",
          "Input pertinenti modificati durante l'analisi; risultato non pubblicato come corrente.",
        );
        return null;
      }
      return fn(tx, inputs);
    });
  }
  try {
    for (let round = 0; round < rounds; round++) {
      // Revalidate before each inference/retrieval, not just before the final publication.
      const ready = await guarded(async (tx, inputs) => {
        claim.inputs = inputs;
        await persistInputs(tx, w, id, claim.generation, inputs);
        return true;
      });
      if (!ready) return;
      const result = parseStructuredOutput(
        analysisResultSchema,
        await specialist.analyze({
          contract: claim.contract,
          inputs: claim.inputs,
          capability: {
            read: "shared_workspace_projection",
            output: "unadopted_analysis",
            actions: "none",
          },
        }),
      );
      if (result.needsMore.length) {
        requireThat(
          !result.body && !result.citations.length,
          "INSUFFICIENT_CONTEXT_OUTPUT",
        );
        const allowed = await guarded(async (tx) => {
          await tx.query(
            "INSERT INTO active_work_retrieval(id,workspace_id,work_id,generation,terms) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), w, id, claim.generation, result.needsMore],
          );
          return true;
        });
        if (!allowed) return;
        extra.push(...result.needsMore);
        continue;
      }
      if (result.needsInput) {
        await guarded(async (tx) => {
          await issue(tx, w, id, "input", result.needsInput);
          return true;
        });
        return;
      }
      requireThat(
        result.body.trim().length > 0 && result.citations.length > 0,
        "ANALYSIS_OUTPUT_REQUIRED",
      );
      const allowed = new Set(claim.inputs.map((i) => i.key));
      requireThat(
        result.citations.every((c) => allowed.has(c)),
        "INVALID_ANALYSIS_CITATION",
      );
      await guarded(async (tx, current) => {
        if (inputFingerprint(current) !== inputFingerprint(claim.inputs)) {
          await fenceWork(tx, w, id, "queued");
          await workEvent(
            tx,
            w,
            id,
            "continuing",
            "Nuovo materiale pertinente incorporato; rivalutazione nello stesso lavoro.",
          );
          await queueWork(tx, w, id);
          return;
        }
        await tx.query(
          "INSERT INTO active_work_contribution(id,workspace_id,work_id,generation,contract_version,body,citation_keys,qualification) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            w,
            id,
            claim.generation,
            claim.version,
            result.body,
            result.citations,
            "Contribution dello Specialist di analisi, non adottata. Fonti e qualificazioni restano consultabili; nessun effetto normativo o esterno.",
          ],
        );
        await tx.query(
          "UPDATE active_work SET phase='completed',validity='current',lease_until=NULL WHERE workspace_id=$1 AND id=$2",
          [w, id],
        );
        await workEvent(
          tx,
          w,
          id,
          "completed",
          "Brief pronto. Output prodotto, non adottato; nessuna Task, decisione o azione è stata completata per conseguenza.",
        );
      });
      return;
    }
    await guarded(async (tx) => {
      await issue(
        tx,
        w,
        id,
        "input",
        "Contesto ancora insufficiente. Fornisci input pertinente o restringi la richiesta; nessun risultato incompleto è dichiarato completato.",
      );
      return true;
    });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "ANALYSIS_FAILED";
    await guarded(async (tx) => {
      await fenceWork(tx, w, id, "needs_input");
      await tx.query(
        "UPDATE active_work SET error_code=$3 WHERE workspace_id=$1 AND id=$2",
        [w, id, code],
      );
      await workEvent(
        tx,
        w,
        id,
        "needs_input",
        code === "AI_OUTPUT_PARSE_ERROR"
          ? "Output Specialist non valido; nessuna Contribution pubblicata."
          : "Analisi non completata; nessun risultato adottato. È possibile riprovare esplicitamente.",
      );
      return true;
    });
  }
}
export async function recoverActiveWork(supplied?: AnalysisSpecialist) {
  const specialist = supplied ?? configuredAnalysisSpecialist();
  const spaces = (
    await pool.query(
      "SELECT DISTINCT workspace_id FROM active_work UNION SELECT DISTINCT workspace_id FROM open_question",
    )
  ).rows;
  for (const { workspace_id: w } of spaces)
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      await reassessActiveWork(tx, w);
      const expired = (
        await tx.query(
          "SELECT id FROM active_work WHERE workspace_id=$1 AND phase='working' AND lease_until<now()",
          [w],
        )
      ).rows;
      for (const { id } of expired) {
        await fenceWork(tx, w, id, "queued");
        await workEvent(
          tx,
          w,
          id,
          "recovering",
          "Analisi interrotta: ripresa protetta del lavoro, senza ripetere effetti esterni.",
        );
      }
      for (const { id } of (
        await tx.query(
          "SELECT id FROM active_work WHERE workspace_id=$1 AND phase='queued'",
          [w],
        )
      ).rows)
        if (!(await openIssues(tx, w, id)).length) await queueWork(tx, w, id);
      await considerAutonomousWork(tx, w, Boolean(specialist));
    });
}
