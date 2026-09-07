
import { getDb, schema, eq } from "@zfloat/database";
import { apiOk } from "@/lib/api";

/**
 * Public content API — drives the marketing site from DB (pages + settings),
 * so platform admins can change pricing tokens, copy and FAQs without a deploy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("page") ?? "pricing";
  const { db } = getDb();

  const [page] = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug))
    .limit(1);

  const settingsRows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.scope, "GLOBAL"));

  const settings: Record<string, unknown> = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  return apiOk({ data: { page: page ?? null, settings } });
}
