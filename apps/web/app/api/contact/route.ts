import { NextRequest } from "next/server";
import { getDb, schema } from "@zfloat/database";
import { rateLimit, apiOk, apiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await rateLimit(`contact:${ip}`, {
    windowMs: 60_000,
    max: 5,
  });
  if (!allowed)
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many messages — try again shortly",
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "")
    .trim()
    .slice(0, 200);
  const email = String(b.email ?? "")
    .trim()
    .slice(0, 254);
  const message = String(b.message ?? "")
    .trim()
    .slice(0, 5000);
  if (!name || !email || !message)
    return apiError(
      400,
      "MISSING_FIELDS",
      "Name, email and message are required",
    );

  const { db } = getDb();
  await db.insert(schema.supportTickets).values({
    tenantId: null, // no tenant — public contact
    userId: null,
    subject: `Contact form: ${name}`,
    body: `From: ${name} <${email}>\n\n${message}`,
    status: "OPEN",
    priority: "NORMAL",
  });
  return apiOk({ data: { ok: true } }, { status: 201 });
}
