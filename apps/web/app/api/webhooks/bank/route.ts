import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { enqueue } from "@zfloat/queue";
import { ingestWebhook } from "@zfloat/payments-core";
import { createProviderRegistry } from "@zfloat/providers";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generic bank/PSP webhook endpoint. */
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
    const result = await ingestWebhook(db, {
      provider: registry.get("bank-psp"),
      rawBody,
      headers,
    });
    if (!result.accepted) return NextResponse.json({ status: "duplicate" }, { status: 200 });
    const [event] = await db.query.webhookEvents.findMany({ orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 1 });
    if (event) {
      await enqueue("webhooks.process", { correlationId: `webhook-${event.id}`, eventId: event.id }, { jobId: `wh-${event.id}` });
    }
    return NextResponse.json({ status: "received" }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ status: "rejected", reason: err instanceof Error ? err.message : "rejected" }, { status: 400 });
  }
}
