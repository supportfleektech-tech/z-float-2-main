import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { notifyTicketMessage, notifyTicketStatusChange } from "@zfloat/support/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  const [ticket] = await db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.id, id))
    .limit(1);

  if (!ticket) {
    return apiError(404, "NOT_FOUND", "Ticket not found");
  }

  if (ticket.tenantId && ticket.tenantId !== user?.tenantId) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  // Check if user owns the ticket or is an agent
  const isOwner = ticket.userId === user?.userId;
  const isAgent = ticket.assignedToId
    ? await isUserAgent(db, user?.userId!, ticket.assignedToId)
    : false;

  if (!isOwner && !isAgent) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  const messages = await db
    .select()
    .from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, id))
    .orderBy(schema.ticketMessages.createdAt);

  return apiOk({ data: { ticket, messages } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const bodyText = String(b.body ?? "").trim();
  const action = String(b.action ?? "reply"); // reply, status_change
  const newStatus = String(b.status ?? "").trim();

  if (!bodyText && action !== "status_change") {
    return apiError(400, "MISSING_BODY", "Message body is required");
  }

  const [ticket] = await db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.id, id))
    .limit(1);

  if (!ticket) {
    return apiError(404, "NOT_FOUND", "Ticket not found");
  }

  if (ticket.tenantId && ticket.tenantId !== user?.tenantId) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  const isOwner = ticket.userId === user?.userId;
  const isAgent = ticket.assignedToId
    ? await isUserAgent(db, user?.userId!, ticket.assignedToId)
    : false;

  if (!isOwner && !isAgent) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  if (action === "status_change" && newStatus && isAgent) {
    const oldStatus = ticket.status;
    if (oldStatus !== newStatus) {
      await db
        .update(schema.supportTickets)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(schema.supportTickets.id, id));

      // Notify user of status change
      await notifyTicketStatusChange(db, id, ticket.tenantId!, ticket.userId!, oldStatus, newStatus);

      const [updated] = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, id))
        .limit(1);

      return apiOk({ data: updated });
    }
    return apiOk({ data: ticket });
  }

  // Add message
  const [message] = await db
    .insert(schema.ticketMessages)
    .values({
      ticketId: id,
      authorUserId: user?.userId,
      authorIsAdmin: isAgent,
      body: bodyText,
    })
    .returning();

  // Update ticket status if it was OPEN
  if (ticket.status === "OPEN") {
    await db
      .update(schema.supportTickets)
      .set({ status: "IN_PROGRESS", updatedAt: new Date() })
      .where(eq(schema.supportTickets.id, id));
  }

  // Notify the other party
  const recipientId = isAgent ? ticket.userId : ticket.assignedToId;
  if (recipientId) {
    await notifyTicketMessage(db, id, ticket.tenantId!, recipientId, isAgent, bodyText.slice(0, 100));
  }

  return apiOk({ data: message }, { status: 201 });
}

async function isUserAgent(db: any, userId: string, agentId: string): Promise<boolean> {
  const [agent] = await db
    .select()
    .from(schema.supportAgents)
    .where(and(eq(schema.supportAgents.id, agentId), eq(schema.supportAgents.userId, userId)))
    .limit(1);
  return !!agent;
}