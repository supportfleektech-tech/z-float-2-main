import { NextRequest } from "next/server";
import { getDb, schema, eq, and, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  // Verify user has access to this session
  const [session] = await db
    .select()
    .from(schema.supportChatSessions)
    .where(eq(schema.supportChatSessions.id, id))
    .limit(1);

  if (!session) {
    return apiError(404, "NOT_FOUND", "Chat session not found");
  }

  if (session.tenantId && session.tenantId !== user?.tenantId) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  // User can only access their own sessions unless they're an agent
  const isAgent = session.agentId
    ? await isUserAgent(db, user?.userId!, session.agentId)
    : false;

  if (session.userId !== user?.userId && !isAgent) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  const messages = await db
    .select()
    .from(schema.supportChatMessages)
    .where(eq(schema.supportChatMessages.sessionId, id))
    .orderBy(schema.supportChatMessages.createdAt);

  return apiOk({ data: messages });
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

  if (!bodyText) {
    return apiError(400, "MISSING_BODY", "Message body is required");
  }

  // Verify session exists and user has access
  const [session] = await db
    .select()
    .from(schema.supportChatSessions)
    .where(eq(schema.supportChatSessions.id, id))
    .limit(1);

  if (!session) {
    return apiError(404, "NOT_FOUND", "Chat session not found");
  }

  if (session.tenantId && session.tenantId !== user?.tenantId) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  const isAgent = session.agentId
    ? await isUserAgent(db, user?.userId!, session.agentId)
    : false;

  if (session.userId !== user?.userId && !isAgent) {
    return apiError(403, "FORBIDDEN", "Access denied");
  }

  if (session.status === "ENDED") {
    return apiError(400, "SESSION_ENDED", "Cannot send messages to ended session");
  }

  // Create message
  const [message] = await db
    .insert(schema.supportChatMessages)
    .values({
      sessionId: id,
      authorUserId: user?.userId,
      authorIsAgent: isAgent,
      body: bodyText,
    })
    .returning();

  // Update session updatedAt
  await db
    .update(schema.supportChatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(schema.supportChatSessions.id, id));

  // Notify the other party
  const recipientId = isAgent ? session.userId : session.agentId;
  if (recipientId) {
    const { notifyChatMessage } = await import("@zfloat/support/server");
    await notifyChatMessage(db, id, session.tenantId!, recipientId, isAgent, bodyText.slice(0, 100));
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