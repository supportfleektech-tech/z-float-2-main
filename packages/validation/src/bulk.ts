import { z } from "zod";
import { amountDecimalSchema, phoneInputSchema } from "./common.js";

/** One validated row of a bulk payment file (after normalization). */
export const bulkRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  recipientName: z.string().trim().min(2).max(200),
  phone: phoneInputSchema,
  amount: amountDecimalSchema,
  reference: z.string().trim().max(100).optional().default(""),
  category: z.string().trim().max(100).optional().default(""),
});

export const bulkUploadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  channel: z.enum(["mpesa", "till", "paybill"]),
  currency: z.enum(["KES"]),
  idempotencyKey: z.string().min(8).max(128),
  // rows are parsed server-side from the file; this schema applies to the JSON
  // preview submitted at the "review" step:
  rows: z.array(bulkRowSchema).min(1).max(50_000),
});

export type BulkRow = z.infer<typeof bulkRowSchema>;
