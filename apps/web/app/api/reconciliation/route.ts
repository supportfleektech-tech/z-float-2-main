import { desc, eq } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { apiOk } from "@/lib/api";
import { reconApiContext } from "@/lib/recon-api";

/** GET /api/reconciliation — recent recon exceptions, newest first.
 *
 * Tenant members: their own tenant only (pre-existing behaviour).
 * Platform admins: `?scope=all` returns exceptions across every tenant with
 * the tenant name, powering the /admin/reconciliation view.
 */
export async function GET(req: Request) {
  const guard = await reconApiContext(false);
  if ("response" in guard) return guard.response;
  const { db, tenantId, isPlatformAdmin } = guard.ctx;
  const url = new URL(req.url);
  const scopeAll = isPlatformAdmin && url.searchParams.get("scope") === "all";

  const rows = await db
    .select({
      id: schema.reconExceptions.id,
      tenantId: schema.reconExceptions.tenantId,
      tenantName: schema.tenants.name,
      kind: schema.reconExceptions.kind,
      severity: schema.reconExceptions.severity,
      status: schema.reconExceptions.status,
      resolution: schema.reconExceptions.resolution,
      resolvedAt: schema.reconExceptions.resolvedAt,
      providerReference: schema.reconItems.providerReference,
      amountMinor: schema.reconItems.amountMinor,
      createdAt: schema.reconExceptions.createdAt,
    })
    .from(schema.reconExceptions)
    .leftJoin(schema.reconItems, eq(schema.reconItems.id, schema.reconExceptions.itemId))
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.reconExceptions.tenantId))
    .where(scopeAll ? undefined : eq(schema.reconExceptions.tenantId, tenantId!))
    .orderBy(desc(schema.reconExceptions.createdAt))
    .limit(100);

  return apiOk({
    data: rows.map((r) => ({
      ...r,
      tenantName: r.tenantName ?? "",
      providerReference: r.providerReference ?? "",
      amountMinor: (r.amountMinor ?? 0n).toString(),
    })),
  });
}
