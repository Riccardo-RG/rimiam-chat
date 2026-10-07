import type { ProductAssistance } from "../contracts/product-assistance";
import { feedbackFromComposer } from "../shared/beta-feedback";

export interface ProductHelpDraft {
  context: ProductAssistance;
  scope: string;
}

export function assistanceForMessage(
  help: ProductHelpDraft | null,
  draft: { text: string; scope: string },
  currentScope: string,
): ProductAssistance | null {
  if (
    !help ||
    help.scope !== currentScope ||
    draft.scope !== currentScope ||
    !draft.text.trim() ||
    feedbackFromComposer(draft.text) !== null
  )
    return null;
  return help.context;
}
