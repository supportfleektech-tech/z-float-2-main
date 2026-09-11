import { getDb, schema, desc } from "@zfloat/database";
import { requirePlatformAdmin, apiOk } from "@/lib/api";
import { getAllCircuitBreakerStates } from "@zfloat/providers";

/** Live provider health derived from the circuit-breaker registry.
 * No breaker entry means the rail has never tripped (never failed).
 * latencyMs is null: the breaker tracks counts, not latencies.
 */
export async function GET() {
  const { response } = await requirePlatformAdmin();
  if (response) return response;
  const { db } = getDb();
  const states = getAllCircuitBreakerStates();
  const rows = await db.select().from(schema.providers).orderBy(desc(schema.providers.createdAt));
  return apiOk({
    data: rows.map((p) => {
      const cb = states[p.code];
      const cbState = cb?.state ?? "CLOSED";
      const failures = cb?.failureCount ?? 0;
      const successes = cb?.successCount ?? 0;
      const total = failures + successes;
      return {
        providerId: p.id,
        status: cbState === "OPEN" ? "DOWN" : cbState === "HALF_OPEN" ? "DEGRADED" : "HEALTHY",
        lastCheck: new Date().toISOString(),
        latencyMs: null,
        successRate: total > 0 ? (successes / total) * 100 : 100,
        errorCount: failures,
        circuitBreakerState: cbState,
      };
    }),
  });
}
