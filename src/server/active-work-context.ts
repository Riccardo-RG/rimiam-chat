import { createHash } from "node:crypto";
import type { Tx } from "./db.ts";
import type { WorkInput } from "../contracts/active-work.ts";
import { workContext } from "./tasks-context.ts";
import { calendarContext } from "./calendar-state.ts";

export function topicTerms(text: string) {
  const skip = new Set(
    "miriam analizza analisi confronta confronto prepara brief approfondisci domanda quali quale come cosa sono delle della degli dello questa questo questi quanto vorrei possiamo materiale condiviso analyze compare analysis please about with from that".split(
      " ",
    ),
  );
  return [
    ...new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []),
  ].filter((t) => !skip.has(t));
}
export function topicKey(text: string) {
  return topicTerms(text).sort().join(" ") || text.toLocaleLowerCase().trim();
}
export async function sharedWorkAvailable(tx: Tx, w: string) {
  // Product-owned shared analysis capability, not a grant borrowed from one member.
  return !!(
    await tx.query(
      `SELECT 1 FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active AND m.contributes AND u.eligible AND u."emailVerified" LIMIT 1`,
      [w],
    )
  ).rowCount;
}
export async function analysisInputs(
  tx: Tx,
  w: string,
  objective: string,
  focus: string[],
  extra: string[] = [],
): Promise<WorkInput[]> {
  const terms = [
    ...new Set([...topicTerms([objective, ...focus].join(" ")), ...extra]),
  ];
  const out: WorkInput[] = [];
  function add(
    kind: string,
    id: string,
    version: number,
    content: string,
    qualification: string,
    provenance: Record<string, unknown>,
  ) {
    out.push({
      key: `${kind}:${id}:${version}`,
      kind,
      id,
      version,
      content,
      qualification,
      provenance,
    });
  }
  const goals = (
    await tx.query(
      `SELECT g.id,v.* FROM goal g JOIN goal_version v ON v.workspace_id=g.workspace_id AND v.goal_id=g.id AND v.version=g.current_version WHERE g.workspace_id=$1 AND g.current_primary`,
      [w],
    )
  ).rows;
  for (const g of goals)
    add(
      "goal",
      g.id,
      g.version,
      g.content,
      "Intento registrato; non implica adesione o authority.",
      { actor: g.established_by, current: true },
    );
  const info = (
    await tx.query(
      `SELECT i.id,i.subject,v.* FROM accepted_information i JOIN information_version v ON v.workspace_id=i.workspace_id AND v.information_id=i.id AND v.version=i.current_version WHERE i.workspace_id=$1 AND EXISTS(SELECT 1 FROM unnest($2::text[]) t WHERE i.id::text=t OR i.subject ILIKE '%'||t||'%' OR v.content ILIKE '%'||t||'%')`,
      [w, terms],
    )
  ).rows;
  const candidates: string[] = [];
  for (const i of info) {
    candidates.push(i.candidate_id);
    add(
      "information",
      i.id,
      i.version,
      `${i.subject}: ${i.content}`,
      "Informazione accettata editorialmente, non verità garantita né consenso collettivo.",
      { actor: i.accepted_by, candidateId: i.candidate_id, current: true },
    );
  }
  const acts = (
    await tx.query(
      `SELECT a.id,p.content,p.kind,p.candidate_id,p.source_id,ARRAY(SELECT person_id FROM required_project_approval r WHERE r.workspace_id=p.workspace_id AND r.proposal_id=p.id) AS people FROM current_project_act a JOIN normative_proposal p ON p.workspace_id=a.workspace_id AND p.id=a.proposal_id WHERE a.workspace_id=$1`,
      [w],
    )
  ).rows;
  // Effective constraints/commitments are not removed by relevance heuristics.
  for (const a of acts) {
    if (a.candidate_id) candidates.push(a.candidate_id);
    add(
      "commitment",
      a.id,
      1,
      a.content,
      "Atto efficace entro il proprio perimetro; analisi e completamento non lo modificano.",
      {
        people: a.people,
        kind: a.kind,
        candidateId: a.candidate_id,
        sourceId: a.source_id,
        current: true,
      },
    );
  }
  const questions = (
    await tx.query(
      `SELECT q.id,v.* FROM open_question q JOIN question_version v ON v.workspace_id=q.workspace_id AND v.question_id=q.id AND v.version=q.current_version WHERE q.workspace_id=$1 AND EXISTS(SELECT 1 FROM unnest($2::text[]) t WHERE q.id::text=t OR v.content ILIKE '%'||t||'%')`,
      [w, terms],
    )
  ).rows;
  for (const q of questions)
    add(
      "question",
      q.id,
      q.version,
      q.content,
      `Domanda ${q.status}; non accetta le premesse.`,
      { actor: q.recorded_by, sourceId: q.source_id, current: true },
    );
  const alternatives = (
    await tx.query(
      `SELECT c.* FROM candidate c WHERE c.workspace_id=$1 AND c.subject=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM information_version v WHERE v.workspace_id=c.workspace_id AND v.candidate_id=c.id)`,
      [w, info.map((i) => i.subject)],
    )
  ).rows;
  for (const c of alternatives) {
    candidates.push(c.id);
    add("candidate", c.id, 1, c.content, `Non accettato; ${c.qualification}`, {
      sourceId: c.source_id,
      origin: c.origin,
      classification: c.classification,
      current: false,
    });
  }
  // Explicit source/recording identities narrow initial source retrieval; the
  // Specialist may still request pertinent expansion through needsMore.
  const explicitIds =
    objective.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ) ?? [];
  const sourceTerms = explicitIds.length
    ? [...explicitIds, ...extra, ...focus.flatMap(topicTerms)]
    : terms;
  const sources = (
    await tx.query(
      `SELECT s.*, NOT EXISTS(SELECT 1 FROM external_source n WHERE n.workspace_id=s.workspace_id AND n.document_id=s.document_id AND n.document_version>s.document_version) AS current FROM workspace_source s WHERE s.workspace_id=$1 AND (EXISTS(SELECT 1 FROM unnest($2::text[]) t WHERE s.id::text=t OR s.document_id::text=t OR s.content ILIKE '%'||t||'%' OR s.title ILIKE '%'||t||'%') OR s.id IN (SELECT source_id FROM candidate_source WHERE workspace_id=$1 AND candidate_id=ANY($3::uuid[])) OR s.id=ANY($4::uuid[])) ORDER BY s.created_at,s.id`,
      [
        w,
        sourceTerms,
        candidates,
        [
          ...questions.map((q) => q.source_id),
          ...acts.map((a) => a.source_id).filter(Boolean),
        ],
      ],
    )
  ).rows;
  for (const s of sources)
    add("source", s.id, 1, s.content, s.qualification, {
      sourceKind: s.kind,
      author: s.author_name,
      contributor: s.author_id,
      url: s.url,
      documentId: s.document_id,
      documentVersion: s.document_version,
      current: s.current,
      createdAt: s.created_at,
    });
  for (const t of await workContext(tx, w, terms))
    add(
      "task",
      t.id,
      t.version,
      `${t.title}\n${t.description}\nStato: ${t.status}; scadenza: ${t.dueAt ?? "nessuna"}`,
      t.qualification,
      {
        actor: t.actor,
        responsible: t.responsible,
        acceptedVersion: t.acceptedVersion,
        references: t.references,
        current: t.current,
      },
    );
  for (const t of await calendarContext(tx, w, terms))
    add(
      `temporal_${t.kind}`,
      t.id,
      t.version,
      `${t.title} · ${t.starts_at} → ${t.ends_at}`,
      "Stato temporale interno; nessuna osservazione privata del provider.",
      { actor: t.actor_id, current: t.current, sourceId: t.source_message_id },
    );
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
export function inputFingerprint(inputs: WorkInput[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        inputs.map((i) => [
          i.key,
          i.content,
          i.qualification,
          i.provenance.current,
        ]),
      ),
    )
    .digest("hex");
}
export function materialInputChange(before: WorkInput[], after: WorkInput[]) {
  const current = new Map(
    after
      .filter((i) => i.provenance.current !== false)
      .map((i) => [`${i.kind}:${i.id}`, i.key]),
  );
  return (
    before.some(
      (i) =>
        i.provenance.current !== false &&
        i.kind !== "source" &&
        i.kind !== "candidate" &&
        current.get(`${i.kind}:${i.id}`) !== i.key,
    ) ||
    before.some(
      (i) =>
        i.kind === "source" &&
        i.provenance.current === true &&
        i.provenance.documentId &&
        after.some(
          (n) =>
            n.provenance.documentId === i.provenance.documentId &&
            Number(n.provenance.documentVersion) >
              Number(i.provenance.documentVersion),
        ),
    )
  );
}
