/**
 * Accounting mappings management
 * GET /api/accounting/mappings?connectionId=...
 * POST /api/accounting/mappings - Create/update mappings
 * DELETE /api/accounting/mappings/:id - Delete mapping
 */
import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { eq, and, inArray } from "drizzle-orm";
import { requireUser, apiError, apiOk } from "@/lib/api";
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

  if (!connectionId) {
    return apiError(400, "BAD_REQUEST", "connectionId required");
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

  const mappings = await db
    .select()
    .from(schema.accountingMappings)
    .where(eq(schema.accountingMappings.connectionId, connectionId))
    .orderBy(schema.accountingMappings.createdAt);

  return apiOk({ mappings });
}

export async function POST(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const userId = user!.userId;
  const tenantId = user!.tenantId!;

  try {
    const body = await request.json();
    const { connectionId, mappings } = body as {
      connectionId: string;
      mappings: Array<{
        id?: string;
        chartAccountId?: string;
        ledgerAccountId?: string;
        externalAccountId: string;
        externalAccountName: string;
        externalAccountCode?: string;
        externalAccountType: string;
        direction?: "OUTBOUND" | "INBOUND" | "BIDIRECTIONAL";
        isActive?: boolean;
      }>;
    };

    if (!connectionId || !mappings?.length) {
      return apiError(400, "BAD_REQUEST", "connectionId and mappings required");
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

    // Upsert mappings
    const results = [];
    for (const m of mappings) {
      if (m.id) {
        // Update
        const [updated] = await db
          .update(schema.accountingMappings)
          .set({
            chartAccountId: m.chartAccountId,
            ledgerAccountId: m.ledgerAccountId,
            externalAccountId: m.externalAccountId,
            externalAccountName: m.externalAccountName,
            externalAccountCode: m.externalAccountCode,
            externalAccountType: m.externalAccountType,
            direction: m.direction ?? "OUTBOUND",
            isActive: m.isActive ?? true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.accountingMappings.id, m.id),
              eq(schema.accountingMappings.connectionId, connectionId),
            ),
          )
          .returning();
        results.push(updated);
      } else {
        // Insert
        const [inserted] = await db
          .insert(schema.accountingMappings)
          .values({
            tenantId,
            connectionId,
            chartAccountId: m.chartAccountId,
            ledgerAccountId: m.ledgerAccountId,
            externalAccountId: m.externalAccountId,
            externalAccountName: m.externalAccountName,
            externalAccountCode: m.externalAccountCode,
            externalAccountType: m.externalAccountType,
            direction: m.direction ?? "OUTBOUND",
            isActive: m.isActive ?? true,
            createdById: userId,
          })
          .returning();
        results.push(inserted);
      }
    }

    return apiOk({ mappings: results });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to save mappings");
  }
}

export async function DELETE(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const tenantId = user!.tenantId!;

  const url = new URL(request.url);
  const mappingId = url.pathname.split("/").pop();

  if (!mappingId) {
    return apiError(400, "BAD_REQUEST", "Mapping ID required");
  }

  const [mapping] = await db
    .select()
    .from(schema.accountingMappings)
    .where(eq(schema.accountingMappings.id, mappingId))
    .limit(1);

  if (!mapping) {
    return apiError(404, "NOT_FOUND", "Mapping not found");
  }

  // Verify tenant access via connection
  const [connection] = await db
    .select()
    .from(schema.accountingConnections)
    .where(
      and(
        eq(schema.accountingConnections.id, mapping.connectionId),
        eq(schema.accountingConnections.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  await db.delete(schema.accountingMappings).where(eq(schema.accountingMappings.id, mappingId));

  return apiOk({ success: true });
}