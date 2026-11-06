import { getDb, schema, eq, and } from "@zfloat/database";
import { generateRemittanceData, generateKraPayeCsv, generateNssfCsv, generateShaCsv, generateHousingCsv } from "@zfloat/payroll";
import { requireUser, apiError } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const { id, type } = await params;

  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, id), eq(schema.payrollRuns.tenantId, user!.tenantId!)))
    .limit(1);

  if (!run) return apiError(404, "NOT_FOUND", "Payroll run not found");
  if (run.status !== "APPROVED" && run.status !== "PROCESSING" && run.status !== "COMPLETED") {
    return apiError(409, "INVALID_STATE", "Remittance data only available for approved/completed payroll runs");
  }

  try {
    const remittance = await generateRemittanceData(db, id);
    let csv: string;
    let filename: string;

    switch (type) {
      case "kra":
      case "paye":
        csv = generateKraPayeCsv(remittance);
        filename = `paye_remittance_${id}.csv`;
        break;
      case "nssf":
        csv = generateNssfCsv(remittance);
        filename = `nssf_remittance_${id}.csv`;
        break;
      case "sha":
      case "shif":
        csv = generateShaCsv(remittance);
        filename = `sha_remittance_${id}.csv`;
        break;
      case "housing":
        csv = generateHousingCsv(remittance);
        filename = `housing_remittance_${id}.csv`;
        break;
      default:
        return apiError(400, "INVALID_TYPE", "Invalid remittance type. Use: kra, nssf, sha, or housing");
    }

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return apiError(400, "REMITTANCE_FAILED", err instanceof Error ? err.message : "Failed to generate remittance");
  }
}