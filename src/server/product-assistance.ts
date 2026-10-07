import {
  productAssistanceSchema,
  type ProductAssistance,
} from "../contracts/product-assistance.ts";
import {
  PRODUCT_GUIDE_VERSION,
  resolveProductAssistance,
} from "../shared/product-guide.ts";
import type { Tx } from "./db.ts";

export async function recordProductAssistance(
  tx: Tx,
  workspace: string,
  message: string,
  input: ProductAssistance,
) {
  const reference = productAssistanceSchema.parse(input);
  await tx.query(
    "INSERT INTO message_product_assistance(workspace_id,message_id,guide_version,screen,field_id,issue) VALUES($1,$2,$3,$4,$5,$6)",
    [
      workspace,
      message,
      PRODUCT_GUIDE_VERSION,
      reference.screen,
      reference.field ?? null,
      reference.issue ?? null,
    ],
  );
}

export async function productAssistanceContext(
  tx: Tx,
  workspace: string,
  message: string,
) {
  const row = (
    await tx.query(
      "SELECT guide_version,screen,field_id,issue FROM message_product_assistance WHERE workspace_id=$1 AND message_id=$2",
      [workspace, message],
    )
  ).rows[0];
  if (!row) return null;
  const unavailable = {
    guideVersion: row.guide_version as number,
    screen: row.screen as string,
    unavailable: true as const,
    instructions:
      "This is an explicit product-help question. The historical guide reference is unavailable; do not substitute current field semantics. Ask for the minimum clarification. No state-changing output is allowed.",
  };
  if (row.guide_version !== PRODUCT_GUIDE_VERSION) return unavailable;
  return (
    resolveProductAssistance({
      screen: row.screen,
      ...(row.field_id ? { field: row.field_id } : {}),
      ...(row.issue ? { issue: row.issue } : {}),
    }) ?? unavailable
  );
}

export const productAssistanceJoin = `LEFT JOIN message_product_assistance pa ON pa.workspace_id=m.workspace_id AND pa.message_id=m.id
 LEFT JOIN conversation_workstream_action cwa ON cwa.workspace_id=m.workspace_id AND cwa.reply_message_id=m.id`;
export const productAssistanceProjection = `CASE WHEN pa.message_id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('screen',pa.screen,'field',pa.field_id,'issue',pa.issue)) END`;
export const conversationOperationProjection = `CASE WHEN cwa.reply_message_id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('outcome',cwa.outcome,'title',cwa.title,'workstreamId',cwa.workstream_id,'workstreamVersion',cwa.workstream_version)) END`;
