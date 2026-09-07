import { NextRequest } from "next/server";
import { getDb, schema, eq, or, isNull, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { loadUserPermissions, hashToken } from "@zfloat/auth";
import { queueNotification } from "@zfloat/notifications";
import { roleGrantRequiresApproval, createInviteRoleApprovalRequest } from "@/lib/invite-controls";

const INVITE_TTL_MS = 7 * 86400_000;

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const users = await db
    .select({
      id: schema.users.id,
      fullName: schema.users.fullName,
      email: schema.users.email,
      status: schema.users.status,
      mfaEnabled: schema.users.mfaEnabled,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.tenantId, user!.tenantId!))
    .orderBy(desc(schema.users.createdAt));

  // System roles (tenantId NULL, isSystem) are global; tenant roles are scoped.
  const roles = await db
    .select()
    .from(schema.roles)
    .where(or(eq(schema.roles.tenantId, user!.tenantId!), isNull(schema.roles.tenantId)));
  return apiOk({ data: { users, roles } });
}

/** Invite a team member — invite-based registration keeps signups controlled. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();
  const perms = await loadUserPermissions(db, user!.userId);
  if (!perms.has("team.manage")) return apiError(403, "FORBIDDEN", "You need team.manage permission");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = String(b.email ?? "").trim().toLowerCase();
  const roleId = String(b.roleId ?? "");
  if (!email.includes("@")) return apiError(400, "INVALID_EMAIL", "Enter a valid email");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(roleId)) return apiError(400, "INVALID_ROLE", "Choose a role in your workspace");

  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).limit(1);
  // Accept global system roles (tenantId NULL) and this tenant's own roles.
  if (!role || (role.tenantId !== null && role.tenantId !== user!.tenantId)) {
    return apiError(400, "INVALID_ROLE", "Choose a role in your workspace");
  }

  const [existing] = await db.select().from(schema.invitations).where(eq(schema.invitations.email, email)).limit(1);
  if (existing) {
    return apiError(409, "ALREADY_INVITED", "This email already has a pending invitation");
  }

  // The raw token is emailed to the invitee — it is never returned in the
  // API response (only its hash is stored, so a DB leak cannot mint invites).
  const rawToken = `inv-${crypto.randomUUID()}`;
  const tokenHash = hashToken(rawToken);

  const [invite] = await db
    .insert(schema.invitations)
    .values({
      tenantId: user!.tenantId!,
      email,
      roleId,
      tokenHash,
      invitedById: user!.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      // Demo-only carrier so the demo UI can surface the invite link.
      // Production leaves this NULL — the token is emailed and never stored.
      rawToken: process.env.DEMO_MODE === "true" ? rawToken : null,
    })
    .returning({ id: schema.invitations.id });

  // Maker-checker for privileged role grants: inviting a user into a role
  // that carries approval/power permissions requires an independent checker's
  // sign-off before the invitee can register into that role. Atomic with the
  // invitation row so an invite can never exist without its gate.
  const roleGate = await db.transaction(async (tx) => {
    const requiresApproval = await roleGrantRequiresApproval(tx, role.id);
    if (!requiresApproval) return { requiresApproval, status: "NONE" as const, approvalRequestId: null };
    const created = await createInviteRoleApprovalRequest(tx, {
      tenantId: user!.tenantId!,
      inviteId: invite!.id,
      createdById: user!.userId,
    });
    await tx
      .update(schema.invitations)
      .set({ roleApprovalStatus: "PENDING" })
      .where(eq(schema.invitations.id, invite!.id));
    return { requiresApproval, status: "PENDING" as const, approvalRequestId: created.approvalRequestId };
  });
  const roleRequiresApproval = roleGate.requiresApproval;
  const roleApprovalStatus = roleGate.status;
  const roleApprovalRequestId = roleGate.approvalRequestId;

  const baseUrl = process.env.APP_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/register?invite=${rawToken}`;
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  // Deliver the invitation link out-of-band: EMAIL through the configured
  // channel driver in production, IN_APP in demo mode (no real inbox).
  const isDemo = process.env.DEMO_MODE === "true";

  let deliveredChannel: "EMAIL" | "IN_APP" | "none" = isDemo ? "IN_APP" : "EMAIL";
  let deliveryId: string | null = null;
  try {
    deliveryId = await queueNotification(db, {
      tenantId: user!.tenantId!,
      userId: user!.userId,
      channel: deliveredChannel,
      templateCode: "team.invite",
      title: isDemo ? "Team invitation created (demo)" : `You're invited to join ${role.name ?? "a Z-float workspace"}`,
      body: isDemo
        ? `Invitation created for ${email} — share this link with them (demo):\n\n${inviteUrl}\n\nValid until ${new Date(expiresAt).toLocaleString()}.`
        : `You've been invited to ${role.name ?? "a Z-float workspace"} by your workspace owner.\n\nAccept with this link (valid 7 days):\n${inviteUrl}\n\nIf you didn't expect this invite you can ignore this email.`,
      data: isDemo
        ? { inviteEmail: email, role: role.name, expiresAt, inviteUrl, from: user!.email }
        : { inviteEmail: email, role: role.name, expiresAt, to: email },
    });
  } catch {
    deliveredChannel = "none";
  }

  // Deliberately no raw token / inviteUrl in the response: the link is
  // delivered by the notification worker (email driver in production, IN_APP
  // in demo). Demo UI reads the token back via GET /api/team/[id]/invite-notice.
  return apiOk(
    {
      data: {
        invited: email,
        role: role.name,
        channel: deliveredChannel,
        deliveryId,
        invitationId: invite?.id ?? null,
        expiresAt,
        roleApprovalStatus,
        roleApprovalRequestId,
        roleApprovalNote: roleRequiresApproval
          ? `Inviting a user into the ${role.name} role is pending approval — an independent checker must sign off in the Approval center before this invite can be used.`
          : null,
      },
    },
    { status: 201 },
  );
}
