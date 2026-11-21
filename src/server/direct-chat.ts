import { randomUUID, createHash } from "node:crypto";
import type {
  DirectInput,
  DirectView,
  DirectEntry,
} from "../contracts/direct-chat.ts";
import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { authenticatedSession, eligible } from "./workspace-state.ts";
import { resolvePersonalContactEmails } from "./personal-contacts.ts";
import { readProfile } from "./participant-profiles.ts";
import { inspectMedia } from "./media-provider.ts";
import { decodeDocument } from "./sources.ts";
import { privateRecap } from "./private-recap.ts";
import {
  configuredStructuredModel,
  type StructuredModel,
} from "./structured-llm.ts";

async function user(tx: Tx, actor: string, session: string) {
  await eligible(tx, actor, true);
  await authenticatedSession(tx, actor, session);
}
async function boundary(
  tx: Tx,
  actor: string,
  session: string,
  id: string,
  editing = false,
) {
  await user(tx, actor, session);
  const {
    rows: [chat],
  } = await tx.query(
    `SELECT * FROM direct_chat WHERE id=$1 AND $2 IN(person_a,person_b)` +
      (editing ? " FOR UPDATE" : ""),
    [id, actor],
  );
  requireThat(chat, "DIRECT_CHAT_NOT_FOUND", 404);
  return {
    peer: actor === chat.person_a ? chat.person_b : chat.person_a,
    version: chat.consent_version as number,
  };
}
export async function openDirect(
  actor: string,
  session: string,
  contact: string,
) {
  return transaction(async (tx) => {
    await user(tx, actor, session);
    requireThat(actor !== contact, "PERSONAL_CONTACT_UNAVAILABLE", 409);
    await resolvePersonalContactEmails(tx, actor, [contact]);
    const [a, b] = [actor, contact].sort((x, y) =>
      Buffer.compare(Buffer.from(x), Buffer.from(y)),
    );
    const {
      rows: [row],
    } = await tx.query(
      "INSERT INTO direct_chat(id,person_a,person_b) VALUES($1,$2,$3) ON CONFLICT(person_a,person_b) DO UPDATE SET person_a=excluded.person_a RETURNING id",
      [randomUUID(), a, b],
    );
    await tx.query(
      "INSERT INTO direct_reader(chat_id,actor_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING",
      [row.id, a, b],
    );
    return { id: row.id as string };
  });
}
export async function directDirectory(
  actor: string,
  session: string,
): Promise<DirectEntry[]> {
  return transaction(async (tx) => {
    await user(tx, actor, session);
    const { rows } = await tx.query(
      `SELECT c.id,u.name,u.id AS "contactId",(SELECT p.version FROM profile_photo p WHERE p.owner_id=u.id AND p.image IS NOT NULL AND u.eligible AND u."emailVerified") AS "photoVersion",last.sent_at AS "lastActivityAt",left(coalesce(nullif(last.body,''),f.filename),180) AS preview,
      (SELECT count(*)::int FROM direct_message m WHERE m.chat_id=c.id AND m.sender_id<>$1 AND NOT EXISTS (SELECT FROM direct_seen s WHERE (s.chat_id,s.actor_id,s.message_id)=(c.id,$1,m.id))) AS "unreadCount"
      FROM direct_chat c JOIN "user" u ON u.id=CASE WHEN person_a=$1 THEN person_b ELSE person_a END
      JOIN LATERAL(SELECT m.id,m.body,m.sent_at FROM direct_message m WHERE m.chat_id=c.id ORDER BY m.ordinal DESC LIMIT 1) last ON true
      LEFT JOIN LATERAL(SELECT filename FROM direct_file WHERE chat_id=c.id AND message_id=last.id ORDER BY position LIMIT 1) f ON true
      WHERE $1 IN(person_a,person_b) ORDER BY last.sent_at DESC,c.id`,
      [actor],
    );
    return rows.map(
      (r) =>
        ({
          ...r,
          lastActivityAt: r.lastActivityAt.toISOString(),
        }) as DirectEntry,
    );
  });
}
export async function directView(
  actor: string,
  session: string,
  id: string,
): Promise<DirectView> {
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const b = await boundary(tx, actor, session, id);
    const {
      rows: [me],
    } = await tx.query(
      "SELECT consent,anchor_id,anchor_offset,anchor_at_bottom,cursor_version,(SELECT coalesce(max(consent_version),0) FROM direct_consent_act WHERE chat_id=$1 AND actor_id=$2) AS my_version FROM direct_reader WHERE chat_id=$1 AND actor_id=$2",
      [id, actor],
    );
    const {
      rows: [peer],
    } = await tx.query(
      'SELECT u.id,u.name,r.consent,(SELECT p.version FROM profile_photo p WHERE p.owner_id=u.id AND p.image IS NOT NULL AND u.eligible AND u."emailVerified") AS photo_version FROM direct_reader r JOIN "user" u ON u.id=r.actor_id WHERE r.chat_id=$1 AND u.id=$2',
      [id, b.peer],
    );
    const { rows: messages } = await tx.query(
      `SELECT m.id,m.sender_id AS "authorId",u.name,m.body AS text,m.sent_at AS "sentAt",m.quote_id AS "quoteId",
      NOT EXISTS(SELECT FROM direct_seen s WHERE (s.chat_id,s.actor_id,s.message_id)=($1,$2,m.id)) AND m.sender_id<>$2 AS unread,
      ARRAY(SELECT json_build_object('id',f.id,'filename',f.filename,'type',f.content_type) FROM direct_file f WHERE f.chat_id=m.chat_id AND f.message_id=m.id ORDER BY f.position) AS files
      FROM direct_message m JOIN "user" u ON u.id=m.sender_id WHERE m.chat_id=$1 ORDER BY m.ordinal`,
      [id, actor],
    );
    const { rows: recaps } = await tx.query(
      `SELECT id,body AS text,source_ids AS "sourceIds",created_at AS "createdAt" FROM direct_recap WHERE chat_id=$1 AND actor_id=$2 AND status='ready' ORDER BY created_at DESC`,
      [id, actor],
    );
    return {
      id,
      me: actor,
      peer: { id: peer.id, name: peer.name, photoVersion: peer.photo_version },
      consent: me.consent,
      peerConsent: peer.consent,
      consentVersion: me.my_version,
      messages: messages.map((m) => ({
        id: m.id,
        authorId: m.authorId,
        name: m.name,
        text: m.text,
        sentAt: m.sentAt.toISOString(),
        quoteId: m.quoteId,
        files: m.files,
      })),
      reading: {
        admission: 1,
        anchorId: me.anchor_id,
        anchorOffset: me.anchor_offset,
        anchorAtBottom: me.anchor_at_bottom,
        cursorVersion: me.cursor_version,
        unreadIds: messages.filter((m) => m.unread).map((m) => m.id),
        mentionIds: [],
        requestIds: [],
      },
      recaps: recaps.map((r) => ({
        id: r.id,
        text: r.text,
        sourceIds: r.sourceIds,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
export async function directPeerProfile(
  actor: string,
  session: string,
  id: string,
) {
  return transaction(async (tx) => {
    const { peer } = await boundary(tx, actor, session, id);
    return readProfile(tx, peer);
  });
}

export async function directPeerPhoto(
  actor: string,
  session: string,
  id: string,
) {
  return transaction(async (tx) => {
    const b = await boundary(tx, actor, session, id);
    await eligible(tx, b.peer, true);
    const result = await tx.query(
      "SELECT image FROM profile_photo WHERE owner_id=$1 AND image IS NOT NULL",
      [b.peer],
    );
    requireThat(result.rows[0], "PHOTO_NOT_FOUND", 404);
    return result.rows[0].image as Buffer;
  });
}
export async function directFile(
  actor: string,
  session: string,
  id: string,
  file: string,
) {
  return transaction(async (tx) => {
    await boundary(tx, actor, session, id);
    const {
      rows: [f],
    } = await tx.query(
      "SELECT filename,content_type,original_bytes FROM direct_file WHERE chat_id=$1 AND id=$2",
      [id, file],
    );
    requireThat(f, "FILE_NOT_FOUND", 404);
    return f;
  });
}
function fileContent(file: { filename: string; bytesBase64: string }) {
  requireThat(
    !/[\\/\x00-\x1f\x7f]/.test(file.filename),
    "DOCUMENT_FORMAT_UNSUPPORTED",
    400,
  );
  const bytes = Buffer.from(file.bytesBase64, "base64");
  requireThat(
    bytes.length > 0 &&
      bytes.length <= 8388608 &&
      bytes.toString("base64") === file.bytesBase64,
    "INVALID_DOCUMENT_ENCODING",
    400,
  );
  const media = inspectMedia(file.filename, bytes);
  if (!media) decodeDocument({ type: "document.upload", ...file });
  return { bytes, type: media?.mediaType ?? "text/plain; charset=utf-8" };
}
export async function directCommand(
  actor: string,
  session: string,
  id: string,
  c: DirectInput,
  model?: StructuredModel,
) {
  requireThat(c.expectedActorId === actor, "AUTH_CONTEXT_CHANGED", 409);
  if (c.type === "recap") return generateRecap(actor, session, id, c.id, model);
  return transaction(async (tx) => {
    const b = await boundary(tx, actor, session, id, true);
    if (c.type === "send") {
      await eligible(tx, b.peer, true);
      const hash = createHash("sha256")
        .update(
          JSON.stringify([c.text, c.quoteId ?? null, c.attachments ?? []]),
        )
        .digest("hex");
      const prior = (
        await tx.query(
          "SELECT payload_hash FROM direct_message WHERE chat_id=$1 AND sender_id=$2 AND id=$3",
          [id, actor, c.id],
        )
      ).rows[0];
      if (prior) {
        requireThat(hash === prior.payload_hash, "COMMAND_ID_REUSED", 409);
        return { messageId: c.id };
      }
      if (c.quoteId)
        requireThat(
          (
            await tx.query(
              "SELECT FROM direct_message WHERE chat_id=$1 AND id=$2",
              [id, c.quoteId],
            )
          ).rowCount,
          "MESSAGE_NOT_FOUND",
          404,
        );
      await tx.query(
        "INSERT INTO direct_message(id,chat_id,sender_id,body,payload_hash,quote_id) VALUES($1,$2,$3,$4,$5,$6)",
        [c.id, id, actor, c.text, hash, c.quoteId ?? null],
      );
      let total = 0;
      for (const [position, file] of (c.attachments ?? []).entries()) {
        const { bytes, type } = fileContent(file);
        total += bytes.length;
        requireThat(total <= 8388608, "DOCUMENT_TOO_LARGE", 413);
        await tx.query("INSERT INTO direct_file VALUES($1,$2,$3,$4,$5,$6,$7)", [
          randomUUID(),
          id,
          c.id,
          position,
          file.filename,
          type,
          bytes,
        ]);
      }
      return { messageId: c.id };
    }
    if (c.type === "read") {
      const ids = [...new Set([...c.seen, ...(c.anchor ? [c.anchor.id] : [])])];
      requireThat(
        (
          await tx.query(
            "SELECT id FROM direct_message WHERE chat_id=$1 AND id=ANY($2::uuid[])",
            [id, ids],
          )
        ).rowCount === ids.length,
        "MESSAGE_NOT_FOUND",
        404,
      );
      if (c.seen.length)
        await tx.query(
          "INSERT INTO direct_seen SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING",
          [id, actor, c.seen],
        );
      if (c.anchor)
        await tx.query(
          "UPDATE direct_reader SET anchor_id=$3,anchor_offset=$4,anchor_at_bottom=$6,cursor_version=cursor_version+1 WHERE chat_id=$1 AND actor_id=$2 AND cursor_version=$5",
          [
            id,
            actor,
            c.anchor.id,
            c.anchor.offset,
            c.anchor.expectedVersion,
            c.anchor.atBottom ?? false,
          ],
        );
      return {
        cursorVersion: (
          await tx.query(
            "SELECT cursor_version FROM direct_reader WHERE chat_id=$1 AND actor_id=$2",
            [id, actor],
          )
        ).rows[0].cursor_version,
      };
    }
    const prior = (
      await tx.query(
        "SELECT enabled,consent_version FROM direct_consent_act WHERE id=$1 AND chat_id=$2 AND actor_id=$3",
        [c.id, id, actor],
      )
    ).rows[0];
    if (prior) {
      requireThat(prior.enabled === c.enabled, "COMMAND_ID_REUSED", 409);
      return { consentVersion: prior.consent_version };
    }
    // Two people granting consent independently do not invalidate each other's act.
    // A delayed grant on the same account must never undo its later withdrawal.
    const mine = (
      await tx.query(
        "SELECT coalesce(max(consent_version),0) AS version FROM direct_consent_act WHERE chat_id=$1 AND actor_id=$2",
        [id, actor],
      )
    ).rows[0].version;
    requireThat(mine === c.expectedVersion, "DIRECT_CONSENT_STALE", 409);
    const v = b.version + 1;
    await tx.query(
      "UPDATE direct_reader SET consent=$3 WHERE chat_id=$1 AND actor_id=$2",
      [id, actor, c.enabled],
    );
    await tx.query("UPDATE direct_chat SET consent_version=$2 WHERE id=$1", [
      id,
      v,
    ]);
    await tx.query(
      "INSERT INTO direct_consent_act(id,chat_id,actor_id,enabled,consent_version) VALUES($1,$2,$3,$4,$5)",
      [c.id, id, actor, c.enabled, v],
    );
    return { consentVersion: v };
  });
}
async function allowed(
  tx: Tx,
  actor: string,
  session: string,
  id: string,
  expectedVersion?: number,
) {
  const b = await boundary(tx, actor, session, id, true);
  await eligible(tx, b.peer, true);
  requireThat(
    expectedVersion === undefined || b.version === expectedVersion,
    "DIRECT_CONSENT_STALE",
    409,
  );
  const result = await tx.query(
    "SELECT count(*)::int n FROM direct_reader WHERE chat_id=$1 AND consent",
    [id],
  );
  requireThat(result.rows[0].n === 2, "DIRECT_RECAP_CONSENT_REQUIRED", 403);
  return b.version;
}
async function generateRecap(
  actor: string,
  session: string,
  id: string,
  request: string,
  injected?: StructuredModel,
) {
  const source = await transaction(async (tx) => {
    const version = await allowed(tx, actor, session, id);
    const previous = (
      await tx.query(
        "SELECT status FROM direct_recap WHERE id=$1 AND chat_id=$2 AND actor_id=$3",
        [request, id, actor],
      )
    ).rows[0];
    if (previous) {
      requireThat(
        previous.status === "ready",
        "DIRECT_RECAP_ATTEMPT_EXISTS",
        409,
      );
      return null;
    }
    await tx.query(
      "UPDATE direct_recap SET status='failed' WHERE chat_id=$1 AND actor_id=$2 AND status='processing' AND created_at<clock_timestamp()-interval '5 minutes'",
      [id, actor],
    );
    requireThat(
      !(
        await tx.query(
          "SELECT FROM direct_recap WHERE chat_id=$1 AND actor_id=$2 AND status='processing'",
          [id, actor],
        )
      ).rowCount,
      "DIRECT_RECAP_IN_PROGRESS",
      409,
    );
    const { rows } = await tx.query<{
      id: string;
      author: string;
      text: string;
    }>(
      `SELECT m.id,u.name AS author,concat_ws(' ',nullif(m.body,''),(SELECT string_agg(filename,', ' ORDER BY position) FROM direct_file f WHERE f.chat_id=m.chat_id AND f.message_id=m.id)) AS text
      FROM direct_message m JOIN "user" u ON u.id=m.sender_id WHERE m.chat_id=$1 ORDER BY m.ordinal`,
      [id],
    );
    requireThat(rows.length, "NO_MESSAGES_TO_SUMMARIZE", 409);
    const model = injected ?? configuredStructuredModel();
    requireThat(model, "AI_CONFIGURATION_REQUIRED", 503);
    await tx.query(
      "INSERT INTO direct_recap(id,chat_id,actor_id,consent_version,through_message,status) VALUES($1,$2,$3,$4,$5,'processing')",
      [request, id, actor, version, rows.at(-1)!.id],
    );
    return { model, version, messages: rows };
  });
  if (!source) return { recapId: request };
  try {
    const validateAccess = () =>
      transaction(async (tx) => {
        await allowed(tx, actor, session, id, source.version);
      });
    const recap = await privateRecap({
      model: source.model,
      messages: source.messages,
      admissionScope: { directChat: id, operation: "direct_recap" },
      validateAccess,
    });
    await transaction(async (tx) => {
      await allowed(tx, actor, session, id, source.version);
      requireThat(
        (
          await tx.query(
            "UPDATE direct_recap SET status='ready',body=$2,source_ids=$3 WHERE id=$1 AND status='processing'",
            [request, recap.text, recap.sourceIds],
          )
        ).rowCount,
        "DIRECT_RECAP_ATTEMPT_EXISTS",
        409,
      );
    });
    return { recapId: request };
  } catch (e) {
    await transaction(async (tx) => {
      await tx.query(
        "UPDATE direct_recap SET status='failed' WHERE id=$1 AND status='processing'",
        [request],
      );
    });
    throw e;
  }
}
