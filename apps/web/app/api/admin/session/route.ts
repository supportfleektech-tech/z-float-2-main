import { getSessionUser, apiOk, apiError } from "@/lib/api";
import { getDb } from "@zfloat/database";
import { loadUserPermissions } from "@zfloat/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to continue");
  const { db } = getDb();
  const perms = await loadUserPermissions(db, user.userId);
  const isAdmin =
    perms.has("admin.tenants") || perms.has("admin.pricing") || perms.has("admin.audit") || perms.has("admin.health") || perms.has("admin.flags");
  if (!isAdmin) return apiError(403, "FORBIDDEN", "Platform administrator access required");
  return apiOk({ user: { id: user.userId, email: user.email, fullName: user.fullName } });
}
