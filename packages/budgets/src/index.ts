/**
 * Budget Management Engine
 *
 * Handles budgets, spend limits, and petty cash wallets with:
 * - Period-based budgets (monthly/quarterly/yearly/custom)
 * - Category-level budget items with warn/block thresholds
 * - Spend limits per entity (branch, department, employee) with actions (WARN/BLOCK/REQUIRE_APPROVAL)
 * - Petty cash sub-wallets with daily/monthly limits and parent approval
 * - Alerts at 80%, 90%, 100% thresholds
 */

export {
  BudgetError,
  InsufficientBudgetError,
  BudgetLimitExceededError,
  type BudgetScope,
  type BudgetPeriod,
  type SpendLimitAction,
  type BudgetStatus,
  type CreateBudgetInput,
  type CreateBudgetItemInput,
  type CreateSpendLimitInput,
  type CreatePettyCashWalletInput,
  type BudgetWithItems,
  type SpendLimitWithUsage,
  type PettyCashWalletWithUsage,
  type BudgetCheckResult,
  type SpendLimitCheckResult,
  type PettyCashCheckResult,
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
  recordSpend,
  recordCommitment,
  releaseCommitment,
  resetPeriodIfNeeded,
  getBudgetUsage,
  getSpendLimitUsage,
  getPettyCashWalletUsage,
} from "./engine.js";

export {
  budgetAlertsWorker,
  checkAndSendBudgetAlerts,
} from "./alerts.js";

export {
  evaluateBudgetRules,
  type BudgetRule,
  type BudgetContext,
} from "./policy.js";