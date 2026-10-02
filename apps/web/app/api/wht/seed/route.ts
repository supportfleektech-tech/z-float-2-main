import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { seedDefaultWhtRules } from "@zfloat/etims";

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
  const effectiveFrom = b.effectiveFrom ? new Date(String(b.effectiveFrom)) : new Date("2024-01-01");

  await seedDefaultWhtRules(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    effectiveFrom,
  });

  await writeAuditEvent(db, {
    tenantId: user!.tenantId!,
    actorId: user!.userId,
    action: "wht_rules.seeded",
    resourceType: "wht_rule",
    after: { effectiveFrom: effectiveFrom.toISOString() },
  });

  return apiOk({ data: { success: true, message: "Default Kenya WHT rules seeded" } });
}