import { NextRequest } from "next/server";
import { getDb, schema, eq, and, desc, gte, lte } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { listWhtCertificates } from "@zfloat/etims";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const searchParams = request.nextUrl.searchParams;

  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);
  const status = searchParams.get("status");
  const fromDate = searchParams.get("fromDate") ? new Date(searchParams.get("fromDate")!) : undefined;
  const toDate = searchParams.get("toDate") ? new Date(searchParams.get("toDate")!) : undefined;

  const certificates = await listWhtCertificates(db, user!.tenantId!, {
    limit,
    offset,
    status,
    fromDate,
    toDate,
  });

  return apiOk({
    data: certificates.map((c) => ({
      ...c,
      grossAmountMinor: c.grossAmountMinor.toString(),
      whtAmountMinor: c.whtAmountMinor.toString(),
      netAmountMinor: c.netAmountMinor.toString(),
    })),
  });
}