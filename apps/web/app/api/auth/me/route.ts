import { getSessionUser } from "@/lib/api";
import { apiError, apiOk } from "@/lib/api";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  return apiOk({ user: { id: user.userId, email: user.email, fullName: user.fullName, tenantId: user.tenantId, mfaEnabled: user.mfaEnabled } });
}
