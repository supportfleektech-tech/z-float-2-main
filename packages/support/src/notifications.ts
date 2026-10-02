/**
 * Support notification helpers.
 * Sends email/SMS/in-app notifications for support events.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { queueNotification, type NotificationChannel } from "@zfloat/notifications";

/** Send notification when a new ticket is created */
export async function notifyTicketCreated(
  db: Db,
  ticketId: string,
  tenantId: string | null,
  userId: string,
  subject: string,
): Promise<void> {
  // Notify the ticket creator (in-app)
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Ticket Created",
    body: `Your support ticket "${subject}" has been created. We'll get back to you within one business day.`,
    data: { ticketId, eventType: "ticket_created" },
  });

  // Notify assigned agent (if any) - will be handled by ticket assignment
}

/** Send notification when a ticket receives a new message */
export async function notifyTicketMessage(
  db: Db,
  ticketId: string,
  tenantId: string | null,
  recipientUserId: string,
  senderIsAgent: boolean,
  messagePreview: string,
): Promise<void> {
  const title = senderIsAgent ? "Support Reply" : "New Customer Message";
  const body = senderIsAgent
    ? `You have a new reply from our support team: "${messagePreview}"`
    : `Customer replied to your ticket: "${messagePreview}"`;

  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId: recipientUserId,
    channel: "IN_APP",
    title,
    body,
    data: { ticketId, eventType: "ticket_message", senderIsAgent },
  });
}

/** Send notification when a ticket status changes */
export async function notifyTicketStatusChange(
  db: Db,
  ticketId: string,
  tenantId: string | null,
  userId: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  const statusMessages: Record<string, string> = {
    OPEN: "opened",
    IN_PROGRESS: "in progress",
    WAITING_CUSTOMER: "waiting for your response",
    RESOLVED: "resolved",
    CLOSED: "closed",
  };

  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Ticket Status Updated",
    body: `Your ticket status changed from "${statusMessages[oldStatus] ?? oldStatus}" to "${statusMessages[newStatus] ?? newStatus}".`,
    data: { ticketId, eventType: "ticket_status_change", oldStatus, newStatus },
  });
}

/** Send notification when a callback is requested */
export async function notifyCallbackRequested(
  db: Db,
  callbackId: string,
  tenantId: string | null,
  userId: string,
  name: string,
  phone: string,
  preferredTime: Date,
): Promise<void> {
  // Notify user (in-app confirmation)
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Callback Requested",
    body: `We'll call you at ${phone} on ${preferredTime.toLocaleString()}. Our team will reach out within the scheduled window.`,
    data: { callbackId, eventType: "callback_requested" },
  });

  // Notify available agents (in-app)
  const agents = await db
    .select()
    .from(schema.supportAgents)
    .where(eq(schema.supportAgents.isActive, true))
    .limit(10);

  for (const agent of agents) {
    await queueNotification(db, {
      tenantId: tenantId ?? undefined,
      userId: agent.userId,
      channel: "IN_APP",
      title: "New Callback Request",
      body: `${name} (${phone}) requested a callback for ${preferredTime.toLocaleString()}.`,
      data: { callbackId, eventType: "callback_requested", customerName: name, customerPhone: phone },
    });
  }
}

/** Send notification when a callback is scheduled */
export async function notifyCallbackScheduled(
  db: Db,
  callbackId: string,
  tenantId: string | null,
  userId: string,
  agentId: string,
  scheduledTime: Date,
): Promise<void> {
  // Notify user
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Callback Scheduled",
    body: `Your callback has been scheduled for ${scheduledTime.toLocaleString()}. An agent will call you then.`,
    data: { callbackId, eventType: "callback_scheduled", scheduledAt: scheduledTime.toISOString() },
  });

  // Also send SMS reminder if phone available
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (user?.phone) {
    await queueNotification(db, {
      tenantId: tenantId ?? undefined,
      userId,
      channel: "SMS",
      body: `Z-float: Your callback is scheduled for ${scheduledTime.toLocaleTimeString()}. We'll call you at ${user.phone}.`,
      data: { callbackId, eventType: "callback_scheduled", phone: user.phone },
    });
  }

  // Notify assigned agent
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId: agentId,
    channel: "IN_APP",
    title: "Callback Assigned",
    body: `You have a callback scheduled for ${scheduledTime.toLocaleString()}.`,
    data: { callbackId, eventType: "callback_assigned", scheduledAt: scheduledTime.toISOString() },
  });
}

/** Send notification when a callback is completed */
export async function notifyCallbackCompleted(
  db: Db,
  callbackId: string,
  tenantId: string | null,
  userId: string,
  notes: string | null,
): Promise<void> {
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Callback Completed",
    body: `Your callback has been completed.${notes ? ` Notes: ${notes}` : ""}`,
    data: { callbackId, eventType: "callback_completed", notes },
  });
}

/** Send notification when a chat session starts */
export async function notifyChatStarted(
  db: Db,
  sessionId: string,
  tenantId: string | null,
  userId: string,
  agentId: string | null,
): Promise<void> {
  // Notify user
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Chat Started",
    body: agentId
      ? "You're now connected with a support agent."
      : "You're in the queue. An agent will be with you shortly.",
    data: { sessionId, eventType: "chat_started", agentId },
  });

  // Notify agent if assigned
  if (agentId) {
    const [agent] = await db.select().from(schema.supportAgents).where(eq(schema.supportAgents.id, agentId)).limit(1);
    if (agent) {
      await queueNotification(db, {
        tenantId: tenantId ?? undefined,
        userId: agent.userId,
        channel: "IN_APP",
        title: "New Chat Session",
        body: "A new chat session has been assigned to you.",
        data: { sessionId, eventType: "chat_assigned" },
      });
    }
  }
}

/** Send notification when a chat message is received (for offline agents) */
export async function notifyChatMessage(
  db: Db,
  sessionId: string,
  tenantId: string | null,
  recipientUserId: string,
  senderIsAgent: boolean,
  messagePreview: string,
): Promise<void> {
  const title = senderIsAgent ? "New Message from Agent" : "New Message from Customer";
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId: recipientUserId,
    channel: "IN_APP",
    title,
    body: messagePreview,
    data: { sessionId, eventType: "chat_message", senderIsAgent },
  });
}

/** Send notification when chat ends */
export async function notifyChatEnded(
  db: Db,
  sessionId: string,
  tenantId: string | null,
  userId: string,
  agentId: string | null,
): Promise<void> {
  // Notify user
  await queueNotification(db, {
    tenantId: tenantId ?? undefined,
    userId,
    channel: "IN_APP",
    title: "Chat Ended",
    body: "Your chat session has ended. If you need further assistance, please start a new chat or create a ticket.",
    data: { sessionId, eventType: "chat_ended" },
  });
}