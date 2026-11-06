/**
 * Accounting connections management
 * GET /api/accounting/connections - List connections
 * DELETE /api/accounting/connections/:id - Disconnect
 */
import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { accountingProviderRegistry } from "@zfloat/accounting";
import { eq, and } from "drizzle-orm";
import { requireUser, apiError, apiOk } from "@/lib/api";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET - List all connections for tenant */
export async function GET(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const tenantId = user!.tenantId!;

  const connections = await db
    .select()
    .from(schema.accountingConnections)
    .where(eq(schema.accountingConnections.tenantId, tenantId))
    .orderBy(schema.accountingConnections.createdAt);

  // Remove sensitive fields
  const safeConnections = connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    status: c.status,
    realmId: c.realmId,
    companyName: c.companyName,
    scopes: c.scopes,
    lastSyncedAt: c.lastSyncedAt,
    lastSyncStatus: c.lastSyncStatus,
    lastSyncError: c.lastSyncError,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return apiOk({ connections: safeConnections });
}

/** DELETE - Disconnect a connection */
export async function DELETE(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const tenantId = user!.tenantId!;

  // Get connection ID from URL
  const url = new URL(request.url);
  const connectionId = url.pathname.split("/").pop();

  if (!connectionId) {
    return apiError(400, "BAD_REQUEST", "Connection ID required");
  }

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

  try {
    // Revoke tokens at provider if connected
    if (connection.status === "CONNECTED" && connection.accessTokenEncrypted) {
      const adapter = accountingProviderRegistry.get(connection.provider as any);
      const { decryptToken } = await import("@zfloat/accounting");
      const accessToken = await decryptToken(connection.accessTokenEncrypted);
      await adapter.revokeToken(accessToken);
    }

    // Delete connection and mappings
    await db.delete(schema.accountingMappings).where(eq(schema.accountingMappings.connectionId, connectionId));
    await db.delete(schema.accountingConnections).where(eq(schema.accountingConnections.id, connectionId));

    return apiOk({ success: true });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to disconnect");
  }
}