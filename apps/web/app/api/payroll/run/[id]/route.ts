import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const { id } = await params;

  const [run] = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.id, id), eq(schema.payrollRuns.tenantId, user!.tenantId!)))
    .limit(1);

  if (!run) return apiError(404, "NOT_FOUND", "Payroll run not found");

  return apiOk({
    data: {
      ...run,
      totalGrossMinor: run.totalGrossMinor.toString(),
      totalNetMinor: run.totalNetMinor.toString(),
      totalPayeMinor: run.totalPayeMinor.toString(),
      totalShifMinor: run.totalShifMinor.toString(),
      totalNssfMinor: run.totalNssfMinor.toString(),
      totalHousingMinor: run.totalHousingMinor.toString(),
    },
  });
}