import { NextRequest } from "next/server";
import { getDb, schema, eq, desc, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { createPayment, submitPayment } from "@zfloat/payments-core";
import { resolveApprovalRulesForSubmit } from "@/lib/approval-gate";
import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "@zfloat/config";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const url = new URL(request.url);
  const ledgerId = url.searchParams.get("ledgerId");
  const exportCsv = url.searchParams.get("export") === "csv";

  const conditions = [eq(schema.charges.tenantId, user!.tenantId!)];
  if (ledgerId) conditions.push(eq(schema.charges.ledgerId, ledgerId));

  const rows = await db
    .select({
      id: schema.charges.id,
      description: schema.charges.description,
      amountMinor: schema.charges.amountMinor,
      category: schema.charges.category,
      ledgerId: schema.charges.ledgerId,
      ledgerName: schema.expenseLedgers.name,
      receiptFileId: schema.charges.receiptFileId,
      receiptFilename: schema.fileObjects.filename,
      createdAt: schema.charges.createdAt,
    })
    .from(schema.charges)
    .leftJoin(schema.expenseLedgers, eq(schema.charges.ledgerId, schema.expenseLedgers.id))
    .leftJoin(schema.fileObjects, eq(schema.charges.receiptFileId, schema.fileObjects.id))
    .where(and(...conditions))
    .orderBy(desc(schema.charges.createdAt))
    .limit(500);

  const data = rows.map((r) => ({
    ...r,
    amountMinor: r.amountMinor.toString(),
  }));

  if (exportCsv) {
    const header = "Description,Category,Ledger,Amount (KES),Receipt,Recorded";
    const lines = data.map((r) =>
      [
        `"${r.description.replace(/"/g, '""')}"`,
        `"${r.category}"`,
        `"${r.ledgerName ?? ""}"`,
        (Number(r.amountMinor) / 100).toFixed(2),
        r.receiptFilename ?? "",
        new Date(r.createdAt).toISOString(),
      ].join(","),
    );
    const csv = [header, ...lines].join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="expenses-${Date.now()}.csv"`,
      },
    });
  }

  return apiOk({ data });
}

/** List expense ledgers for the tenant. */
export async function HEAD() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.expenseLedgers)
    .where(eq(schema.expenseLedgers.tenantId, user!.tenantId!))
    .orderBy(schema.expenseLedgers.name);
  return apiOk({ data: rows });
}

/** Record an expense claim with optional receipt upload; optionally pay from wallet. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const contentType = request.headers.get("content-type") ?? "";
  let description: string;
  let amount: string;
  let payNow: boolean;
  let category: string;
  let ledgerId: string | null;
  let receiptFileId: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return apiError(400, "BAD_REQUEST", "Invalid form data");
    description = String(form.get("description") ?? "");
    amount = String(form.get("amount") ?? "0");
    payNow = form.get("payNow") === "true";
    category = String(form.get("category") ?? "General");
    ledgerId = form.get("ledgerId") ? String(form.get("ledgerId")) : null;

    const file = form.get("receipt");
    if (file && typeof file !== "string") {
      const buf = Buffer.from(await (file as File).arrayBuffer());
      if (buf.length > 0) {
        if (buf.length > MAX_RECEIPT_BYTES) return apiError(413, "FILE_TOO_LARGE", "Receipts are limited to 10 MB.");
        const mime = (file as File).type.toLowerCase();
        const ext = ALLOWED_RECEIPT_MIME[mime];
        if (!ext) return apiError(415, "UNSUPPORTED_TYPE", "Only JPEG, PNG and PDF receipts are accepted.");

        const config = getConfig();
        const storageKey = `receipts/${user!.tenantId}/${randomUUID()}.${ext}`;
        const { getObjectStore } = await import("@zfloat/storage");
        const store = getObjectStore();
        await store.put({ key: storageKey, body: buf, contentType: mime });

        const checksum = createHash("sha256").update(buf).digest("hex");
        const filename = String((file as File).name ?? "receipt").slice(0, 240);
        const [f] = await db
          .insert(schema.fileObjects)
          .values({
            tenantId: user!.tenantId,
            ref: `receipt-${Date.now()}`,
            filename,
            mimeType: mime,
            sizeBytes: buf.length,
            checksumSha256: checksum,
            storageDriver: config.STORAGE_DRIVER,
            storageKey,
            scanStatus: "CLEAN",
            uploadedById: user!.userId,
          })
          .returning();
        receiptFileId = f!.id;
      }
    }
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "BAD_REQUEST", "Invalid JSON body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    description = String(b.description ?? "");
    amount = String(b.amount ?? "0");
    payNow = b.payNow === true;
    category = String(b.category ?? "General");
    ledgerId = b.ledgerId ? String(b.ledgerId) : null;
  }

  if (!description || !amount) return apiError(400, "MISSING_FIELDS", "Description and amount are required");
  if (category.length > 80) return apiError(400, "BAD_CATEGORY", "Category must be 80 characters or fewer");

  if (ledgerId) {
    const [ledger] = await db
      .select()
      .from(schema.expenseLedgers)
      .where(eq(schema.expenseLedgers.id, ledgerId))
      .limit(1);
    if (!ledger || ledger.tenantId !== user!.tenantId) {
      return apiError(400, "BAD_LEDGER", "Invalid ledger");
    }
  }

  try {
    const [charge] = await db
      .insert(schema.charges)
      .values({
        tenantId: user!.tenantId!,
        description,
        amountMinor: BigInt(Math.round(Number(amount) * 100)),
        category,
        ledgerId: ledgerId || undefined,
        receiptFileId: receiptFileId || undefined,
      })
      .returning();
    if (!charge) throw new Error("Failed to record expense");
    if (payNow) {
      const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, user!.tenantId!)).limit(1);
      if (!wallet) throw new Error("No wallet configured");
      const { payment } = await createPayment(db, {
        tenantId: user!.tenantId!,
        actorId: user!.userId,
        amount,
        channel: "mpesa",
        product: "expense",
        sourceWalletId: wallet.id,
        category: "expenses",
        remark: description,
        recipient: { name: "Expense claim" },
        idempotencyKey: `exp-${crypto.randomUUID()}`,
      });
      const policy = await resolveApprovalRulesForSubmit(db, user!.tenantId!);
      if (!policy.ok) throw new Error(policy.message);
      await submitPayment(db, {
        tenantId: user!.tenantId!,
        actorId: user!.userId,
        paymentId: payment.paymentId,
        policyRules: policy.rules,
      });
      return apiOk({ data: { ...charge, amountMinor: charge.amountMinor.toString(), paymentCreated: true } }, { status: 201 });
    }
    return apiOk({ data: { ...charge, amountMinor: charge.amountMinor.toString(), paymentCreated: false } }, { status: 201 });
  } catch (err) {
    return apiError(400, "EXPENSE_FAILED", err instanceof Error ? err.message : "Expense creation failed");
  }
}
