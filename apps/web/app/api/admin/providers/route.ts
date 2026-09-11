
import { getDb, schema, desc, eq } from "@zfloat/database";
import { requirePlatformAdmin, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { z } from "zod";

const providerSchema = z.object({
  code: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(200),
  providerType: z.enum(["mpesa", "bank", "airtime", "sandbox"]),
  environment: z.enum(["sandbox", "staging", "production"]).default("sandbox"),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  config: z.record(z.unknown()).default({}),
  maintenance: z.boolean().default(false),
});

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.providers).orderBy(desc(schema.providers.createdAt));
  return apiOk({ data: rows });
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

  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid provider data", parsed.error.flatten().fieldErrors);
  }

  const [existing] = await db.select().from(schema.providers).where(eq(schema.providers.code, parsed.data.code)).limit(1);
  if (existing) {
    return apiError(409, "CONFLICT", "Provider code already exists");
  }

  const [provider] = await db.insert(schema.providers).values(parsed.data).returning();
  if (!provider) return apiError(500, "CREATE_FAILED", "Could not create provider");

  await writeAuditEvent(db, {
    actorId: user!.userId,
    actorRole: "platform_admin",
    action: "provider.created",
    resourceType: "provider",
    resourceId: provider.id,
    after: { code: provider.code, name: provider.name },
  });

  return apiOk({ data: provider }, { status: 201 });
}
