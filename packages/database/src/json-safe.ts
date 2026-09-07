/**
 * JSONB-safe serialization: bigint values cannot be JSON.stringify'd by pg.
 * Convert bigints to decimal strings (the canonical wire form for money)
 * before storing any jsonb snapshot (policy rules, beneficiary snapshots,
 * fee snapshots, webhook payloads, audit diffs, ...).
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

/** Inverse helper: parse a stored decimal-string amount back to bigint when needed. */
export function fromJsonSafe<T>(value: unknown): T {
  return value as T;
}
