/**
 * Payroll Calculation Engine
 *
 * Calculates statutory deductions, generates payroll runs, and produces remittance data.
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import type { payrollDeductions } from "@zfloat/database";
type PayrollDeduction = typeof payrollDeductions.$inferSelect;
import {
  calculateStatutoryDeductions,
  calculateEmployerContributions,
  KENYA_STATUTORY_RATES_2025_2026,
} from "./rates.js";
import { ApprovalRule } from "@zfloat/approvals";

export class PayrollError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PayrollError";
  }
}

export interface PayrollEmployeeInput {
  employeeId: string;
  employeeNumber?: string;
  departmentId?: string;
  branchId?: string;
  basicSalaryMinor: bigint;
  allowancesMinor?: bigint;
  kraPin?: string;
  nssfNumber?: string;
  shifNumber?: string;
  insurancePremiumsMinor?: bigint;
}

export interface CreatePayrollRunInput {
  tenantId: string;
  actorId: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  employees: PayrollEmployeeInput[];
}

export interface PayrollRunResult {
  runId: string;
  totalGrossMinor: bigint;
  totalNetMinor: bigint;
  totalPayeMinor: bigint;
  totalShifMinor: bigint;
  totalNssfMinor: bigint;
  totalHousingMinor: bigint;
  employeeCount: number;
}

/**
 * Create a payroll run with calculated deductions
 */
export async function createPayrollRun(db: Db, input: CreatePayrollRunInput): Promise<PayrollRunResult> {
  if (input.employees.length === 0) throw new PayrollError("Payroll run must have at least one employee", "EMPTY_PAYROLL");

  return db.transaction(async (tx) => {
    // Create the payroll run record
    const [run] = await tx
      .insert(schema.payrollRuns)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        payDate: input.payDate,
        status: "CALCULATED",
        createdById: input.actorId,
      })
      .returning();
    if (!run) throw new PayrollError("Failed to create payroll run", "CREATE_FAILED");

    let totalGross = 0n;
    let totalNet = 0n;
    let totalPaye = 0n;
    let totalShif = 0n;
    let totalNssf = 0n;
    let totalHousing = 0n;

    // Process each employee
    for (const emp of input.employees) {
      const grossMinor = emp.basicSalaryMinor + (emp.allowancesMinor ?? 0n);
      const deductions = calculateStatutoryDeductions(grossMinor, {
        insurancePremiumsMinor: emp.insurancePremiumsMinor,
      });

      totalGross += grossMinor;
      totalNet += deductions.netPayMinor;
      totalPaye += deductions.paye.payeMinor;
      totalShif += deductions.shif.shifMinor;
      totalNssf += deductions.nssf.nssfMinor;
      totalHousing += deductions.housing.housingMinor;

      // Insert payroll employee record
      const [payrollEmp] = await tx
        .insert(schema.payrollEmployees)
        .values({
          runId: run.id,
          tenantId: input.tenantId,
          employeeId: emp.employeeId,
          employeeNumber: emp.employeeNumber,
          departmentId: emp.departmentId,
          branchId: emp.branchId,
          basicSalaryMinor: emp.basicSalaryMinor,
          allowancesMinor: emp.allowancesMinor ?? 0n,
          grossMinor,
          payeMinor: deductions.paye.payeMinor,
          shifMinor: deductions.shif.shifMinor,
          nssfMinor: deductions.nssf.nssfMinor,
          housingMinor: deductions.housing.housingMinor,
          otherDeductionsMinor: 0n,
          totalDeductionsMinor: deductions.totalDeductionsMinor,
          netPayMinor: deductions.netPayMinor,
          kraPin: emp.kraPin,
          nssfNumber: emp.nssfNumber,
          shifNumber: emp.shifNumber,
        })
        .returning();
      if (!payrollEmp) throw new PayrollError(`Failed to create payroll employee for ${emp.employeeId}`, "EMPLOYEE_CREATE_FAILED");

      // Insert deduction breakdown
      await tx.insert(schema.payrollDeductions).values([
        {
          employeeId: payrollEmp.id,
          runId: run.id,
          type: "PAYE",
          name: "PAYE (Income Tax)",
          amountMinor: deductions.paye.payeMinor,
          rate: `${(KENYA_STATUTORY_RATES_2025_2026.paye.bands.map(b => `${b.rate * 100}%`).join(" / "))}`,
          taxableAmountMinor: deductions.paye.taxablePayMinor,
          metadata: { bands: deductions.paye.bands, reliefAppliedMinor: deductions.paye.reliefAppliedMinor.toString() },
        },
        {
          employeeId: payrollEmp.id,
          runId: run.id,
          type: "SHIF",
          name: "SHIF (Social Health Insurance)",
          amountMinor: deductions.shif.shifMinor,
          rate: `${(KENYA_STATUTORY_RATES_2025_2026.shif.rate * 100).toFixed(2)}%`,
          taxableAmountMinor: grossMinor,
        },
        {
          employeeId: payrollEmp.id,
          runId: run.id,
          type: "NSSF",
          name: "NSSF (National Social Security Fund)",
          amountMinor: deductions.nssf.nssfMinor,
          rate: `${(KENYA_STATUTORY_RATES_2025_2026.nssf.employeeRate * 100).toFixed(0)}%`,
          taxableAmountMinor: grossMinor,
          metadata: {
            tier1Minor: deductions.nssf.tier1Minor.toString(),
            tier2Minor: deductions.nssf.tier2Minor.toString(),
            capped: deductions.nssf.capped,
            maxContribution: KENYA_STATUTORY_RATES_2025_2026.nssf.maxEmployeeContribution.toString(),
          },
        },
        {
          employeeId: payrollEmp.id,
          runId: run.id,
          type: "HOUSING",
          name: "Housing Levy (Affordable Housing Fund)",
          amountMinor: deductions.housing.housingMinor,
          rate: `${(KENYA_STATUTORY_RATES_2025_2026.housing.employeeRate * 100).toFixed(1)}%`,
          taxableAmountMinor: grossMinor,
        },
      ]);
    }

    // Update run totals
    await tx
      .update(schema.payrollRuns)
      .set({
        totalGrossMinor: totalGross,
        totalNetMinor: totalNet,
        totalPayeMinor: totalPaye,
        totalShifMinor: totalShif,
        totalNssfMinor: totalNssf,
        totalHousingMinor: totalHousing,
        employeeCount: input.employees.length,
      })
      .where(eq(schema.payrollRuns.id, run.id));

    return {
      runId: run.id,
      totalGrossMinor: totalGross,
      totalNetMinor: totalNet,
      totalPayeMinor: totalPaye,
      totalShifMinor: totalShif,
      totalNssfMinor: totalNssf,
      totalHousingMinor: totalHousing,
      employeeCount: input.employees.length,
    };
  });
}

/**
 * Submit a payroll run for approval
 */
export async function submitPayrollRun(
  db: Db,
  input: { tenantId: string; runId: string; actorId: string; policyRules: ApprovalRule[] }
): Promise<{ status: string; approvalRequestId?: string }> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.id, input.runId), eq(schema.payrollRuns.tenantId, input.tenantId)))
      .for("update");
    if (!run) throw new PayrollError("Payroll run not found", "RUN_NOT_FOUND");
    if (run.status !== "CALCULATED" && run.status !== "DRAFT") {
      throw new PayrollError(`Cannot submit payroll run in state ${run.status}`, "INVALID_STATE");
    }

    // Check if approval is needed
    const { evaluatePolicy } = await import("@zfloat/approvals");
    const ctx = {
      amountMinor: run.totalNetMinor,
      product: "payroll",
      channel: "bank",
    };
    const rules = input.policyRules ?? [];
    if (evaluatePolicy(rules, ctx).length > 0) {
      const { createApprovalRequest } = await import("@zfloat/approvals");
      const { requestId } = await createApprovalRequest(tx, {
        tenantId: input.tenantId,
        resourceType: "batch",
        resourceId: run.id,
        rules,
        context: ctx,
        createdById: input.actorId,
      });
      await tx.update(schema.payrollRuns).set({ status: "PENDING_APPROVAL" }).where(eq(schema.payrollRuns.id, run.id));
      return { status: "PENDING_APPROVAL", approvalRequestId: requestId };
    }

    // No approval needed - auto approve
    await tx.update(schema.payrollRuns).set({ status: "APPROVED", approvedById: input.actorId, approvedAt: new Date() }).where(eq(schema.payrollRuns.id, run.id));
    return { status: "APPROVED" };
  });
}

/**
 * Approve a payroll run after approval request resolves
 */
export async function approvePayrollRun(db: Db, input: { tenantId: string; runId: string; actorId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.id, input.runId), eq(schema.payrollRuns.tenantId, input.tenantId)))
      .for("update");
    if (!run) throw new PayrollError("Payroll run not found", "RUN_NOT_FOUND");
    if (run.status !== "PENDING_APPROVAL") throw new PayrollError(`Cannot approve payroll run in state ${run.status}`, "INVALID_STATE");

    await tx.update(schema.payrollRuns).set({ status: "APPROVED", approvedById: input.actorId, approvedAt: new Date() }).where(eq(schema.payrollRuns.id, run.id));
  });
}

/**
 * Reject a payroll run
 */
export async function rejectPayrollRun(db: Db, input: { tenantId: string; runId: string; actorId: string; reason?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.id, input.runId), eq(schema.payrollRuns.tenantId, input.tenantId)))
      .for("update");
    if (!run) throw new PayrollError("Payroll run not found", "RUN_NOT_FOUND");
    if (run.status !== "PENDING_APPROVAL") throw new PayrollError(`Cannot reject payroll run in state ${run.status}`, "INVALID_STATE");

    await tx.update(schema.payrollRuns).set({ status: "REJECTED" }).where(eq(schema.payrollRuns.id, run.id));
  });
}

/**
 * Generate remittance data for statutory bodies
 */
export interface RemittanceData {
  kra: Array<{
    kraPin: string;
    employeeName: string;
    grossPay: bigint;
    paye: bigint;
    personalRelief: bigint;
    insuranceRelief: bigint;
    netTax: bigint;
  }>;
  nssf: Array<{
    nssfNumber: string;
    employeeName: string;
    grossPay: bigint;
    employeeContribution: bigint;
    employerContribution: bigint;
    tier1Employee: bigint;
    tier2Employee: bigint;
    tier1Employer: bigint;
    tier2Employer: bigint;
  }>;
  shif: Array<{
    shifNumber: string;
    employeeName: string;
    grossPay: bigint;
    employeeContribution: bigint;
    employerContribution: bigint;
  }>;
  housing: Array<{
    kraPin: string;
    employeeName: string;
    grossPay: bigint;
    employeeContribution: bigint;
    employerContribution: bigint;
  }>;
  summary: {
    totalEmployees: number;
    totalGrossMinor: bigint;
    totalPayeMinor: bigint;
    totalNssfEmployeeMinor: bigint;
    totalNssfEmployerMinor: bigint;
    totalShifEmployeeMinor: bigint;
    totalShifEmployerMinor: bigint;
    totalHousingEmployeeMinor: bigint;
    totalHousingEmployerMinor: bigint;
  };
}

/**
 * Generate remittance data for a payroll run
 */
export async function generateRemittanceData(db: Db, runId: string): Promise<RemittanceData> {
  const run = await db
    .select()
    .from(schema.payrollRuns)
    .where(eq(schema.payrollRuns.id, runId))
    .limit(1);
  if (!run[0]) throw new PayrollError("Payroll run not found", "RUN_NOT_FOUND");

  const employees = await db
    .select({
      employee: schema.payrollEmployees,
      user: schema.users,
      deductions: schema.payrollDeductions,
    })
    .from(schema.payrollEmployees)
    .leftJoin(schema.users, eq(schema.payrollEmployees.employeeId, schema.users.id))
    .leftJoin(schema.payrollDeductions, eq(schema.payrollDeductions.employeeId, schema.payrollEmployees.id))
    .where(eq(schema.payrollEmployees.runId, runId));

  // Group deductions by employee
  const deductionsByEmp = new Map<string, PayrollDeduction[]>();
  for (const row of employees) {
    if (row.deductions) {
      const existing = deductionsByEmp.get(row.employee.id) ?? [];
      existing.push(row.deductions);
      deductionsByEmp.set(row.employee.id, existing);
    }
  }

  const kra: RemittanceData["kra"] = [];
  const nssf: RemittanceData["nssf"] = [];
  const shif: RemittanceData["shif"] = [];
  const housing: RemittanceData["housing"] = [];

  let totalPaye = 0n;
  let totalNssfEmployee = 0n;
  let totalNssfEmployer = 0n;
  let totalShifEmployee = 0n;
  let totalShifEmployer = 0n;
  let totalHousingEmployee = 0n;
  let totalHousingEmployer = 0n;

  for (const row of employees) {
    const emp = row.employee;
    const user = row.user;
    const deductions = deductionsByEmp.get(emp.id) ?? [];
    const employeeName = user?.fullName ?? "Unknown";

    const payeDed = deductions.find(d => d.type === "PAYE");
    const nssfDed = deductions.find(d => d.type === "NSSF");
    const shifDed = deductions.find(d => d.type === "SHIF");
    const housingDed = deductions.find(d => d.type === "HOUSING");

    const employer = calculateEmployerContributions(emp.grossMinor);

    if (payeDed) {
      const meta = payeDed.metadata as Record<string, unknown> | undefined;
      const reliefApplied = meta?.reliefAppliedMinor ? BigInt(meta.reliefAppliedMinor as string) : 0n;
      const personalReliefMinor = BigInt(Math.round(KENYA_STATUTORY_RATES_2025_2026.paye.personalRelief * 100));
      const insuranceReliefMinor = reliefApplied - personalReliefMinor;
      
      kra.push({
        kraPin: emp.kraPin ?? "",
        employeeName,
        grossPay: emp.grossMinor,
        paye: payeDed.amountMinor,
        personalRelief: personalReliefMinor,
        insuranceRelief: insuranceReliefMinor > 0n ? insuranceReliefMinor : 0n,
        netTax: payeDed.amountMinor,
      });
      totalPaye += payeDed.amountMinor;
    }

    if (nssfDed) {
      const meta = nssfDed.metadata as Record<string, unknown> | undefined;
      const tier1Emp = meta?.tier1Minor ? BigInt(meta.tier1Minor as string) : 0n;
      const tier2Emp = meta?.tier2Minor ? BigInt(meta.tier2Minor as string) : 0n;
      const tier1Employer = tier1Emp; // Same calculation for employer
      const tier2Employer = tier2Emp;
      
      nssf.push({
        nssfNumber: emp.nssfNumber ?? "",
        employeeName,
        grossPay: emp.grossMinor,
        employeeContribution: nssfDed.amountMinor,
        employerContribution: employer.nssfEmployerMinor,
        tier1Employee: tier1Emp,
        tier2Employee: tier2Emp,
        tier1Employer,
        tier2Employer,
      });
      totalNssfEmployee += nssfDed.amountMinor;
      totalNssfEmployer += employer.nssfEmployerMinor;
    }

    if (shifDed) {
      shif.push({
        shifNumber: emp.shifNumber ?? "",
        employeeName,
        grossPay: emp.grossMinor,
        employeeContribution: shifDed.amountMinor,
        employerContribution: employer.shifEmployerMinor,
      });
      totalShifEmployee += shifDed.amountMinor;
      totalShifEmployer += employer.shifEmployerMinor;
    }

    if (housingDed) {
      housing.push({
        kraPin: emp.kraPin ?? "",
        employeeName,
        grossPay: emp.grossMinor,
        employeeContribution: housingDed.amountMinor,
        employerContribution: employer.housingEmployerMinor,
      });
      totalHousingEmployee += housingDed.amountMinor;
      totalHousingEmployer += employer.housingEmployerMinor;
    }
  }

  return {
    kra,
    nssf,
    shif,
    housing,
    summary: {
      totalEmployees: employees.length,
      totalGrossMinor: run[0].totalGrossMinor,
      totalPayeMinor: totalPaye,
      totalNssfEmployeeMinor: totalNssfEmployee,
      totalNssfEmployerMinor: totalNssfEmployer,
      totalShifEmployeeMinor: totalShifEmployee,
      totalShifEmployerMinor: totalShifEmployer,
      totalHousingEmployeeMinor: totalHousingEmployee,
      totalHousingEmployerMinor: totalHousingEmployer,
    },
  };
}

/**
 * Generate CSV for KRA iTax PAYE return
 */
export function generateKraPayeCsv(remittance: RemittanceData): string {
  const headers = [
    "PIN",
    "Employee Name",
    "Gross Pay",
    "PAYE",
    "Personal Relief",
    "Insurance Relief",
    "Net Tax",
  ];
  const rows = remittance.kra.map(e => [
    e.kraPin,
    e.employeeName,
    (Number(e.grossPay) / 100).toFixed(2),
    (Number(e.paye) / 100).toFixed(2),
    (Number(e.personalRelief) / 100).toFixed(2),
    (Number(e.insuranceRelief) / 100).toFixed(2),
    (Number(e.netTax) / 100).toFixed(2),
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Generate CSV for NSSF return
 */
export function generateNssfCsv(remittance: RemittanceData): string {
  const headers = [
    "NSSF Number",
    "Employee Name",
    "Gross Pay",
    "Employee Contribution",
    "Employer Contribution",
    "Tier I Employee",
    "Tier II Employee",
    "Tier I Employer",
    "Tier II Employer",
  ];
  const rows = remittance.nssf.map(e => [
    e.nssfNumber,
    e.employeeName,
    (Number(e.grossPay) / 100).toFixed(2),
    (Number(e.employeeContribution) / 100).toFixed(2),
    (Number(e.employerContribution) / 100).toFixed(2),
    (Number(e.tier1Employee) / 100).toFixed(2),
    (Number(e.tier2Employee) / 100).toFixed(2),
    (Number(e.tier1Employer) / 100).toFixed(2),
    (Number(e.tier2Employer) / 100).toFixed(2),
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Generate CSV for SHA (Social Health Authority) return
 */
export function generateShaCsv(remittance: RemittanceData): string {
  const headers = [
    "SHIF Number",
    "Employee Name",
    "Gross Pay",
    "Employee Contribution",
    "Employer Contribution",
  ];
  const rows = remittance.shif.map(e => [
    e.shifNumber,
    e.employeeName,
    (Number(e.grossPay) / 100).toFixed(2),
    (Number(e.employeeContribution) / 100).toFixed(2),
    (Number(e.employerContribution) / 100).toFixed(2),
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Generate CSV for Housing Levy return
 */
export function generateHousingCsv(remittance: RemittanceData): string {
  const headers = [
    "PIN",
    "Employee Name",
    "Gross Pay",
    "Employee Contribution",
    "Employer Contribution",
  ];
  const rows = remittance.housing.map(e => [
    e.kraPin,
    e.employeeName,
    (Number(e.grossPay) / 100).toFixed(2),
    (Number(e.employeeContribution) / 100).toFixed(2),
    (Number(e.employerContribution) / 100).toFixed(2),
  ]);
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}