import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { normalizeKenyanPhone } from "@zfloat/notifications";

export async function POST(request: NextRequest) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const tenantId = String(b.tenantId ?? "").trim();
  const userId = String(b.userId ?? "").trim();
  const name = String(b.name ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  const email = String(b.email ?? "").trim();
  const preferredTime = String(b.preferredTime ?? "").trim();
  const timezone = String(b.timezone ?? "Africa/Nairobi").trim();
  const reason = String(b.reason ?? "").trim();

  if (!tenantId || !userId || !name || !phone || !preferredTime) {
    return apiError(400, "MISSING_FIELDS", "tenantId, userId, name, phone, and preferredTime are required");
  }

  // Validate phone number
  const normalizedPhone = normalizeKenyanPhone(phone);
  if (!normalizedPhone) {
    return apiError(400, "INVALID_PHONE", "Invalid Kenyan phone number format");
  }

  // Validate preferred time is in the future
  const preferred = new Date(preferredTime);
  if (isNaN(preferred.getTime()) || preferred <= new Date()) {
    return apiError(400, "INVALID_TIME", "Preferred time must be in the future");
  }

  // Create callback request
  const [callback] = await db
    .insert(schema.callbackRequests)
    .values({
      tenantId,
      userId,
      name,
      phone: normalizedPhone,
      email: email || null,
      preferredTime: preferred,
      timezone,
      reason: reason || null,
      status: "PENDING",
    })
    .returning();

  // Notify user and agents
  const { notifyCallbackRequested } = await import("@zfloat/support/server");
  await notifyCallbackRequested(db, callback.id, tenantId, userId, name, normalizedPhone, preferred);

  return apiOk({ data: callback }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const userId = searchParams.get("userId");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  if (!tenantId) {
    return apiError(400, "MISSING_TENANT", "tenantId is required");
  }

  const { db } = getDb();

  const conditions = [eq(schema.callbackRequests.tenantId, tenantId)];
  if (userId) conditions.push(eq(schema.callbackRequests.userId, userId));
  if (status) conditions.push(eq(schema.callbackRequests.status, status));

  const callbacks = await db
    .select()
    .from(schema.callbackRequests)
    .where(and(...conditions))
    .orderBy(desc(schema.callbackRequests.createdAt))
    .limit(limit);

  return apiOk({ data: callbacks });
}