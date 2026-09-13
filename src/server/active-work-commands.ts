import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./db.ts";
import { activeWorkCommandSchema } from "../contracts/active-work.ts";
import { member, authenticatedSession, changed } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { topicKey, sharedWorkAvailable } from "./active-work-context.ts";
import {
  workAt,
  workEvent,
  queueWork,
  fenceWork,
  issue,
  issueAct,
  openIssues,
} from "./active-work-state.ts";

export function startObjective(text: string) {
  return /^(?:miriam[, ]+)?(?:analizza|prepara un brief|analyze)\s*[: ]\s*(.{3,})$/isu
    .exec(text.trim())?.[1]
    ?.trim();
}
export async function recordWorkMessage(
  tx: Tx,
  w: string,
  actor: string,
  text: string,
) {
  const id = randomUUID();
  const seq = (
    await tx.query(
      "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
      [w],
    )
  ).rows[0].next_message;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
    [id, w, seq, actor, text],
  );
  await changed(tx, w, "message.send");
  return id;
}
export async function createActiveWork(
  tx: Tx,
  w: string,
  objective: string,
  source: string | null,
  actor: string | null,
) {
  objective = z.string().trim().min(3).max(4000).parse(objective);
  requireThat(
    await sharedWorkAvailable(tx, w),
    "WORK_CAPABILITY_UNAVAILABLE",
    403,
  );
  const key = topicKey(objective);
  const existing = (
    await tx.query(
      "SELECT id,phase FROM active_work WHERE workspace_id=$1 AND topic_key=$2 ORDER BY created_at LIMIT 1",
      [w, key],
    )
  ).rows[0];
  // A repeated trigger never circumvents a previous pause, conflict, stop or completion.
  if (existing)
    return {
      workId: existing.id,
      continued: true,
      message:
        "Questo tema ha già un lavoro: consulta lo stato e usa i controlli espliciti per proseguire.",
    };
  const count = (
    await tx.query(
      "SELECT count(*)::int AS n FROM active_work WHERE workspace_id=$1 AND phase IN ('queued','working')",
      [w],
    )
  ).rows[0].n;
  requireThat(count < 4, "ACTIVE_WORK_BUSY");
  const id = randomUUID();
  await tx.query(
    "INSERT INTO active_work(id,workspace_id,contract_version,phase,topic_key) VALUES($1,$2,1,'queued',$3)",
    [id, w, key],
  );
  await tx.query(
    `INSERT INTO active_work_contract(workspace_id,work_id,version,objective,scope,expected_output,direction_actors,actor_id,origin,source_id,reason) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      w,
      id,
      objective,
      "Solo analisi del materiale già condiviso pertinente al tema; nessun accesso privato, adozione o effetto esterno.",
      "Brief con fonti, alternative, limiti e domande aperte; Contribution non adottata.",
      actor ? [actor] : [],
      actor,
      actor ? "human" : "miriam",
      source,
      actor
        ? "Incarico conversazionale esplicito"
        : "Iniziativa Miriam su domanda aperta e materiale pertinente disponibile",
    ],
  );
  await workEvent(
    tx,
    w,
    id,
    "started",
    `Miriam prepara un'analisi: ${objective}`,
    actor,
    source,
  );
  await queueWork(tx, w, id);
  return {
    workId: id,
    continued: false,
    message:
      "Analisi avviata sul materiale condiviso; nessuna adozione o azione esterna.",
  };
}
async function reviseContract(
  tx: Tx,
  w: string,
  id: string,
  actor: string,
  source: string,
  reason: string,
  objective?: string,
  focus?: string[],
  directors?: string[],
  anchors?: string[],
) {
  const a = await workAt(tx, w, id),
    v = a.contract_version + 1;
  await tx.query(
    `INSERT INTO active_work_contract(workspace_id,work_id,version,objective,scope,expected_output,anchors,focus,direction_actors,actor_id,origin,source_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human',$11,$12)`,
    [
      w,
      id,
      v,
      objective ?? a.objective,
      a.scope,
      a.expected_output,
      anchors ?? a.anchors,
      focus ?? a.focus,
      directors ?? a.direction_actors,
      actor,
      source,
      reason,
    ],
  );
  await tx.query(
    "UPDATE active_work SET contract_version=$3,topic_key=$4,validity='potentially_outdated' WHERE workspace_id=$1 AND id=$2",
    [w, id, v, topicKey(objective ?? a.objective)],
  );
  await fenceWork(tx, w, id, "needs_input");
  await workEvent(tx, w, id, "contract_changed", reason, actor, source);
}
async function resume(
  tx: Tx,
  w: string,
  id: string,
  actor: string,
  source: string,
) {
  requireThat(
    await sharedWorkAvailable(tx, w),
    "WORK_CAPABILITY_UNAVAILABLE",
    403,
  );
  if ((await openIssues(tx, w, id)).length) {
    await fenceWork(tx, w, id, "needs_input");
    await workEvent(
      tx,
      w,
      id,
      "needs_input",
      "La ripresa richiede prima il chiarimento degli input o delle obiezioni ancora aperti.",
      actor,
      source,
    );
    return;
  }
  await fenceWork(tx, w, id, "queued");
  await tx.query(
    "UPDATE active_work SET error_code=NULL WHERE workspace_id=$1 AND id=$2",
    [w, id],
  );
  await workEvent(
    tx,
    w,
    id,
    "resumed",
    "Ripresa esplicita nel contratto corrente.",
    actor,
    source,
  );
  await queueWork(tx, w, id);
}
export async function applyActiveWork(
  tx: Tx,
  w: string,
  actor: string,
  c: z.infer<typeof activeWorkCommandSchema>,
  session?: string,
) {
  await member(tx, w, actor, true, true);
  await authenticatedSession(tx, actor, session);
  const original = c.text.trim();
  requireThat(!c.instruction || c.workId, "WORK_TARGET_REQUIRED");
  const prefix = {
    input: "input",
    assumption: "ipotesi",
    objection: "obiezione",
    redirect: "reindirizza",
    format: "formato",
  };
  const labels = {
    input: "Considera queste informazioni nell’analisi",
    assumption: "Usa questa ipotesi per l’analisi",
    objection: "Non procedere senza chiarire questo limite",
    redirect: "Propongo questa direzione per l’analisi",
    format: "Presenta il risultato in questo formato",
  };
  const text = c.instruction
      ? `${prefix[c.instruction]}: ${original}`
      : original,
    objective = startObjective(text);
  requireThat(!c.workId || c.expectedRevision, "WORK_REVISION_REQUIRED");
  if (c.workId) {
    const a = await workAt(tx, w, c.workId);
    requireThat(a.revision === c.expectedRevision, "WORK_STATE_STALE");
  }
  const source = await recordWorkMessage(
    tx,
    w,
    actor,
    c.instruction ? `${labels[c.instruction]}: ${original}` : original,
  );
  if (objective && !c.workId)
    return createActiveWork(tx, w, objective, source, actor);
  if (!c.workId)
    return {
      messageId: source,
      message:
        "Indica il lavoro da controllare; per iniziare scrivi «Analizza: tema».",
    };
  const id = c.workId,
    a = await workAt(tx, w, id),
    lower = text.toLocaleLowerCase();
  if (/^(stato|cosa stai facendo|status)\??$/.test(lower))
    return {
      workId: id,
      message: `${a.phase}: ${a.objective}`,
      messageId: source,
    };
  if (/^(pausa|ferma|stop|pause)$/.test(lower)) {
    const phase = /paus/.test(lower) ? "paused" : "stopped";
    await fenceWork(tx, w, id, phase);
    await workEvent(
      tx,
      w,
      id,
      phase,
      phase === "paused"
        ? "Lavoro in pausa su istruzione esplicita."
        : "Lavoro fermato; storia e obblighi preservati.",
      actor,
      source,
    );
  } else if (/^(riprendi|resume)$/.test(lower))
    await resume(tx, w, id, actor, source);
  else if (/^(obiezione|limita)\s*:/i.test(text)) {
    await issue(
      tx,
      w,
      id,
      "objection",
      text.slice(text.indexOf(":") + 1).trim() ||
        "Chiarire la restrizione prima di proseguire.",
      actor,
      source,
    );
  } else if (/^formato\s*:\s*(elenco|sintesi|dettagli)$/i.test(text)) {
    // Presentation-only steering retains every objective, anchor and unresolved issue.
    const format = text.split(":")[1].trim().toLocaleLowerCase();
    await reviseContract(
      tx,
      w,
      id,
      actor,
      source,
      `Formato richiesto: ${format}`,
      undefined,
      [
        ...a.focus.filter((s: string) => !s.startsWith("Formato: ")),
        `Formato: ${format}`,
      ],
    );
    // Respect a prior pause/stop; material issues still block resume.
    if (["paused", "stopped"].includes(a.phase))
      await fenceWork(tx, w, id, a.phase);
    else await resume(tx, w, id, actor, source);
  } else if (/^ipotesi\s*:/i.test(text)) {
    const anchor = text.slice(text.indexOf(":") + 1).trim();
    requireThat(anchor, "WORK_ASSUMPTION_REQUIRED");
    await reviseContract(
      tx,
      w,
      id,
      actor,
      source,
      "Ipotesi analitica fissata, non informazione accettata.",
      undefined,
      undefined,
      undefined,
      [...a.anchors, anchor],
    );
    if (["paused", "stopped"].includes(a.phase))
      await fenceWork(tx, w, id, a.phase);
    else await resume(tx, w, id, actor, source);
  } else if (/^(reindirizza|obiettivo)\s*:/i.test(text)) {
    const next = text.slice(text.indexOf(":") + 1).trim();
    requireThat(next.length >= 3, "WORK_OBJECTIVE_REQUIRED");
    if (next === a.objective)
      return {
        workId: id,
        message: "L'obiettivo è già quello indicato.",
        messageId: source,
      };
    const required = [...new Set<string>([...a.direction_actors, actor])];
    const pending = await issue(
      tx,
      w,
      id,
      "revision",
      `Direzione proposta: ${next}. Il contratto precedente resta efficace finché le istruzioni coinvolte non sono chiarite.`,
      actor,
      source,
      next,
      required,
    );
    await issueAct(tx, w, id, pending, actor, "acknowledge", source);
    if (
      required.every((p) => p === actor) &&
      (await openIssues(tx, w, id)).length === 1
    ) {
      await reviseContract(
        tx,
        w,
        id,
        actor,
        source,
        "Direzione esplicitamente aggiornata senza altre istruzioni umane in conflitto.",
        next,
        undefined,
        required,
      );
      await issueAct(tx, w, id, pending, null, "resolved", source);
      if (["paused", "stopped"].includes(a.phase))
        await fenceWork(tx, w, id, a.phase);
      else await resume(tx, w, id, actor, source);
    }
  } else if (/^(confermo|ritiro)\s*:/i.test(text)) {
    const issueId = z.uuid().parse(text.slice(text.indexOf(":") + 1).trim());
    const pending = (await openIssues(tx, w, id)).find((i) => i.id === issueId);
    requireThat(pending, "WORK_ISSUE_NOT_OPEN");
    if (lower.startsWith("ritiro")) {
      requireThat(pending.actor_id === actor, "OWN_INSTRUCTION_REQUIRED", 403);
      await issueAct(tx, w, id, issueId, actor, "withdraw", source);
      await workEvent(
        tx,
        w,
        id,
        "input",
        "La persona ha ritirato la propria istruzione; nessuna obiezione altrui è cancellata.",
        actor,
        source,
      );
    } else {
      // Each person clarifies only their own conflicting instruction, not the group's consent.
      requireThat(
        pending.kind === "revision" && pending.required_people.includes(actor),
        "OWN_INSTRUCTION_REQUIRED",
        403,
      );
      requireThat(
        pending.contract_version === a.contract_version,
        "WORK_PROPOSAL_STALE",
      );
      await issueAct(tx, w, id, issueId, actor, "acknowledge", source);
      const current = (await openIssues(tx, w, id)).find(
        (i) => i.id === issueId,
      )!;
      if (
        (await openIssues(tx, w, id)).length === 1 &&
        current.required_people.every((p: string) =>
          current.acknowledged_by.includes(p),
        )
      ) {
        await reviseContract(
          tx,
          w,
          id,
          actor,
          source,
          "Direzione chiarita esplicitamente dalle persone le cui istruzioni erano coinvolte.",
          current.proposed_objective,
          undefined,
          current.required_people,
        );
        await issueAct(tx, w, id, issueId, null, "resolved", source);
      }
      await workEvent(
        tx,
        w,
        id,
        "input",
        "Chiarimento attribuito registrato; eventuali altre obiezioni restano aperte.",
        actor,
        source,
      );
    }
    // Never resume automatically after resolving one issue.
  } else if (/^input\s*:/i.test(text)) {
    await workEvent(
      tx,
      w,
      id,
      "input",
      text.slice(text.indexOf(":") + 1).trim(),
      actor,
      source,
    );
    for (const i of await openIssues(tx, w, id))
      if (i.kind === "input")
        await issueAct(tx, w, id, i.id, actor, "resolved", source);
    // Input is an attributed statement. It cannot settle objections or change anchored assumptions.
    await fenceWork(
      tx,
      w,
      id,
      ["paused", "stopped"].includes(a.phase) ? a.phase : "needs_input",
    );
  } else if (lower === "usa contesto aggiornato") {
    for (const i of await openIssues(tx, w, id))
      if (i.kind === "context")
        await issueAct(tx, w, id, i.id, actor, "resolved", source);
    await workEvent(
      tx,
      w,
      id,
      "input",
      "Aggiornamenti ammessi come contesto di analisi; vincoli e assunzioni fissate restano invariati, nessuna accettazione editoriale.",
      actor,
      source,
    );
  } else {
    throw new DomainError("WORK_INSTRUCTION_UNCLEAR");
  }
  return {
    workId: id,
    messageId: source,
    revision: (await workAt(tx, w, id)).revision,
  };
}
