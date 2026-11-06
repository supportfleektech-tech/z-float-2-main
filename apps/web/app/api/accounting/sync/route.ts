/**
 * Manual accounting sync trigger
 * POST /api/accounting/sync
 * Body: { connectionId: string, syncType: "PAYMENT" | "INVOICE" | "JOURNAL_ENTRY" | "FULL" | "ETIMS", entityId?: string }
 */
import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { enqueueSync, enqueueFullSync, type SyncJobPayload, type FullSyncJobPayload } from "@zfloat/accounting";
import { eq, and } from "drizzle-orm";
import { requireUser, apiError, apiOk } from "@/lib/api";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const userId = user!.userId;
  const tenantId = user!.tenantId!;

  try {
    const body = await request.json();
    const { connectionId, syncType, entityId } = body as {
      connectionId: string;
      syncType: "PAYMENT" | "INVOICE" | "JOURNAL_ENTRY" | "FULL" | "ETIMS";
      entityId?: string;
    };

    if (!connectionId || !syncType) {
      return apiError(400, "BAD_REQUEST", "connectionId and syncType required");
    }

    // Verify connection belongs to tenant
    const [connection] = await db
      .select()
      .from(schema.accountingConnections)
      .where(
        and(
          eq(schema.accountingConnections.id, connectionId),
          eq(schema.accountingConnections.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!connection) {
      return apiError(404, "NOT_FOUND", "Connection not found");
    }

    if (connection.status !== "CONNECTED") {
      return apiError(400, "BAD_REQUEST", "Connection not active");
    }

    const correlationId = `manual-${connectionId}-${syncType}-${Date.now()}`;

    let jobId: string;
    if (syncType === "FULL") {
      jobId = await enqueueFullSync({
        correlationId,
        tenantId,
        connectionId,
        syncTypes: ["PAYMENT", "INVOICE", "JOURNAL_ENTRY"],
      } as FullSyncJobPayload);
    } else {
      jobId = await enqueueSync({
        correlationId,
        tenantId,
        connectionId,
        syncType,
        entityId,
        entityType: syncType === "PAYMENT" ? "payment" : syncType === "INVOICE" ? "invoice" : "journal",
        triggeredBy: userId,
      } as SyncJobPayload);
    }

    return apiOk({ jobId, correlationId });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to start sync");
  }
}