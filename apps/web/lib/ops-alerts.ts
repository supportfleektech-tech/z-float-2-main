/**
 * Ops alerting (GAP-ANALYSIS Phase 4) — the other half of /admin/health:
 * rule evaluation lives in @zfloat/observability (pure); THIS module turns a
 * non-ok evaluation into an actual out-of-band notification through the
 * existing notification pipeline (queueNotification → worker dispatch → EMAIL
 * console/smtp/sink or SMS console/http driver).
 *
 *  - Recipients come from env (OPS_ALERT_EMAILS / OPS_ALERT_SMS, comma
 *    separated) — never from callers or the DB.
 *  - Per-rule cooldown (ALERT_COOLDOWN_SECONDS) is enforced in Redis so a
 *    repeated poll of a failing rule sends at most one alert per window.
 *    Evaluation stays visible in the health payload regardless.
 *  - Every send is a persisted notification row (templateCode `ops.alert`),
 *    so the admin health page can show delivery state (QUEUED → SENT) and the
 *    audit trail sees it via the notifications table.
 *  - Fail-closed on infrastructure trouble: if Redis/DB misbehave we skip the
 *    send rather than spam ops — the failure still shows on the health page.
 */
import { desc, eq, schema, type Db } from "@zfloat/database";
import { getConfig } from "@zfloat/config";
import { createRedisClient } from "@zfloat/queue";
import { queueNotification } from "@zfloat/notifications";
import type { AlertResult } from "@zfloat/observability";

export const OPS_ALERT_TEMPLATE = "ops.alert";

export interface AlertSendOutcome {
  rule: string;
  severity: string;
  /** true when a notification was queued for at least one channel. */
  sent: boolean;
  /** "cooldown" | "no-recipients" | "error" when not sent. */
  skippedReason?: string;
  channels?: string[];
}

function recipients(config: ReturnType<typeof getConfig>): { emails: string[]; sms: string[] } {
  return {
    emails: config.OPS_ALERT_EMAILS.split(",").map((t) => t.trim()).filter(Boolean),
    sms: config.OPS_ALERT_SMS.split(",").map((t) => t.trim()).filter(Boolean),
  };
}

export async function queueOpsAlert(db: Db, input: { severity: string; label: string; rule: string; detail: string }): Promise<number> {
  const config = getConfig();
  const { emails, sms } = recipients(config);
  let queued = 0;
  const at = new Date().toISOString();
  const title = `[Z-float] ${input.severity.toUpperCase()} — ${input.label}`;
  const body = `${input.detail}\nRule: ${input.rule} (${input.severity}) at ${at} — see /admin/health.`;
  for (const email of emails) {
    await queueNotification(db, {
      channel: "EMAIL",
      templateCode: OPS_ALERT_TEMPLATE,
      title,
      body,
      data: { kind: "ops.alert", rule: input.rule, severity: input.severity, detail: input.detail, at, to: email },
    });
    queued += 1;
  }
  for (const phone of sms) {
    await queueNotification(db, {
      channel: "SMS",
      templateCode: OPS_ALERT_TEMPLATE,
      title,
      body,
      data: { kind: "ops.alert", rule: input.rule, severity: input.severity, detail: input.detail, at, phone },
    });
    queued += 1;
  }
  return queued;
}

/** Evaluate-and-send: called by the health API after each rule evaluation.
 * Returns per-rule outcomes (for the UI + tests). Never throws. */
export async function maybeSendOpsAlerts(db: Db, rules: AlertResult[]): Promise<AlertSendOutcome[]> {
  const config = getConfig();
  const { emails, sms } = recipients(config);
  if (emails.length === 0 && sms.length === 0) {
    return rules.filter((r) => r.severity !== "ok").map((r) => ({ rule: r.rule, severity: r.severity, sent: false, skippedReason: "no-recipients" }));
  }
  const redis = createRedisClient({ bounded: true });
  const outcomes: AlertSendOutcome[] = [];
  for (const rule of rules) {
    if (rule.severity === "ok") continue;
    const cooldownKey = `zfloat:alert:cooldown:${rule.rule}`;
    try {
      const stillCooling = await redis.get(cooldownKey);
      if (stillCooling) {
        outcomes.push({ rule: rule.rule, severity: rule.severity, sent: false, skippedReason: "cooldown" });
        continue;
      }
      const channels: string[] = [];
      if (emails.length > 0) channels.push("EMAIL");
      if (sms.length > 0) channels.push("SMS");
      await queueOpsAlert(db, { severity: rule.severity, label: rule.label, rule: rule.rule, detail: rule.detail });
      if (config.ALERT_COOLDOWN_SECONDS > 0) {
        await redis.set(cooldownKey, new Date().toISOString(), "EX", config.ALERT_COOLDOWN_SECONDS);
      }
      outcomes.push({ rule: rule.rule, severity: rule.severity, sent: true, channels });
    } catch {
      // Fail-closed: keep the health check itself healthy; never spam.
      outcomes.push({ rule: rule.rule, severity: rule.severity, sent: false, skippedReason: "error" });
    }
  }
  // NOTE: no redis.quit() — bounded clients are a per-process warm singleton
  // (createRedisClient) and must outlive individual requests.
  return outcomes;
}

/** Explicit ops test button — dispatches one EMAIL to the first configured ops
 * address (no cooldown, labeled TEST) so operators can prove the channel. */
export async function sendTestOpsAlert(db: Db): Promise<{ queued: number; email?: string }> {
  const config = getConfig();
  const { emails } = recipients(config);
  if (emails.length === 0) throw new Error("OPS_ALERT_EMAILS not configured");
  const email = emails[0];
  const at = new Date().toISOString();
  const title = "[Z-float] TEST alert — notification pipeline";
  const body = `This is a test alert from /admin/health at ${at}. If you can read this, the ops alerting channel works end to end.`;
  await queueNotification(db, {
    channel: "EMAIL",
    templateCode: OPS_ALERT_TEMPLATE,
    title,
    body,
    data: { kind: "ops.alert", rule: "manual.test", severity: "info", detail: body, at, to: email },
  });
  return { queued: 1, email };
}

/** Recent ops-alert notification deliveries (templateCode `ops.alert`),
 * newest first — drives the /admin/health delivery panel. */
export async function recentOpsAlerts(db: Db, limit = 25) {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.templateCode, OPS_ALERT_TEMPLATE))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows;
}
