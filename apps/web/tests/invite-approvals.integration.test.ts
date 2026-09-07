/**
 * Maker-checker for privileged role grants (route-layer helpers):
 *  - inviting into a role that carries approval/power permissions raises an
 *    approval request (invitation stays PENDING until an independent checker
 *    approves);
 *  - the inviter cannot approve their own role-grant request;
 *  - a checker's APPROVED decision flips the invitation to APPROVED (the
 *    invitee may then register into the role); REJECTED is final.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import { recordApprovalAction } from "@zfloat/approvals";
import { hashToken } from "@zfloat/auth";
import {
  roleGrantRequiresApproval,
  createInviteRoleApprovalRequest,
  applyInviteRoleDecision,
  INVITE_APPROVER_ROLES,
} from "../lib/invite-controls";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT = "";

const CHECKER = { id: "88888888-8888-8888-8888-888888888888", roles: [...INVITE_APPROVER_ROLES] };
const INVITER = "77777777-7777-7777-7777-777777777777";

async function ensurePermission(code: string) {
  const [existing] = await db.select().from(schema.permissions).where(eq(schema.permissions.code, code)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.permissions)
    .values({ code, name: code })
    .onConflictDoNothing({ target: schema.permissions.code })
    .returning({ id: schema.permissions.id });
  if (created) return created.id;
  const [row] = await db.select().from(schema.permissions).where(eq(schema.permissions.code, code)).limit(1);
  return row!.id;
}

async function makeRole(name: string, permCodes: string[]) {
  const [role] = await db
    .insert(schema.roles)
    .values({ scope: "BUSINESS", name: `${name}-${crypto.randomUUID().slice(0, 6)}`, isSystem: false })
    .returning();
  for (const code of permCodes) {
    const permissionId = await ensurePermission(code);
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: role!.id, permissionId })
      .onConflictDoNothing();
  }
  return role!;
}

async function makeInvite(roleId: string) {
  const [invite] = await db
    .insert(schema.invitations)
    .values({
      tenantId: TENANT,
      email: `invitee-${crypto.randomUUID().slice(0, 8)}@test.co.ke`,
      roleId,
      tokenHash: hashToken(`tok-${crypto.randomUUID()}`),
      invitedById: INVITER,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return invite!;
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  const [t] = await db
    .insert(schema.tenants)
    .values({ name: "Invite Co", slug: `inv-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
    .returning();
  TENANT = t!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("role-grant maker-checker", () => {
  it("a role carrying payment.approve requires an approval; a viewer-like role does not", async () => {
    const approverRole = await makeRole("ApproverLike", ["payment.approve", "batch.approve"]);
    const viewerRole = await makeRole("ViewerLike", ["reports.read"]);

    expect(await roleGrantRequiresApproval(db, approverRole.id)).toBe(true);
    expect(await roleGrantRequiresApproval(db, viewerRole.id)).toBe(false);
  });

  it("privileged invites stay PENDING until an independent checker approves; inviter cannot self-approve", async () => {
    const role = await makeRole("ApproverLike", ["payment.approve"]);
    const invite = await makeInvite(role.id);

    const { approvalRequestId } = await createInviteRoleApprovalRequest(db, {
      tenantId: TENANT,
      inviteId: invite.id,
      createdById: INVITER,
    });

    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, approvalRequestId)).limit(1);
    expect(req!.resourceType).toBe("invite");
    expect(req!.resourceId).toBe(invite.id);
    expect(req!.status).toBe("PENDING");

    // the inviter (maker) cannot approve their own role-grant request
    await expect(
      recordApprovalAction(db, { requestId: approvalRequestId, actorId: INVITER, actorRoles: CHECKER.roles, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "MAKER_CHECKER_VIOLATION" });

    // independent checker approves → invite becomes grantable
    const outcome = await recordApprovalAction(db, {
      requestId: approvalRequestId,
      actorId: CHECKER.id,
      actorRoles: CHECKER.roles,
      decision: "APPROVE",
    });
    expect(outcome.status).toBe("APPROVED");

    await applyInviteRoleDecision(db, { inviteId: invite.id, decision: "APPROVED", actorId: CHECKER.id });
    const [after] = await db
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.id, invite.id), eq(schema.invitations.tenantId, TENANT)))
      .limit(1);
    expect(after!.roleApprovalStatus).toBe("APPROVED");
    expect(after!.roleApprovedById).toBe(CHECKER.id);
  });

  it("a checker's rejection is final on the invitation", async () => {
    const role = await makeRole("FinanceLike", ["approvals.manage"]);
    const invite = await makeInvite(role.id);
    const { approvalRequestId } = await createInviteRoleApprovalRequest(db, {
      tenantId: TENANT,
      inviteId: invite.id,
      createdById: INVITER,
    });
    await recordApprovalAction(db, { requestId: approvalRequestId, actorId: CHECKER.id, actorRoles: CHECKER.roles, decision: "REJECT" });
    await applyInviteRoleDecision(db, { inviteId: invite.id, decision: "REJECTED", actorId: CHECKER.id });

    const [after] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invite.id)).limit(1);
    expect(after!.roleApprovalStatus).toBe("REJECTED");
  });
});
