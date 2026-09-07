
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser, apiOk } from "@/lib/api";
import { minorToDisplay } from "@zfloat/money"; export async function GET() { const { user, response } = await requireUser(); if (response) return response; const { db } = getDb(); const wallets = await db .select() .from(schema.wallets) .where(eq(schema.wallets.tenantId, user!.tenantId!)) .orderBy(schema.wallets.createdAt); return apiOk({ data: wallets.map((w) => ({ id: w.id, name: w.name, availableMinor: w.availableMinor.toString(), reservedMinor: w.reservedMinor.toString(), availableDisplay: minorToDisplay(BigInt(w.availableMinor)), status: w.status, currency: w.currency })) });
}
