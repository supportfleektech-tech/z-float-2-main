import { getDb, schema, eq, count } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  providerType: z.enum(["mpesa", "bank", "airtime", "sandbox"]).optional(),
  environment: z.enum(["sandbox", "staging", "production"]).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  config: z.record(z.unknown()).optional(),
  maintenance: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const providerId = params.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid update data", parsed.error.flatten().fieldErrors);
  }

  const [existing] = await db.select().from(schema.providers).where(eq(schema.providers.id, providerId)).limit(1);
  if (!existing) return apiError(404, "NOT_FOUND", "Provider not found");

  // Provider code is immutable once created (routes reference it).
  if (typeof (body as Record<string, unknown>)?.code === "string" && (body as Record<string, unknown>).code !== existing.code) {
    return apiError(400, "CODE_IMMUTABLE", "Provider code cannot be changed");
  }

  const [updated] = await db
    .update(schema.providers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.providers.id, providerId))
    .returning();

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "provider.updated",
    resourceType: "provider",
    resourceId: providerId,
    before: { enabled: existing.enabled, maintenance: existing.maintenance, priority: existing.priority },
    after: parsed.data,
  });

  return apiOk({ data: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const providerId = params.id;

  const [existing] = await db.select().from(schema.providers).where(eq(schema.providers.id, providerId)).limit(1);
  if (!existing) return apiError(404, "NOT_FOUND", "Provider not found");

  const [routeCount] = await db.select({ n: count() }).from(schema.paymentRoutes).where(eq(schema.paymentRoutes.providerId, providerId));
  if (routeCount && routeCount.n > 0) {
    return apiError(409, "CONFLICT", "Cannot delete provider with active payment routes. Disable it instead.");
  }

  await db.delete(schema.providers).where(eq(schema.providers.id, providerId));

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "provider.deleted",
    resourceType: "provider",
    resourceId: providerId,
    before: { code: existing.code, name: existing.name },
  });

  return apiOk({ data: { deleted: true } });
}
