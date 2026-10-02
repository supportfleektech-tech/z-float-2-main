/**
 * Support package — shared types and utilities for 24/7 support system.
 * Client-safe exports only (no server-only dependencies like BullMQ).
 */

export * from "./types.js";
export * from "./utils.js";

/** Support ticket statuses */
export const SUPPORT_TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/** Support priorities */
export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/** Chat session statuses */
export const CHAT_SESSION_STATUSES = ["WAITING", "ACTIVE", "TRANSFERRED", "ENDED"] as const;
export type ChatSessionStatus = (typeof CHAT_SESSION_STATUSES)[number];

/** Callback request statuses */
export const CALLBACK_STATUSES = ["PENDING", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_ANSWER"] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

/** Queue names for support-related jobs */
export const SUPPORT_QUEUES = {
  "support.ticket.created": "support.ticket.created",
  "support.ticket.updated": "support.ticket.updated",
  "support.chat.started": "support.chat.started",
  "support.chat.message": "support.chat.message",
  "support.callback.requested": "support.callback.requested",
  "support.callback.scheduled": "support.callback.scheduled",
} as const;

export type SupportQueueName = (typeof SUPPORT_QUEUES)[keyof typeof SUPPORT_QUEUES];

/** Default working hours for agents (24/7 coverage via rotation) */
export const DEFAULT_WORKING_HOURS = {
  monday: { start: "00:00", end: "24:00" },
  tuesday: { start: "00:00", end: "24:00" },
  wednesday: { start: "00:00", end: "24:00" },
  thursday: { start: "00:00", end: "24:00" },
  friday: { start: "00:00", end: "24:00" },
  saturday: { start: "00:00", end: "24:00" },
  sunday: { start: "00:00", end: "24:00" },
} as const;

/** Chat widget configuration */
export interface ChatWidgetConfig {
  tenantId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  theme?: "light" | "dark" | "auto";
  position?: "bottom-right" | "bottom-left";
  primaryColor?: string;
  greetingMessage?: string;
  offlineMessage?: string;
}

/** Callback request form data */
export interface CallbackRequestData {
  name: string;
  phone: string;
  email?: string;
  preferredTime: string; // ISO 8601
  timezone: string;
  reason?: string;
}

/** Ticket creation data */
export interface TicketCreateData {
  subject: string;
  body: string;
  priority?: SupportPriority;
}

/** Chat message data */
export interface ChatMessageData {
  sessionId: string;
  body: string;
  authorIsAgent?: boolean;
}