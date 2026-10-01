import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk } from "@/lib/api";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const branches = await db
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.tenantId, user!.tenantId!))
    .orderBy(schema.branches.createdAt);

  return apiOk({ data: branches });
}