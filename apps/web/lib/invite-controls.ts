/**
 * Maker-checker for privileged role grants (hardening batch).
 *
 * Inviting someone into a role that carries approval/power permissions
 * (e.g. APPROVER, FINANCE_MANAGER, OWNER, ADMIN) is itself a sensitive
 * action: a single actor could otherwise invite an accomplice into a role
 * that bypasses every control. Such invitations are created in a PENDING
 * state and only become grantable after an INDEPENDENT checker (someone
 * other than the inviter) approves the request in the Approval center.
 *
 * Non-privileged invites (MAKER, PAYROLL_OFFICER, ACCOUNTANT, VIEWER, …)
 * flow exactly as before — no approval required.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { createApprovalRequest } from "@zfloat/approvals";

/** Permissions that make a role grant require an independent sign-off. */
export const ROLE_APPROVAL_SENSITIVE_PERMISSIONS = [
  "payment.approve",
  "batch.approve",
  "payment.reverse",
  "team.manage",
  "settings.manage",
  "approvals.manage",
] as const;

/** Checker roles eligible to sign off a role grant (mirror payment approval). */
export const INVITE_APPROVER_ROLES = ["APPROVER", "FINANCE_MANAGER", "OWNER"];

/** True when granting `roleId` lets a user act unilaterally on sensitive ops. */
export async function roleGrantRequiresApproval(db: Db, roleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.rolePermissions.roleId })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(
      and(
        eq(schema.rolePermissions.roleId, roleId),
        inArray(schema.permissions.code, [...ROLE_APPROVAL_SENSITIVE_PERMISSIONS]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Maker step: raise the role-grant approval request for a pending invite. */
export async function createInviteRoleApprovalRequest(
  db: Db,
  input: { tenantId: string; inviteId: string; createdById: string },
): Promise<{ approvalRequestId: string }> {
  const { requestId } = await createApprovalRequest(db, {
    tenantId: input.tenantId,
    resourceType: "invite",
    resourceId: input.inviteId,
    rules: [{ mode: "ANY", requiredRoles: [...INVITE_APPROVER_ROLES], minApprovers: 1, order: 0 }],
    context: { amountMinor: 0n, product: "control", channel: "internal" },
    createdById: input.createdById,
  });
  return { approvalRequestId: requestId };
}

/**
 * Checker step: apply the approver's decision to the invitation row so the
 * invitee may (or may never) register into the granted role.
 */
export async function applyInviteRoleDecision(
  db: Db,
  input: { inviteId: string; decision: "APPROVED" | "REJECTED"; actorId: string },
): Promise<void> {
  await db
    .update(schema.invitations)
    .set({ roleApprovalStatus: input.decision, roleApprovedById: input.actorId })
    .where(eq(schema.invitations.id, input.inviteId));
}
