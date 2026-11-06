import { getDb, schema, eq, desc } from "@zfloat/database";
import { createPayrollRun, type PayrollEmployeeInput } from "@zfloat/payroll";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.payrollRuns)
    .where(eq(schema.payrollRuns.tenantId, user!.tenantId!))
    .orderBy(desc(schema.payrollRuns.createdAt))
    .limit(100);
  return apiOk({ data: rows.map((r) => ({
    ...r,
    totalGrossMinor: r.totalGrossMinor.toString(),
    totalNetMinor: r.totalNetMinor.toString(),
    totalPayeMinor: r.totalPayeMinor.toString(),
    totalShifMinor: r.totalShifMinor.toString(),
    totalNssfMinor: r.totalNssfMinor.toString(),
    totalHousingMinor: r.totalHousingMinor.toString(),
  })) });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const name = String(b.name ?? "Payroll Run");
  const periodStart = b.periodStart ? new Date(String(b.periodStart)) : new Date();
  const periodEnd = b.periodEnd ? new Date(String(b.periodEnd)) : new Date();
  const payDate = b.payDate ? new Date(String(b.payDate)) : new Date();
  const rawEmployees = (b.employees ?? []) as Array<Record<string, unknown>>;

  if (rawEmployees.length === 0) {
    return apiError(400, "EMPTY_PAYROLL", "Payroll run must have at least one employee");
  }

  const employees: PayrollEmployeeInput[] = rawEmployees.map((e) => ({
    employeeId: String(e.employeeId),
    employeeNumber: e.employeeNumber ? String(e.employeeNumber) : undefined,
    departmentId: e.departmentId ? String(e.departmentId) : undefined,
    branchId: e.branchId ? String(e.branchId) : undefined,
    basicSalaryMinor: BigInt(Math.round(Number(e.basicSalary) * 100)),
    allowancesMinor: e.allowances ? BigInt(Math.round(Number(e.allowances) * 100)) : undefined,
    kraPin: e.kraPin ? String(e.kraPin) : undefined,
    nssfNumber: e.nssfNumber ? String(e.nssfNumber) : undefined,
    shifNumber: e.shifNumber ? String(e.shifNumber) : undefined,
    insurancePremiumsMinor: e.insurancePremiums ? BigInt(Math.round(Number(e.insurancePremiums) * 100)) : undefined,
  }));

  try {
    const result = await createPayrollRun(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      name,
      periodStart,
      periodEnd,
      payDate,
      employees,
    });

    await writeAuditEvent(db, { tenantId: user!.tenantId!, actorId: user!.userId, action: "payroll.created", resourceType: "payroll_run", resourceId: result.runId });

    return apiOk({ data: { ...result, totalGrossMinor: result.totalGrossMinor.toString(), totalNetMinor: result.totalNetMinor.toString(), totalPayeMinor: result.totalPayeMinor.toString(), totalShifMinor: result.totalShifMinor.toString(), totalNssfMinor: result.totalNssfMinor.toString(), totalHousingMinor: result.totalHousingMinor.toString() } }, { status: 201 });
  } catch (err) {
    return apiError(400, "PAYROLL_FAILED", err instanceof Error ? err.message : "Payroll creation failed");
  }
}