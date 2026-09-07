import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { reconcileStatement, type StatementRow } from "@zfloat/payments-core";

/** Minimal RFC-4180-ish CSV parser (quotes + embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function toMinor(value: string): bigint | null {
  const cleaned = value.replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 100));
}

/**
 * POST /api/reconciliation/statement — import a provider/bank statement CSV
 * (columns: provider_reference|ref, amount|amount_minor in KES, date|occurred_at)
 * and match it against tenant payments.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (!csv.trim()) return apiError(400, "CSV_REQUIRED", "Paste the statement CSV to import");

  const rows = parseCsv(csv);
  if (rows.length < 2) return apiError(400, "CSV_EMPTY", "The CSV needs a header row and at least one data row");

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const colRef = header.find((h) => ["provider_reference", "ref", "provider_ref", "transaction_id", "reference"].includes(h));
  const colAmount = header.find((h) => ["amount", "amount_minor", "amount_kes", "value"].includes(h));
  const colDate = header.find((h) => ["date", "occurred_at", "created_at", "transaction_date"].includes(h));
  if (!colRef || !colAmount) {
    return apiError(400, "CSV_HEADER_MISMATCH", "Expected columns: provider_reference, amount (KES), date — got: " + header.join(", "));
  }

  const refIdx = header.indexOf(colRef);
  const amountIdx = header.indexOf(colAmount);
  const dateIdx = colDate ? header.indexOf(colDate) : -1;

  const statementRows: StatementRow[] = [];
  const skipped: string[] = [];
  for (const cells of rows.slice(1)) {
    const ref = String(cells[refIdx] ?? "").trim();
    const amount = toMinor(String(cells[amountIdx] ?? ""));
    const dateRaw = dateIdx >= 0 ? String(cells[dateIdx] ?? "") : "";
    const occurredAt = dateRaw ? new Date(dateRaw) : new Date();
    if (!ref || amount === null || Number.isNaN(occurredAt.getTime())) {
      skipped.push(ref || "?");
      continue;
    }
    statementRows.push({ providerReference: ref, amountMinor: amount, occurredAt });
  }

  if (statementRows.length === 0) return apiError(400, "NO_VALID_ROWS", "No parseable rows (need provider reference + amount)");

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 90 * 86400_000);
  const result = await reconcileStatement(db, { tenantId: user!.tenantId!, periodStart, periodEnd, rows: statementRows, actorId: user!.userId });

  return apiOk({ data: { ...result, skipped: skipped.length, csvRows: rows.length - 1 } });
}
