import { z } from "zod";
import {
  isProductField,
  productIssueIds,
  productScreenIds,
} from "../shared/product-guide.ts";

// Intentionally excludes values, drafts, free-form errors, DOM and provider state.
export const productAssistanceSchema = z
  .object({
    screen: z.enum(productScreenIds),
    field: z.string().min(1).max(64).optional(),
    issue: z.enum(productIssueIds).optional(),
  })
  .strict()
  .refine(
    (input) => !input.field || isProductField(input.screen, input.field),
    {
      path: ["field"],
      message: "Unknown field for this product screen",
    },
  );
export type ProductAssistance = z.infer<typeof productAssistanceSchema>;
