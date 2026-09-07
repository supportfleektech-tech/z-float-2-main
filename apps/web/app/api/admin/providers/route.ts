
import { getDb, schema, desc } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";

export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const rows = await db.select().from(schema.providers).orderBy(desc(schema.providers.createdAt));
  return apiOk({ data: rows });
}
