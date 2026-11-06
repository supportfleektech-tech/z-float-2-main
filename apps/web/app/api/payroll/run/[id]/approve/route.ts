import { getDb, schema, eq, and } from "@zfloat/database";
import { approvePayrollRun } from "@zfloat/payroll";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (run.status !== "PENDING_APPROVAL") return apiError(409, "INVALID_STATE", `Cannot approve payroll run in state ${run.status}`);

  try {
    await approvePayrollRun(db, { tenantId: user!.tenantId!, runId: id, actorId: user!.userId });
    await writeAuditEvent(db, { tenantId: user!.tenantId!, actorId: user!.userId, action: "payroll.approved", resourceType: "payroll_run", resourceId: id });
    return apiOk({ data: { status: "APPROVED" } });
  } catch (err) {
    return apiError(400, "APPROVAL_FAILED", err instanceof Error ? err.message : "Approval failed");
  }
}