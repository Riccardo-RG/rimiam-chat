import { voiceResearchQuery } from "../shared/voice-research.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { changed, member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { inspectMedia } from "./media-provider.ts";
import { uploadDocument } from "./sources.ts";
import { voiceSendSchema, voiceMessagesSchema } from "../contracts/voice.ts";

export async function sendVoice(
  tx: Tx,
  w: string,
  actor: string,
  input: z.infer<typeof voiceSendSchema>,
) {
  requireThat(
    inspectMedia(input.filename, Buffer.from(input.bytesBase64, "base64"))
      ?.kind === "audio",
    "VOICE_AUDIO_REQUIRED",
    400,
  );
  const source = await uploadDocument(
    tx,
    w,
    actor,
    { ...input, type: "document.upload" },
    "Messaggio vocale condiviso esplicitamente dall'autore. Trascrizione automatica fallibile: verificare l'audio originale. Non costituisce accettazione, delega o autorizzazione operativa.",
  );
  const messageId = randomUUID();
  const sequence = (
    await tx.query(
      "UPDATE workspace SET next_message=next_message+1 WHERE id=$1 RETURNING next_message",
      [w],
    )
  ).rows[0].next_message;
  await tx.query(
    "INSERT INTO message(id,workspace_id,sequence,author_id,content) VALUES($1,$2,$3,$4,$5)",
    [
      messageId,
      w,
      sequence,
      actor,
      input.mode === "miriam"
        ? "Messaggio vocale a RIMIAM"
        : "Messaggio vocale",
    ],
  );
  await tx.query(
    "INSERT INTO voice_message(message_id,workspace_id,source_id,mode) VALUES($1,$2,$3,$4)",
    [messageId, w, source.sourceId, input.mode],
  );
  await changed(tx, w, "voice.sent");
  return { ...source, messageId };
}

export async function voiceMessages(actor: string, w: string) {
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const rows = (
      await tx.query(
        `SELECT v.message_id AS "messageId",v.source_id AS "sourceId",v.mode,p.status,
      e.content AS transcript,s.qualification || coalesce(' '||e.qualification,'') AS qualification,p.error_code AS "errorCode",
      (SELECT i.status FROM interpretation i WHERE i.workspace_id=v.workspace_id AND i.source_id=v.source_id ORDER BY i.created_at DESC LIMIT 1) AS "interpretationStatus"
      FROM voice_message v JOIN document_processing p ON p.source_id=v.source_id JOIN external_source s ON s.id=v.source_id
      LEFT JOIN document_extraction e ON e.source_id=v.source_id AND e.publication='published'
      WHERE v.workspace_id=$1 ORDER BY v.created_at`,
        [w],
      )
    ).rows;
    return voiceMessagesSchema.parse({
      messages: rows.map((r) => ({
        ...r,
        researchQuery: voiceResearchQuery(r.transcript),
      })),
    });
  });
}
