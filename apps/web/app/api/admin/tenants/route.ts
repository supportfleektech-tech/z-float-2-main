import { getDb, schema, eq, count, desc, sum, ilike, or, and, inArray } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { z } from "zod";

const tenantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]).default("PENDING"),
  riskTier: z.enum(["STANDARD", "HIGH", "CRITICAL"]).default("STANDARD"),
  kybStatus: z.enum(["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "REJECTED", "NEEDS_INFO"]).default("NOT_SUBMITTED"),
  defaultCurrency: z.string().length(3).default("KES"),
  settings: z.record(z.unknown()).default({}),
});

export async function GET(req: Request) {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "ALL";
  const offset = (page - 1) * limit;

  const whereConditions = [];
  if (search) {
    whereConditions.push(or(
      ilike(schema.tenants.name, `%${search}%`),
      ilike(schema.tenants.slug, `%${search}%`)
    ));
  }
  if (status !== "ALL") {
    whereConditions.push(eq(schema.tenants.status, status));
  }

  const [tenants, totalResult] = await Promise.all([
    db
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
        slug: schema.tenants.slug,
        status: schema.tenants.status,
        riskTier: schema.tenants.riskTier,
        kybStatus: schema.tenants.kybStatus,
        defaultCurrency: schema.tenants.defaultCurrency,
        createdAt: schema.tenants.createdAt,
      })
      .from(schema.tenants)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ n: count() })
      .from(schema.tenants)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined),
  ]);

  const tenantIds = tenants.map(t => t.id);
  let userMap = new Map<string | null, number>();
  let paymentMap = new Map<string, { n: number; total: bigint }>();

  if (tenantIds.length > 0) {
    const [userCounts, paymentAgg] = await Promise.all([
      db
        .select({ tenantId: schema.users.tenantId, n: count() })
        .from(schema.users)
        .where(inArray(schema.users.tenantId, tenantIds))
        .groupBy(schema.users.tenantId),
      db
        .select({
          tenantId: schema.payments.tenantId,
          n: count(),
          total: sum(schema.payments.amountMinor),
        })
        .from(schema.payments)
        .where(and(inArray(schema.payments.tenantId, tenantIds), eq(schema.payments.status, "SUCCESS")))
        .groupBy(schema.payments.tenantId),
    ]);
    userMap = new Map(userCounts.map(r => [r.tenantId, r.n]));
    paymentMap = new Map(paymentAgg.map(r => [r.tenantId, { n: r.n, total: BigInt(r.total ?? 0) }]));
  }

  return apiOk({
    data: {
      tenants: tenants.map(t => ({
        ...t,
        userCount: userMap.get(t.id) ?? 0,
        paymentCount: paymentMap.get(t.id)?.n ?? 0,
        volumeMinor: (paymentMap.get(t.id)?.total ?? 0n).toString(),
      })),
      total: totalResult[0]?.n ?? 0,
    },
  });
}

export async function POST(req: Request) {
  const { user, response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const parsed = tenantSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid tenant data", parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;

  // Check slug uniqueness
  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, data.slug)).limit(1);
  if (existing) {
    return apiError(409, "CONFLICT", "Slug already exists");
  }

  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: data.name,
      slug: data.slug,
      status: data.status,
      riskTier: data.riskTier,
      kybStatus: data.kybStatus,
      defaultCurrency: data.defaultCurrency,
      settings: data.settings,
    })
    .returning();

  const created = tenant;
  if (!created) return apiError(500, "CREATE_FAILED", "Could not create tenant");

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "tenant.created",
    resourceType: "tenant",
    resourceId: created.id,
    after: { name: created.name, slug: created.slug },
  });

  return apiOk({ data: created }, { status: 201 });
}