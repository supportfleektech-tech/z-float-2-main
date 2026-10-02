import { NextRequest } from "next/server";
import { getDb, schema, eq, and, desc } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import {
  createBudget,
  getBudget,
  listBudgets,
  updateBudget,
  deleteBudget,
  createBudgetItem,
  getBudgetItem,
  listBudgetItems,
  updateBudgetItem,
  deleteBudgetItem,
  createSpendLimit,
  getSpendLimit,
  listSpendLimits,
  updateSpendLimit,
  deleteSpendLimit,
  createPettyCashWallet,
  getPettyCashWallet,
  listPettyCashWallets,
  updatePettyCashWallet,
  deletePettyCashWallet,
  checkBudget,
  checkSpendLimit,
  checkPettyCashWallet,
  getBudgetUsage,
  getSpendLimitUsage,
  getPettyCashWalletUsage,
  parseMinor,
} from "@zfloat/budgets";

/**
 * Budgets API
 * GET  — list budgets (with items)
 * POST — create budget
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const searchParams = request.nextUrl.searchParams;
  const budgetId = searchParams.get("budgetId");
  const spendLimitId = searchParams.get("spendLimitId");
  const pettyCashWalletId = searchParams.get("pettyCashWalletId");
  const scope = searchParams.get("scope") as "TENANT" | "BRANCH" | "DEPARTMENT" | "EMPLOYEE" | null;
  const scopeRef = searchParams.get("scopeRef");
  const status = searchParams.get("status") as "DRAFT" | "ACTIVE" | "EXPIRED" | "ARCHIVED" | null;
  const activeOnly = searchParams.get("activeOnly") === "true";
  const usage = searchParams.get("usage") === "true";

  if (budgetId) {
    const budget = await getBudget(db, user!.tenantId!, budgetId);
    if (!budget) return apiError(404, "NOT_FOUND", "Budget not found");
    if (usage) {
      const usageData = await getBudgetUsage(db, user!.tenantId!, budgetId);
      return apiOk({ data: { ...budget, usage: usageData } });
    }
    return apiOk({ data: budget });
  }

  if (spendLimitId) {
    const limit = await getSpendLimit(db, user!.tenantId!, spendLimitId);
    if (!limit) return apiError(404, "NOT_FOUND", "Spend limit not found");
    if (usage) {
      const usageData = await getSpendLimitUsage(db, user!.tenantId!, spendLimitId);
      return apiOk({ data: { ...limit, usage: usageData } });
    }
    return apiOk({ data: limit });
  }

  if (pettyCashWalletId) {
    const pcw = await getPettyCashWallet(db, user!.tenantId!, pettyCashWalletId);
    if (!pcw) return apiError(404, "NOT_FOUND", "Petty cash wallet not found");
    if (usage) {
      const usageData = await getPettyCashWalletUsage(db, user!.tenantId!, pettyCashWalletId);
      return apiOk({ data: { ...pcw, usage: usageData } });
    }
    return apiOk({ data: pcw });
  }

  const budgets = await listBudgets(db, user!.tenantId!, { scope, scopeRef, status, activeOnly });
  return apiOk({ data: budgets });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const type = String(b.type ?? "budget");

  try {
    switch (type) {
      case "budget": {
        const budget = await createBudget(db, {
          tenantId: user!.tenantId!,
          actorId: user!.userId,
          name: String(b.name),
          description: b.description ? String(b.description) : undefined,
          scope: (b.scope as "TENANT" | "BRANCH" | "DEPARTMENT" | "EMPLOYEE") ?? "TENANT",
          scopeRef: b.scopeRef ? String(b.scopeRef) : undefined,
          period: (b.period as "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM") ?? "MONTHLY",
          periodStart: b.periodStart ? new Date(String(b.periodStart)) : new Date(),
          periodEnd: b.periodEnd ? new Date(String(b.periodEnd)) : new Date(),
          totalLimitMinor: parseMinor(String(b.totalLimitMinor)),
          approvalRequired: b.approvalRequired === true,
          approvalPolicyId: b.approvalPolicyId ? String(b.approvalPolicyId) : undefined,
        });
        return apiOk({ data: budget });
      }

      case "budgetItem": {
        if (!b.budgetId) return apiError(400, "BAD_REQUEST", "budgetId required");
        const item = await createBudgetItem(db, {
          budgetId: String(b.budgetId),
          category: String(b.category),
          subCategory: b.subCategory ? String(b.subCategory) : undefined,
          limitMinor: parseMinor(String(b.limitMinor)),
          warnThresholdPct: b.warnThresholdPct ? Number(b.warnThresholdPct) : undefined,
          blockThresholdPct: b.blockThresholdPct ? Number(b.blockThresholdPct) : undefined,
        });
        return apiOk({ data: item });
      }

      case "spendLimit": {
        const limit = await createSpendLimit(db, {
          tenantId: user!.tenantId!,
          actorId: user!.userId,
          entityType: (b.entityType as "TENANT" | "BRANCH" | "DEPARTMENT" | "EMPLOYEE") ?? "BRANCH",
          entityId: String(b.entityId),
          category: b.category ? String(b.category) : undefined,
          subCategory: b.subCategory ? String(b.subCategory) : undefined,
          period: (b.period as "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM") ?? "MONTHLY",
          periodStart: b.periodStart ? new Date(String(b.periodStart)) : new Date(),
          periodEnd: b.periodEnd ? new Date(String(b.periodEnd)) : new Date(),
          limitMinor: parseMinor(String(b.limitMinor)),
          action: (b.action as "WARN" | "BLOCK" | "REQUIRE_APPROVAL") ?? "WARN",
        });
        return apiOk({ data: limit });
      }

      case "pettyCashWallet": {
        const pcw = await createPettyCashWallet(db, {
          tenantId: user!.tenantId!,
          actorId: user!.userId,
          parentWalletId: String(b.parentWalletId),
          walletId: String(b.walletId),
          employeeId: String(b.employeeId),
          branchId: b.branchId ? String(b.branchId) : undefined,
          departmentId: b.departmentId ? String(b.departmentId) : undefined,
          dailyLimitMinor: parseMinor(String(b.dailyLimitMinor)),
          monthlyLimitMinor: parseMinor(String(b.monthlyLimitMinor)),
          approvalThresholdMinor: b.approvalThresholdMinor ? parseMinor(String(b.approvalThresholdMinor)) : undefined,
          approvalPolicyId: b.approvalPolicyId ? String(b.approvalPolicyId) : undefined,
        });
        return apiOk({ data: pcw });
      }

      default:
        return apiError(400, "BAD_REQUEST", `Unknown type: ${type}`);
    }
  } catch (err) {
    return apiError(400, "CREATE_FAILED", err instanceof Error ? err.message : "Failed to create");
  }
}

/**
 * PATCH /api/budgets — update budget, budget item, spend limit, or petty cash wallet
 */
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const type = String(b.type ?? "");
  const id = String(b.id ?? "");

  if (!id) return apiError(400, "BAD_REQUEST", "id required");

  try {
    switch (type) {
      case "budget": {
        const budget = await updateBudget(db, user!.tenantId!, id, {
          name: b.name ? String(b.name) : undefined,
          description: b.description ? String(b.description) : undefined,
          totalLimitMinor: b.totalLimitMinor ? parseMinor(String(b.totalLimitMinor)) : undefined,
          status: b.status ? String(b.status) : undefined,
          approvalRequired: b.approvalRequired === true,
          approvalPolicyId: b.approvalPolicyId ? String(b.approvalPolicyId) : undefined,
        });
        if (!budget) return apiError(404, "NOT_FOUND", "Budget not found");
        return apiOk({ data: budget });
      }

      case "budgetItem": {
        const item = await updateBudgetItem(db, id, {
          limitMinor: b.limitMinor ? parseMinor(String(b.limitMinor)) : undefined,
          warnThresholdPct: b.warnThresholdPct ? Number(b.warnThresholdPct) : undefined,
          blockThresholdPct: b.blockThresholdPct ? Number(b.blockThresholdPct) : undefined,
        });
        if (!item) return apiError(404, "NOT_FOUND", "Budget item not found");
        return apiOk({ data: item });
      }

      case "spendLimit": {
        const limit = await updateSpendLimit(db, user!.tenantId!, id, {
          limitMinor: b.limitMinor ? parseMinor(String(b.limitMinor)) : undefined,
          action: b.action ? String(b.action) : undefined,
        });
        if (!limit) return apiError(404, "NOT_FOUND", "Spend limit not found");
        return apiOk({ data: limit });
      }

      case "pettyCashWallet": {
        const pcw = await updatePettyCashWallet(db, user!.tenantId!, id, {
          dailyLimitMinor: b.dailyLimitMinor ? parseMinor(String(b.dailyLimitMinor)) : undefined,
          monthlyLimitMinor: b.monthlyLimitMinor ? parseMinor(String(b.monthlyLimitMinor)) : undefined,
          approvalThresholdMinor: b.approvalThresholdMinor ? parseMinor(String(b.approvalThresholdMinor)) : undefined,
          approvalPolicyId: b.approvalPolicyId ? String(b.approvalPolicyId) : undefined,
          status: b.status ? String(b.status) : undefined,
        });
        if (!pcw) return apiError(404, "NOT_FOUND", "Petty cash wallet not found");
        return apiOk({ data: pcw });
      }

      default:
        return apiError(400, "BAD_REQUEST", `Unknown type: ${type}`);
    }
  } catch (err) {
    return apiError(400, "UPDATE_FAILED", err instanceof Error ? err.message : "Failed to update");
  }
}

/**
 * DELETE /api/budgets — delete budget, budget item, spend limit, or petty cash wallet
 */
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) return apiError(400, "BAD_REQUEST", "type and id required");

  try {
    let deleted = false;
    switch (type) {
      case "budget":
        deleted = await deleteBudget(db, user!.tenantId!, id);
        break;
      case "budgetItem":
        deleted = await deleteBudgetItem(db, id);
        break;
      case "spendLimit":
        deleted = await deleteSpendLimit(db, user!.tenantId!, id);
        break;
      case "pettyCashWallet":
        deleted = await deletePettyCashWallet(db, user!.tenantId!, id);
        break;
      default:
        return apiError(400, "BAD_REQUEST", `Unknown type: ${type}`);
    }
    if (!deleted) return apiError(404, "NOT_FOUND", "Not found");
    return apiOk({ data: { deleted: true } });
  } catch (err) {
    return apiError(400, "DELETE_FAILED", err instanceof Error ? err.message : "Failed to delete");
  }
}

/**
 * POST /api/budgets/check — check budget/spend limit/petty cash before payment
 */
export async function PUT(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const checkType = String(b.checkType ?? "budget");

  try {
    switch (checkType) {
      case "budget": {
        const result = await checkBudget(db, user!.tenantId!, {
          amountMinor: parseMinor(String(b.amountMinor)),
          category: String(b.category),
          subCategory: b.subCategory ? String(b.subCategory) : undefined,
          branchId: b.branchId ? String(b.branchId) : undefined,
          departmentId: b.departmentId ? String(b.departmentId) : undefined,
          employeeId: b.employeeId ? String(b.employeeId) : undefined,
          paymentId: b.paymentId ? String(b.paymentId) : undefined,
        });
        return apiOk({ data: result });
      }

      case "spendLimit": {
        const results = await checkSpendLimit(db, user!.tenantId!, {
          amountMinor: parseMinor(String(b.amountMinor)),
          category: b.category ? String(b.category) : undefined,
          subCategory: b.subCategory ? String(b.subCategory) : undefined,
          entityType: (b.entityType as "TENANT" | "BRANCH" | "DEPARTMENT" | "EMPLOYEE") ?? "BRANCH",
          entityId: String(b.entityId),
        });
        return apiOk({ data: results });
      }

      case "pettyCashWallet": {
        if (!b.pettyCashWalletId) return apiError(400, "BAD_REQUEST", "pettyCashWalletId required");
        const result = await checkPettyCashWallet(db, user!.tenantId!, {
          amountMinor: parseMinor(String(b.amountMinor)),
          pettyCashWalletId: String(b.pettyCashWalletId),
        });
        return apiOk({ data: result });
      }

      default:
        return apiError(400, "BAD_REQUEST", `Unknown checkType: ${checkType}`);
    }
  } catch (err) {
    return apiError(400, "CHECK_FAILED", err instanceof Error ? err.message : "Check failed");
  }
}