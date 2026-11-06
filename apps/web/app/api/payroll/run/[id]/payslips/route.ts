import { getDb, schema, eq, and } from "@zfloat/database";
import { generatePayslipsPdf, type PayslipData, calculateEmployerContributions } from "@zfloat/payroll";
import { requireUser, apiError } from "@/lib/api";

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

  const employees = await db
    .select({
      employee: schema.payrollEmployees,
      user: schema.users,
      department: schema.departments,
    })
    .from(schema.payrollEmployees)
    .leftJoin(schema.users, eq(schema.payrollEmployees.employeeId, schema.users.id))
    .leftJoin(schema.departments, eq(schema.payrollEmployees.departmentId, schema.departments.id))
    .where(eq(schema.payrollEmployees.runId, id));

  const payslipsData: PayslipData[] = employees.map((row) => {
    const emp = row.employee;
    const usr = row.user;
    const dept = row.department;

    // Calculate employer contributions
    const employer = calculateEmployerContributions(emp.grossMinor);

    // Get allowances from other_deductions (negative) or store separately
    // For now, we'll use 0 allowances since we didn't store them separately
    const allowances = [] as Array<{ name: string; amountMinor: bigint }>;

    return {
      companyName: "Z-float Demo Company",
      companyKraPin: "A001234567Z",
      companyAddress: "Nairobi, Kenya",
      employeeName: usr?.fullName ?? "Unknown",
      employeeNumber: emp.employeeNumber ?? emp.employeeId.slice(0, 8),
      employeeKraPin: emp.kraPin ?? "",
      employeeNssfNumber: emp.nssfNumber ?? "",
      employeeShifNumber: emp.shifNumber ?? "",
      department: dept?.name,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      payDate: run.payDate,
      basicSalaryMinor: emp.basicSalaryMinor,
      allowances,
      grossPayMinor: emp.grossMinor,
      payeMinor: emp.payeMinor,
      shifMinor: emp.shifMinor,
      nssfMinor: emp.nssfMinor,
      housingMinor: emp.housingMinor,
      otherDeductions: [],
      totalDeductionsMinor: emp.totalDeductionsMinor,
      netPayMinor: emp.netPayMinor,
      employerNssfMinor: employer.nssfEmployerMinor,
      employerShifMinor: employer.shifEmployerMinor,
      employerHousingMinor: employer.housingEmployerMinor,
    };
  });

  try {
    const pdfBuffer = await generatePayslipsPdf(payslipsData);
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payslips_${id}.pdf"`,
      },
    });
  } catch (err) {
    return apiError(400, "PAYSLIP_FAILED", err instanceof Error ? err.message : "Failed to generate payslips");
  }
}