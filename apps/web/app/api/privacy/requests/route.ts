import { getDb, schema } from "@zfloat/database";
import { apiOk, apiError, rateLimit } from "@/lib/api";

/**
 * POST /api/privacy/requests — public DSAR intake (data subject access
 * request), GAP closeout.
 *
 * SAFETY: this endpoint NEVER executes anything. It only opens a request row
 * (status REQUESTED) that a platform admin identity-checks and then fulfils
 * through the admin DSAR endpoints (export / erasure). The row is the SLA
 * clock for the DPA Sec. 26 30-day reply.
 */
const TYPES = ["EXPORT", "DELETE", "CORRECTION"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const { db } = getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!(await rateLimit(`dsar-intake:${ip}`, { windowMs: 3_600_000, max: 5 }))) {
    return apiError(429, "RATE_LIMITED", "Too many requests — try again later");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = String(b.email ?? "").trim().toLowerCase();
  const type = String(b.type ?? "").toUpperCase();
  const note = String(b.note ?? "").trim().slice(0, 2000);

  if (!EMAIL_RE.test(email)) return apiError(400, "INVALID_EMAIL", "Provide a valid email for the reply");
  if (!(TYPES as readonly string[]).includes(type)) {
    return apiError(400, "INVALID_TYPE", `type must be one of: ${TYPES.join("|")}`);
  }

  const [row] = await db
    .insert(schema.dataRequests)
    .values({
      type,
      status: "REQUESTED",
      requesterEmail: email,
      requesterName: String(b.name ?? "").trim().slice(0, 200) || null,
      note: note || null,
      requestedAt: new Date(),
    })
    .returning();
  if (!row) return apiError(500, "INTAKE_FAILED", "Could not record the request — try again");

  return apiOk(
    {
      data: {
        requestId: row.id,
        type: row.type,
        status: row.status,
        note: "Request received. A platform operator will verify your identity by email, then fulfil it within 30 days (Kenya Data Protection Act 2019, Sec. 26).",
      },
    },
    { status: 201 },
  );
}
