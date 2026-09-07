import { NextRequest } from "next/server";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";

/** DELETE /api/report-schedules/:id — cancel a recurring export schedule. */
export async function DELETE(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [sched] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, ctx.params.id)).limit(1);
  if (!sched || sched.tenantId !== user!.tenantId) {
    return apiError(404, "NOT_FOUND", "Schedule not found");
  }

  await db
    .update(schema.reportSchedules)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.reportSchedules.id, sched.id));

  return apiOk({ data: { id: sched.id, active: false } });
}
