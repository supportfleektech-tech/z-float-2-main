import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { BillerAggregatorProvider } from "@zfloat/providers";

export async function POST(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const billerId = String(b.billerId ?? "");
  const accountRef = String(b.accountRef ?? "");

  if (!billerId || !accountRef) {
    return apiError(400, "MISSING_FIELDS", "billerId and accountRef are required");
  }

  const aggregator = new BillerAggregatorProvider();
  let biller: { id: string; code: string; name: string; category: string | null; channel: string; accountNumber: string } | undefined;
  try {
    const liveBillers = await aggregator.getBillers();
    biller = liveBillers.find((x) => x.id === billerId || x.code === billerId);
  } catch {
    const [row] = await db.select().from(schema.billers).where(eq(schema.billers.id, billerId)).limit(1);
    biller = row;
  }
  if (!biller) return apiError(404, "NOT_FOUND", "Biller not found");

  try {
    const validation = await aggregator.validateAccount(biller.code, accountRef);
    return apiOk({ data: validation });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not configured")) {
      return apiError(503, "AGGREGATOR_UNAVAILABLE", "Biller aggregator not configured");
    }
    return apiError(400, "VALIDATION_FAILED", err instanceof Error ? err.message : "Account validation failed");
  }
}