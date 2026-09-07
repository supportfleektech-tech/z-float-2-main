
import { getDb, schema, eq } from "@zfloat/database";

export interface SiteContent {
  page: { slug: string; title: string; content: unknown } | null;
  settings: Record<string, unknown>;
}

/** Shared server-side read of admin-editable marketing content (pages + GLOBAL settings). */
export async function getSiteContent(pageSlug?: string): Promise<SiteContent> {
  const { db } = getDb();
  const [page] = pageSlug
    ? await db.select().from(schema.pages).where(eq(schema.pages.slug, pageSlug)).limit(1)
    : [];
  const settingsRows = await db.select().from(schema.settings).where(eq(schema.settings.scope, "GLOBAL"));
  const settings: Record<string, unknown> = {};
  for (const s of settingsRows) settings[s.key] = s.value;
  let content: unknown = null;
  if (page) {
    try {
      content = JSON.parse(page.content);
    } catch {
      content = page.content;
    }
  }
  return { page: page ? { slug: page.slug, title: page.title, content } : null, settings };
}
