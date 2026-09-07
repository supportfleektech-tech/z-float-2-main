import { NextRequest, NextResponse } from "next/server";

import { getDb, schema, and, eq, gt } from "@zfloat/database";
import { hashPassword, hashToken, createSession } from "@zfloat/auth";
import { rateLimit } from "@/lib/api";

const COOKIE = "zf_session";

/** Invite-token registration. Production flow: platform admin invites a team member. */
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await rateLimit(`register:${ip}`, {
    windowMs: 10 * 60_000,
    max: 10,
  });
  if (!allowed)
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many attempts — try again shortly",
        },
      },
      { status: 429 },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = String(b.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(b.password ?? "");
  const fullName = String(b.fullName ?? "").trim();
  const inviteToken = String(b.inviteToken ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_EMAIL",
          message: "Enter a valid email address",
        },
      },
      { status: 400 },
    );
  }
  if (password.length < 10) {
    return NextResponse.json(
      {
        error: {
          code: "WEAK_PASSWORD",
          message: "Password must be at least 10 characters",
        },
      },
      { status: 400 },
    );
  }
  if (!inviteToken) {
    return NextResponse.json(
      {
        error: {
          code: "INVITE_REQUIRED",
          message:
            "Registration is invite-based. Ask your workspace owner for an invitation link.",
        },
      },
      { status: 400 },
    );
  }

  const { db } = getDb();

  const [invite] = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.tokenHash, hashToken(inviteToken)),
        gt(schema.invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!invite) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INVITE",
          message: "This invitation is invalid or has expired",
        },
      },
      { status: 400 },
    );
  }
  if (invite.acceptedAt) {
    return NextResponse.json(
      {
        error: {
          code: "INVITE_USED",
          message: "This invitation has already been used",
        },
      },
      { status: 400 },
    );
  }
  if (invite.email.toLowerCase() !== email) {
    return NextResponse.json(
      {
        error: {
          code: "EMAIL_MISMATCH",
          message: "Use the email address the invitation was sent to",
        },
      },
      { status: 400 },
    );
  }

  // Maker-checker for privileged role grants: the invitee can only register
  // into the invited role once an independent checker has approved the grant
  // (PENDING blocks; REJECTED is final).
  if (invite.roleApprovalStatus === "PENDING") {
    return NextResponse.json(
      {
        error: {
          code: "ROLE_AWAITING_APPROVAL",
          message:
            "This invitation is awaiting an approver's sign-off. Once an independent checker approves the role grant in the Approval center, you can complete registration with this link.",
        },
      },
      { status: 403 },
    );
  }
  if (invite.roleApprovalStatus === "REJECTED") {
    return NextResponse.json(
      {
        error: {
          code: "ROLE_INVITE_REJECTED",
          message: "This invitation's role grant was rejected by an approver. Ask your workspace owner to send a new invitation.",
        },
      },
      { status: 403 },
    );
  }

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error: {
          code: "EMAIL_TAKEN",
          message: "An account with this email already exists",
        },
      },
      { status: 409 },
    );
  }

  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: invite.tenantId,
      email,
      fullName,
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
    })
    .returning();
  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "CREATE_FAILED",
          message: "Account could not be created",
        },
      },
      { status: 500 },
    );
  }

  await db
    .insert(schema.userRoles)
    .values({
      userId: user.id,
      roleId: invite.roleId,
      tenantId: invite.tenantId,
    });
  await db
    .update(schema.invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(schema.invitations.id, invite.id));

  const session = await createSession(db, {
    userId: user.id,
    tenantId: user.tenantId ?? undefined,
  });
  const response = NextResponse.json(
    { user: { id: user.id, email: user.email, fullName: user.fullName } },
    { status: 201 },
  );
  response.cookies.set(COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: session.expiresAt,
  });
  return response;
}
