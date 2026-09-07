import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/**
 * Demo-mode bridge: the invite *token* lives only in the emailed link, but a
 * demo has no real inbox. This endpoint returns the shareable invite link for
 * a pending invitation the current user just created. Production (DEMO_MODE
 * off) always answers 404 — the token is never stored there.
 */
export async function POST(request: NextRequest) {
  const isDemo = process.env.DEMO_MODE === "true";
  if (!isDemo) return apiError(404, "NOT_FOUND", "Not available in production");

  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const body = (await request.json().catch(() => ({}))) as { inviteId?: string };
  const inviteId = String(body.inviteId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return apiError(400, "BAD_REQUEST", "Missing invite id");

  const [invite] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, inviteId)).limit(1);
  if (!invite || invite.invitedById !== user!.userId) {
    return apiError(404, "NOT_FOUND", "No such invitation");
  }
  if (invite.acceptedAt) return apiError(409, "ALREADY_ACCEPTED", "This invitation was already accepted");
  if (!invite.rawToken) return apiError(404, "NOT_FOUND", "No demo token stored for this invitation");

  const baseUrl = process.env.APP_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  return apiOk({
    data: {
      inviteUrl: `${baseUrl}/register?invite=${invite.rawToken}`,
      email: invite.email,
      expiresAt: invite.expiresAt,
    },
  });
}
