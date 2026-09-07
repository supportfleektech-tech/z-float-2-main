/**
 * RBAC — roles, permissions and policy checks.
 *
 * Permissions are action-scoped, resource-scoped and tenant-scoped:
 *   payment.create / payment.approve / payment.reverse
 *   batch.create / batch.approve
 *   ledger.read / reports.read / admin.* / settings.* ...
 *
 * The API layer calls `can(actor, permission, tenantId)` before executing a
 * command. UI visibility is NOT a security boundary — this check always runs
 * server-side.
 */
import { eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";

export const PERMISSIONS = {
  // business surface
  "payment.create": "Create payments",
  "payment.approve": "Approve payments",
  "payment.reverse": "Reverse payments",
  "payment.read": "View payments",
  "batch.create": "Create bulk batches",
  "batch.approve": "Approve bulk batches",
  "recipient.manage": "Manage recipients",
  "wallet.fund": "Fund wallets",
  "wallet.read": "View wallets",
  "ledger.read": "View ledger entries",
  "reports.read": "View reports",
  "reports.export": "Export reports",
  "reconciliation.manage": "Manage reconciliation",
  "team.manage": "Manage team members",
  "settings.manage": "Manage business settings",
  "approvals.manage": "Manage approval policies",
  "payroll.manage": "Manage payroll",
  "expenses.manage": "Manage expenses",
  "bills.manage": "Manage bills",
  "airtime.manage": "Manage airtime purchases",
  // platform surface
  "admin.tenants": "Manage tenants",
  "admin.providers": "Manage providers",
  "admin.pricing": "Manage pricing & fees",
  "admin.limits": "Manage limits",
  "admin.routing": "Manage payment routing",
  "admin.flags": "Manage feature flags",
  "admin.audit": "Read audit logs",
  "admin.kyc": "Manage KYC/KYB cases",
  "admin.cms": "Manage content",
  "admin.support": "Manage support",
  "admin.health": "View system health",
  "admin.users": "Manage admin users",
  "admin.recon": "Manage reconciliation ops",
  "admin.settlement": "Manage settlements",
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

/** Business roles → default permission sets (seed data overrides at will). */
export const BUSINESS_ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  OWNER: Object.keys(PERMISSIONS) as PermissionCode[],
  ADMIN: Object.keys(PERMISSIONS) as PermissionCode[],
  FINANCE_MANAGER: [
    "payment.create", "payment.approve", "payment.read", "payment.reverse",
    "batch.create", "batch.approve", "recipient.manage", "wallet.read", "wallet.fund",
    "ledger.read", "reports.read", "reports.export", "reconciliation.manage",
    "approvals.manage", "payroll.manage", "expenses.manage", "bills.manage", "airtime.manage",
  ],
  MAKER: ["payment.create", "payment.read", "batch.create", "recipient.manage", "bills.manage", "airtime.manage", "expenses.manage"],
  APPROVER: ["payment.read", "payment.approve", "batch.approve", "reports.read"],
  PAYROLL_OFFICER: ["payment.read", "payroll.manage", "batch.create", "recipient.manage"],
  PROCUREMENT_OFFICER: ["payment.read", "payment.create", "recipient.manage", "bills.manage", "expenses.manage"],
  ACCOUNTANT: ["payment.read", "ledger.read", "reports.read", "reports.export", "reconciliation.manage"],
  BRANCH_MANAGER: ["payment.read", "payment.create", "payment.approve", "reports.read", "wallet.read"],
  VIEWER: ["payment.read", "reports.read", "wallet.read"],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  SUPER_ADMIN: Object.keys(PERMISSIONS) as PermissionCode[],
  OPS_ADMIN: ["admin.tenants", "admin.providers", "admin.routing", "admin.health", "admin.recon", "admin.settlement", "admin.support"],
  COMPLIANCE_ADMIN: ["admin.kyc", "admin.audit", "admin.tenants", "admin.limits", "admin.recon"],
  FINANCE_ADMIN: ["admin.pricing", "admin.limits", "admin.settlement", "admin.audit", "admin.recon"],
  SUPPORT_ADMIN: ["admin.support", "admin.tenants", "admin.health"],
  DEV_ADMIN: ["admin.providers", "admin.routing", "admin.flags", "admin.health", "admin.audit"],
  AUDITOR: ["admin.audit", "admin.health", "reports.read", "admin.recon"],
};

/** Load the user's permission codes (platform or business scope). */
export async function loadUserPermissions(db: Db, userId: string): Promise<Set<string>> {
  const roleRows = await db
    .select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(inArray(schema.userRoles.userId, [userId]));
  const roleIds = roleRows.map((r) => r.roleId);
  if (roleIds.length === 0) return new Set();
  const permRows = await db
    .select({ code: schema.permissions.code })
    .from(schema.permissions)
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(inArray(schema.rolePermissions.roleId, roleIds));
  return new Set(permRows.map((p) => p.code));
}

/** Server-side authorization check. */
export async function can(db: Db, userId: string, permission: PermissionCode): Promise<boolean> {
  const perms = await loadUserPermissions(db, userId);
  return perms.has(permission);
}


