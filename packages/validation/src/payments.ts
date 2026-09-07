import { z } from "zod";
import { amountDecimalSchema, currencySchema, idempotencyKeySchema, phoneInputSchema, remarkSchema } from "./common.js";

export const paymentChannels = ["mpesa", "till", "paybill", "bank"] as const;
export const paymentProducts = ["single_payment", "bulk_payment", "bill_payment", "payroll", "airtime", "expense"] as const;

export const paymentChannelSchema = z.enum(paymentChannels);

export const recipientInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: phoneInputSchema.optional(),
  bankAccountName: z.string().trim().min(2).max(200).optional(),
  bankAccountNumber: z.string().trim().min(4).max(40).optional(),
  bankCode: z.string().trim().min(3).max(20).optional(),
  tillNumber: z.string().trim().min(5).max(12).optional(),
  paybillNumber: z.string().trim().min(5).max(12).optional(),
  paybillAccount: z.string().trim().min(1).max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  type: z.enum(["person", "supplier", "employee", "biller"]).default("person"),
  notes: z.string().trim().max(500).optional(),
});

export const createPaymentSchema = z.object({
  amount: amountDecimalSchema,
  currency: currencySchema,
  channel: paymentChannelSchema,
  product: z.enum(paymentProducts).default("single_payment"),
  recipient: recipientInputSchema,
  sourceWalletId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  category: z.string().trim().max(100).optional(),
  remark: remarkSchema,
  idempotencyKey: idempotencyKeySchema,
  scheduleAt: z.string().datetime().optional(),
  attachmentRef: z.string().optional(),
});

export const paymentIdSchema = z.object({
  paymentId: z.string().uuid(),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: idempotencyKeySchema,
});

export const approvePaymentSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(500).optional(),
  idempotencyKey: idempotencyKeySchema,
});
