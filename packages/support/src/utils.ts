/**
 * Support utilities — validation, formatting, helpers.
 */

import type { CallbackRequestData, TicketCreateData, ChatMessageData } from "./index.js";
import type { CallbackFormErrors, TicketFormErrors } from "./types.js";

/** Normalize Kenyan phone to E.164 format */
function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+254")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

/** Validate callback request form data */
export function validateCallbackRequest(data: CallbackRequestData): CallbackFormErrors {
  const errors: CallbackFormErrors = {};

  if (!data.name.trim()) {
    errors.name = "Name is required";
  }

  if (!data.phone.trim()) {
    errors.phone = "Phone number is required";
  } else {
    const normalized = normalizeKenyanPhone(data.phone);
    if (!normalized) {
      errors.phone = "Invalid Kenyan phone number format";
    }
  }

  if (data.email && data.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email.trim())) {
      errors.email = "Invalid email format";
    }
  }

  if (!data.preferredTime) {
    errors.preferredTime = "Preferred time is required";
  } else {
    const preferred = new Date(data.preferredTime);
    if (isNaN(preferred.getTime())) {
      errors.preferredTime = "Invalid date/time";
    } else if (preferred <= new Date()) {
      errors.preferredTime = "Preferred time must be in the future";
    }
  }

  if (!data.timezone.trim()) {
    errors.timezone = "Timezone is required";
  }

  return errors;
}

/** Check if callback form has errors */
export function hasCallbackErrors(errors: CallbackFormErrors): boolean {
  return Object.values(errors).some((e) => e !== undefined);
}

/** Validate ticket creation form data */
export function validateTicketCreate(data: TicketCreateData): TicketFormErrors {
  const errors: TicketFormErrors = {};

  if (!data.subject.trim()) {
    errors.subject = "Subject is required";
  } else if (data.subject.length > 300) {
    errors.subject = "Subject must be 300 characters or less";
  }

  if (!data.body.trim()) {
    errors.body = "Message is required";
  } else if (data.body.length > 5000) {
    errors.body = "Message must be 5000 characters or less";
  }

  return errors;
}

/** Check if ticket form has errors */
export function hasTicketErrors(errors: TicketFormErrors): boolean {
  return Object.values(errors).some((e) => e !== undefined);
}

/** Format priority for display */
export function formatPriority(priority: string): string {
  const map: Record<string, string> = {
    LOW: "Low",
    NORMAL: "Normal",
    HIGH: "High",
    URGENT: "Urgent",
  };
  return map[priority] ?? priority;
}

/** Format ticket status for display */
export function formatTicketStatus(status: string): string {
  const map: Record<string, string> = {
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    WAITING_CUSTOMER: "Waiting for Customer",
    RESOLVED: "Resolved",
    CLOSED: "Closed",
  };
  return map[status] ?? status;
}

/** Format chat session status for display */
export function formatChatStatus(status: string): string {
  const map: Record<string, string> = {
    WAITING: "Waiting for Agent",
    ACTIVE: "Active",
    TRANSFERRED: "Transferred",
    ENDED: "Ended",
  };
  return map[status] ?? status;
}

/** Format callback status for display */
export function formatCallbackStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: "Pending",
    SCHEDULED: "Scheduled",
    IN_PROGRESS: "In Progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_ANSWER: "No Answer",
  };
  return map[status] ?? status;
}

/** Get priority color class */
export function getPriorityColorClass(priority: string): string {
  const map: Record<string, string> = {
    LOW: "info",
    NORMAL: "neutral",
    HIGH: "warning",
    URGENT: "danger",
  };
  return map[priority] ?? "neutral";
}

/** Get status color class */
export function getStatusColorClass(status: string, type: "ticket" | "chat" | "callback" = "ticket"): string {
  if (type === "ticket") {
    const map: Record<string, string> = {
      OPEN: "warning",
      IN_PROGRESS: "info",
      WAITING_CUSTOMER: "warning",
      RESOLVED: "success",
      CLOSED: "neutral",
    };
    return map[status] ?? "neutral";
  }
  if (type === "chat") {
    const map: Record<string, string> = {
      WAITING: "warning",
      ACTIVE: "success",
      TRANSFERRED: "info",
      ENDED: "neutral",
    };
    return map[status] ?? "neutral";
  }
  const map: Record<string, string> = {
    PENDING: "warning",
    SCHEDULED: "info",
    IN_PROGRESS: "info",
    COMPLETED: "success",
    CANCELLED: "danger",
    NO_ANSWER: "danger",
  };
  return map[status] ?? "neutral";
}

/** Generate a unique session ID for chat */
export function generateSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Calculate estimated wait time based on queue position */
export function calculateEstimatedWait(queuePosition: number, avgHandleTimeMinutes = 5): string {
  const waitMinutes = queuePosition * avgHandleTimeMinutes;
  if (waitMinutes < 1) return "< 1 min";
  if (waitMinutes < 60) return `${waitMinutes} min`;
  const hours = Math.floor(waitMinutes / 60);
  const mins = waitMinutes % 60;
  return `${hours}h ${mins}m`;
}

/** Check if agent is available for new chat */
export function isAgentAvailable(agent: { currentChats: number; maxConcurrentChats: number; isActive: boolean }): boolean {
  return agent.isActive && agent.currentChats < agent.maxConcurrentChats;
}

/** Get next available agent (simple round-robin for now) */
export function getNextAvailableAgent(agents: Array<{ id: string; currentChats: number; maxConcurrentChats: number; isActive: boolean }>): string | null {
  const available = agents.filter(isAgentAvailable).sort((a, b) => a.currentChats - b.currentChats);
  return available.length > 0 ? available[0]!.id : null;
}