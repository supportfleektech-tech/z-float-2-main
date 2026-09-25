/**
 * KRA eTIMS device (OSCU/VSCU) settings.
 *  GET   — current device + driver/environment
 *  PUT   { kraPin, deviceSerial, branchId? } — initialise with KRA (selectInitOsdcInfo)
 *  PATCH { autoReceipt?, defaultTaxType? }
 */
import { getDb, schema, eq } from "@zfloat/database";
import { getConfig } from "@zfloat/config";
import { requireUser, requirePermission, apiError } from "@/lib/api";
import { configureDevice, getDevice, updateDeviceSettings, isTaxType } from "@zfloat/etims";
import { normalizeKraPin } from "@zfloat/validation";
import { jsonOk, readJson, receivablesError } from "@/lib/receivables";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const cfg = getConfig();
  const [tenant] = await db
    .select({ name: schema.tenants.name, kraPin: schema.tenants.kraPin, collectionAccountRef: schema.tenants.collectionAccountRef })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, user!.tenantId!))
    .limit(1);
  return jsonOk({
    data: await getDevice(db, user!.tenantId!),
    driver: cfg.ETIMS_DRIVER,
    environment: cfg.ETIMS_ENVIRONMENT,
    tenant: tenant ?? null,
    tenantName: tenant?.name ?? null,
    c2b: { shortcode: cfg.MPESA_SHORTCODE, till: cfg.MPESA_TILL_NUMBER || null },
  });
}

export async function PUT(request: Request) {
  const { user, response } = await requirePermission("settings.manage");
  if (response) return response;
  const b = await readJson(request);
  if (!b) return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  const kraPin = normalizeKraPin(String(b.kraPin ?? ""));
  if (!kraPin) return apiError(400, "INVALID_KRA_PIN", "Enter your business KRA PIN (e.g. P051234567Q)");
  const deviceSerial = String(b.deviceSerial ?? "").trim();
  if (!/^[A-Za-z0-9-]{3,40}$/.test(deviceSerial)) return apiError(400, "INVALID_SERIAL", "Enter the device serial number KRA issued for this OSCU/VSCU");
  const branchId = String(b.branchId ?? "00").trim();
  if (!/^\d{1,2}$/.test(branchId)) return apiError(400, "INVALID_BRANCH", "Branch ID is a 2-digit code (00 = head office)");
  const { db } = getDb();
  try {
    const device = await configureDevice(db, { tenantId: user!.tenantId!, kraPin, deviceSerial, branchId });
    // Keep the business KRA PIN on the tenant profile too.
    await db.update(schema.tenants).set({ kraPin }).where(eq(schema.tenants.id, user!.tenantId!));
    return jsonOk({ data: device });
  } catch (err) {
    return receivablesError(err, "KRA device initialisation failed");
  }
}

export async function PATCH(request: Request) {
  const { user, response } = await requirePermission("settings.manage");
  if (response) return response;
  const b = (await readJson(request)) ?? {};
  const { db } = getDb();
  // Paybill account prefix used to route C2B payments to this business.
  if (b.collectionAccountRef !== undefined) {
    const ref = String(b.collectionAccountRef ?? "").trim().toUpperCase();
    if (ref && !/^[A-Z0-9]{3,12}$/.test(ref)) return apiError(400, "INVALID_ACCOUNT_REF", "Account reference: 3–12 letters/digits");
    try {
      await db.update(schema.tenants).set({ collectionAccountRef: ref || null }).where(eq(schema.tenants.id, user!.tenantId!));
    } catch {
      return apiError(409, "ACCOUNT_REF_TAKEN", "That account reference is used by another business");
    }
  }
  if (b.defaultTaxType !== undefined && !isTaxType(String(b.defaultTaxType))) return apiError(400, "INVALID_TAX_TYPE", "Tax type must be A–E");
  try {
    const device = await updateDeviceSettings(db, {
      tenantId: user!.tenantId!,
      autoReceipt: typeof b.autoReceipt === "boolean" ? b.autoReceipt : undefined,
      defaultTaxType: b.defaultTaxType ? (String(b.defaultTaxType) as "A" | "B" | "C" | "D" | "E") : undefined,
    });
    return jsonOk({ data: device });
  } catch (err) {
    return receivablesError(err);
  }
}
