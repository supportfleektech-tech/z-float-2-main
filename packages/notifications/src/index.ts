/**
 * Notification service — IN_APP, EMAIL, SMS, WHATSAPP and USSD channels.
 *
 * Every notification is persisted (notifications table) first; out-of-band channels
 * are then enqueued for the worker (notifications.send), which delivers via
 * the configured channel driver:
 *
 *   EMAIL:      console | smtp (nodemailer) | sink (writes .eml-style JSON files)
 *   SMS:        console | http  (Africa's Talking–compatible JSON POST)
 *   WHATSAPP:   console | meta  (Meta WhatsApp Business API)
 *   USSD:       console | africastalking (Africa's Talking USSD gateway)
 *
 * Drivers are chosen by env (EMAIL_DRIVER / SMS_DRIVER / WHATSAPP_DRIVER / USSD_DRIVER)
 * — never by callers. Dispatch failures surface on the row (status + data.error)
 * and are retried by BullMQ (exponential backoff, default attempts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { schema, toJsonSafe, type Db } from "@zfloat/database";
import { getConfig } from "@zfloat/config";
import { enqueue } from "@zfloat/queue";
import nodemailer, { type Transporter } from "nodemailer";

export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP" | "USSD";

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
  /** Channel driver actually used (console|smtp|sink|http|meta|africastalking). */
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
      case "WHATSAPP": {
        const data = (n.data ?? {}) as Record<string, unknown>;
        const phone = String(data.phone ?? "") || (n.userId ? await phoneForUser(db, n.userId) : undefined);
        if (!phone) throw new Error("No recipient phone for WHATSAPP notification");
        driver = await sendWhatsApp(
          phone,
          n.title ?? "",
          n.body ?? "",
          typeof data.templateCode === "string" ? data.templateCode : undefined,
          Array.isArray(data.templateParams) ? data.templateParams as WhatsAppTemplateParam[] : undefined,
        );
        break;
      }
      case "USSD": {
        const data = (n.data ?? {}) as Record<string, unknown>;
        const phone = String(data.phone ?? "") || (n.userId ? await phoneForUser(db, n.userId) : undefined);
        if (!phone) throw new Error("No recipient phone for USSD notification");
        driver = await sendUssd(phone, n.body ?? "", typeof data.sessionId === "string" ? data.sessionId : undefined);
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
/* WhatsApp drivers                                                    */
/* ------------------------------------------------------------------ */

interface WhatsAppTemplateParam {
  type: "text" | "currency" | "date_time";
  text?: string;
  currency?: { fallback_value: string; code: string; amount_1000: number };
  date_time?: { fallback_value: string };
}

async function sendWhatsApp(
  phone: string,
  title: string,
  body: string,
  templateCode?: string | null,
  templateParams?: WhatsAppTemplateParam[] | null,
): Promise<string> {
  const config = getConfig();
  const to = normalizeKenyanPhone(phone) ?? phone;
  switch (config.WHATSAPP_DRIVER) {
    case "meta": {
      if (!config.WHATSAPP_API_URL) throw new Error("WHATSAPP_API_URL not configured for WHATSAPP_DRIVER=meta");
      if (!config.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_PHONE_NUMBER_ID not configured");
      if (!config.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_ACCESS_TOKEN not configured");

      const url = `${config.WHATSAPP_API_URL}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      const payload = templateCode
        ? {
            messaging_product: "whatsapp",
            to: to.replace("+", ""),
            type: "template",
            template: {
              name: templateCode,
              language: { code: "en" },
              components: templateParams
                ? [
                    {
                      type: "body",
                      parameters: templateParams.map((p) => {
                        if (p.type === "text") return { type: "text", text: p.text };
                        if (p.type === "currency")
                          return { type: "currency", currency: p.currency };
                        if (p.type === "date_time")
                          return { type: "date_time", date_time: p.date_time };
                        return { type: "text", text: String(p.text ?? "") };
                      }),
                    },
                  ]
                : [],
            },
          }
        : {
            messaging_product: "whatsapp",
            to: to.replace("+", ""),
            type: "text",
            text: { body: `${title}\n\n${body}` },
          };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`WhatsApp API HTTP ${res.status}: ${errText}`);
      }
      return "meta";
    }
    case "console":
    default: {
      // eslint-disable-next-line no-console
      console.log(`[whatsapp:console] to=${to} template=${templateCode ?? "text"}: ${title}\n${body}`);
      return "console";
    }
  }
}

/* ------------------------------------------------------------------ */
/* USSD drivers                                                        */
/* ------------------------------------------------------------------ */

async function sendUssd(phone: string, body: string, sessionId?: string | null): Promise<string> {
  const config = getConfig();
  const to = normalizeKenyanPhone(phone) ?? phone;
  switch (config.USSD_DRIVER) {
    case "africastalking": {
      if (!config.USSD_GATEWAY_URL) throw new Error("USSD_GATEWAY_URL not configured for USSD_DRIVER=africastalking");
      if (!config.USSD_USERNAME) throw new Error("USSD_USERNAME not configured");
      if (!config.USSD_API_KEY) throw new Error("USSD_API_KEY not configured");
      if (!config.USSD_SHORTCODE) throw new Error("USSD_SHORTCODE not configured");

      // Africa's Talking USSD push (initiates a USSD session to the user's phone)
      const url = `${config.USSD_GATEWAY_URL}/version1/messaging`;
      const payload = new URLSearchParams({
        username: config.USSD_USERNAME,
        to: to,
        message: body,
        shortCode: config.USSD_SHORTCODE,
      });
      if (sessionId) payload.append("sessionId", sessionId);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          apiKey: config.USSD_API_KEY,
        },
        body: payload.toString(),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`USSD gateway HTTP ${res.status}: ${errText}`);
      }
      return "africastalking";
    }
    case "console":
    default: {
      // eslint-disable-next-line no-console
      console.log(`[ussd:console] to=${to} sessionId=${sessionId ?? "new"}: ${body}`);
      return "console";
    }
  }
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

/* ------------------------------------------------------------------ */
/* Approval notification helpers                                       */
/* ------------------------------------------------------------------ */

export interface ApprovalNotificationDetails {
  approvalRequestId: string;
  approvalToken: string;
  approvalUrl: string;
  paymentNumber?: string;
  batchName?: string;
  beneficiaryName?: string;
  reversalPaymentNumber?: string;
  inviteEmail?: string;
  inviteRole?: string;
  amountMinor?: number | string | bigint;
  currency?: string;
  dueAt?: Date;
  createdByName?: string;
  tenantId?: string;
}

/**
 * Send approval request notification to an approver via their preferred channels.
 * Reads user's notification preferences and sends via enabled channels in priority order.
 */
export async function sendApprovalNotification(
  db: Db,
  approverId: string,
  details: ApprovalNotificationDetails,
): Promise<void> {
  const config = getConfig();
  const approver = await db.select().from(schema.users).where(eq(schema.users.id, approverId)).limit(1);
  if (!approver[0]) throw new Error(`Approver ${approverId} not found`);

  const prefs = await db
    .select()
    .from(schema.notificationPreferences)
    .where(
      eq(schema.notificationPreferences.userId, approverId),
    )
    .orderBy(schema.notificationPreferences.priority);

  const phone = approver[0].phone;
  const email = approver[0].email;

  // Determine resource type and title/body
  let title = "Approval Required";
  let body = "";
  let resourceType = "payment";

  if (details.paymentNumber) {
    resourceType = "payment";
    const amountFormatted = details.amountMinor ? formatAmount(details.amountMinor, details.currency ?? "KES") : "";
    body = `Payment ${details.paymentNumber} for ${amountFormatted} requires your approval.\n\nTap to approve: ${details.approvalUrl}\n\nExpires: ${details.dueAt ? formatDate(details.dueAt) : "N/A"}`;
  } else if (details.batchName) {
    resourceType = "batch";
    body = `Batch "${details.batchName}" requires your approval.\n\nTap to approve: ${details.approvalUrl}\n\nExpires: ${details.dueAt ? formatDate(details.dueAt) : "N/A"}`;
  } else if (details.beneficiaryName) {
    resourceType = "beneficiary";
    body = `New beneficiary "${details.beneficiaryName}" requires your approval.\n\nTap to approve: ${details.approvalUrl}\n\nExpires: ${details.dueAt ? formatDate(details.dueAt) : "N/A"}`;
  } else if (details.reversalPaymentNumber) {
    resourceType = "reversal";
    body = `Reversal for payment ${details.reversalPaymentNumber} requires your approval.\n\nTap to approve: ${details.approvalUrl}\n\nExpires: ${details.dueAt ? formatDate(details.dueAt) : "N/A"}`;
  } else if (details.inviteEmail) {
    resourceType = "invite";
    body = `Role invitation for ${details.inviteEmail} (${details.inviteRole}) requires your approval.\n\nTap to approve: ${details.approvalUrl}\n\nExpires: ${details.dueAt ? formatDate(details.dueAt) : "N/A"}`;
  }

  const eventType = "approval_requested";

  // If no preferences set, default to IN_APP + SMS
  const effectivePrefs = prefs.length > 0
    ? prefs.filter((p) => p.enabled && p.eventType === eventType)
    : [
        { channel: "IN_APP" as NotificationChannel, enabled: true },
        { channel: "SMS" as NotificationChannel, enabled: true },
      ];

  const sentChannels = new Set<string>();

  for (const pref of effectivePrefs) {
    if (sentChannels.has(pref.channel)) continue;

    switch (pref.channel) {
      case "IN_APP": {
        await queueNotification(db, {
          tenantId: details.tenantId,
          userId: approverId,
          channel: "IN_APP",
          title,
          body,
          data: { ...details, resourceType, eventType },
        });
        sentChannels.add("IN_APP");
        break;
      }
      case "EMAIL": {
        if (email) {
          await queueNotification(db, {
            tenantId: details.tenantId,
            userId: approverId,
            channel: "EMAIL",
            title,
            body: `${body}\n\n---\nThis is an automated message from Z-float. Please do not reply to this email.`,
            data: { ...details, to: email, resourceType, eventType },
          });
          sentChannels.add("EMAIL");
        }
        break;
      }
      case "SMS": {
        if (phone) {
          const smsBody = `${title}: ${body.slice(0, 160 - title.length - 3)}... Ref: ${details.approvalRequestId.slice(0, 8)}`;
          await queueNotification(db, {
            tenantId: details.tenantId,
            userId: approverId,
            channel: "SMS",
            body: smsBody,
            data: { ...details, phone, resourceType, eventType },
          });
          sentChannels.add("SMS");
        }
        break;
      }
      case "WHATSAPP": {
        if (phone) {
          const amountFormatted = details.amountMinor ? formatAmount(details.amountMinor, details.currency ?? "KES") : "";
          await queueNotification(db, {
            tenantId: details.tenantId,
            userId: approverId,
            channel: "WHATSAPP",
            title,
            body,
            templateCode: config.WHATSAPP_TEMPLATE_APPROVAL,
            data: {
              ...details,
              phone,
              resourceType,
              eventType,
              templateParams: [
                { type: "text", text: details.paymentNumber ?? details.batchName ?? details.beneficiaryName ?? details.reversalPaymentNumber ?? details.inviteEmail ?? "Request" },
                { type: "text", text: amountFormatted || "N/A" },
                { type: "text", text: details.approvalUrl },
                { type: "text", text: details.dueAt ? formatDate(details.dueAt) : "N/A" },
              ],
            },
          });
          sentChannels.add("WHATSAPP");
        }
        break;
      }
      case "USSD": {
        if (phone) {
          await queueNotification(db, {
            tenantId: details.tenantId,
            userId: approverId,
            channel: "USSD",
            body: `Approval required: ${details.paymentNumber ?? details.batchName ?? details.beneficiaryName ?? "Request"}. Dial *${config.USSD_SHORTCODE ?? "123"}# to respond.`,
            data: { ...details, phone, resourceType, eventType },
          });
          sentChannels.add("USSD");
        }
        break;
      }
    }
  }
}

/**
 * Send approval reminder notification (for pending approvals nearing expiry).
 */
export async function sendApprovalReminder(
  db: Db,
  approverId: string,
  details: ApprovalNotificationDetails,
): Promise<void> {
  const config = getConfig();
  const approver = await db.select().from(schema.users).where(eq(schema.users.id, approverId)).limit(1);
  if (!approver[0]) return;

  const phone = approver[0].phone;

  const title = "Approval Reminder";
  const body = `Reminder: You have a pending approval (${details.paymentNumber ?? details.batchName ?? "Request"}). Expires soon.\n\nTap to approve: ${details.approvalUrl}`;

  // Send via WhatsApp if available (template-based)
  if (phone) {
    await queueNotification(db, {
      tenantId: details.tenantId,
      userId: approverId,
      channel: "WHATSAPP",
      title,
      body,
      templateCode: config.WHATSAPP_TEMPLATE_APPROVAL_REMINDER,
      data: {
        ...details,
        phone,
        resourceType: "reminder",
        eventType: "approval_reminder",
        templateParams: [
          { type: "text", text: details.paymentNumber ?? details.batchName ?? "Request" },
          { type: "text", text: details.approvalUrl },
        ],
      },
    });
  }

  // Also send IN_APP reminder
  await queueNotification(db, {
    tenantId: details.tenantId,
    userId: approverId,
    channel: "IN_APP",
    title,
    body,
    data: { ...details, resourceType: "reminder", eventType: "approval_reminder" },
  });
}