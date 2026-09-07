/**
 * Provider webhook gateway — one endpoint per provider.
 * Pipeline: verify → persist raw event → dedupe → enqueue async processing →
 * ack quickly. Processing happens on the webhooks.process queue.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { enqueue } from "@zfloat/queue";
import { ingestWebhook } from "@zfloat/payments-core";
import { createProviderRegistry } from "@zfloat/providers";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await secretsReady();
  const registry = createProviderRegistry();
  const rawBody = await request.text();
  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const { db } = getDb();
  try {
    // Use the M-Pesa provider for this webhook endpoint (not the mock)
    const result = await ingestWebhook(db, {
      provider: registry.get("mpesa-safaricom"),
      rawBody,
      headers,
    });
    if (!result.accepted) {
      // duplicate — ack silently (provider must not retry forever)
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }
    // find the stored event and enqueue processing
    const [event] = await db.query.webhookEvents.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 1,
    });
    if (event) {
      await enqueue("webhooks.process", { correlationId: `webhook-${event.id}`, eventId: event.id }, { jobId: `wh-${event.id}` });
    }
    return NextResponse.json({ status: "received" }, { status: 200 });
  } catch (err) {
    // Unverifiable webhooks are logged (raw payload persisted before verification
    // failures for forensics) and rejected.
    return NextResponse.json({ status: "rejected", reason: err instanceof Error ? err.message : "rejected" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "zfloat-webhook-gateway" });
}
