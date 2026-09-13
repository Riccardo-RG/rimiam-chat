import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  attentionCommandSchema,
  attentionViewSchema,
} from "../contracts/attention.ts";
import { transaction, type Tx } from "./db.ts";
import { member, changed, lockWorkspace } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";

export async function attentionCommand(
  tx: Tx,
  w: string,
  actor: string,
  c: z.infer<typeof attentionCommandSchema>,
) {
  await member(tx, w, actor, c.type !== "attention.aligned", true);
  if (c.type === "attention.aligned") {
    const current = (
      await tx.query("SELECT revision FROM workspace WHERE id=$1", [w])
    ).rows[0].revision;
    requireThat(c.revision <= current, "STATE_REVISION_INVALID");
    await tx.query(
      "INSERT INTO workspace_alignment(workspace_id,person_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [w, actor, c.revision],
    );
    return { alignedRevision: c.revision };
  }
  if (c.type === "attention.preference") {
    const current = (
      await tx.query(
        "SELECT COALESCE(max(version),0)::int AS version FROM collaboration_preference WHERE workspace_id=$1",
        [w],
      )
    ).rows[0].version;
    requireThat(current === c.expectedVersion, "STATE_STALE");
    await tx.query(
      "INSERT INTO collaboration_preference(workspace_id,version,mode,actor_id) VALUES($1,$2,$3,$4)",
      [w, current + 1, c.mode, actor],
    );
    await changed(tx, w, c.type);
    return { version: current + 1 };
  }
  if (c.type === "workstream.save") {
    const id = c.id ?? randomUUID();
    let version = 1;
    if (c.id) {
      const a = (
        await tx.query(
          "SELECT current_version FROM workstream WHERE workspace_id=$1 AND id=$2",
          [w, id],
        )
      ).rows[0];
      requireThat(a, "WORKSTREAM_NOT_FOUND", 404);
      requireThat(a.current_version === c.expectedVersion, "STATE_STALE");
      version = a.current_version + 1;
      await tx.query(
        "UPDATE workstream SET current_version=$3 WHERE workspace_id=$1 AND id=$2",
        [w, id, version],
      );
    } else
      await tx.query("INSERT INTO workstream(workspace_id,id) VALUES($1,$2)", [
        w,
        id,
      ]);
    await tx.query(
      "INSERT INTO workstream_version(workspace_id,workstream_id,version,title,description,actor_id,origin) VALUES($1,$2,$3,$4,$5,$6,'human')",
      [w, id, version, c.title, c.description, actor],
    );
    await changed(tx, w, c.type);
    return { id, version };
  }
  const stream = (
    await tx.query(
      "SELECT id FROM workstream WHERE workspace_id=$1 AND id=$2",
      [w, c.workstreamId],
    )
  ).rowCount;
  const source = (
    await tx.query(
      "SELECT id FROM workspace_source WHERE workspace_id=$1 AND id=$2",
      [w, c.sourceId],
    )
  ).rowCount;
  requireThat(stream && source, "WORKSTREAM_SOURCE_NOT_FOUND", 404);
  const v = (
    await tx.query(
      "SELECT COALESCE(max(version),0)::int AS v FROM workstream_source WHERE workspace_id=$1 AND workstream_id=$2 AND source_id=$3",
      [w, c.workstreamId, c.sourceId],
    )
  ).rows[0].v;
  requireThat(v === c.expectedVersion, "STATE_STALE");
  await tx.query(
    "INSERT INTO workstream_source(workspace_id,workstream_id,source_id,version,included,actor_id,origin) VALUES($1,$2,$3,$4,$5,$6,'human')",
    [w, c.workstreamId, c.sourceId, v + 1, c.included, actor],
  );
  await changed(tx, w, c.type);
  return { version: v + 1 };
}

export async function organizeSources(
  tx: Tx,
  w: string,
  source: string,
  groups: { title: string; sourceIds: string[] }[],
) {
  for (const group of groups) {
    let id = (
      await tx.query(
        "SELECT w.id FROM workstream w JOIN workstream_version v ON (v.workspace_id,v.workstream_id,v.version)=(w.workspace_id,w.id,w.current_version) WHERE w.workspace_id=$1 AND lower(v.title)=lower($2) ORDER BY w.id LIMIT 1",
        [w, group.title],
      )
    ).rows[0]?.id;
    if (!id) {
      id = randomUUID();
      await tx.query("INSERT INTO workstream(workspace_id,id) VALUES($1,$2)", [
        w,
        id,
      ]);
      await tx.query(
        "INSERT INTO workstream_version(workspace_id,workstream_id,version,title,description,origin,source_id) VALUES($1,$2,1,$3,'Organizzazione semantica di Miriam; non un Goal o una decisione.','miriam',$4)",
        [w, id, group.title, source],
      );
    }
    for (const sid of group.sourceIds) {
      // Never re-add a source a person removed; inclusion is inspectable organization, not adoption.
      if (
        (
          await tx.query(
            "SELECT 1 FROM workstream_source WHERE workspace_id=$1 AND workstream_id=$2 AND source_id=$3",
            [w, id, sid],
          )
        ).rowCount
      )
        continue;
      await tx.query(
        "INSERT INTO workstream_source(workspace_id,workstream_id,source_id,version,included,origin) VALUES($1,$2,$3,1,true,'miriam')",
        [w, id, sid],
      );
    }
  }
  if (groups.length) await changed(tx, w, "workstream.organized");
}

export async function attentionView(actor: string, w: string, before?: number) {
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await member(tx, w, actor);
    const revision = (
      await tx.query("SELECT revision FROM workspace WHERE id=$1", [w])
    ).rows[0].revision;
    const alignedRevision = (
      await tx.query(
        "SELECT COALESCE(max(revision),0)::int AS revision FROM workspace_alignment WHERE workspace_id=$1 AND person_id=$2",
        [w, actor],
      )
    ).rows[0].revision;
    const changes = (
      await tx.query(
        `SELECT revision,kind,created_at AS "createdAt" FROM workspace_change WHERE workspace_id=$1 AND revision>$2 AND revision<$3 AND kind ~ '^(goal|information|commitment|project|task|work[.]|artifact|question|workstream)' ORDER BY revision DESC LIMIT 101`,
        [w, alignedRevision, before ?? revision + 1],
      )
    ).rows;
    const workstreams = (
      await tx.query(
        "SELECT w.id,w.current_version AS version,v.title,v.description,v.actor_id AS actor,v.origin FROM workstream w JOIN workstream_version v ON (v.workspace_id,v.workstream_id,v.version)=(w.workspace_id,w.id,w.current_version) WHERE w.workspace_id=$1 ORDER BY v.title,w.id",
        [w],
      )
    ).rows;
    for (const s of workstreams) {
      s.sources = (
        await tx.query(
          "SELECT l.source_id AS id,l.version,l.included,l.actor_id AS actor,l.origin,v.content,v.kind FROM (SELECT DISTINCT ON(source_id) * FROM workstream_source WHERE workspace_id=$1 AND workstream_id=$2 ORDER BY source_id,version DESC) l JOIN workspace_source v ON (v.workspace_id,v.id)=(l.workspace_id,l.source_id)",
          [w, s.id],
        )
      ).rows;
      s.history = (
        await tx.query(
          'SELECT version,title,description,actor_id AS actor,origin,created_at AS "createdAt" FROM workstream_version WHERE workspace_id=$1 AND workstream_id=$2 ORDER BY version DESC',
          [w, s.id],
        )
      ).rows;
    }
    const preference = (
      await tx.query(
        "SELECT version,mode,actor_id AS actor FROM collaboration_preference WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1",
        [w],
      )
    ).rows[0] ?? { version: 0, mode: "discreet", actor: null };
    const attention = (
      await tx.query(
        `SELECT 'work' AS kind,a.id,c.objective AS text,CASE WHEN a.validity='potentially_outdated' THEN 'Risultato da ricontrollare' WHEN a.phase='needs_input' THEN 'Miriam ha bisogno di un chiarimento' WHEN a.phase='paused' THEN 'Analisi in pausa' ELSE 'Miriam sta lavorando' END AS reason FROM active_work a JOIN active_work_contract c ON (c.workspace_id,c.work_id,c.version)=(a.workspace_id,a.id,a.contract_version) WHERE a.workspace_id=$1 AND (a.phase IN ('queued','working','needs_input','paused') OR a.validity='potentially_outdated')
 UNION ALL SELECT 'question',q.id,v.content,'Domanda aperta' FROM open_question q JOIN question_version v ON (v.workspace_id,v.question_id,v.version)=(q.workspace_id,q.id,q.current_version) WHERE q.workspace_id=$1 AND v.status='open'
 UNION ALL SELECT 'task',t.id,v.title,CASE WHEN v.due_at<now() THEN 'Scadenza trascorsa; stato ancora aperto' WHEN r.person_id=$2 THEN 'Responsabilità che hai accettato' ELSE 'Task senza responsabilità accettata' END FROM workspace_task t JOIN task_version v ON (v.workspace_id,v.task_id,v.version)=(t.workspace_id,t.id,t.current_version) LEFT JOIN task_responsibility r ON r.id=v.responsibility_id AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND v.status IN ('open','in_progress') AND (v.due_at<now() OR r.person_id=$2 OR r.id IS NULL)
 UNION ALL SELECT 'proposal',p.id,p.content,'Decisione, vincolo o impegno ancora proposto' FROM normative_proposal p WHERE p.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM project_act a WHERE a.workspace_id=p.workspace_id AND a.proposal_id=p.id)`,
        [w, actor],
      )
    ).rows;
    return attentionViewSchema.parse(
      JSON.parse(
        JSON.stringify({
          revision,
          alignedRevision,
          changes: changes.slice(0, 100),
          nextBefore: changes.length > 100 ? changes[99].revision : null,
          attention,
          preference,
          workstreams,
        }),
      ),
    );
  });
}
