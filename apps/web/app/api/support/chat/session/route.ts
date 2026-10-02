import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and, sql } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function GET(request: NextRequest) {
  const { response, user } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const userId = searchParams.get("userId");

  if (!tenantId || !userId) {
    return apiError(400, "MISSING_PARAMS", "tenantId and userId are required");
  }

  const { db } = getDb();

  // Find existing active session for this user
  const [existingSession] = await db
    .select()
    .from(schema.supportChatSessions)
    .where(
      and(
        eq(schema.supportChatSessions.tenantId, tenantId),
        eq(schema.supportChatSessions.userId, userId),
        sql`${schema.supportChatSessions.status} IN ('WAITING', 'ACTIVE')`
      )
    )
    .orderBy(desc(schema.supportChatSessions.createdAt))
    .limit(1);

  if (existingSession) {
    // Load messages for this session
    const messages = await db
      .select()
      .from(schema.supportChatMessages)
      .where(eq(schema.supportChatMessages.sessionId, existingSession.id))
      .orderBy(schema.supportChatMessages.createdAt);

    return apiOk({ data: { session: existingSession, messages } });
  }

  return apiOk({ data: { session: null, messages: [] } });
}

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
  const userName = String(b.userName ?? "").trim();
  const userEmail = String(b.userEmail ?? "").trim();
  const userPhone = String(b.userPhone ?? "").trim();

  if (!tenantId || !userId || !userName || !userEmail) {
    return apiError(400, "MISSING_FIELDS", "tenantId, userId, userName, and userEmail are required");
  }

  // Check for existing active session
  const [existingSession] = await db
    .select()
    .from(schema.supportChatSessions)
    .where(
      and(
        eq(schema.supportChatSessions.tenantId, tenantId),
        eq(schema.supportChatSessions.userId, userId),
        sql`${schema.supportChatSessions.status} IN ('WAITING', 'ACTIVE')`
      )
    )
    .orderBy(desc(schema.supportChatSessions.createdAt))
    .limit(1);

  if (existingSession) {
    const messages = await db
      .select()
      .from(schema.supportChatMessages)
      .where(eq(schema.supportChatMessages.sessionId, existingSession.id))
      .orderBy(schema.supportChatMessages.createdAt);

    return apiOk({ data: { session: existingSession, messages } });
  }

  // Find available agent
  const [agent] = await db
    .select()
    .from(schema.supportAgents)
    .where(
      and(
        eq(schema.supportAgents.isActive, true),
        sql`${schema.supportAgents.currentChats} < ${schema.supportAgents.maxConcurrentChats}`
      )
    )
    .orderBy(schema.supportAgents.currentChats)
    .limit(1);

  // Create new chat session
  const [session] = await db
    .insert(schema.supportChatSessions)
    .values({
      tenantId,
      userId,
      agentId: agent?.id ?? null,
      status: agent ? "ACTIVE" : "WAITING",
      subject: "Support Chat",
      priority: "NORMAL",
      startedAt: new Date(),
    })
    .returning();

  // If agent assigned, increment their currentChats
  if (agent) {
    await db
      .update(schema.supportAgents)
      .set({ currentChats: sql`${schema.supportAgents.currentChats} + 1` })
      .where(eq(schema.supportAgents.id, agent.id));
  }

  // Send system message
  await db.insert(schema.supportChatMessages).values({
    sessionId: session.id,
    authorUserId: null,
    authorIsAgent: false,
    body: agent
      ? `You're now connected with ${agent.displayName}. How can we help you today?`
      : "You're in the queue. An agent will be with you shortly.",
  });

  // Notify user and agent
  const { notifyChatStarted } = await import("@zfloat/support/server");
  await notifyChatStarted(db, session.id, tenantId, userId, agent?.id ?? null);

  return apiOk({ data: { session, messages: [] } }, { status: 201 });
}