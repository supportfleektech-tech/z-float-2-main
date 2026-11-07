/**
 * Budget Alerting — checks budget/spend limit/petty cash usage and sends notifications
 * at 80%, 90%, 100% thresholds.
 *
 * Runs as a scheduled worker job (budgets.alerts).
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@zfloat/database";
import { queueNotification } from "@zfloat/notifications";
import { getConfig } from "@zfloat/config";

export interface BudgetAlertResult {
  budgetId: string;
  budgetName: string;
  budgetItemId?: string;
  category: string;
  usagePct: number;
  threshold: number; // 80, 90, 100
  alertSent: boolean;
}

export interface SpendLimitAlertResult {
  spendLimitId: string;
  entityType: string;
  entityId: string;
  category: string | null;
  usagePct: number;
  threshold: number;
  alertSent: boolean;
}

export interface PettyCashAlertResult {
  pettyCashWalletId: string;
  employeeId: string;
  period: "daily" | "monthly";
  usagePct: number;
  threshold: number;
  alertSent: boolean;
}

/**
 * Check all active budgets and send alerts for thresholds crossed.
 * Called by the scheduled worker.
 */
export async function checkAndSendBudgetAlerts(db: Db): Promise<{
  budgetAlerts: BudgetAlertResult[];
  spendLimitAlerts: SpendLimitAlertResult[];
  pettyCashAlerts: PettyCashAlertResult[];
}> {
  const config = getConfig();
  const alertEmails = config.OPS_ALERT_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
  const alertSms = config.OPS_ALERT_SMS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  if (alertEmails.length === 0 && alertSms.length === 0) {
    return { budgetAlerts: [], spendLimitAlerts: [], pettyCashAlerts: [] };
  }

  const budgetAlerts = await checkBudgetAlerts(db, alertEmails, alertSms);
  const spendLimitAlerts = await checkSpendLimitAlerts(db, alertEmails, alertSms);
  const pettyCashAlerts = await checkPettyCashAlerts(db, alertEmails, alertSms);

  return { budgetAlerts, spendLimitAlerts, pettyCashAlerts };
}

async function checkBudgetAlerts(
  db: Db,
  alertEmails: string[],
  alertSms: string[]
): Promise<BudgetAlertResult[]> {
  const now = new Date();

  // Get active budgets with items
  const budgets = await db
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.status, "ACTIVE"),
        gte(schema.budgets.periodEnd, now),
        lte(schema.budgets.periodStart, now),
      ),
    );

  const results: BudgetAlertResult[] = [];

  for (const budget of budgets) {
    const items = await db
      .select()
      .from(schema.budgetItems)
      .where(eq(schema.budgetItems.budgetId, budget.id));

    for (const item of items) {
      const totalCommitted = BigInt(item.spentMinor) + BigInt(item.committedMinor);
      if (BigInt(item.limitMinor) === 0n) continue;

      const usagePct = Number((totalCommitted * 100n) / BigInt(item.limitMinor));
      const thresholds = [
        { pct: item.warnThresholdPct, sent: false }, // budget items track their own warn threshold
        { pct: item.blockThresholdPct, sent: false },
      ];

      for (const threshold of thresholds) {
        if (usagePct >= threshold.pct) {
          // For budget items, we track alerts per threshold via a simple check
          // In production, you'd want a separate alert tracking table
          const alertKey = `${budget.id}:${item.id}:${threshold.pct}`;
          const alertSent = await sendBudgetAlert(
            db,
            alertEmails,
            alertSms,
            budget,
            item,
            usagePct,
            threshold.pct,
            alertKey,
          );
          results.push({
            budgetId: budget.id,
            budgetName: budget.name,
            budgetItemId: item.id,
            category: item.category,
            usagePct,
            threshold: threshold.pct,
            alertSent,
          });
        }
      }
    }
  }

  return results;
}

async function checkSpendLimitAlerts(
  db: Db,
  alertEmails: string[],
  alertSms: string[]
): Promise<SpendLimitAlertResult[]> {
  const now = new Date();

  const limits = await db
    .select()
    .from(schema.spendLimits)
    .where(
      and(
        gte(schema.spendLimits.periodEnd, now),
        lte(schema.spendLimits.periodStart, now),
      ),
    );

  const results: SpendLimitAlertResult[] = [];

  for (const limit of limits) {
    const totalCommitted = BigInt(limit.spentMinor) + BigInt(limit.committedMinor);
    if (BigInt(limit.limitMinor) === 0n) continue;

    const usagePct = Number((totalCommitted * 100n) / BigInt(limit.limitMinor));
    const thresholds = [80, 90, 100];

    for (const threshold of thresholds) {
      if (usagePct >= threshold) {
        const alertKey = `spend_limit:${limit.id}:${threshold}`;
        const alertSent = await sendSpendLimitAlert(
          db,
          alertEmails,
          alertSms,
          limit,
          usagePct,
          threshold,
          alertKey,
        );
        results.push({
          spendLimitId: limit.id,
          entityType: limit.entityType,
          entityId: limit.entityId,
          category: limit.category,
          usagePct,
          threshold,
          alertSent,
        });
      }
    }
  }

  return results;
}

async function checkPettyCashAlerts(
  db: Db,
  alertEmails: string[],
  alertSms: string[]
): Promise<PettyCashAlertResult[]> {
  const pcws = await db
    .select()
    .from(schema.pettyCashWallets)
    .where(eq(schema.pettyCashWallets.status, "ACTIVE"));

  const results: PettyCashAlertResult[] = [];

  for (const pcw of pcws) {
    const dailyUsagePct = pcw.dailyLimitMinor > 0n
      ? Number(((BigInt(pcw.dailySpentMinor) + BigInt(pcw.dailyCommittedMinor)) * 100n) / BigInt(pcw.dailyLimitMinor))
      : 0;
    const monthlyUsagePct = pcw.monthlyLimitMinor > 0n
      ? Number(((BigInt(pcw.monthlySpentMinor) + BigInt(pcw.monthlyCommittedMinor)) * 100n) / BigInt(pcw.monthlyLimitMinor))
      : 0;

    const thresholds = [80, 90, 100];

    // Daily alerts
    for (const threshold of thresholds) {
      if (dailyUsagePct >= threshold) {
        const sentFlag = threshold === 80 ? pcw.dailyAlert80Sent : threshold === 90 ? pcw.dailyAlert90Sent : true;
        if (!sentFlag) {
          const alertKey = `petty_cash:${pcw.id}:daily:${threshold}`;
          const alertSent = await sendPettyCashAlert(
            db,
            alertEmails,
            alertSms,
            pcw,
            "daily",
            dailyUsagePct,
            threshold,
            alertKey,
          );
          if (alertSent) {
            await db
              .update(schema.pettyCashWallets)
              .set({
                [threshold === 80 ? "dailyAlert80Sent" : "dailyAlert90Sent"]: true,
                updatedAt: new Date(),
              })
              .where(eq(schema.pettyCashWallets.id, pcw.id));
          }
          results.push({
            pettyCashWalletId: pcw.id,
            employeeId: pcw.employeeId,
            period: "daily",
            usagePct: dailyUsagePct,
            threshold,
            alertSent,
          });
        }
      }
    }

    // Monthly alerts
    for (const threshold of thresholds) {
      if (monthlyUsagePct >= threshold) {
        const sentFlag = threshold === 80 ? pcw.monthlyAlert80Sent : threshold === 90 ? pcw.monthlyAlert90Sent : true;
        if (!sentFlag) {
          const alertKey = `petty_cash:${pcw.id}:monthly:${threshold}`;
          const alertSent = await sendPettyCashAlert(
            db,
            alertEmails,
            alertSms,
            pcw,
            "monthly",
            monthlyUsagePct,
            threshold,
            alertKey,
          );
          if (alertSent) {
            await db
              .update(schema.pettyCashWallets)
              .set({
                [threshold === 80 ? "monthlyAlert80Sent" : "monthlyAlert90Sent"]: true,
                updatedAt: new Date(),
              })
              .where(eq(schema.pettyCashWallets.id, pcw.id));
          }
          results.push({
            pettyCashWalletId: pcw.id,
            employeeId: pcw.employeeId,
            period: "monthly",
            usagePct: monthlyUsagePct,
            threshold,
            alertSent,
          });
        }
      }
    }
  }

  return results;
}

async function sendBudgetAlert(
  db: Db,
  alertEmails: string[],
  alertSms: string[],
  budget: typeof schema.budgets.$inferSelect,
  item: typeof schema.budgetItems.$inferSelect,
  usagePct: number,
  threshold: number,
  alertKey: string
): Promise<boolean> {
  const severity = threshold >= 100 ? "critical" : threshold >= 90 ? "warning" : "info";
  const title = `[Z-float] Budget ${severity.toUpperCase()} — ${budget.name}`;
  const body = `Budget "${budget.name}" category "${item.category}" is at ${usagePct.toFixed(1)}% (threshold: ${threshold}%).\nLimit: ${formatAmount(item.limitMinor)}\nSpent + Committed: ${formatAmount(BigInt(item.spentMinor) + BigInt(item.committedMinor))}`;

  let sent = false;
  for (const email of alertEmails) {
    await queueNotification(db, {
      channel: "EMAIL",
      title,
      body,
      data: { kind: "budget.alert", budgetId: budget.id, budgetItemId: item.id, usagePct, threshold, severity, to: email },
    });
    sent = true;
  }
  for (const phone of alertSms) {
    await queueNotification(db, {
      channel: "SMS",
      title,
      body: `${title}: ${body}`,
      data: { kind: "budget.alert", budgetId: budget.id, budgetItemId: item.id, usagePct, threshold, severity, phone },
    });
    sent = true;
  }
  return sent;
}

async function sendSpendLimitAlert(
  db: Db,
  alertEmails: string[],
  alertSms: string[],
  limit: typeof schema.spendLimits.$inferSelect,
  usagePct: number,
  threshold: number,
  alertKey: string
): Promise<boolean> {
  const severity = threshold >= 100 ? "critical" : threshold >= 90 ? "warning" : "info";
  const cat = limit.category ? ` category "${limit.category}"` : "";
  const title = `[Z-float] Spend Limit ${severity.toUpperCase()} — ${limit.entityType} ${limit.entityId}`;
  const body = `Spend limit for ${limit.entityType} ${limit.entityId}${cat} is at ${usagePct.toFixed(1)}% (threshold: ${threshold}%).\nLimit: ${formatAmount(limit.limitMinor)}\nSpent + Committed: ${formatAmount(BigInt(limit.spentMinor) + BigInt(limit.committedMinor))}\nAction: ${limit.action}`;

  let sent = false;
  for (const email of alertEmails) {
    await queueNotification(db, {
      channel: "EMAIL",
      title,
      body,
      data: { kind: "spend_limit.alert", spendLimitId: limit.id, usagePct, threshold, severity, to: email },
    });
    sent = true;
  }
  for (const phone of alertSms) {
    await queueNotification(db, {
      channel: "SMS",
      title,
      body: `${title}: ${body}`,
      data: { kind: "spend_limit.alert", spendLimitId: limit.id, usagePct, threshold, severity, phone },
    });
    sent = true;
  }
  return sent;
}

async function sendPettyCashAlert(
  db: Db,
  alertEmails: string[],
  alertSms: string[],
  pcw: typeof schema.pettyCashWallets.$inferSelect,
  period: "daily" | "monthly",
  usagePct: number,
  threshold: number,
  alertKey: string
): Promise<boolean> {
  const severity = threshold >= 100 ? "critical" : threshold >= 90 ? "warning" : "info";
  const limit = period === "daily" ? pcw.dailyLimitMinor : pcw.monthlyLimitMinor;
  const spent = period === "daily"
    ? BigInt(pcw.dailySpentMinor) + BigInt(pcw.dailyCommittedMinor)
    : BigInt(pcw.monthlySpentMinor) + BigInt(pcw.monthlyCommittedMinor);
  const title = `[Z-float] Petty Cash ${severity.toUpperCase()} — Employee ${pcw.employeeId}`;
  const body = `${period.charAt(0).toUpperCase() + period.slice(1)} petty cash for employee ${pcw.employeeId} is at ${usagePct.toFixed(1)}% (threshold: ${threshold}%).\nLimit: ${formatAmount(limit)}\nSpent + Committed: ${formatAmount(spent)}`;

  let sent = false;
  for (const email of alertEmails) {
    await queueNotification(db, {
      channel: "EMAIL",
      title,
      body,
      data: { kind: "petty_cash.alert", pettyCashWalletId: pcw.id, period, usagePct, threshold, severity, to: email },
    });
    sent = true;
  }
  for (const phone of alertSms) {
    await queueNotification(db, {
      channel: "SMS",
      title,
      body: `${title}: ${body}`,
      data: { kind: "petty_cash.alert", pettyCashWalletId: pcw.id, period, usagePct, threshold, severity, phone },
    });
    sent = true;
  }
  return sent;
}

export function formatAmount(minor: bigint): string {
  const major = Number(minor / 100n);
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 }).format(major);
}

/**
 * Worker handler for budget alerts queue.
 * Register as: startWorker("budgets.alerts", budgetAlertsWorker)
 */
export async function budgetAlertsWorker(payload: { tenantId?: string }): Promise<void> {
  const { getDb } = await import("@zfloat/database");
  const { db } = getDb();

  // If tenantId provided, only check that tenant; otherwise check all
  // For multi-tenant, we'd iterate tenants - simplified here
  await checkAndSendBudgetAlerts(db);
}