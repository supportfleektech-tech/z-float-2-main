import { z } from "zod";
import { normalizeKenyanPhone } from "./phone.js";

export const currencySchema = z.enum(["KES"]);

/** Amount in decimal string form ("1234.50") — validated without floats. */
export const amountDecimalSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Amount must be a valid decimal with up to 2 decimal places");

export const idSchema = z.string().uuid("Invalid identifier");

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency key may contain letters, digits, '._:-' only");

export const emailSchema = z.string().trim().toLowerCase().email("Invalid email address").max(254);

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol");

export const phoneE164Schema = z
  .string()
  .regex(/^\+254\d{9}$/, "Must be a valid Kenyan mobile number (e.g. +254712345678)");

export const phoneInputSchema = z
  .string()
  .transform((v, ctx) => {
    const normalized = normalizeKenyanPhone(v);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a valid Kenyan mobile number" });
      return z.NEVER;
    }
    return normalized;
  })
  .pipe(phoneE164Schema);

export const remarkSchema = z.string().trim().max(500).default("");

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
