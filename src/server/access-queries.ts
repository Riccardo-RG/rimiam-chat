import { accessHistorySchema, accessViewSchema } from "../contracts/access.ts";
import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  accessConditions,
  participationAvailable,
  type AccessRelationship,
} from "./access-commands.ts";

// Version 1 is part of the proposal accepted by the holders, retained with its immutable targets.
export function accessTerms(
  kind: "stewardship" | "delegation" | "revoke",
  joint: boolean,
) {
  const common = [
    "Questi accordi riguardano soltanto l’accesso: non conferiscono authority su Goal, impegni, decisioni o azioni esterne, né il potere di chiudere, archiviare o eliminare il Workspace.",
    "L’idoneità dell’account e la membership devono restare valide. Nessun privilegio deriva dall’essere creator e nessuna successione è automatica.",
  ];
  if (kind === "delegation")
    return [
      ...common,
      "La delega consente soltanto la gestione degli inviti. Non conferisce partecipazione protetta, rimozione dei membri, modifica della governance o delega ulteriore.",
      "Ogni steward corrente validamente autorizzato può revocare questa delega senza una nuova accettazione del titolare; la sua efficacia non dipende soltanto dalla presenza del concedente originario.",
      "Il titolare può rinunciare o uscire liberamente. Gli inviti ancora pendenti non si attivano se la loro authority termina.",
    ];
  if (kind === "revoke")
    return [
      ...common,
      "La delega agli inviti indicata viene revocata secondo i poteri riservati già accettati. La membership rimane; gli inviti pendenti privi della loro base autorizzante non si attivano.",
    ];
  return [
    ...common,
    "L’insieme nominativo indicato sostituisce la stewardship corrente. Ogni titolare può gestire inviti, rimuovere membri ordinari non protetti e concedere o revocare deleghe ai soli inviti.",
    joint
      ? "Le partecipazioni protette e le loro condizioni possono essere modificate soltanto con l’approvazione congiunta delle partecipazioni nominate. Non è un voto di tutti i membri."
      : "La stewardship ordinaria indicata può stabilire i successivi accordi di accesso, rispettandone ogni protezione e accettazione necessaria.",
    "Ognuno può rinunciare alla propria partecipazione o uscire senza successore. Le condizioni degli altri non cambiano: se una partecipazione richiesta termina, quel percorso congiunto diventa indisponibile, senza promuovere chi resta. La collaborazione già permessa continua.",
  ];
}

export async function accessView(actor: string, w: string, before?: string) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const revision = (
      await tx.query("SELECT access_revision FROM workspace WHERE id=$1", [w])
    ).rows[0].access_revision as number;
    const members = (
      await tx.query(
        'SELECT m.user_id AS id,u.name,m.active FROM membership m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name',
        [w],
      )
    ).rows;
    const records = (
      await tx.query<AccessRelationship>(
        "SELECT * FROM access_relationship WHERE workspace_id=$1 ORDER BY id",
        [w],
      )
    ).rows;
    const relationships = [];
    for (const r of records) {
      const conditions = [];
      for (const id of await accessConditions(tx, w, r)) {
        const required = records.find((x) => x.id === id);
        if (required)
          conditions.push({
            participationId: id,
            holderId: required.holder_id,
            available: await participationAvailable(tx, w, id),
          });
      }
      relationships.push({
        id: r.id,
        holderId: r.holder_id,
        holderName:
          members.find((m) => m.id === r.holder_id)?.name ?? r.holder_id,
        version: r.version,
        active: r.active,
        available: await participationAvailable(tx, w, r.id),
        kind: r.kind,
        invitations: r.invitations,
        removeMembers: r.remove_members,
        changeAccess: r.change_access,
        protected: r.protected,
        basis: r.basis,
        conditions,
      });
    }
    const rows = (
      await tx.query(
        "SELECT p.*,a.adopted_at FROM access_proposal p LEFT JOIN access_proposal_adoption a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 AND ($2::uuid IS NULL OR p.id<$2) ORDER BY p.id DESC LIMIT 51",
        [w, before ?? null],
      )
    ).rows;
    const proposals = [];
    for (const p of rows.slice(0, 50)) {
      const targets = (
        await tx.query(
          'SELECT relationship_id AS "relationshipId",holder_id AS "holderId",base_version AS "baseVersion",active,kind,protected FROM access_proposal_target WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY holder_id',
          [w, p.id],
        )
      ).rows;
      const required = (
        await tx.query(
          'SELECT role,person_id AS "personId",participation_id AS "participationId" FROM access_proposal_requirement WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY role,person_id',
          [w, p.id],
        )
      ).rows;
      const approvals = (
        await tx.query(
          'SELECT role,person_id AS "personId",created_at AS "createdAt" FROM access_proposal_approval WHERE workspace_id=$1 AND proposal_id=$2 ORDER BY created_at',
          [w, p.id],
        )
      ).rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
      proposals.push({
        id: p.id,
        kind: p.kind,
        reason: p.reason,
        proposedBy: p.proposed_by,
        baseAccessRevision: p.base_access_revision,
        createdAt: p.created_at.toISOString(),
        termsVersion: p.terms_version,
        terms: accessTerms(
          p.kind,
          targets.filter((t) => t.active && t.kind === "stewardship").length >
            1,
        ),
        status: p.adopted_at
          ? "adopted"
          : p.base_access_revision !== revision
            ? "stale"
            : "pending",
        targets,
        required,
        approvals,
      });
    }
    return accessViewSchema.parse({
      accessRevision: revision,
      members,
      relationships,
      proposals,
      next: rows.length > 50 ? rows[49].id : null,
    });
  });
}

export async function accessHistory(
  actor: string,
  w: string,
  relationshipId: string,
  before = 2147483647,
) {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    requireThat(
      (
        await tx.query(
          "SELECT 1 FROM access_relationship WHERE workspace_id=$1 AND id=$2",
          [w, relationshipId],
        )
      ).rowCount,
      "ACCESS_RELATIONSHIP_NOT_FOUND",
      404,
    );
    const rows = (
      await tx.query(
        "SELECT * FROM access_history WHERE workspace_id=$1 AND relationship_id=$2 AND version<$3 ORDER BY version DESC LIMIT 51",
        [w, relationshipId, before],
      )
    ).rows;
    const versions = [];
    for (const row of rows.slice(0, 50)) {
      const terms = (
        await tx.query(
          "SELECT version FROM access_version_terms WHERE workspace_id=$1 AND relationship_id=$2 AND version<=$3 ORDER BY version DESC LIMIT 1",
          [w, relationshipId, row.version],
        )
      ).rows[0];
      const conditions = (
        await tx.query(
          terms
            ? "SELECT required_participation_id FROM access_version_condition WHERE workspace_id=$1 AND relationship_id=$2 AND version=$3 ORDER BY required_participation_id"
            : "SELECT required_participation_id FROM access_condition WHERE workspace_id=$1 AND relationship_id=$2 AND $3::int>0 ORDER BY required_participation_id",
          [w, relationshipId, terms?.version ?? row.version],
        )
      ).rows;
      versions.push({
        version: row.version,
        active: row.active,
        invitations: row.invitations,
        removeMembers: row.remove_members,
        changeAccess: row.change_access,
        protected: row.protected,
        actor: row.actor_id,
        basis: row.basis,
        createdAt: row.created_at.toISOString(),
        requiredParticipations: conditions.map(
          (r) => r.required_participation_id,
        ),
      });
    }
    return accessHistorySchema.parse({
      relationshipId,
      versions,
      nextBefore: rows.length > 50 ? rows[49].version : null,
    });
  });
}
