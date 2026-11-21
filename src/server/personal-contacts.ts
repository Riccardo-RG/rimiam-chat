import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { authenticatedSession, eligible } from "./workspace-state.ts";

// Earlier releases dated membership history at transaction start, before the
// Workspace lock. A queued admission could then look earlier than a departure.
// Modern admissions recorded after locking give a strict wall-clock proof.
// Otherwise use conservative revision bounds; an ambiguous ordering grants no
// visibility. The audit journal and receipts already carry the serialized acts.
const beginsBeforeDeparture = (
  start: "mine" | "other",
  end: "mine" | "other",
) =>
  `(${end}.left_at IS NULL
    OR (${start}.joined_at > ${start}.join_transaction_at AND ${start}.joined_at < ${end}.left_at)
    OR ${start}.latest_join < ${end}.earliest_departure)`;

const sharedPeople = `WITH my_spaces AS (
  SELECT m.workspace_id FROM membership m JOIN workspace w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.personal_owner_id IS NULL
), membership_changes AS (
  SELECT c.workspace_id, c.revision, c.kind, c.created_at
  FROM my_spaces s JOIN workspace_change c USING(workspace_id)
  WHERE c.kind IN ('workspace.created', 'member.joined', 'member.remove', 'member.leave')
), periods AS (
  SELECT h.workspace_id, h.user_id, h.created_at AS joined_at, d.created_at AS left_at,
    times.join_transaction_at, admission.latest_join, departure.earliest_departure
  FROM my_spaces m JOIN membership_history h
    ON h.workspace_id = m.workspace_id AND h.active
  JOIN workspace w ON w.id = h.workspace_id
  LEFT JOIN membership_history d
    ON (d.workspace_id, d.user_id, d.version) = (h.workspace_id, h.user_id, h.version + 1)
  LEFT JOIN invitation i ON i.workspace_id = h.workspace_id AND i.accepted_by = h.user_id
    AND h.basis = 'invitation:' || i.id::text
  CROSS JOIN LATERAL (SELECT CASE WHEN h.basis = 'workspace_initialization'
    THEN w.created_at ELSE i.accepted_at END AS join_transaction_at) times
  CROSS JOIN LATERAL (
    SELECT min(c.revision) AS earliest_join, max(c.revision) AS latest_join FROM membership_changes c
    WHERE c.workspace_id = h.workspace_id AND c.created_at = times.join_transaction_at
      AND c.kind = CASE WHEN h.basis = 'workspace_initialization' THEN 'workspace.created' ELSE 'member.joined' END
  ) admission
  CROSS JOIN LATERAL (
    SELECT min(c.revision) AS earliest_departure FROM membership_changes c
    JOIN command_receipt r ON r.workspace_id = c.workspace_id AND r.created_at = c.created_at
      AND r.actor_id = d.actor_id
    WHERE c.workspace_id = h.workspace_id AND c.kind = d.basis
      AND c.revision > admission.earliest_join AND c.created_at <= d.created_at
  ) departure
), shared_people AS (
  SELECT DISTINCT other.user_id FROM periods mine JOIN periods other
    ON mine.workspace_id = other.workspace_id AND other.user_id <> mine.user_id
  WHERE mine.user_id = $1 AND ${beginsBeforeDeparture("mine", "other")}
    AND ${beginsBeforeDeparture("other", "mine")}
)`;
const eligibleContacts = `FROM shared_people s JOIN "user" u ON u.id = s.user_id
  WHERE u.eligible AND u."emailVerified"`;
const pageSize = 30;

export async function personalContacts(
  actor: string,
  sessionId: string,
  query: string,
  offset: number,
) {
  return transaction(async (tx) => {
    await eligible(tx, actor, true);
    await authenticatedSession(tx, actor, sessionId);
    const { rows } = await tx.query<{
      id: string;
      name: string;
      nameAmbiguous: boolean;
    }>(
      `${sharedPeople} SELECT u.id, u.name,
       count(*) OVER (PARTITION BY lower(trim(u.name))) > 1 AS "nameAmbiguous"
       ${eligibleContacts}
       AND strpos(lower(u.name), lower($2)) > 0
       ORDER BY lower(u.name), u.id LIMIT $3 OFFSET $4`,
      [actor, query, pageSize + 1, offset],
    );
    return {
      contacts: rows.slice(0, pageSize),
      nextOffset: rows.length > pageSize ? offset + pageSize : null,
    };
  });
}

// The recipient email is resolved only inside the authorized invitation command.
export async function resolvePersonalContactEmails(
  tx: Tx,
  actor: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds)];
  if (!ids.length) return new Map();
  const { rows } = await tx.query<{ id: string; email: string }>(
    `${sharedPeople} SELECT u.id, lower(u.email) AS email ${eligibleContacts}
     AND u.id = ANY($2::text[]) ORDER BY u.id FOR SHARE OF u`,
    [actor, ids],
  );
  requireThat(rows.length === ids.length, "PERSONAL_CONTACT_UNAVAILABLE", 409);
  return new Map(rows.map(({ id, email }) => [id, email]));
}
