/**
 * Zoho Books webhook endpoint
 * POST /api/accounting/webhooks/zoho
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { accountingProviderRegistry } from "@zfloat/accounting";
import { enqueue } from "@zfloat/queue";
import { eq } from "drizzle-orm";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await secretsReady();

  const rawBody = await request.text();
  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const { db } = getDb();

  try {
    const adapter = accountingProviderRegistry.get("zoho");
    const verified = await adapter.verifyWebhook({ rawBody, headers });

    if (!verified.valid) {
      return NextResponse.json({ status: "rejected", reason: "Invalid signature" }, { status: 400 });
    }

    // Find connection by organization_id
    const orgId = verified.data?.organization_id as string | undefined;
    if (!orgId) {
      return NextResponse.json({ status: "rejected", reason: "Missing organization_id" }, { status: 400 });
    }

    const [connection] = await db
      .select()
      .from(schema.accountingConnections)
      .where(eq(schema.accountingConnections.realmId, orgId))
      .limit(1);

    if (!connection) {
      return NextResponse.json({ status: "rejected", reason: "Connection not found" }, { status: 404 });
    }

    const [event] = await db
      .insert(schema.accountingSyncLog)
      .values({
        tenantId: connection.tenantId,
        connectionId: connection.id,
        syncType: "INVOICE",
        status: "COMPLETED",
        providerReference: verified.providerEventId,
        externalId: verified.providerEventId,
        requestPayload: verified.data,
        responsePayload: {},
        completedAt: new Date(),
      })
      .returning();

    if (event) {
      await enqueue("accounting.sync", {
        correlationId: `webhook-zoho-${event.id}`,
        tenantId: connection.tenantId,
        connectionId: connection.id,
        syncType: "FULL",
      } as any, { jobId: `webhook-zoho-${event.id}` });
    }

    return NextResponse.json({ status: "received" }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { status: "rejected", reason: err instanceof Error ? err.message : "rejected" },
      { status: 400 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "zfloat-zoho-webhook" });
}