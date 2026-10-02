import { NextRequest } from "next/server";
import { getDb, schema, desc, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { notifyTicketCreated } from "@zfloat/support/server";

export async function GET() {
  const { response, user } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.supportTickets)
    .where(user!.tenantId ? eq(schema.supportTickets.tenantId, user!.tenantId) : undefined)
    .orderBy(desc(schema.supportTickets.createdAt))
    .limit(50);

  return apiOk({ data: rows });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const subject = String(b.subject ?? "").trim();
  const bodyText = String(b.body ?? "").trim();
  const priority = (String(b.priority ?? "NORMAL").toUpperCase() as "LOW" | "NORMAL" | "HIGH" | "URGENT");

  if (!subject || !bodyText) {
    return apiError(400, "MISSING_FIELDS", "Subject and message are required");
  }

  const [ticket] = await db
    .insert(schema.supportTickets)
    .values({
      tenantId: user!.tenantId ?? null,
      userId: user!.userId,
      subject: subject.slice(0, 300),
      body: bodyText.slice(0, 5000),
      status: "OPEN",
      priority,
    })
    .returning();

  // Notify ticket creator
  await notifyTicketCreated(db, ticket.id, user!.tenantId ?? null, user!.userId, subject);

  return apiOk({ data: ticket }, { status: 201 });
}