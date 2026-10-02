import { NextRequest } from "next/server";
import { getDb, schema, eq, and, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { createWhtRemittance, listWhtRemittances, submitWhtRemittanceToKra, type WhtRemittanceInput } from "@zfloat/etims";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const searchParams = request.nextUrl.searchParams;

  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);
  const status = searchParams.get("status");

  const remittances = await listWhtRemittances(db, user!.tenantId!, { limit, offset, status });

  return apiOk({
    data: remittances.map((r) => ({
      ...r,
      totalWhtMinor: r.totalWhtMinor.toString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? "create");

  if (action === "create") {
    const periodStart = b.periodStart ? new Date(String(b.periodStart)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = b.periodEnd ? new Date(String(b.periodEnd)) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

    const result = await createWhtRemittance(db, {
      tenantId: user!.tenantId!,
      periodStart,
      periodEnd,
      actorId: user!.userId,
    });

    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "wht_remittance.created",
      resourceType: "wht_remittance",
      resourceId: result.remittanceId,
      after: result,
    });

    return apiOk({ data: { ...result, totalWhtMinor: result.totalWhtMinor.toString() } }, { status: 201 });
  }

  if (action === "submit") {
    const remittanceId = String(b.remittanceId ?? "");
    const sourceWalletId = String(b.sourceWalletId ?? "");

    if (!remittanceId) return apiError(400, "MISSING_REMITTANCE_ID", "remittanceId is required");
    if (!sourceWalletId) return apiError(400, "MISSING_WALLET_ID", "sourceWalletId is required");

    const result = await submitWhtRemittanceToKra(db, {
      remittanceId,
      actorId: user!.userId,
      sourceWalletId,
    });

    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "wht_remittance.submitted",
      resourceType: "wht_remittance",
      resourceId: remittanceId,
      after: result,
    });

    return apiOk({ data: result });
  }

  return apiError(400, "INVALID_ACTION", "Supported actions: create, submit");
}