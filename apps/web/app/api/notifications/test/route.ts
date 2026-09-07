import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { queueNotification } from "@zfloat/notifications";

/**
 * POST /api/notifications/test — send a test EMAIL/SMS to the current user
 * through the configured channel driver (sink/smtp/console/http). Lets the
 * demo prove the full out-of-band delivery path from the UI.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as { channel?: string };
  const channel = String(body.channel ?? "").toUpperCase();
  if (channel !== "EMAIL" && channel !== "SMS") {
    return apiError(400, "INVALID_CHANNEL", "channel must be EMAIL or SMS");
  }

  const id = await queueNotification(db, {
    tenantId: user!.tenantId!,
    userId: user!.userId,
    channel,
    title: channel === "EMAIL" ? "Z-float test message" : undefined,
    body: `This is a test ${channel} from Z-float — your channel configuration is working.${
      channel === "SMS" ? " (Sent via the configured SMS gateway.)" : ""
    }`,
    data: { reason: "test-send" },
  });

  return apiOk({ data: { id, channel, note: "Queued — the worker delivers it through the configured channel driver." } });
}
