/**
 * Shared types for the support system.
 * These mirror the database schema types for type safety across packages.
 */

import type {
  SupportTicketStatus,
  SupportPriority,
  ChatSessionStatus,
  CallbackStatus,
} from "./index.js";

/** Support agent (linked to a user) */
export interface SupportAgent {
  id: string;
  tenantId: string | null;
  userId: string;
  displayName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  isPlatform: boolean;
  maxConcurrentChats: number;
  currentChats: number;
  skills: string[];
  workingHours: Record<string, { start: string; end: string }>;
  createdAt: Date;
  updatedAt: Date;
}

/** Support ticket */
export interface SupportTicket {
  id: string;
  tenantId: string | null;
  userId: string | null;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  priority: SupportPriority;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Ticket message */
export interface TicketMessage {
  id: string;
  ticketId: string;
  authorUserId: string | null;
  authorIsAdmin: boolean;
  body: string;
  createdAt: Date;
}

/** Chat session */
export interface SupportChatSession {
  id: string;
  tenantId: string | null;
  userId: string;
  agentId: string | null;
  status: ChatSessionStatus;
  subject: string | null;
  priority: SupportPriority;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Chat message */
export interface SupportChatMessage {
  id: string;
  sessionId: string;
  authorUserId: string | null;
  authorIsAgent: boolean;
  body: string;
  createdAt: Date;
}

/** Callback request */
export interface CallbackRequest {
  id: string;
  tenantId: string | null;
  userId: string;
  name: string;
  phone: string;
  email: string | null;
  preferredTime: Date;
  timezone: string;
  reason: string | null;
  status: CallbackStatus;
  assignedAgentId: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Agent availability status */
export interface AgentAvailability {
  agentId: string;
  isAvailable: boolean;
  currentChats: number;
  maxConcurrentChats: number;
  nextAvailableAt: Date | null;
}

/** Chat widget state */
export interface ChatWidgetState {
  isOpen: boolean;
  isMinimized: boolean;
  unreadCount: number;
  sessionId: string | null;
  agentId: string | null;
  agentName: string | null;
  isAgentOnline: boolean;
}

/** Callback form validation errors */
export interface CallbackFormErrors {
  name?: string;
  phone?: string;
  email?: string;
  preferredTime?: string;
  timezone?: string;
}

/** Ticket form validation errors */
export interface TicketFormErrors {
  subject?: string;
  body?: string;
}