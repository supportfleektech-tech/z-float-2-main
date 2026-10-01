/**
 * Notification service — IN_APP, EMAIL and SMS channels.
 *
 * Every notification is persisted (notifications table) first; EMAIL/SMS rows
 * are then enqueued for the worker (notifications.send), which delivers via
 * the configured channel driver:
 *
 *   EMAIL: console | smtp (nodemailer) | sink (writes .eml-style JSON files)
 *   SMS:   console | http  (Africa's Talking–compatible JSON POST)
 *
 * Drivers are chosen by env (EMAIL_DRIVER / SMS_DRIVER) — never by callers.
 * Dispatch failures surface on the row (status + data.error) and are retried
 * by BullMQ (exponential backoff, default attempts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";
import { getConfig } from "@zfloat/config";
import { enqueue } from "@zfloat/queue";
import nodemailer, { type Transporter } from "nodemailer";

export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS";

export interface SendNotificationInput {
  tenantId?: string;
  userId?: string;
  channel: NotificationChannel;
  templateCode?: string;
  title?: string;
  body: string;
  /** Free-form: e.g. { phone: "+2547…", to: "person@co.ke" } overrides. */
  data?: Record<string, unknown>;
}

/**
 * Persist a notification, then enqueue delivery for out-of-band channels.
 * IN_APP rows need no dispatch (they are read from the portal bell).
 */
export async function queueNotification(db: Db, input: SendNotificationInput): Promise<string> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      channel: input.channel,
      templateCode: input.templateCode,
      title: input.title,
      body: input.body,
      data: toJsonSafe(input.data) as Record<string, unknown>,
      status: "QUEUED",
    })
    .returning();
  const id = row!.id;
  if (input.channel !== "IN_APP") {
    // Out-of-band delivery is async: worker picks this up and retries on failure.
    await enqueue(
      "notifications.send",
      { correlationId: `notif-${id}`, notificationId: id, tenantId: input.tenantId },
      { jobId: `notif-${id}` },
    ).catch(() => undefined);
  }
  return id;
}

export interface DispatchResult {
  ok: boolean;
  /** Channel driver actually used (console|smtp|sink|http). */
  driver?: string;
  error?: string;
}

/** Deliver a queued notification through its channel driver. Throws on failure. */
export async function dispatchNotification(db: Db, notificationId: string): Promise<DispatchResult> {
  const [n] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, notificationId)).limit(1);
  if (!n) throw new Error("Notification not found");
  if (n.status === "SENT" && n.sentAt) return { ok: true };

  let driver = "n/a";
  try {
    switch (n.channel) {
      case "IN_APP":
        driver = "in-app";
        break; // persisted — nothing to deliver
      case "EMAIL": {
        const data = (n.data ?? {}) as Record<string, unknown>;
        const to = String(data.to ?? "") || (n.userId ? await emailForUser(db, n.userId) : undefined);
        if (!to) throw new Error("No recipient address for EMAIL notification");
        driver = await sendEmail(to, n.title ?? "", n.body ?? "");
        break;
      }
      case "SMS": {
        const data = (n.data ?? {}) as Record<string, unknown>;
        const phone = String(data.phone ?? "") || (n.userId ? await phoneForUser(db, n.userId) : undefined);
        if (!phone) throw new Error("No recipient phone for SMS notification");
        driver = await sendSms(phone, n.body ?? "");
        break;
      }
    }
    await db
      .update(schema.notifications)
      .set({
        status: "SENT",
        sentAt: new Date(),
        data: { ...(n.data ?? {}), driver, deliveredAt: new Date().toISOString() },
      })
      .where(eq(schema.notifications.id, n.id));
    return { ok: true, driver };
  } catch (err) {
    const message = err instanceof Error ? err.message : "dispatch failed";
    await db
      .update(schema.notifications)
      .set({
        status: "FAILED",
        data: { ...(n.data ?? {}), driver, error: message, failedAt: new Date().toISOString() },
      })
      .where(eq(schema.notifications.id, n.id));
    throw new Error(message);
  }
}

async function emailForUser(db: Db, userId: string): Promise<string | undefined> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user?.email;
}

async function phoneForUser(db: Db, userId: string): Promise<string | undefined> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const phone = user?.phone ?? "";
  return phone || undefined;
}

/* ------------------------------------------------------------------ */
/* EMAIL drivers                                                       */
/* ------------------------------------------------------------------ */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const config = getConfig();
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    // Local demo sinks (and sandboxes) often run without TLS on 2525.
    requireTLS: false,
  });
  return transporter;
}

/** Returns the driver id actually used. */
async function sendEmail(to: string, subject: string, text: string): Promise<string> {
  const config = getConfig();
  switch (config.EMAIL_DRIVER) {
    case "sink": {
      const dir = config.SMTP_SINK_DIR;
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      writeFileSync(
        file,
        JSON.stringify({ to, from: config.EMAIL_FROM, subject, text, deliveredAt: new Date().toISOString() }, null, 2),
        "utf8",
      );
      return "sink";
    }
    case "smtp": {
      if (!config.SMTP_HOST) throw new Error("SMTP_HOST not configured for EMAIL_DRIVER=smtp");
      await getTransporter().sendMail({ from: config.EMAIL_FROM, to, subject, text });
      return "smtp";
    }
    case "console":
    default: {
      // eslint-disable-next-line no-console
      console.log(`[email:console] to=${to} subject=${subject}\n${text}`);
      return "console";
    }
  }
}

/* ------------------------------------------------------------------ */
/* SMS drivers                                                         */
/* ------------------------------------------------------------------ */

/** Normalize to E.164 (Kenya: drop leading 0). */
export function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+254")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Payment confirmation helpers                                        */
/* ------------------------------------------------------------------ */

export interface PaymentDetails {
  paymentNumber: string;
  amountMinor: number | string | bigint;
  currency: string;
  recipientName: string;
  recipientPhone?: string;
  recipientEmail?: string;
  providerReference?: string;
  channel: string;
  status: "SUCCESS" | "FAILED" | "REVERSED";
  errorCode?: string;
  errorMessage?: string;
  payerId?: string;
  payerEmail?: string;
  payerPhone?: string;
  payerName?: string;
  tenantId?: string;
}

function formatAmount(amountMinor: number | string | bigint, currency = "KES"): string {
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  const major = Number(minor / 100n);
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, minimumFractionDigits: 2 }).format(major);
}

function formatDate(date: Date = new Date()): string {
  return date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export async function getUserContact(db: Db, userId: string): Promise<{ email?: string; phone?: string; name?: string }> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return {
    email: user?.email,
    phone: user?.phone ?? undefined,
    name: user?.fullName,
  };
}

/** Send payment confirmation (success/failed/reversed) to both payer and recipient via EMAIL and SMS. */
export async function sendPaymentConfirmation(db: Db, details: PaymentDetails): Promise<void> {
  const amountFormatted = formatAmount(details.amountMinor, details.currency);
  const isSuccess = details.status === "SUCCESS";
  const isReversed = details.status === "REVERSED";

  // Build notification content
  const successTitle = isSuccess
    ? "Payment Successful"
    : isReversed
    ? "Payment Reversed"
    : "Payment Failed";

  const successBody = isSuccess
    ? `Your payment of ${amountFormatted} to ${details.recipientName} has been completed successfully.`
    : isReversed
    ? `Your payment of ${amountFormatted} to ${details.recipientName} has been reversed.`
    : `Your payment of ${amountFormatted} to ${details.recipientName} has failed.`;

  const recipientTitle = isSuccess
    ? "Payment Received"
    : isReversed
    ? "Payment Reversed"
    : "Payment Failed";

  const recipientBody = isSuccess
    ? `You have received ${amountFormatted} from ${details.payerName ?? "a payment"}.`
    : isReversed
    ? `A payment of ${amountFormatted} from ${details.payerName ?? "a payer"} has been reversed.`
    : `A payment of ${amountFormatted} from ${details.payerName ?? "a payer"} has failed.`;

  const commonData = {
    paymentNumber: details.paymentNumber,
    amount: amountFormatted,
    currency: details.currency,
    recipientName: details.recipientName,
    providerReference: details.providerReference,
    channel: details.channel,
    status: details.status,
    timestamp: formatDate(),
    errorCode: details.errorCode,
    errorMessage: details.errorMessage,
  };

  // 1. Send to PAYER (createdById / payerId) - EMAIL
  if (details.payerEmail) {
    await queueNotification(db, {
      tenantId: details.tenantId,
      channel: "EMAIL",
      title: successTitle,
      body: `${successBody}\n\nPayment Details:\n- Payment Number: ${details.paymentNumber}\n- Amount: ${amountFormatted}\n- Recipient: ${details.recipientName}\n- Channel: ${details.channel}\n- Provider Reference: ${details.providerReference ?? "N/A"}\n- Date: ${formatDate()}${details.errorCode ? `\n- Error: ${details.errorCode} (${details.errorMessage})` : ""}`,
      data: { ...commonData, to: details.payerEmail, recipientType: "payer" },
    });
  }

  // 2. Send to PAYER - SMS
  if (details.payerPhone) {
    const smsBody = `${successTitle}: ${amountFormatted} ${isSuccess ? "sent to" : isReversed ? "reversed for" : "failed for"} ${details.recipientName}. Ref: ${details.paymentNumber}. ${details.errorCode ? `Error: ${details.errorCode}` : ""}`;
    await queueNotification(db, {
      tenantId: details.tenantId,
      channel: "SMS",
      body: smsBody,
      data: { ...commonData, phone: details.payerPhone, recipientType: "payer" },
    });
  }

  // 3. Send to RECIPIENT - EMAIL (if email available in beneficiary snapshot)
  if (details.recipientEmail) {
    await queueNotification(db, {
      tenantId: details.tenantId,
      channel: "EMAIL",
      title: recipientTitle,
      body: `${recipientBody}\n\nPayment Details:\n- Payment Number: ${details.paymentNumber}\n- Amount: ${amountFormatted}\n- Payer: ${details.payerName ?? "Unknown"}\n- Channel: ${details.channel}\n- Provider Reference: ${details.providerReference ?? "N/A"}\n- Date: ${formatDate()}${details.errorCode ? `\n- Error: ${details.errorCode} (${details.errorMessage})` : ""}`,
      data: { ...commonData, to: details.recipientEmail, recipientType: "recipient" },
    });
  }

  // 4. Send to RECIPIENT - SMS (if phone available in beneficiary snapshot)
  if (details.recipientPhone) {
    const smsBody = `${recipientTitle}: ${amountFormatted} ${isSuccess ? "received from" : isReversed ? "reversed from" : "failed from"} ${details.payerName ?? "a payer"}. Ref: ${details.paymentNumber}. ${details.errorCode ? `Error: ${details.errorCode}` : ""}`;
    await queueNotification(db, {
      tenantId: details.tenantId,
      channel: "SMS",
      body: smsBody,
      data: { ...commonData, phone: details.recipientPhone, recipientType: "recipient" },
    });
  }
}

/** Returns the driver id actually used. */
async function sendSms(phone: string, message: string): Promise<string> {
  const config = getConfig();
  const to = normalizeKenyanPhone(phone) ?? phone;
  switch (config.SMS_DRIVER) {
    case "http": {
      if (!config.SMS_PROVIDER_URL) throw new Error("SMS_PROVIDER_URL not configured for SMS_DRIVER=http");
      // Africa's Talking–compatible request shape.
      const res = await fetch(config.SMS_PROVIDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.SMS_API_KEY ?? ""}` },
        body: JSON.stringify({ to: [to], from: config.SMS_FROM || "Z-FLOAT", message }),
      });
      if (!res.ok) throw new Error(`SMS provider HTTP ${res.status}`);
      return "http";
    }
    case "console":
    default: {
      // eslint-disable-next-line no-console
      console.log(`[sms:console] to=${to} from=${config.SMS_FROM || "Z-FLOAT"}: ${message}`);
      return "console";
    }
  }
}
