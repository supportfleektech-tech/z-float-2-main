/**
 * Demo seed — creates a fully working demo environment:
 * - 1 demo business (Acme Traders Ltd), 3 branches, wallets
 * - 5 users with different roles + demo login
 * - 25 recipients, 50 transactions across states, 5 pending approvals
 * - 3 scheduled payments, payroll + airtime batches, recon exceptions
 * - admin pricing versions, approval policies, billers, catalog, flags,
 *   notification templates, providers/routes, KYC case, audit trail
 *
 * Usage: pnpm db:seed (idempotent — safe to run multiple times)
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getConfig } from "@zfloat/config";
import { createDb, schema, toJsonSafe } from "../index.js";
import { hashPassword } from "@zfloat/auth";
import { ensureSystemChart, postFundingJournal } from "@zfloat/ledger";
import {
  createPayment,
  submitPayment,
  executePayment,
  createBatch,
  submitBatch,
  materializeBatchRow,
  markBatchRowOutcome,
  refreshBatchStatus,
} from "@zfloat/payments-core";
import { MockProvider } from "@zfloat/providers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../../.env"), quiet: true });

const DEMO_EMAIL = "demo@zfloat.app";
const DEMO_PASSWORD = "Demo@12345";

const KES = (v: string) => BigInt(Math.round(Number(v) * 100));

async function main() {
  const config = getConfig();
  if (config.NODE_ENV === "production" || config.NODE_ENV === "staging") {
    // eslint-disable-next-line no-console
    console.error(
      "[seed] refusing to run demo seed in production/staging. Set NODE_ENV=local|development.",
    );
    process.exit(1);
  }
  if (!config.SEED_DEMO_DATA && !config.DEMO_MODE) {
    // eslint-disable-next-line no-console
    console.log(
      "[seed] SEED_DEMO_DATA/DEMO_MODE not enabled — skipping demo data.",
    );
    return;
  }
  const { db, pool } = createDb();

  // ---------------- system roles & permissions ----------------
  const systemRoles: Record<string, string[]> = {
    OWNER: [
      "payment.create",
      "payment.approve",
      "payment.reverse",
      "payment.read",
      "batch.create",
      "batch.approve",
      "recipient.manage",
      "wallet.fund",
      "wallet.read",
      "ledger.read",
      "reports.read",
      "reports.export",
      "reconciliation.manage",
      "team.manage",
      "settings.manage",
      "approvals.manage",
      "payroll.manage",
      "expenses.manage",
      "bills.manage",
      "airtime.manage",
    ],
    ADMIN: [
      "payment.create",
      "payment.approve",
      "payment.reverse",
      "payment.read",
      "batch.create",
      "batch.approve",
      "recipient.manage",
      "wallet.fund",
      "wallet.read",
      "ledger.read",
      "reports.read",
      "reports.export",
      "reconciliation.manage",
      "team.manage",
      "settings.manage",
      "approvals.manage",
      "payroll.manage",
      "expenses.manage",
      "bills.manage",
      "airtime.manage",
    ],
    FINANCE_MANAGER: [
      "payment.create",
      "payment.approve",
      "payment.read",
      "payment.reverse",
      "batch.create",
      "batch.approve",
      "recipient.manage",
      "wallet.read",
      "wallet.fund",
      "ledger.read",
      "reports.read",
      "reports.export",
      "reconciliation.manage",
      "approvals.manage",
      "payroll.manage",
      "expenses.manage",
      "bills.manage",
      "airtime.manage",
    ],
    MAKER: [
      "payment.create",
      "payment.read",
      "batch.create",
      "recipient.manage",
      "bills.manage",
      "airtime.manage",
      "expenses.manage",
    ],
    APPROVER: [
      "payment.read",
      "payment.approve",
      "batch.approve",
      "reports.read",
    ],
    PAYROLL_OFFICER: [
      "payment.read",
      "payroll.manage",
      "batch.create",
      "recipient.manage",
    ],
    PROCUREMENT_OFFICER: [
      "payment.read",
      "payment.create",
      "recipient.manage",
      "bills.manage",
      "expenses.manage",
    ],
    ACCOUNTANT: [
      "payment.read",
      "ledger.read",
      "reports.read",
      "reports.export",
      "reconciliation.manage",
    ],
    BRANCH_MANAGER: [
      "payment.read",
      "payment.create",
      "payment.approve",
      "reports.read",
      "wallet.read",
    ],
    VIEWER: ["payment.read", "reports.read", "wallet.read"],
    SUPER_ADMIN: [
      "admin.tenants",
      "admin.providers",
      "admin.pricing",
      "admin.limits",
      "admin.routing",
      "admin.flags",
      "admin.audit",
      "admin.kyc",
      "admin.cms",
      "admin.support",
      "admin.health",
      "admin.users",
      "admin.recon",
      "admin.settlement",
      "reports.read",
      "ledger.read",
      "payment.read",
    ],
    OPS_ADMIN: [
      "admin.tenants",
      "admin.providers",
      "admin.routing",
      "admin.health",
      "admin.recon",
      "admin.settlement",
      "admin.support",
    ],
    COMPLIANCE_ADMIN: [
      "admin.kyc",
      "admin.audit",
      "admin.tenants",
      "admin.limits",
      "admin.recon",
    ],
    SUPPORT_ADMIN: ["admin.support", "admin.tenants", "admin.health"],
    AUDITOR: ["admin.audit", "admin.health", "reports.read", "admin.recon"],
  };

  // eslint-disable-next-line no-console
  console.log("[seed] roles & permissions...");
  for (const [roleName, perms] of Object.entries(systemRoles)) {
    const scope =
      roleName === "SUPER_ADMIN" ||
      roleName === "OPS_ADMIN" ||
      roleName === "COMPLIANCE_ADMIN" ||
      roleName === "SUPPORT_ADMIN" ||
      roleName === "AUDITOR"
        ? "PLATFORM"
        : "BUSINESS";
    const [role] = await db
      .insert(schema.roles)
      .values({ scope, name: roleName, isSystem: true })
      .onConflictDoNothing({ target: [schema.roles.scope, schema.roles.name] })
      .returning();
    if (role) {
      for (const code of perms) {
        // Insert the permission if missing, then wire role→permission
        // unconditionally: onConflictDoNothing().returning() yields no row for
        // codes already created by an earlier role, which used to silently
        // skip the wiring for every role that shared codes with OWNER.
        await db
          .insert(schema.permissions)
          .values({ code, name: code })
          .onConflictDoNothing({ target: [schema.permissions.code] });
        const [permission] = await db
          .select()
          .from(schema.permissions)
          .where(eq(schema.permissions.code, code))
          .limit(1);
        if (permission) {
          await db
            .insert(schema.rolePermissions)
            .values({ roleId: role.id, permissionId: permission.id })
            .onConflictDoNothing();
        }
      }
    }
  }

  // ---------------- platform admin ----------------
  const adminEmail = config.ADMIN_EMAIL;
  const [existingAdmin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);
  let adminId = existingAdmin?.id;
  if (!adminId) {
    // eslint-disable-next-line no-console
    console.log(`[seed] creating platform admin ${adminEmail}`);
    const password = config.ADMIN_PASSWORD || DEMO_PASSWORD;
    const [admin] = await db
      .insert(schema.users)
      .values({
        email: adminEmail,
        fullName: "Platform Admin",
        passwordHash: await hashPassword(password),
        status: "ACTIVE",
      })
      .returning();
    adminId = admin!.id;
    const [superAdminRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, "SUPER_ADMIN"))
      .limit(1);
    if (superAdminRole) {
      await db
        .insert(schema.userRoles)
        .values({
          userId: adminId!,
          roleId: superAdminRole.id,
          tenantId: "00000000-0000-0000-0000-000000000000",
        })
        .onConflictDoNothing();
    }
  }

  // ---------------- second platform admin (maker-checker demo) ----------------
  // Platform config changes now require two distinct platform admins
  // (maker ≠ checker). ops@zfloat.app is the demo checker for the admin
  // config approvals centre. Production needs at least two SUPER_ADMIN
  // accounts; see docs/GAP-ANALYSIS.md Phase 1.
  const checkerEmail = process.env.OPS_ADMIN_EMAIL || "ops@zfloat.app";
  const [existingOps] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, checkerEmail))
    .limit(1);
  if (!existingOps) {
    console.log(`[seed] creating second platform admin ${checkerEmail}`);
    const [ops] = await db
      .insert(schema.users)
      .values({
        email: checkerEmail,
        fullName: "Platform Checker",
        passwordHash: await hashPassword(DEMO_PASSWORD),
        status: "ACTIVE",
      })
      .returning();
    const [superAdminRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, "SUPER_ADMIN"))
      .limit(1);
    if (ops && superAdminRole) {
      await db
        .insert(schema.userRoles)
        .values({
          userId: ops.id,
          roleId: superAdminRole.id,
          tenantId: "00000000-0000-0000-0000-000000000000",
        })
        .onConflictDoNothing();
    }
  }

  // ---------------- demo tenant ----------------
  const [existingTenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, "acme-traders"))
    .limit(1);
  if (existingTenant) {
    // eslint-disable-next-line no-console
    console.log("[seed] demo tenant already exists — skipping.");
    await pool.end();
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[seed] demo tenant + business structure...");
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: "Acme Traders Ltd",
      slug: "acme-traders",
      status: "ACTIVE",
      riskTier: "STANDARD",
      kybStatus: "APPROVED",
      settings: {
        currency: "KES",
        country: "KE",
        allowBulk: true,
        allowPayroll: true,
      },
    })
    .returning();
  const tenantId = tenant!.id;
  await ensureSystemChart(db, tenantId);

  const branchNames = [
    { name: "Nairobi HQ", code: "NBO" },
    { name: "Mombasa Branch", code: "MBA" },
    { name: "Kisumu Branch", code: "KSM" },
  ];
  const branchIds: string[] = [];
  for (const b of branchNames) {
    const [branch] = await db
      .insert(schema.branches)
      .values({ tenantId, name: b.name, code: b.code })
      .returning();
    branchIds.push(branch!.id);
  }
  await db
    .insert(schema.departments)
    .values({
      tenantId,
      branchId: branchIds[0],
      name: "Operations",
      code: "OPS",
    });

  const [wallet] = await db
    .insert(schema.wallets)
    .values({
      tenantId,
      branchId: branchIds[0],
      name: "Main Operating Wallet",
      currency: "KES",
    })
    .returning();
  const walletId = wallet!.id;
  await postFundingJournal(db, {
    tenantId,
    walletId,
    amountMinor: KES("2500000.00"),
  });
  await db
    .update(schema.wallets)
    .set({ availableMinor: KES("2500000.00") })
    .where(eq(schema.wallets.id, walletId));

  // ---------------- demo users ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] demo users...");
  const users = [
    {
      email: DEMO_EMAIL,
      name: "Demo Owner",
      role: "OWNER",
      branch: branchIds[0],
    },
    {
      email: "finance@acme.co.ke",
      name: "Grace Mwangi",
      role: "FINANCE_MANAGER",
      branch: branchIds[0],
    },
    {
      email: "maker@acme.co.ke",
      name: "Brian Otieno",
      role: "MAKER",
      branch: branchIds[1],
    },
    {
      email: "approver@acme.co.ke",
      name: "Faith Njeri",
      role: "APPROVER",
      branch: branchIds[0],
    },
    {
      email: "accountant@acme.co.ke",
      name: "Peter Kilonzo",
      role: "ACCOUNTANT",
      branch: branchIds[2],
    },
  ];
  const userIds: Record<string, string> = {};
  for (const u of users) {
    const [user] = await db
      .insert(schema.users)
      .values({
        tenantId,
        email: u.email,
        fullName: u.name,
        passwordHash: await hashPassword(
          u.email === DEMO_EMAIL
            ? DEMO_PASSWORD
            : `Acme@${u.name.split(" ")[0]}123!`,
        ),
        status: "ACTIVE",
        mfaEnabled: false,
      })
      .returning();
    userIds[u.role] = user!.id;
    const [role] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, u.role))
      .limit(1);
    if (role) {
      await db
        .insert(schema.userRoles)
        .values({
          userId: user!.id,
          roleId: role.id,
          tenantId,
          branchIds: u.branch ? [u.branch] : [],
        })
        .onConflictDoNothing();
    }
  }

  // ---------------- recipients (25) ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] 25 recipients...");
  const firstNames = [
    "James",
    "Mary",
    "John",
    "Wanjiru",
    "David",
    "Amina",
    "Samuel",
    "Lucy",
    "Kevin",
    "Esther",
    "Collins",
    "Mercy",
    "Daniel",
    "Joy",
    "Victor",
    "Naomi",
    "Felix",
    "Cynthia",
    "George",
    "Ruth",
    "Emmanuel",
    "Purity",
    "Michael",
    "Sarah",
    "Tom",
  ];
  const lastNames = [
    "Kamau",
    "Wanjiku",
    "Otieno",
    "Njeri",
    "Mutua",
    "Hassan",
    "Kiprotich",
    "Achieng",
    "Omondi",
    "Wambui",
    "Kariuki",
    "Atieno",
    "Maina",
    "Chebet",
    "Barasa",
    "Akinyi",
    "Muthoni",
    "Njoroge",
    "Ochieng",
    "Wairimu",
    "Kibet",
    "Nyambura",
    "Munyao",
    "Jerono",
    "Odhiambo",
  ];
  const recipientIds: string[] = [];
  for (let i = 0; i < 25; i++) {
    const phone = `+2547${String(10000000 + i * 137913).slice(0, 8)}`;
    const type = i % 5 === 0 ? "supplier" : i % 7 === 0 ? "employee" : "person";
    const [r] = await db
      .insert(schema.beneficiaries)
      .values({
        tenantId,
        type,
        name: `${firstNames[i]} ${lastNames[i]}`,
        phone,
        email: `${firstNames[i]!.toLowerCase()}.${lastNames[i]!.toLowerCase()}@example.co.ke`,
        status: "ACTIVE",
        createdById: userIds["MAKER"]!,
        notes: type === "supplier" ? "Verified supplier" : undefined,
      })
      .returning();
    recipientIds.push(r!.id);
  }

  // ---------------- fee rules + versions ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] pricing (fee rules + versions)...");
  const feeDefs = [
    {
      product: "single_payment",
      channel: "mpesa",
      provider: "mpesa-safaricom",
      flat: "0",
      pct: "1.5",
      min: "0",
      max: "0",
    },
    {
      product: "single_payment",
      channel: "mpesa",
      provider: "local-sandbox",
      flat: "0",
      pct: "1.5",
      min: "0",
      max: "0",
    },
    {
      product: "single_payment",
      channel: "till",
      provider: "local-sandbox",
      flat: "5.00",
      pct: "0.5",
      min: "0",
      max: "0",
    },
    {
      product: "bulk_payment",
      channel: "mpesa",
      provider: "local-sandbox",
      flat: "0",
      pct: "1.0",
      min: "0",
      max: "0",
    },
    {
      product: "bulk_payment",
      channel: "mpesa",
      provider: "mpesa-safaricom",
      flat: "0",
      pct: "1.0",
      min: "0",
      max: "0",
    },
    {
      product: "payroll",
      channel: "mpesa",
      provider: "local-sandbox",
      flat: "0",
      pct: "0.75",
      min: "0",
      max: "0",
    },
    {
      product: "airtime",
      channel: "airtime",
      provider: "local-sandbox",
      flat: "0",
      pct: "2.0",
      min: "0",
      max: "0",
    },
  ];
  for (let v = 1; v <= 3; v++) {
    for (const f of feeDefs) {
      const [rule] = await db
        .insert(schema.feeRules)
        .values({
          tenantId: null,
          product: f.product,
          channel: f.channel,
          provider: f.provider,
          flatFeeMinor: KES(f.flat),
          percentBps: BigInt(Math.round(Number(f.pct) * 100)),
          minFeeMinor: KES(f.min),
          maxFeeMinor: KES(f.max),
          currency: "KES",
          status: v === 3 ? "ACTIVE" : "DISABLED",
          version: v,
          changeComment: v === 3 ? "Q3 2026 pricing" : `previous pricing v${v}`,
        })
        .returning();
      if (rule) {
        await db.insert(schema.feeVersions).values({
          feeRuleId: rule.id,
          version: v,
          snapshot: toJsonSafe({
            flatFeeMinor: rule.flatFeeMinor,
            percentBps: rule.percentBps,
            status: rule.status,
          }) as Record<string, unknown>,
          changeComment: rule.changeComment,
          createdById: adminId,
        });
      }
    }
  }

  // ---------------- approval policies ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] approval policies...");
  const [policy] = await db
    .insert(schema.approvalPolicies)
    .values({
      tenantId,
      name: "Standard Tiered Approval",
      description:
        "Small payments need one approver; large ones need finance manager + owner.",
      version: 1,
      active: true,
      createdById: userIds["OWNER"]!,
      rules: toJsonSafe([
        {
          minAmountMinor: 0n,
          maxAmountMinor: 1000000n,
          mode: "ANY",
          requiredRoles: ["APPROVER"],
          minApprovers: 1,
          order: 0,
        },
        {
          minAmountMinor: 1000001n,
          maxAmountMinor: 10000000n,
          mode: "SEQUENTIAL",
          requiredRoles: ["APPROVER", "FINANCE_MANAGER"],
          minApprovers: 1,
          order: 1,
        },
        {
          minAmountMinor: 10000001n,
          mode: "SEQUENTIAL",
          requiredRoles: ["APPROVER", "FINANCE_MANAGER", "OWNER"],
          minApprovers: 1,
          order: 2,
        },
      ]) as unknown as Record<string, unknown>[],
    })
    .returning();
  await db.insert(schema.approvalPolicyVersions).values({
    policyId: policy!.id,
    version: 1,
    rulesSnapshot: policy!.rules,
    changeComment: "initial policy",
    createdById: userIds["OWNER"]!,
  });

  // ---------------- transactions: 50 total ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] 50 transactions across states...");
  const states: Array<{ n: number; status: string; product: string }> = [
    { n: 30, status: "SUCCESS", product: "single_payment" },
    { n: 5, status: "FAILED", product: "single_payment" },
    { n: 3, status: "PROVIDER_PENDING", product: "single_payment" },
    { n: 3, status: "DRAFT", product: "single_payment" },
    { n: 5, status: "PENDING_APPROVAL", product: "single_payment" },
    { n: 2, status: "QUEUED", product: "single_payment" },
    { n: 2, status: "REVERSED", product: "single_payment" },
  ];
  const provider = new MockProvider("success");
  let seq = 0;
  for (const s of states) {
    for (let i = 0; i < s.n; i++) {
      seq += 1;
      const amount = `${(500 + ((seq * 137) % 45000)) / 100}`; // between 5.00 and 455.00
      const recipient = recipientIds[seq % 25]!;
      try {
        const { payment } = await createPayment(db, {
          tenantId,
          actorId: userIds["MAKER"]!,
          amount,
          channel: "mpesa",
          sourceWalletId: walletId,
          recipient: {
            name: `Recipient ${seq}`,
            phone: `071${String(20000000 + seq * 7).slice(0, 8)}`,
          },
          idempotencyKey: `seed-${s.status}-${seq}`,
          category: [
            "office-supplies",
            "transport",
            "utilities",
            "salaries",
            "marketing",
          ][seq % 5]!,
          remark: `Seeded ${s.status.toLowerCase()} payment #${seq}`,
        });
        if (s.status === "SUCCESS") {
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [],
          });
          await executePayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            provider,
            attemptNumber: 1,
          });
        } else if (s.status === "FAILED") {
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [],
          });
          await db
            .update(schema.payments)
            .set({
              status: "FAILED",
              failureReason: "Provider rejected: duplicate beneficiary details",
            })
            .where(eq(schema.payments.id, payment.paymentId));
        } else if (s.status === "PROVIDER_PENDING") {
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [],
          });
          await db
            .update(schema.payments)
            .set({
              status: "PROVIDER_PENDING",
              providerStatus: "PENDING",
              providerReference: `MOCK-ZF-${payment.paymentNumber}`,
            })
            .where(eq(schema.payments.id, payment.paymentId));
        } else if (s.status === "QUEUED") {
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [],
          });
        } else if (s.status === "PENDING_APPROVAL") {
          // route through the tiered policy so a real approval request is created
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [
              {
                minAmountMinor: 0n,
                maxAmountMinor: 1000000n,
                mode: "ANY",
                requiredRoles: ["APPROVER"],
                minApprovers: 1,
                order: 0,
              },
              {
                minAmountMinor: 1000001n,
                mode: "SEQUENTIAL",
                requiredRoles: ["APPROVER", "FINANCE_MANAGER", "OWNER"],
                minApprovers: 1,
                order: 1,
              },
            ],
          });
        } else if (s.status === "REVERSED") {
          await submitPayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            actorId: userIds["MAKER"]!,
            policyRules: [],
          });
          await executePayment(db, {
            tenantId,
            paymentId: payment.paymentId,
            provider,
            attemptNumber: 1,
          });
          await db
            .update(schema.payments)
            .set({
              status: "REVERSED",
              reversalReason: "Customer requested refund",
              providerStatus: "REVERSED",
            })
            .where(eq(schema.payments.id, payment.paymentId));
        }
        // PENDING_APPROVAL and DRAFT stay as created
        void recipient;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[seed] payment ${seq} skipped:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // ---------------- pending approval requests (5) ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] 5 pending approval requests...");
  // Requests were created by submitPayment above; give the first one its steps.
  const [req] = await db.select().from(schema.approvalRequests).limit(1);
  if (req) {
    await db.insert(schema.approvalSteps).values([
      {
        requestId: req.id,
        level: 1,
        mode: "SEQUENTIAL",
        roles: ["APPROVER"],
        minApprovers: 1,
        status: "IN_PROGRESS",
      },
      {
        requestId: req.id,
        level: 2,
        mode: "SEQUENTIAL",
        roles: ["FINANCE_MANAGER"],
        minApprovers: 1,
        status: "PENDING",
      },
    ]);
  }

  // ---------------- schedules (3) ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] 3 scheduled payments...");
  const schedules = [
    { name: "Rent — Westlands office", amount: "85000.00", freq: "MONTHLY" },
    { name: "Internet — Zuku", amount: "6500.00", freq: "MONTHLY" },
    { name: "Security — KK Security", amount: "12500.00", freq: "MONTHLY" },
  ];
  for (const s of schedules) {
    await db.insert(schema.paymentSchedules).values({
      tenantId,
      name: s.name,
      beneficiaryId: recipientIds[schedules.indexOf(s) % 25],
      beneficiarySnapshot: {
        name: s.name,
        phone: `+2547${String(31000000 + schedules.indexOf(s) * 999).slice(0, 8)}`,
      },
      amountMinor: KES(s.amount),
      currency: "KES",
      frequency: s.freq,
      startDate: new Date(),
      nextRunAt: new Date(Date.now() + 5 * 24 * 3600_000),
      status: "ACTIVE",
      channel: "mpesa",
      createdById: userIds.FINANCE_MANAGER,
    });
  }

  // ---------------- batches: payroll + airtime + one pending ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] payroll + airtime batches...");
  const payroll = await createBatch(db, {
    tenantId,
    actorId: userIds["MAKER"]!,
    name: "July Payroll Run",
    channel: "mpesa",
    rows: Array.from({ length: 12 }, (_, i) => ({
      rowNumber: i + 1,
      recipientName: `${firstNames[i]} ${lastNames[i]}`,
      phone: `07${String(400000000 + i * 99991).slice(0, 8)}`,
      amountMinor: KES((25000 + i * 3500).toString()),
      category: "salaries",
    })),
  });
  await submitBatch(db, {
    tenantId,
    batchId: payroll.batchId,
    actorId: userIds["MAKER"]!,
    policyRules: [],
  });

  // execute a few rows to completion for realism (full pipeline: provider + journals)
  const demoProvider = new MockProvider("success");
  const payrollRows = await db
    .select()
    .from(schema.paymentBatchRows)
    .where(eq(schema.paymentBatchRows.batchId, payroll.batchId))
    .limit(4);
  for (const row of payrollRows) {
    const { paymentId } = await materializeBatchRow(db, {
      tenantId,
      batchId: payroll.batchId,
      rowId: row.id,
      actorId: userIds["MAKER"]!,
    });
    await executePayment(db, {
      tenantId,
      paymentId,
      provider: demoProvider,
      attemptNumber: 1,
    });
    await markBatchRowOutcome(db, { rowId: row.id, status: "SUCCESS" });
  }
  await refreshBatchStatus(db, payroll.batchId);

  const airtime = await createBatch(db, {
    tenantId,
    actorId: userIds["MAKER"]!,
    name: "Field Team Airtime",
    channel: "mpesa",
    rows: Array.from({ length: 6 }, (_, i) => ({
      rowNumber: i + 1,
      recipientName: `Field Agent ${i + 1}`,
      phone: `07${String(500000000 + i * 77771).slice(0, 8)}`,
      amountMinor: KES("500.00"),
      category: "airtime",
    })),
  });
  await submitBatch(db, {
    tenantId,
    batchId: airtime.batchId,
    actorId: userIds["MAKER"]!,
    policyRules: [],
  });
  for (const row of await db
    .select()
    .from(schema.paymentBatchRows)
    .where(eq(schema.paymentBatchRows.batchId, airtime.batchId))
    .limit(6)) {
    const { paymentId } = await materializeBatchRow(db, {
      tenantId,
      batchId: airtime.batchId,
      rowId: row.id,
      actorId: userIds["MAKER"]!,
    });
    await executePayment(db, {
      tenantId,
      paymentId,
      provider: demoProvider,
      attemptNumber: 1,
    });
    await markBatchRowOutcome(db, { rowId: row.id, status: "SUCCESS" });
  }
  await refreshBatchStatus(db, airtime.batchId);

  // one batch pending approval
  const pendingBatch = await createBatch(db, {
    tenantId,
    actorId: userIds["MAKER"]!,
    name: "Supplier Payments — Pending Review",
    channel: "mpesa",
    rows: [
      {
        rowNumber: 1,
        recipientName: "Kenya Steel Ltd",
        phone: "0716000001",
        amountMinor: KES("450000.00"),
      },
      {
        rowNumber: 2,
        recipientName: "Nairobi Packing Co",
        phone: "0716000002",
        amountMinor: KES("220000.00"),
      },
    ],
  });
  await submitBatch(db, {
    tenantId,
    batchId: pendingBatch.batchId,
    actorId: userIds["MAKER"]!,
    policyRules: [
      {
        minAmountMinor: 0n,
        mode: "SEQUENTIAL",
        requiredRoles: ["APPROVER", "FINANCE_MANAGER"],
        minApprovers: 1,
        order: 0,
      },
    ],
  });

  // ---------------- billers & airtime catalog ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] billers + airtime catalog...");
  const billers = [
    {
      code: "KPLC-PB",
      name: "Kenya Power (KPLC)",
      category: "Utilities",
      channel: "paybill",
      accountNumber: "888880",
    },
    {
      code: "NWSC-PB",
      name: "Nairobi Water",
      category: "Utilities",
      channel: "paybill",
      accountNumber: "999999",
    },
    {
      code: "ZUKU-PB",
      name: "Zuku Fibre",
      category: "Telecom",
      channel: "paybill",
      accountNumber: "542542",
    },
    {
      code: "SAF-PB",
      name: "Safaricom Postpaid",
      category: "Telecom",
      channel: "paybill",
      accountNumber: "123456",
    },
    {
      code: "KRA-PB",
      name: "KRA (PAYE)",
      category: "Government",
      channel: "paybill",
      accountNumber: "572572",
    },
  ];
  for (const b of billers) {
    await db
      .insert(schema.billers)
      .values(b)
      .onConflictDoNothing({ target: [schema.billers.code] });
  }
  const airtimeProducts = [
    {
      providerCode: "airtime-aggregator",
      network: "SAFARICOM",
      productCode: "SAF-10",
      name: "Safaricom Airtime KES 10",
      type: "AIRTIME",
      denominationMinor: KES("10"),
    },
    {
      providerCode: "airtime-aggregator",
      network: "SAFARICOM",
      productCode: "SAF-50",
      name: "Safaricom Airtime KES 50",
      type: "AIRTIME",
      denominationMinor: KES("50"),
    },
    {
      providerCode: "airtime-aggregator",
      network: "SAFARICOM",
      productCode: "SAF-1GB",
      name: "Safaricom Data 1GB",
      type: "DATA",
      denominationMinor: KES("100"),
    },
    {
      providerCode: "airtime-aggregator",
      network: "AIRTEL",
      productCode: "AIRT-10",
      name: "Airtel Airtime KES 10",
      type: "AIRTIME",
      denominationMinor: KES("10"),
    },
    {
      providerCode: "airtime-aggregator",
      network: "TELKOM",
      productCode: "TELK-10",
      name: "Telkom Airtime KES 10",
      type: "AIRTIME",
      denominationMinor: KES("10"),
    },
  ];
  for (const p of airtimeProducts) {
    await db.insert(schema.airtimeCatalog).values(p).onConflictDoNothing();
  }

  // ---------------- providers & routes ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] providers + routing...");
  const [sandboxProvider] = await db
    .insert(schema.providers)
    .values({
      code: "local-sandbox",
      name: "Local Sandbox (simulated)",
      providerType: "sandbox",
      environment: "sandbox",
      enabled: true,
      priority: 10,
      config: {},
    })
    .onConflictDoNothing({ target: [schema.providers.code] })
    .returning();
  const [mpesaProvider] = await db
    .insert(schema.providers)
    .values({
      code: "mpesa-safaricom",
      name: "Safaricom M-Pesa (Daraja)",
      providerType: "mpesa",
      environment: "sandbox",
      enabled: false,
      priority: 20,
      config: { requiresCredentials: true },
    })
    .onConflictDoNothing({ target: [schema.providers.code] })
    .returning();
  void mpesaProvider;
  if (sandboxProvider) {
    await db
      .insert(schema.paymentRoutes)
      .values([
        {
          product: "single_payment",
          channel: "mpesa",
          providerId: sandboxProvider.id,
          priority: 10,
          enabled: true,
        },
        {
          product: "bulk_payment",
          channel: "mpesa",
          providerId: sandboxProvider.id,
          priority: 10,
          enabled: true,
        },
        {
          product: "payroll",
          channel: "mpesa",
          providerId: sandboxProvider.id,
          priority: 10,
          enabled: true,
        },
      ])
      .onConflictDoNothing();
  }

  // ---------------- reconciliation exceptions ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] reconciliation exceptions...");
  const [run] = await db
    .insert(schema.reconRuns)
    .values({
      tenantId,
      periodStart: new Date(Date.now() - 7 * 86400_000),
      periodEnd: new Date(),
      source: "WEBHOOK",
      status: "EXCEPTIONS",
    })
    .returning();
  const reconItems = [
    {
      providerReference: "MOCK-ZF-MISMATCH-1",
      amountMinor: KES("9999.00"),
      status: "UNMATCHED",
      kind: "UNMATCHED",
    },
    {
      providerReference: "MOCK-ZF-DUP-1",
      amountMinor: KES("4500.00"),
      status: "DUPLICATE",
      kind: "DUPLICATE",
    },
    {
      providerReference: "MOCK-ZF-AMT-1",
      amountMinor: KES("250.00"),
      status: "PARTIAL",
      kind: "AMOUNT_MISMATCH",
    },
  ];
  for (const item of reconItems) {
    const [reconItem] = await db
      .insert(schema.reconItems)
      .values({
        tenantId,
        runId: run!.id,
        source: "WEBHOOK",
        providerReference: item.providerReference,
        amountMinor: item.amountMinor,
        currency: "KES",
        occurredAt: new Date(),
        status: item.status,
        notes: `Seeded ${item.kind.toLowerCase()} for demo`,
      })
      .returning();
    await db
      .insert(schema.reconExceptions)
      .values({
        tenantId,
        itemId: reconItem!.id,
        kind: item.kind,
        severity: "HIGH",
        status: "OPEN",
        resolution: null,
      });
  }

  // ---------------- feature flags, templates, KYC, audit ----------------
  // eslint-disable-next-line no-console
  console.log("[seed] flags, templates, KYC, audit trail...");
  const flags = [
    { key: "bulk-payments", enabled: true },
    { key: "payroll", enabled: true },
    { key: "airtime", enabled: true },
    { key: "scheduled-payments", enabled: true },
    { key: "approval-engine", enabled: true },
    { key: "reconciliation", enabled: true },
    { key: "new-checkout-ui", enabled: true, percentage: 50 },
  ];
  for (const f of flags) {
    await db
      .insert(schema.featureFlags)
      .values({
        key: f.key,
        enabled: f.enabled,
        percentage: f.percentage ?? 100,
        description: "seeded",
      })
      .onConflictDoNothing();
  }
  const templates = [
    {
      code: "payment.success",
      channel: "IN_APP",
      subject: "Payment successful",
      body: "Your payment {{paymentNumber}} of {{amount}} to {{beneficiary}} succeeded.",
    },
    {
      code: "payment.failed",
      channel: "IN_APP",
      subject: "Payment failed",
      body: "Payment {{paymentNumber}} failed: {{reason}}. Funds have been returned to your wallet.",
    },
    {
      code: "payment.approval.required",
      channel: "IN_APP",
      subject: "Approval required",
      body: "Payment {{paymentNumber}} of {{amount}} awaits your approval.",
    },
    {
      code: "payment.reversed",
      channel: "IN_APP",
      subject: "Payment reversed",
      body: "Payment {{paymentNumber}} was reversed. {{amount}} returned to your wallet.",
    },
  ];
  for (const t of templates) {
    await db
      .insert(schema.notificationTemplates)
      .values(t)
      .onConflictDoNothing({ target: [schema.notificationTemplates.code] });
  }
  await db.insert(schema.kybCases).values({
    tenantId,
    status: "APPROVED",
    businessType: "PRIVATE_LTD",
    documents: [
      { type: "CERTIFICATE_OF_INCORPORATION", status: "VERIFIED" },
      { type: "PIN_CERTIFICATE", status: "VERIFIED" },
    ],
    reviewedById: adminId,
    reviewNotes: "Demo approval",
    submittedAt: new Date(Date.now() - 14 * 86400_000),
    reviewedAt: new Date(Date.now() - 12 * 86400_000),
  });
  await db.insert(schema.auditEvents).values([
    {
      tenantId,
      actorId: adminId,
      action: "tenant.activated",
      resourceType: "tenant",
      resourceId: tenantId,
      after: { status: "ACTIVE" },
    },
    {
      tenantId,
      actorId: userIds.OWNER,
      action: "wallet.funded",
      resourceType: "wallet",
      resourceId: walletId,
      after: { amount: "2500000.00" },
    },
    {
      tenantId,
      actorId: adminId,
      action: "pricing.updated",
      resourceType: "fee_rule",
      after: { version: 3, comment: "Q3 2026 pricing" },
    },
  ]);
  await db
    .insert(schema.consentRecords)
    .values({
      tenantId,
      userId: userIds["OWNER"]!,
      purpose: "payment_processing",
      granted: true,
    });
  await db.insert(schema.supportTickets).values({
    tenantId,
    userId: userIds["MAKER"]!,
    subject: "How do I set up approval limits?",
    body: "I want to require two approvers for payments above 50,000 KES.",
    status: "OPEN",
    priority: "NORMAL",
  });

  // ---------------- marketing site content (admin-editable) ----------------
  // pages + settings drive the public site; platform admins can edit these in
  // the admin console (or directly in DB) with NO code changes required.
  console.log("[seed] marketing pages + site settings...");
  const pricingCopy = {
    hero: {
      title: "Simple, honest pricing",
      subtitle:
        "One flat platform fee per successful payment. No setup costs, no monthly minimums, no surprises. Volume discounts apply automatically.",
    },
    plans: [
      {
        name: "Starter",
        pricePerPaymentMinor: 1500, // KES 15.00
        monthlyMinor: 0,
        features: [
          "Up to 500 payments / month",
          "Single wallet",
          "Email support",
          "1 team seat",
        ],
      },
      {
        name: "Growth",
        pricePerPaymentMinor: 1000, // KES 10.00
        monthlyMinor: 499000, // KES 4,990
        features: [
          "Unlimited payments",
          "Bulk upload + payroll",
          "Approval workflows",
          "10 team seats",
          "Priority support",
        ],
        highlighted: true,
      },
      {
        name: "Enterprise",
        pricePerPaymentMinor: 0,
        monthlyMinor: 0,
        features: [
          "Everything in Growth",
          "Unlimited seats",
          "Dedicated success manager",
          "SLA + custom rails",
          "SSO/SAML",
        ],
        cta: "Talk to sales",
      },
    ],
    note: "Payment execution is performed by regulated partners; their charges are passed through at cost and shown before you confirm.",
  };
  await db
    .insert(schema.pages)
    .values({
      slug: "pricing",
      title: "Pricing",
      content: JSON.stringify(pricingCopy),
      status: "PUBLISHED",
    })
    .onConflictDoNothing();

  const siteSettings = {
    "site.brand.name": "Z-float",
    "site.pricing.pageSlug": "pricing",
    "site.features.solutions": [
      {
        title: "Business payments",
        desc: "Send money to any M-Pesa phone, till, paybill or bank account in seconds.",
        href: "/solutions/business-payments",
      },
      {
        title: "Corporate bills",
        desc: "Pay KPLC, water, internet and hundreds of billers on schedule.",
        href: "/solutions/corporate-bills",
      },
      {
        title: "Supplier & vendor payments",
        desc: "Verified supplier accounts, invoices attached, payments reconciled.",
        href: "/solutions/supplier-payments",
      },
      {
        title: "Payroll",
        desc: "Run payroll batches from a spreadsheet with validation and approvals.",
        href: "/solutions/payroll",
      },
      {
        title: "Petty cash & expenses",
        desc: "Team spending authority with receipts and approvals.",
        href: "/solutions/petty-cash",
      },
      {
        title: "Bulk airtime & data",
        desc: "Top up field teams across Safaricom, Airtel and Telkom.",
        href: "/solutions/bulk-airtime",
      },
    ],
    "site.faq.items": [
      {
        q: "How do I fund my wallet?",
        a: "Top up through your bank (EFT or RTGS) or via M-Pesa. Funds are journaled to your wallet instantly.",
      },
      {
        q: "What does a payment cost?",
        a: "A flat platform fee per successful payment, quoted before you confirm. Partner rail charges pass through at cost.",
      },
      {
        q: "Can I run bulk payments?",
        a: "Yes — CSV/XLSX upload with server-side validation, row-level errors and batch approvals.",
      },
      {
        q: "Is my money safe?",
        a: "Money sits in regulated partner accounts; Z-float keeps an immutable double-entry ledger and never mixes client funds.",
      },
      {
        q: "What rails are supported?",
        a: "Sandbox demonstration of M-Pesa (Daraja-style), paybill, till and bank flows. Live rails are enabled per merchant.",
      },
    ],
  };
  for (const [key, value] of Object.entries(siteSettings)) {
    await db
      .insert(schema.settings)
      .values({
        scope: "GLOBAL",
        key,
        value: toJsonSafe(value) as Record<string, unknown>,
      })
      .onConflictDoNothing();
  }

  // ---------------- done ----------------
  // eslint-disable-next-line no-console
  console.log("──────────────────────────────────────────────");
  // eslint-disable-next-line no-console
  console.log("✅ Seed complete!");
  // eslint-disable-next-line no-console
  console.log(` Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  // eslint-disable-next-line no-console
  console.log(
    ` Admin login: ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD || DEMO_PASSWORD}`,
  );
  // eslint-disable-next-line no-console
  console.log("──────────────────────────────────────────────");
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[seed] failed:", err);
  process.exit(1);
});
