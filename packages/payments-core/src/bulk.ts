/**
 * Bulk payment batches.
 *
 * Pipeline (workflow.md): Upload -> Scan -> Parse -> Schema Validate ->
 * Row Validate -> Duplicate Detect -> Totals Review -> Submit -> Approval ->
 * Chunked Execution -> Aggregation -> Reconciliation.
 *
 * This module owns the DB side of the pipeline (rows, statuses, totals).
 * Parsing/sanitization of the raw file happens in the file-pipeline layer
 * (see services/worker/files + apps/web upload API).
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { normalizeKenyanPhone } from "@zfloat/validation";
import { createApprovalRequest, evaluatePolicy, type ApprovalRule } from "@zfloat/approvals";
import { enqueueOutbox } from "./outbox.js";
import { generatePaymentNumber } from "./payments.js";

export class BulkError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "BulkError";
  }
}

export interface ParsedBulkRow {
  rowNumber: number;
  recipientName: string;
  phone: string;
  amountMinor: bigint;
  reference?: string;
  category?: string;
}

export interface CreateBatchInput {
  tenantId: string;
  actorId: string;
  name: string;
  channel: "mpesa" | "till" | "paybill";
  product?: "bulk_payment" | "payroll" | "airtime";
  rows: ParsedBulkRow[];
  fileRef?: string;
}

export interface ValidatedBatch {
  batchId: string;
  totalAmountMinor: string;
  validRowCount: number;
  errorRowCount: number;
}

/** Validate + persist a parsed batch. Duplicate detection is per (phone, amount). */
export async function createBatch(db: Db, input: CreateBatchInput): Promise<ValidatedBatch> {
  if (input.rows.length === 0) throw new BulkError("Batch has no rows", "EMPTY_BATCH");
  if (input.rows.length > 50_000) throw new BulkError("Batch exceeds 50,000 rows", "TOO_LARGE");
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(schema.paymentBatches)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        channel: input.channel,
        product: input.product ?? "bulk_payment",
        currency: "KES",
        rowCount: input.rows.length,
        status: "VALIDATED",
        fileRef: input.fileRef,
        createdById: input.actorId,
      })
      .returning();
    if (!batch) throw new BulkError("Failed to create batch", "CREATE_FAILED");

    let total = 0n;
    let valid = 0;
    let errors = 0;
    const seen = new Set<string>();
    for (const row of input.rows) {
      const phone = normalizeKenyanPhone(row.phone);
      let errorMessage: string | null = null;
      if (!phone) errorMessage = "Invalid Kenyan phone number";
      else if (row.amountMinor <= 0n) errorMessage = "Amount must be positive";
      else if (row.amountMinor > 5_000_000_00n) errorMessage = "Amount exceeds per-row limit";
      else if (row.recipientName.trim().length < 2) errorMessage = "Recipient name too short";
      else if (seen.has(`${phone}|${row.amountMinor}`)) errorMessage = "Duplicate row within file";

      if (errorMessage) {
        errors += 1;
        await tx.insert(schema.paymentBatchRows).values({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          recipientName: row.recipientName,
          phone: row.phone,
          amountMinor: row.amountMinor,
          reference: row.reference,
          category: row.category,
          status: "ERROR",
          errorMessage,
        });
        continue;
      }
      seen.add(`${phone}|${row.amountMinor}`);
      valid += 1;
      total += row.amountMinor;
      await tx.insert(schema.paymentBatchRows).values({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        recipientName: row.recipientName,
        phone: phone!,
        amountMinor: row.amountMinor,
        reference: row.reference,
        category: row.category,
        status: "VALID",
      });
    }

    await tx
      .update(schema.paymentBatches)
      .set({ totalAmountMinor: total, validRowCount: valid, errorRowCount: errors })
      .where(eq(schema.paymentBatches.id, batch.id));
    await enqueueOutbox(tx, {
      eventType: "batch.validated",
      aggregateType: "payment_batch",
      aggregateId: batch.id,
      tenantId: input.tenantId,
      payload: { batchId: batch.id, totalAmountMinor: total.toString(), validRowCount: valid, errorRowCount: errors },
    });
    return { batchId: batch.id, totalAmountMinor: total.toString(), validRowCount: valid, errorRowCount: errors };
  });
}

export interface SubmitBatchInput {
  tenantId: string;
  batchId: string;
  actorId: string;
  policyRules?: ApprovalRule[];
}

/** Submit a batch for approval or direct execution. */
export async function submitBatch(db: Db, input: SubmitBatchInput): Promise<{ status: string; approvalRequestId?: string }> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(schema.paymentBatches)
      .where(and(eq(schema.paymentBatches.id, input.batchId), eq(schema.paymentBatches.tenantId, input.tenantId)))
      .for("update");
    if (!batch) throw new BulkError("Batch not found", "BATCH_NOT_FOUND");
    if (batch.status !== "VALIDATED" && batch.status !== "IN_REVIEW") {
      throw new BulkError(`Cannot submit batch in state ${batch.status}`, "INVALID_STATE");
    }
    if (batch.validRowCount === 0) throw new BulkError("Batch has no valid rows", "NO_VALID_ROWS");

    const ctx = {
      amountMinor: BigInt(batch.totalAmountMinor),
      product: (batch.product ?? "bulk_payment") as "bulk_payment" | "payroll" | "airtime",
      channel: batch.channel,
    };
    const rules = input.policyRules ?? [];
    if (evaluatePolicy(rules, ctx).length > 0) {
      const { requestId } = await createApprovalRequest(tx, {
        tenantId: input.tenantId,
        batchId: batch.id,
        rules,
        context: ctx,
        createdById: input.actorId,
      });
      await tx.update(schema.paymentBatches).set({ status: "SUBMITTED" }).where(eq(schema.paymentBatches.id, batch.id));
      await enqueueOutbox(tx, {
        eventType: "batch.submitted",
        aggregateType: "payment_batch",
        aggregateId: batch.id,
        tenantId: input.tenantId,
        payload: { batchId: batch.id, approvalRequestId: requestId },
      });
      return { status: "SUBMITTED", approvalRequestId: requestId };
    }
    await tx.update(schema.paymentBatches).set({ status: "APPROVED" }).where(eq(schema.paymentBatches.id, batch.id));
    await enqueueOutbox(tx, {
      eventType: "batch.approved",
      aggregateType: "payment_batch",
      aggregateId: batch.id,
      tenantId: input.tenantId,
      payload: { batchId: batch.id },
    });
    return { status: "APPROVED" };
  });
}

/** Approve a batch after its approval request resolved. */
export async function approveBatch(db: Db, input: { tenantId: string; batchId: string; actorId: string }) {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(schema.paymentBatches)
      .where(and(eq(schema.paymentBatches.id, input.batchId), eq(schema.paymentBatches.tenantId, input.tenantId)))
      .for("update");
    if (!batch) throw new BulkError("Batch not found", "BATCH_NOT_FOUND");
    if (batch.status !== "SUBMITTED") throw new BulkError(`Cannot approve batch in state ${batch.status}`, "INVALID_STATE");
    await tx.update(schema.paymentBatches).set({ status: "APPROVED" }).where(eq(schema.paymentBatches.id, batch.id));
    await enqueueOutbox(tx, {
      eventType: "batch.approved",
      aggregateType: "payment_batch",
      aggregateId: batch.id,
      tenantId: input.tenantId,
      payload: { batchId: batch.id },
    });
  });
}

/** Fetch the next chunk of valid rows for execution. */
export async function getBatchExecutionChunk(
  db: Db,
  batchId: string,
  opts: { limit?: number } = {},
): Promise<Array<typeof schema.paymentBatchRows.$inferSelect>> {
  return db
    .select()
    .from(schema.paymentBatchRows)
    .where(and(eq(schema.paymentBatchRows.batchId, batchId), eq(schema.paymentBatchRows.status, "VALID")))
    .orderBy(schema.paymentBatchRows.rowNumber)
    .limit(opts.limit ?? 100);
}

export interface ExecuteBatchRowInput {
  tenantId: string;
  batchId: string;
  rowId: string;
  actorId: string;
  providerCode?: string;
  /** fee snapshot is computed at row-payment creation; execution happens via queue */
}

/** Create the individual payment record for a batch row (chunked execution). */
export async function materializeBatchRow(db: Db, input: ExecuteBatchRowInput): Promise<{ paymentId: string; replayed: boolean }> {
  const [row] = await db
    .select()
    .from(schema.paymentBatchRows)
    .where(and(eq(schema.paymentBatchRows.id, input.rowId), eq(schema.paymentBatchRows.batchId, input.batchId)))
    .limit(1);
  if (!row) throw new BulkError("Batch row not found", "ROW_NOT_FOUND");
  if (row.status !== "VALID") throw new BulkError(`Row is not executable (${row.status})`, "ROW_STATE");

  // product travels with the batch (bulk_payment | payroll | airtime)
  const [batchMeta] = await db
    .select({ product: schema.paymentBatches.product })
    .from(schema.paymentBatches)
    .where(eq(schema.paymentBatches.id, input.batchId))
    .limit(1);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.batchId, input.batchId))
      .limit(1);
    void existing;
    // Idempotent per row: unique batch+row payment. Use a deterministic marker.
    const idempotencyKey = `batch:${input.batchId}:row:${row.rowNumber}`;
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        tenantId: input.tenantId,
        paymentNumber: generatePaymentNumber(input.tenantId),
        batchId: input.batchId,
        product: batchMeta?.product ?? "bulk_payment",
        channel: row.phone ? (input.providerCode === "bank-psp" ? "bank" : "mpesa") : "mpesa",
        amountMinor: row.amountMinor,
        feeMinor: 0n,
        totalMinor: row.amountMinor,
        currency: "KES",
        status: "QUEUED",
        beneficiarySnapshot: { name: row.recipientName, phone: row.phone, type: "person" },
        idempotencyKey,
        createdById: input.actorId,
      })
      .returning();
    if (!payment) throw new BulkError("Failed to materialize payment", "CREATE_FAILED");
    await tx
      .update(schema.paymentBatchRows)
      .set({ paymentId: payment.id, status: "PENDING" })
      .where(eq(schema.paymentBatchRows.id, row.id));
    return { paymentId: payment.id, replayed: false };
  });
}

/** Mark a row outcome after its payment resolves. */
export async function markBatchRowOutcome(
  db: Db,
  input: { rowId: string; status: "SUCCESS" | "FAILED" | "SKIPPED"; errorMessage?: string },
): Promise<void> {
  await db
    .update(schema.paymentBatchRows)
    .set({ status: input.status, errorMessage: input.errorMessage })
    .where(eq(schema.paymentBatchRows.id, input.rowId));
}

/** Recompute batch totals/status after execution. */
export async function refreshBatchStatus(db: Db, batchId: string): Promise<void> {
  const rows = await db
    .select({ status: schema.paymentBatchRows.status })
    .from(schema.paymentBatchRows)
    .where(eq(schema.paymentBatchRows.batchId, batchId));
  const succeeded = rows.filter((r) => r.status === "SUCCESS").length;
  const failed = rows.filter((r) => r.status === "FAILED" || r.status === "ERROR").length;
  const pending = rows.filter((r) => r.status === "PENDING" || r.status === "VALID").length;
  let status = "PROCESSING";
  if (pending === 0) {
    status = failed === 0 ? "COMPLETED" : succeeded > 0 ? "PARTIALLY_FAILED" : "FAILED";
  }
  await db.update(schema.paymentBatches).set({ status }).where(eq(schema.paymentBatches.id, batchId));
}
