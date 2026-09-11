import { getDb, schema, eq, count, desc, inArray, and } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  riskTier: z.enum(["STANDARD", "HIGH", "CRITICAL"]).optional(),
  kybStatus: z.enum(["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "REJECTED", "NEEDS_INFO"]).optional(),
  defaultCurrency: z.string().length(3).optional(),
  settings: z.record(z.unknown()).optional(),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const tenantId = params.id;

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) return apiError(404, "NOT_FOUND", "Tenant not found");

  const [wallets, branches, users, recentPayments] = await Promise.all([
    db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).orderBy(desc(schema.wallets.createdAt)),
    db.select().from(schema.branches).where(eq(schema.branches.tenantId, tenantId)).orderBy(desc(schema.branches.createdAt)),
    db.select({
      id: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      status: schema.users.status,
    }).from(schema.users).where(eq(schema.users.tenantId, tenantId)).orderBy(desc(schema.users.createdAt)),
    db.select({
      id: schema.payments.id,
      amountMinor: schema.payments.amountMinor,
      status: schema.payments.status,
      channel: schema.payments.channel,
      createdAt: schema.payments.createdAt,
    }).from(schema.payments).where(eq(schema.payments.tenantId, tenantId)).orderBy(desc(schema.payments.createdAt)).limit(20),
  ]);

  // Get roles for each user
  const userIds = users.map(u => u.id);
  const userRolesMap = new Map<string, string[]>();
  if (userIds.length > 0) {
    const roleRows = await db
      .select({
        userId: schema.userRoles.userId,
        roleName: schema.roles.name,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(
        eq(schema.userRoles.tenantId, tenantId),
        eq(schema.roles.scope, "BUSINESS"),
        inArray(schema.userRoles.userId, userIds),
      ))
    for (const r of roleRows) {
      if (!userRolesMap.has(r.userId)) userRolesMap.set(r.userId, []);
      userRolesMap.get(r.userId)!.push(r.roleName);
    }
  }

  return apiOk({
    data: {
      ...tenant,
      wallets: wallets.map(w => ({
        ...w,
        availableMinor: w.availableMinor.toString(),
        reservedMinor: w.reservedMinor.toString(),
      })),
      branches,
      users: users.map(u => ({
        ...u,
        roles: userRolesMap.get(u.id) ?? [],
      })),
      recentPayments: recentPayments.map(p => ({
        ...p,
        amountMinor: p.amountMinor.toString(),
      })),
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const tenantId = params.id;

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

  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!existing) return apiError(404, "NOT_FOUND", "Tenant not found");

  const data = parsed.data;
  const [updated] = await db
    .update(schema.tenants)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId))
    .returning();

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "tenant.updated",
    resourceType: "tenant",
    resourceId: tenantId,
    before: { status: existing.status, riskTier: existing.riskTier, kybStatus: existing.kybStatus },
    after: data,
  });

  return apiOk({ data: updated });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const tenantId = params.id;

  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!existing) return apiError(404, "NOT_FOUND", "Tenant not found");

  // Check if tenant has payments
  const [paymentCount] = await db.select({ n: count() }).from(schema.payments).where(eq(schema.payments.tenantId, tenantId));
  if (paymentCount && paymentCount.n > 0) {
    return apiError(409, "CONFLICT", "Cannot delete tenant with existing payments. Suspend instead.");
  }

  await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "tenant.deleted",
    resourceType: "tenant",
    resourceId: tenantId,
    before: { name: existing.name, slug: existing.slug },
  });

  return apiOk({ data: { deleted: true } });
}