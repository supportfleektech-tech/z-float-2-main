/**
 * Budget Management Engine — Core Implementation
 *
 * Handles budgets, spend limits, and petty cash wallets with:
 * - Period-based budgets (monthly/quarterly/yearly/custom)
 * - Category-level budget items with warn/block thresholds
 * - Spend limits per entity (branch, department, employee) with actions (WARN/BLOCK/REQUIRE_APPROVAL)
 * - Petty cash sub-wallets with daily/monthly limits and parent approval
 * - Alerts at 80%, 90%, 100% thresholds
 */

import { and, eq, sql, gte, lte, desc, inArray } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";
import { parseMinor } from "@zfloat/money";
import { createApprovalRequest, type ApprovalRule } from "@zfloat/approvals";
import { queueNotification } from "@zfloat/notifications";
import { enqueue } from "@zfloat/queue";

/* ------------------------------------------------------ Errors */

export class BudgetError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "BudgetError";
  }
}

export class InsufficientBudgetError extends BudgetError {
  constructor(message: string, readonly budgetId: string, readonly availableMinor: bigint) {
    super(message, "INSUFFICIENT_BUDGET");
    this.name = "InsufficientBudgetError";
  }
}

export class BudgetLimitExceededError extends BudgetError {
  constructor(message: string, readonly budgetId: string, readonly limitMinor: bigint, readonly spentMinor: bigint) {
    super(message, "BUDGET_LIMIT_EXCEEDED");
    this.name = "BudgetLimitExceededError";
  }
}

/* ------------------------------------------------------ Types */

export type BudgetScope = "TENANT" | "BRANCH" | "DEPARTMENT" | "EMPLOYEE";
export type BudgetPeriod = "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";
export type SpendLimitAction = "WARN" | "BLOCK" | "REQUIRE_APPROVAL";
export type BudgetStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "ARCHIVED";

export interface CreateBudgetInput {
  tenantId: string;
  actorId: string;
  name: string;
  description?: string;
  scope?: BudgetScope;
  scopeRef?: string;
  period: BudgetPeriod;
  periodStart: Date;
  periodEnd: Date;
  totalLimitMinor: bigint;
  approvalRequired?: boolean;
  approvalPolicyId?: string;
}

export interface CreateBudgetItemInput {
  budgetId: string;
  category: string;
  subCategory?: string;
  limitMinor: bigint;
  warnThresholdPct?: number; // default 80
  blockThresholdPct?: number; // default 100
}

export interface CreateSpendLimitInput {
  tenantId: string;
  actorId: string;
  entityType: BudgetScope;
  entityId: string;
  category?: string;
  subCategory?: string;
  period: BudgetPeriod;
  periodStart: Date;
  periodEnd: Date;
  limitMinor: bigint;
  action?: SpendLimitAction;
}

export interface CreatePettyCashWalletInput {
  tenantId: string;
  actorId: string;
  parentWalletId: string;
  walletId: string; // child wallet id (must exist)
  employeeId: string;
  branchId?: string;
  departmentId?: string;
  dailyLimitMinor: bigint;
  monthlyLimitMinor: bigint;
  approvalThresholdMinor?: bigint; // 0 = no auto-approval needed
  approvalPolicyId?: string;
}

export interface BudgetWithItems {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  scope: BudgetScope;
  scopeRef: string | null;
  period: BudgetPeriod;
  periodStart: Date;
  periodEnd: Date;
  totalLimitMinor: bigint;
  status: BudgetStatus;
  approvalRequired: boolean;
  approvalPolicyId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: BudgetItem[];
}

export interface BudgetItem {
  id: string;
  budgetId: string;
  category: string;
  subCategory: string | null;
  limitMinor: bigint;
  warnThresholdPct: number;
  blockThresholdPct: number;
  spentMinor: bigint;
  committedMinor: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpendLimitWithUsage {
  id: string;
  tenantId: string;
  entityType: BudgetScope;
  entityId: string;
  category: string | null;
  subCategory: string | null;
  period: BudgetPeriod;
  periodStart: Date;
  periodEnd: Date;
  limitMinor: bigint;
  action: SpendLimitAction;
  spentMinor: bigint;
  committedMinor: bigint;
  alert80Sent: boolean;
  alert90Sent: boolean;
  alert100Sent: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PettyCashWalletWithUsage {
  id: string;
  tenantId: string;
  parentWalletId: string;
  walletId: string;
  employeeId: string;
  branchId: string | null;
  departmentId: string | null;
  dailyLimitMinor: bigint;
  monthlyLimitMinor: bigint;
  dailySpentMinor: bigint;
  monthlySpentMinor: bigint;
  dailyCommittedMinor: bigint;
  monthlyCommittedMinor: bigint;
  dailyPeriodStart: Date;
  monthlyPeriodStart: Date;
  approvalThresholdMinor: bigint;
  approvalPolicyId: string | null;
  status: string;
  dailyAlert80Sent: boolean;
  dailyAlert90Sent: boolean;
  monthlyAlert80Sent: boolean;
  monthlyAlert90Sent: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  action: "NONE" | "WARN" | "BLOCK" | "REQUIRE_APPROVAL";
  budgetId?: string;
  budgetItemId?: string;
  spendLimitId?: string;
  pettyCashWalletId?: string;
  message?: string;
  usagePct?: number;
}

export interface SpendLimitCheckResult {
  allowed: boolean;
  action: SpendLimitAction;
  spendLimitId: string;
  usagePct: number;
  message?: string;
}

export interface PettyCashCheckResult {
  allowed: boolean;
  action: "NONE" | "WARN" | "BLOCK" | "REQUIRE_APPROVAL";
  pettyCashWalletId: string;
  dailyUsagePct: number;
  monthlyUsagePct: number;
  message?: string;
}

/* ------------------------------------------------------ Helpers */

function calculatePeriodStart(period: BudgetPeriod, date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case "MONTHLY":
      d.setDate(1);
      break;
    case "QUARTERLY":
      d.setMonth(Math.floor(d.getMonth() / 3) * 3);
      d.setDate(1);
      break;
    case "YEARLY":
      d.setMonth(0);
      d.setDate(1);
      break;
    case "CUSTOM":
      // Caller provides explicit dates
      break;
  }
  return d;
}

function calculatePeriodEnd(period: BudgetPeriod, start: Date): Date {
  const d = new Date(start);
  switch (period) {
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "CUSTOM":
      // Caller provides explicit dates
      break;
  }
  return new Date(d.getTime() - 1); // End of period (inclusive)
}

function isPeriodActive(periodStart: Date, periodEnd: Date, now = new Date()): boolean {
  return now >= periodStart && now <= periodEnd;
}

/* ------------------------------------------------------ Budget CRUD */

export async function createBudget(db: Db, input: CreateBudgetInput): Promise<BudgetWithItems> {
  return db.transaction(async (tx) => {
    const [budget] = await tx
      .insert(schema.budgets)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        description: input.description,
        scope: input.scope ?? "TENANT",
        scopeRef: input.scopeRef,
        period: input.period,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalLimitMinor: input.totalLimitMinor,
        status: "DRAFT",
        approvalRequired: input.approvalRequired ?? false,
        approvalPolicyId: input.approvalPolicyId,
        createdById: input.actorId,
      })
      .returning();

    if (!budget) throw new BudgetError("Failed to create budget", "CREATE_FAILED");

    return {
      ...budget,
      scope: budget.scope as BudgetScope,
      period: budget.period as BudgetPeriod,
      status: budget.status as BudgetStatus,
      items: [],
    };
  });
}

export async function getBudget(db: Db, tenantId: string, budgetId: string): Promise<BudgetWithItems | null> {
  const [budget] = await db
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.tenantId, tenantId)))
    .limit(1);

  if (!budget) return null;

  const items = await listBudgetItems(db, budgetId);
  return {
    ...budget,
    scope: budget.scope as BudgetScope,
    period: budget.period as BudgetPeriod,
    status: budget.status as BudgetStatus,
    items,
  };
}

export async function listBudgets(
  db: Db,
  tenantId: string,
  options?: { scope?: BudgetScope; scopeRef?: string; status?: BudgetStatus; activeOnly?: boolean }
): Promise<BudgetWithItems[]> {
  const conditions = [eq(schema.budgets.tenantId, tenantId)];
  if (options?.scope) conditions.push(eq(schema.budgets.scope, options.scope));
  if (options?.scopeRef) conditions.push(eq(schema.budgets.scopeRef, options.scopeRef));
  if (options?.status) conditions.push(eq(schema.budgets.status, options.status));
  if (options?.activeOnly) {
    const now = new Date();
    conditions.push(gte(schema.budgets.periodEnd, now));
    conditions.push(lte(schema.budgets.periodStart, now));
  }

  const budgets = await db
    .select()
    .from(schema.budgets)
    .where(and(...conditions))
    .orderBy(desc(schema.budgets.createdAt));

  const result: BudgetWithItems[] = [];
  for (const budget of budgets) {
    const items = await listBudgetItems(db, budget.id);
    result.push({
      ...budget,
      scope: budget.scope as BudgetScope,
      period: budget.period as BudgetPeriod,
      status: budget.status as BudgetStatus,
      items,
    });
  }
  return result;
}

export async function updateBudget(
  db: Db,
  tenantId: string,
  budgetId: string,
  updates: Partial<Pick<CreateBudgetInput, "name" | "description" | "totalLimitMinor" | "approvalRequired" | "approvalPolicyId">> & { status?: BudgetStatus }
): Promise<BudgetWithItems | null> {
  const [budget] = await db
    .update(schema.budgets)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.tenantId, tenantId)))
    .returning();

  if (!budget) return null;
  return getBudget(db, tenantId, budget.id);
}

export async function deleteBudget(db: Db, tenantId: string, budgetId: string): Promise<boolean> {
  const result = await db
    .delete(schema.budgets)
    .where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.tenantId, tenantId)));
  return (result.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------ Budget Items CRUD */

export async function createBudgetItem(db: Db, input: CreateBudgetItemInput): Promise<BudgetItem> {
  const [item] = await db
    .insert(schema.budgetItems)
    .values({
      budgetId: input.budgetId,
      category: input.category,
      subCategory: input.subCategory,
      limitMinor: input.limitMinor,
      warnThresholdPct: input.warnThresholdPct ?? 80,
      blockThresholdPct: input.blockThresholdPct ?? 100,
    })
    .returning();

  if (!item) throw new BudgetError("Failed to create budget item", "CREATE_FAILED");
  return item;
}

export async function getBudgetItem(db: Db, itemId: string): Promise<BudgetItem | null> {
  const [item] = await db.select().from(schema.budgetItems).where(eq(schema.budgetItems.id, itemId)).limit(1);
  return item ?? null;
}

export async function listBudgetItems(db: Db, budgetId: string): Promise<BudgetItem[]> {
  return db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.budgetId, budgetId))
    .orderBy(schema.budgetItems.category);
}

export async function updateBudgetItem(
  db: Db,
  itemId: string,
  updates: Partial<Pick<CreateBudgetItemInput, "limitMinor" | "warnThresholdPct" | "blockThresholdPct">>
): Promise<BudgetItem | null> {
  const [item] = await db
    .update(schema.budgetItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.budgetItems.id, itemId))
    .returning();
  return item ?? null;
}

export async function deleteBudgetItem(db: Db, itemId: string): Promise<boolean> {
  const result = await db.delete(schema.budgetItems).where(eq(schema.budgetItems.id, itemId));
  return (result.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------ Spend Limits CRUD */

export async function createSpendLimit(db: Db, input: CreateSpendLimitInput): Promise<SpendLimitWithUsage> {
  const [limit] = await db
    .insert(schema.spendLimits)
    .values({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      category: input.category,
      subCategory: input.subCategory,
      period: input.period,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      limitMinor: input.limitMinor,
      action: input.action ?? "WARN",
      createdById: input.actorId,
    })
    .returning();

  if (!limit) throw new BudgetError("Failed to create spend limit", "CREATE_FAILED");
  return limit as SpendLimitWithUsage;
}

export async function getSpendLimit(db: Db, tenantId: string, limitId: string): Promise<SpendLimitWithUsage | null> {
  const [limit] = await db
    .select()
    .from(schema.spendLimits)
    .where(and(eq(schema.spendLimits.id, limitId), eq(schema.spendLimits.tenantId, tenantId)))
    .limit(1);
  return limit as SpendLimitWithUsage ?? null;
}

export async function listSpendLimits(
  db: Db,
  tenantId: string,
  options?: { entityType?: BudgetScope; entityId?: string; activeOnly?: boolean }
): Promise<SpendLimitWithUsage[]> {
  const conditions = [eq(schema.spendLimits.tenantId, tenantId)];
  if (options?.entityType) conditions.push(eq(schema.spendLimits.entityType, options.entityType));
  if (options?.entityId) conditions.push(eq(schema.spendLimits.entityId, options.entityId));
  if (options?.activeOnly) {
    const now = new Date();
    conditions.push(gte(schema.spendLimits.periodEnd, now));
    conditions.push(lte(schema.spendLimits.periodStart, now));
  }

  return (await db
    .select()
    .from(schema.spendLimits)
    .where(and(...conditions))
    .orderBy(desc(schema.spendLimits.createdAt))) as SpendLimitWithUsage[];
}

export async function updateSpendLimit(
  db: Db,
  tenantId: string,
  limitId: string,
  updates: Partial<Pick<CreateSpendLimitInput, "limitMinor" | "action">>
): Promise<SpendLimitWithUsage | null> {
  const [limit] = await db
    .update(schema.spendLimits)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(schema.spendLimits.id, limitId), eq(schema.spendLimits.tenantId, tenantId)))
    .returning();
  return limit as SpendLimitWithUsage ?? null;
}

export async function deleteSpendLimit(db: Db, tenantId: string, limitId: string): Promise<boolean> {
  const result = await db
    .delete(schema.spendLimits)
    .where(and(eq(schema.spendLimits.id, limitId), eq(schema.spendLimits.tenantId, tenantId)));
  return (result.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------ Petty Cash Wallets CRUD */

export async function createPettyCashWallet(db: Db, input: CreatePettyCashWalletInput): Promise<PettyCashWalletWithUsage> {
  return db.transaction(async (tx) => {
    // Verify child wallet exists and belongs to tenant
    const [childWallet] = await tx
      .select()
      .from(schema.wallets)
      .where(and(eq(schema.wallets.id, input.walletId), eq(schema.wallets.tenantId, input.tenantId)))
      .limit(1);
    if (!childWallet) throw new BudgetError("Child wallet not found", "WALLET_NOT_FOUND");
    if (childWallet.status !== "ACTIVE") throw new BudgetError("Child wallet is not active", "WALLET_FROZEN");

    // Verify parent wallet
    const [parentWallet] = await tx
      .select()
      .from(schema.wallets)
      .where(and(eq(schema.wallets.id, input.parentWalletId), eq(schema.wallets.tenantId, input.tenantId)))
      .limit(1);
    if (!parentWallet) throw new BudgetError("Parent wallet not found", "PARENT_WALLET_NOT_FOUND");

    // Verify employee exists
    const [employee] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, input.employeeId), eq(schema.users.tenantId, input.tenantId)))
      .limit(1);
    if (!employee) throw new BudgetError("Employee not found", "EMPLOYEE_NOT_FOUND");

    const [pcw] = await tx
      .insert(schema.pettyCashWallets)
      .values({
        tenantId: input.tenantId,
        parentWalletId: input.parentWalletId,
        walletId: input.walletId,
        employeeId: input.employeeId,
        branchId: input.branchId,
        departmentId: input.departmentId,
        dailyLimitMinor: input.dailyLimitMinor,
        monthlyLimitMinor: input.monthlyLimitMinor,
        approvalThresholdMinor: input.approvalThresholdMinor ?? 0n,
        approvalPolicyId: input.approvalPolicyId,
        createdById: input.actorId,
      })
      .returning();

    if (!pcw) throw new BudgetError("Failed to create petty cash wallet", "CREATE_FAILED");
    return pcw as PettyCashWalletWithUsage;
  });
}

export async function getPettyCashWallet(db: Db, tenantId: string, pcwId: string): Promise<PettyCashWalletWithUsage | null> {
  const [pcw] = await db
    .select()
    .from(schema.pettyCashWallets)
    .where(and(eq(schema.pettyCashWallets.id, pcwId), eq(schema.pettyCashWallets.tenantId, tenantId)))
    .limit(1);
  return pcw as PettyCashWalletWithUsage ?? null;
}

export async function listPettyCashWallets(
  db: Db,
  tenantId: string,
  options?: { employeeId?: string; branchId?: string; activeOnly?: boolean }
): Promise<PettyCashWalletWithUsage[]> {
  const conditions = [eq(schema.pettyCashWallets.tenantId, tenantId)];
  if (options?.employeeId) conditions.push(eq(schema.pettyCashWallets.employeeId, options.employeeId));
  if (options?.branchId) conditions.push(eq(schema.pettyCashWallets.branchId, options.branchId));
  if (options?.activeOnly) conditions.push(eq(schema.pettyCashWallets.status, "ACTIVE"));

  return (await db
    .select()
    .from(schema.pettyCashWallets)
    .where(and(...conditions))
    .orderBy(desc(schema.pettyCashWallets.createdAt))) as PettyCashWalletWithUsage[];
}

export async function updatePettyCashWallet(
  db: Db,
  tenantId: string,
  pcwId: string,
  updates: Partial<Pick<CreatePettyCashWalletInput, "dailyLimitMinor" | "monthlyLimitMinor" | "approvalThresholdMinor" | "approvalPolicyId">> & { status?: string }
): Promise<PettyCashWalletWithUsage | null> {
  const [pcw] = await db
    .update(schema.pettyCashWallets)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(schema.pettyCashWallets.id, pcwId), eq(schema.pettyCashWallets.tenantId, tenantId)))
    .returning();
  return pcw as PettyCashWalletWithUsage ?? null;
}

export async function deletePettyCashWallet(db: Db, tenantId: string, pcwId: string): Promise<boolean> {
  const result = await db
    .delete(schema.pettyCashWallets)
    .where(and(eq(schema.pettyCashWallets.id, pcwId), eq(schema.pettyCashWallets.tenantId, tenantId)));
  return (result.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------ Budget Checking */

export async function checkBudget(
  db: Db,
  tenantId: string,
  input: {
    amountMinor: bigint;
    category: string;
    subCategory?: string;
    branchId?: string;
    departmentId?: string;
    employeeId?: string;
    paymentId?: string;
  }
): Promise<BudgetCheckResult> {
  // Find active budgets for this tenant/scope
  const budgets = await listBudgets(db, tenantId, { activeOnly: true });

  for (const budget of budgets) {
    // Check if budget applies to this context
    if (budget.scope === "BRANCH" && budget.scopeRef && budget.scopeRef !== input.branchId) continue;
    if (budget.scope === "DEPARTMENT" && budget.scopeRef && budget.scopeRef !== input.departmentId) continue;
    if (budget.scope === "EMPLOYEE" && budget.scopeRef && budget.scopeRef !== input.employeeId) continue;

    // Check budget items for category match
    for (const item of budget.items) {
      if (item.category !== input.category) continue;
      if (item.subCategory && input.subCategory && item.subCategory !== input.subCategory) continue;

      const totalCommitted = item.spentMinor + item.committedMinor + input.amountMinor;
      const usagePct = Number((totalCommitted * 100n) / item.limitMinor);

      // Check block threshold
      if (usagePct >= item.blockThresholdPct) {
        return {
          allowed: false,
          action: "BLOCK",
          budgetId: budget.id,
          budgetItemId: item.id,
          message: `Budget "${budget.name}" category "${item.category}" limit exceeded (${usagePct}% >= ${item.blockThresholdPct}%)`,
          usagePct,
        };
      }

      // Check warn threshold
      if (usagePct >= item.warnThresholdPct) {
        return {
          allowed: true,
          action: "WARN",
          budgetId: budget.id,
          budgetItemId: item.id,
          message: `Budget "${budget.name}" category "${item.category}" at ${usagePct}% (warn at ${item.warnThresholdPct}%)`,
          usagePct,
        };
      }

      // Budget OK but track if approval required
      if (budget.approvalRequired) {
        return {
          allowed: true,
          action: "REQUIRE_APPROVAL",
          budgetId: budget.id,
          budgetItemId: item.id,
          message: `Budget "${budget.name}" requires approval`,
          usagePct,
        };
      }
    }

    // Also check total budget limit
    const totalSpent = await getTotalBudgetSpend(db, budget.id);
    const totalCommitted = totalSpent + input.amountMinor;
    const totalUsagePct = Number((totalCommitted * 100n) / budget.totalLimitMinor);

    if (totalUsagePct >= 100) {
      return {
        allowed: false,
        action: "BLOCK",
        budgetId: budget.id,
        message: `Total budget "${budget.name}" limit exceeded (${totalUsagePct}%)`,
        usagePct: totalUsagePct,
      };
    }
  }

  return { allowed: true, action: "NONE" };
}

async function getTotalBudgetSpend(db: Db, budgetId: string): Promise<bigint> {
  const items = await listBudgetItems(db, budgetId);
  let total = 0n;
  for (const item of items) {
    total += item.spentMinor;
  }
  return total;
}

/* ------------------------------------------------------ Spend Limit Checking */

export async function checkSpendLimit(
  db: Db,
  tenantId: string,
  input: {
    amountMinor: bigint;
    category?: string;
    subCategory?: string;
    entityType: BudgetScope;
    entityId: string;
  }
): Promise<SpendLimitCheckResult[]> {
  const limits = await listSpendLimits(db, tenantId, { entityType: input.entityType, entityId: input.entityId, activeOnly: true });

  const results: SpendLimitCheckResult[] = [];

  for (const limit of limits) {
    // Check category match
    if (limit.category && input.category && limit.category !== input.category) continue;
    if (limit.subCategory && input.subCategory && limit.subCategory !== input.subCategory) continue;

    const totalCommitted = limit.spentMinor + limit.committedMinor + input.amountMinor;
    const usagePct = Number((totalCommitted * 100n) / limit.limitMinor);

    if (limit.action === "BLOCK" && usagePct >= 100) {
      results.push({
        allowed: false,
        action: "BLOCK",
        spendLimitId: limit.id,
        usagePct,
        message: `Spend limit for ${input.entityType} ${input.entityId} exceeded (${usagePct}%)`,
      });
    } else if (limit.action === "REQUIRE_APPROVAL" && usagePct >= 100) {
      results.push({
        allowed: false,
        action: "REQUIRE_APPROVAL",
        spendLimitId: limit.id,
        usagePct,
        message: `Spend limit for ${input.entityType} ${input.entityId} requires approval (${usagePct}%)`,
      });
    } else if (usagePct >= 80) {
      results.push({
        allowed: true,
        action: "WARN",
        spendLimitId: limit.id,
        usagePct,
        message: `Spend limit for ${input.entityType} ${input.entityId} at ${usagePct}%`,
      });
    } else {
      results.push({
        allowed: true,
        action: limit.action,
        spendLimitId: limit.id,
        usagePct,
      });
    }
  }

  return results;
}

/* ------------------------------------------------------ Petty Cash Wallet Checking */

export async function checkPettyCashWallet(
  db: Db,
  tenantId: string,
  input: {
    amountMinor: bigint;
    pettyCashWalletId: string;
  }
): Promise<PettyCashCheckResult> {
  const pcw = await getPettyCashWallet(db, tenantId, input.pettyCashWalletId);
  if (!pcw) throw new BudgetError("Petty cash wallet not found", "PCW_NOT_FOUND");
  if (pcw.status !== "ACTIVE") throw new BudgetError("Petty cash wallet is not active", "PCW_FROZEN");

  // Reset periods if needed
  await resetPettyCashPeriods(db, pcw);

  const dailyTotal = pcw.dailySpentMinor + pcw.dailyCommittedMinor + input.amountMinor;
  const monthlyTotal = pcw.monthlySpentMinor + pcw.monthlyCommittedMinor + input.amountMinor;
  const dailyUsagePct = Number((dailyTotal * 100n) / pcw.dailyLimitMinor);
  const monthlyUsagePct = Number((monthlyTotal * 100n) / pcw.monthlyLimitMinor);

  // Check daily limit
  if (dailyUsagePct >= 100) {
    return {
      allowed: false,
      action: "BLOCK",
      pettyCashWalletId: pcw.id,
      dailyUsagePct,
      monthlyUsagePct,
      message: `Daily petty cash limit exceeded (${dailyUsagePct}%)`,
    };
  }

  // Check monthly limit
  if (monthlyUsagePct >= 100) {
    return {
      allowed: false,
      action: "BLOCK",
      pettyCashWalletId: pcw.id,
      dailyUsagePct,
      monthlyUsagePct,
      message: `Monthly petty cash limit exceeded (${monthlyUsagePct}%)`,
    };
  }

  // Check approval threshold
  if (pcw.approvalThresholdMinor > 0n && input.amountMinor > pcw.approvalThresholdMinor) {
    return {
      allowed: true,
      action: "REQUIRE_APPROVAL",
      pettyCashWalletId: pcw.id,
      dailyUsagePct,
      monthlyUsagePct,
      message: `Amount exceeds auto-approval threshold`,
    };
  }

  // Check warn thresholds
  if (dailyUsagePct >= 80 || monthlyUsagePct >= 80) {
    return {
      allowed: true,
      action: "WARN",
      pettyCashWalletId: pcw.id,
      dailyUsagePct,
      monthlyUsagePct,
      message: `Petty cash at ${Math.max(dailyUsagePct, monthlyUsagePct)}% (daily: ${dailyUsagePct}%, monthly: ${monthlyUsagePct}%)`,
    };
  }

  return { allowed: true, action: "NONE", pettyCashWalletId: pcw.id, dailyUsagePct, monthlyUsagePct };
}

async function resetPettyCashPeriods(db: Db, pcw: PettyCashWalletWithUsage): Promise<void> {
  const now = new Date();
  const dailyStart = new Date(now);
  dailyStart.setHours(0, 0, 0, 0);
  const monthlyStart = new Date(now);
  monthlyStart.setDate(1);
  monthlyStart.setHours(0, 0, 0, 0);

  const updates: Record<string, unknown> = {};

  if (pcw.dailyPeriodStart < dailyStart) {
    updates.dailySpentMinor = 0n;
    updates.dailyCommittedMinor = 0n;
    updates.dailyPeriodStart = dailyStart;
    updates.dailyAlert80Sent = false;
    updates.dailyAlert90Sent = false;
  }

  if (pcw.monthlyPeriodStart < monthlyStart) {
    updates.monthlySpentMinor = 0n;
    updates.monthlyCommittedMinor = 0n;
    updates.monthlyPeriodStart = monthlyStart;
    updates.monthlyAlert80Sent = false;
    updates.monthlyAlert90Sent = false;
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(schema.pettyCashWallets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.pettyCashWallets.id, pcw.id));
  }
}

/* ------------------------------------------------------ Spend Recording */

export async function recordSpend(
  db: Db,
  input: {
    tenantId: string;
    paymentId?: string;
    amountMinor: bigint;
    category: string;
    subCategory?: string;
    budgetId?: string;
    budgetItemId?: string;
    spendLimitId?: string;
    pettyCashWalletId?: string;
    eventType: "SPENT" | "RESERVED" | "RELEASED" | "ADJUSTED";
    note?: string;
    actorId?: string;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    // Update budget item if provided
    if (input.budgetItemId) {
      const [item] = await tx
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId))
        .for("update")
        .limit(1);
      if (item) {
        const newSpent = input.eventType === "RELEASED"
          ? BigInt(item.spentMinor) - input.amountMinor
          : BigInt(item.spentMinor) + input.amountMinor;
        await tx
          .update(schema.budgetItems)
          .set({ spentMinor: newSpent, updatedAt: new Date() })
          .where(eq(schema.budgetItems.id, input.budgetItemId));
      }
    }

    // Update spend limit if provided
    if (input.spendLimitId) {
      const [limit] = await tx
        .select()
        .from(schema.spendLimits)
        .where(eq(schema.spendLimits.id, input.spendLimitId))
        .for("update")
        .limit(1);
      if (limit) {
        const newSpent = input.eventType === "RELEASED"
          ? BigInt(limit.spentMinor) - input.amountMinor
          : BigInt(limit.spentMinor) + input.amountMinor;
        await tx
          .update(schema.spendLimits)
          .set({ spentMinor: newSpent, updatedAt: new Date() })
          .where(eq(schema.spendLimits.id, input.spendLimitId));
      }
    }

    // Update petty cash wallet if provided
    if (input.pettyCashWalletId) {
      const [pcw] = await tx
        .select()
        .from(schema.pettyCashWallets)
        .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId))
        .for("update")
        .limit(1);
      if (pcw) {
        await resetPettyCashPeriods(tx, pcw as PettyCashWalletWithUsage);

        if (input.eventType === "SPENT" || input.eventType === "RESERVED") {
          const isDaily = input.eventType === "SPENT"; // Simplification: spent counts for both
          const newDailySpent = isDaily ? BigInt(pcw.dailySpentMinor) + input.amountMinor : BigInt(pcw.dailySpentMinor);
          const newMonthlySpent = BigInt(pcw.monthlySpentMinor) + input.amountMinor;
          await tx
            .update(schema.pettyCashWallets)
            .set({
              dailySpentMinor: newDailySpent,
              monthlySpentMinor: newMonthlySpent,
              updatedAt: new Date(),
            })
            .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId));
        } else if (input.eventType === "RELEASED") {
          // For releases, we track committed separately
        }
      }
    }

    // Record spend event
    await tx.insert(schema.budgetSpendEvents).values({
      tenantId: input.tenantId,
      budgetId: input.budgetId,
      budgetItemId: input.budgetItemId,
      spendLimitId: input.spendLimitId,
      pettyCashWalletId: input.pettyCashWalletId,
      paymentId: input.paymentId,
      eventType: input.eventType,
      category: input.category,
      subCategory: input.subCategory,
      amountMinor: input.amountMinor,
      balanceAfterMinor: 0n, // Will be calculated by trigger or separately
      committedAfterMinor: 0n,
      note: input.note,
      createdById: input.actorId,
    });
  });
}

export async function recordCommitment(
  db: Db,
  input: {
    tenantId: string;
    paymentId?: string;
    amountMinor: bigint;
    category: string;
    subCategory?: string;
    budgetId?: string;
    budgetItemId?: string;
    spendLimitId?: string;
    pettyCashWalletId?: string;
    actorId?: string;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    // Update budget item committed
    if (input.budgetItemId) {
      const [item] = await tx
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId))
        .for("update")
        .limit(1);
      if (item) {
        await tx
          .update(schema.budgetItems)
          .set({ committedMinor: BigInt(item.committedMinor) + input.amountMinor, updatedAt: new Date() })
          .where(eq(schema.budgetItems.id, input.budgetItemId));
      }
    }

    // Update spend limit committed
    if (input.spendLimitId) {
      const [limit] = await tx
        .select()
        .from(schema.spendLimits)
        .where(eq(schema.spendLimits.id, input.spendLimitId))
        .for("update")
        .limit(1);
      if (limit) {
        await tx
          .update(schema.spendLimits)
          .set({ committedMinor: BigInt(limit.committedMinor) + input.amountMinor, updatedAt: new Date() })
          .where(eq(schema.spendLimits.id, input.spendLimitId));
      }
    }

    // Update petty cash wallet committed
    if (input.pettyCashWalletId) {
      const [pcw] = await tx
        .select()
        .from(schema.pettyCashWallets)
        .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId))
        .for("update")
        .limit(1);
      if (pcw) {
        await resetPettyCashPeriods(tx, pcw as PettyCashWalletWithUsage);
        await tx
          .update(schema.pettyCashWallets)
          .set({
            dailyCommittedMinor: BigInt(pcw.dailyCommittedMinor) + input.amountMinor,
            monthlyCommittedMinor: BigInt(pcw.monthlyCommittedMinor) + input.amountMinor,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId));
      }
    }

    // Record commitment event
    await tx.insert(schema.budgetSpendEvents).values({
      tenantId: input.tenantId,
      budgetId: input.budgetId,
      budgetItemId: input.budgetItemId,
      spendLimitId: input.spendLimitId,
      pettyCashWalletId: input.pettyCashWalletId,
      paymentId: input.paymentId,
      eventType: "RESERVED",
      category: input.category,
      subCategory: input.subCategory,
      amountMinor: input.amountMinor,
      balanceAfterMinor: 0n,
      committedAfterMinor: 0n,
      note: "Commitment/reservation",
      createdById: input.actorId,
    });
  });
}

export async function releaseCommitment(
  db: Db,
  input: {
    tenantId: string;
    paymentId?: string;
    amountMinor: bigint;
    category: string;
    subCategory?: string;
    budgetId?: string;
    budgetItemId?: string;
    spendLimitId?: string;
    pettyCashWalletId?: string;
    actorId?: string;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    // Update budget item committed
    if (input.budgetItemId) {
      const [item] = await tx
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId))
        .for("update")
        .limit(1);
      if (item) {
        await tx
          .update(schema.budgetItems)
          .set({ committedMinor: BigInt(item.committedMinor) - input.amountMinor, updatedAt: new Date() })
          .where(eq(schema.budgetItems.id, input.budgetItemId));
      }
    }

    // Update spend limit committed
    if (input.spendLimitId) {
      const [limit] = await tx
        .select()
        .from(schema.spendLimits)
        .where(eq(schema.spendLimits.id, input.spendLimitId))
        .for("update")
        .limit(1);
      if (limit) {
        await tx
          .update(schema.spendLimits)
          .set({ committedMinor: BigInt(limit.committedMinor) - input.amountMinor, updatedAt: new Date() })
          .where(eq(schema.spendLimits.id, input.spendLimitId));
      }
    }

    // Update petty cash wallet committed
    if (input.pettyCashWalletId) {
      const [pcw] = await tx
        .select()
        .from(schema.pettyCashWallets)
        .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId))
        .for("update")
        .limit(1);
      if (pcw) {
        await tx
          .update(schema.pettyCashWallets)
          .set({
            dailyCommittedMinor: BigInt(pcw.dailyCommittedMinor) - input.amountMinor,
            monthlyCommittedMinor: BigInt(pcw.monthlyCommittedMinor) - input.amountMinor,
            updatedAt: new Date(),
          })
          .where(eq(schema.pettyCashWallets.id, input.pettyCashWalletId));
      }
    }

    // Record release event
    await tx.insert(schema.budgetSpendEvents).values({
      tenantId: input.tenantId,
      budgetId: input.budgetId,
      budgetItemId: input.budgetItemId,
      spendLimitId: input.spendLimitId,
      pettyCashWalletId: input.pettyCashWalletId,
      paymentId: input.paymentId,
      eventType: "RELEASED",
      category: input.category,
      subCategory: input.subCategory,
      amountMinor: input.amountMinor,
      balanceAfterMinor: 0n,
      committedAfterMinor: 0n,
      note: "Commitment released",
      createdById: input.actorId,
    });
  });
}

/* ------------------------------------------------------ Period Reset */

export async function resetPeriodIfNeeded(db: Db, tenantId: string): Promise<void> {
  const now = new Date();
  const dailyStart = new Date(now);
  dailyStart.setHours(0, 0, 0, 0);
  const monthlyStart = new Date(now);
  monthlyStart.setDate(1);
  monthlyStart.setHours(0, 0, 0, 0);

  // Reset petty cash daily periods
  await db
    .update(schema.pettyCashWallets)
    .set({
      dailySpentMinor: 0n,
      dailyCommittedMinor: 0n,
      dailyPeriodStart: dailyStart,
      dailyAlert80Sent: false,
      dailyAlert90Sent: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pettyCashWallets.tenantId, tenantId),
        eq(schema.pettyCashWallets.status, "ACTIVE"),
        sql`${schema.pettyCashWallets.dailyPeriodStart} < ${dailyStart}`,
      ),
    );

  // Reset petty cash monthly periods
  await db
    .update(schema.pettyCashWallets)
    .set({
      monthlySpentMinor: 0n,
      monthlyCommittedMinor: 0n,
      monthlyPeriodStart: monthlyStart,
      monthlyAlert80Sent: false,
      monthlyAlert90Sent: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pettyCashWallets.tenantId, tenantId),
        eq(schema.pettyCashWallets.status, "ACTIVE"),
        sql`${schema.pettyCashWallets.monthlyPeriodStart} < ${monthlyStart}`,
      ),
    );
}

/* ------------------------------------------------------ Usage Reporting */

export interface BudgetUsage {
  budgetId: string;
  budgetName: string;
  totalLimitMinor: bigint;
  totalSpentMinor: bigint;
  totalCommittedMinor: bigint;
  usagePct: number;
  items: Array<{
    id: string;
    category: string;
    subCategory: string | null;
    limitMinor: bigint;
    spentMinor: bigint;
    committedMinor: bigint;
    usagePct: number;
    warnThresholdPct: number;
    blockThresholdPct: number;
  }>;
}

export async function getBudgetUsage(db: Db, tenantId: string, budgetId: string): Promise<BudgetUsage | null> {
  const budget = await getBudget(db, tenantId, budgetId);
  if (!budget) return null;

  let totalSpent = 0n;
  let totalCommitted = 0n;
  const items = budget.items.map((item) => {
    totalSpent += item.spentMinor;
    totalCommitted += item.committedMinor;
    return {
      id: item.id,
      category: item.category,
      subCategory: item.subCategory,
      limitMinor: item.limitMinor,
      spentMinor: item.spentMinor,
      committedMinor: item.committedMinor,
      usagePct: item.limitMinor > 0n ? Number(((item.spentMinor + item.committedMinor) * 100n) / item.limitMinor) : 0,
      warnThresholdPct: item.warnThresholdPct,
      blockThresholdPct: item.blockThresholdPct,
    };
  });

  return {
    budgetId: budget.id,
    budgetName: budget.name,
    totalLimitMinor: budget.totalLimitMinor,
    totalSpentMinor: totalSpent,
    totalCommittedMinor: totalCommitted,
    usagePct: budget.totalLimitMinor > 0n ? Number(((totalSpent + totalCommitted) * 100n) / budget.totalLimitMinor) : 0,
    items,
  };
}

export interface SpendLimitUsage {
  spendLimitId: string;
  entityType: string;
  entityId: string;
  category: string | null;
  subCategory: string | null;
  limitMinor: bigint;
  spentMinor: bigint;
  committedMinor: bigint;
  usagePct: number;
  action: SpendLimitAction;
}

export async function getSpendLimitUsage(db: Db, tenantId: string, limitId: string): Promise<SpendLimitUsage | null> {
  const limit = await getSpendLimit(db, tenantId, limitId);
  if (!limit) return null;

  return {
    spendLimitId: limit.id,
    entityType: limit.entityType,
    entityId: limit.entityId,
    category: limit.category,
    subCategory: limit.subCategory,
    limitMinor: limit.limitMinor,
    spentMinor: limit.spentMinor,
    committedMinor: limit.committedMinor,
    usagePct: limit.limitMinor > 0n ? Number(((limit.spentMinor + limit.committedMinor) * 100n) / limit.limitMinor) : 0,
    action: limit.action as SpendLimitAction,
  };
}

export interface PettyCashWalletUsage {
  pettyCashWalletId: string;
  employeeId: string;
  dailyLimitMinor: bigint;
  monthlyLimitMinor: bigint;
  dailySpentMinor: bigint;
  monthlySpentMinor: bigint;
  dailyCommittedMinor: bigint;
  monthlyCommittedMinor: bigint;
  dailyUsagePct: number;
  monthlyUsagePct: number;
  dailyPeriodStart: Date;
  monthlyPeriodStart: Date;
}

export async function getPettyCashWalletUsage(db: Db, tenantId: string, pcwId: string): Promise<PettyCashWalletUsage | null> {
  const pcw = await getPettyCashWallet(db, tenantId, pcwId);
  if (!pcw) return null;

  return {
    pettyCashWalletId: pcw.id,
    employeeId: pcw.employeeId,
    dailyLimitMinor: pcw.dailyLimitMinor,
    monthlyLimitMinor: pcw.monthlyLimitMinor,
    dailySpentMinor: pcw.dailySpentMinor,
    monthlySpentMinor: pcw.monthlySpentMinor,
    dailyCommittedMinor: pcw.dailyCommittedMinor,
    monthlyCommittedMinor: pcw.monthlyCommittedMinor,
    dailyUsagePct: pcw.dailyLimitMinor > 0n ? Number(((pcw.dailySpentMinor + pcw.dailyCommittedMinor) * 100n) / pcw.dailyLimitMinor) : 0,
    monthlyUsagePct: pcw.monthlyLimitMinor > 0n ? Number(((pcw.monthlySpentMinor + pcw.monthlyCommittedMinor) * 100n) / pcw.monthlyLimitMinor) : 0,
    dailyPeriodStart: pcw.dailyPeriodStart,
    monthlyPeriodStart: pcw.monthlyPeriodStart,
  };
}