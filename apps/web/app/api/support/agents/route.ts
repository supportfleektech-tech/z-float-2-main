import { NextRequest } from "next/server";
import { getDb, schema, desc, eq, and, sql } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function GET() {
  const { response, user } = await requireUser();
  if (response) return response;

  const { db } = getDb();

  // Check if user is an agent
  const [agentRecord] = await db
    .select()
    .from(schema.supportAgents)
    .where(eq(schema.supportAgents.userId, user!.userId))
    .limit(1);

  if (!agentRecord) {
    return apiError(403, "NOT_AGENT", "User is not a support agent");
  }

  // Get all agents for this tenant
  const agents = await db
    .select()
    .from(schema.supportAgents)
    .where(agentRecord.tenantId ? eq(schema.supportAgents.tenantId, agentRecord.tenantId) : undefined)
    .orderBy(schema.supportAgents.displayName);

  return apiOk({ data: agents });
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
  const displayName = String(b.displayName ?? "").trim();
  const email = String(b.email ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  const isPlatform = Boolean(b.isPlatform);
  const maxConcurrentChats = parseInt(String(b.maxConcurrentChats ?? "3"));
  const skills = Array.isArray(b.skills) ? b.skills.map(String) : [];
  const workingHours = b.workingHours ?? {};

  if (!tenantId || !userId || !displayName || !email) {
    return apiError(400, "MISSING_FIELDS", "tenantId, userId, displayName, and email are required");
  }

  // Check if user already has an agent profile
  const [existing] = await db
    .select()
    .from(schema.supportAgents)
    .where(eq(schema.supportAgents.userId, userId))
    .limit(1);

  if (existing) {
    return apiError(400, "AGENT_EXISTS", "User already has an agent profile");
  }

  const [agent] = await db
    .insert(schema.supportAgents)
    .values({
      tenantId: tenantId || null,
      userId,
      displayName,
      email,
      phone: phone || null,
      isPlatform,
      maxConcurrentChats,
      skills,
      workingHours: workingHours as Record<string, { start: string; end: string }>,
    })
    .returning();

  return apiOk({ data: agent }, { status: 201 });
}