/**
 * Accounting sync log
 * GET /api/accounting/sync-log?connectionId=...&limit=50&offset=0
 */
import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { eq, and, desc } from "drizzle-orm";
import { requireUser, apiOk } from "@/lib/api";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const tenantId = user!.tenantId!;

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const conditions = [eq(schema.accountingSyncLog.tenantId, tenantId)];
  if (connectionId) {
    conditions.push(eq(schema.accountingSyncLog.connectionId, connectionId));
  }

  const logs = await db
    .select()
    .from(schema.accountingSyncLog)
    .where(and(...conditions))
    .orderBy(desc(schema.accountingSyncLog.createdAt))
    .limit(limit)
    .offset(offset);

  const total = await db.$count(schema.accountingSyncLog, and(...conditions));

  return apiOk({ logs, total, limit, offset });
}