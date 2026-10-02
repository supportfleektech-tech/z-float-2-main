import { describe, it, expect } from "vitest";
import {
  validateCallbackRequest,
  hasCallbackErrors,
  validateTicketCreate,
  hasTicketErrors,
  formatPriority,
  formatTicketStatus,
  formatChatStatus,
  formatCallbackStatus,
  getPriorityColorClass,
  getStatusColorClass,
  isAgentAvailable,
  getNextAvailableAgent,
} from "../src/utils.js";

describe("Support Utils", () => {
  describe("validateCallbackRequest", () => {
    it("should return errors for empty required fields", () => {
      const errors = validateCallbackRequest({
        name: "",
        phone: "",
        email: "",
        preferredTime: "",
        timezone: "",
        reason: "",
      });

      expect(errors.name).toBe("Name is required");
      expect(errors.phone).toBe("Phone number is required");
      expect(errors.preferredTime).toBe("Preferred time is required");
      expect(errors.timezone).toBe("Timezone is required");
    });

    it("should validate Kenyan phone number format", () => {
      const errors = validateCallbackRequest({
        name: "Test User",
        phone: "invalid",
        email: "",
        preferredTime: new Date(Date.now() + 3600000).toISOString(),
        timezone: "Africa/Nairobi",
        reason: "",
      });

      expect(errors.phone).toBe("Invalid Kenyan phone number format");
    });

    it("should accept valid Kenyan phone formats", () => {
      const validPhones = ["+254712345678", "254712345678", "0712345678", "712345678"];

      for (const phone of validPhones) {
        const errors = validateCallbackRequest({
          name: "Test User",
          phone,
          email: "",
          preferredTime: new Date(Date.now() + 3600000).toISOString(),
          timezone: "Africa/Nairobi",
          reason: "",
        });

        expect(errors.phone).toBeUndefined();
      }
    });

    it("should validate email format", () => {
      const errors = validateCallbackRequest({
        name: "Test User",
        phone: "+254712345678",
        email: "invalid-email",
        preferredTime: new Date(Date.now() + 3600000).toISOString(),
        timezone: "Africa/Nairobi",
        reason: "",
      });

      expect(errors.email).toBe("Invalid email format");
    });

    it("should validate preferred time is in the future", () => {
      const errors = validateCallbackRequest({
        name: "Test User",
        phone: "+254712345678",
        email: "",
        preferredTime: new Date(Date.now() - 3600000).toISOString(),
        timezone: "Africa/Nairobi",
        reason: "",
      });

      expect(errors.preferredTime).toBe("Preferred time must be in the future");
    });
  });

  describe("hasCallbackErrors", () => {
    it("should return true when there are errors", () => {
      const errors = { name: "Name is required", phone: undefined };
      expect(hasCallbackErrors(errors)).toBe(true);
    });

    it("should return false when no errors", () => {
      const errors = { name: undefined, phone: undefined };
      expect(hasCallbackErrors(errors)).toBe(false);
    });
  });

  describe("validateTicketCreate", () => {
    it("should return errors for empty required fields", () => {
      const errors = validateTicketCreate({
        subject: "",
        body: "",
      });

      expect(errors.subject).toBe("Subject is required");
      expect(errors.body).toBe("Message is required");
    });

    it("should validate subject length", () => {
      const errors = validateTicketCreate({
        subject: "a".repeat(301),
        body: "Test message",
      });

      expect(errors.subject).toBe("Subject must be 300 characters or less");
    });

    it("should validate body length", () => {
      const errors = validateTicketCreate({
        subject: "Test subject",
        body: "a".repeat(5001),
      });

      expect(errors.body).toBe("Message must be 5000 characters or less");
    });
  });

  describe("formatPriority", () => {
    it("should format priority correctly", () => {
      expect(formatPriority("LOW")).toBe("Low");
      expect(formatPriority("NORMAL")).toBe("Normal");
      expect(formatPriority("HIGH")).toBe("High");
      expect(formatPriority("URGENT")).toBe("Urgent");
    });
  });

  describe("formatTicketStatus", () => {
    it("should format ticket status correctly", () => {
      expect(formatTicketStatus("OPEN")).toBe("Open");
      expect(formatTicketStatus("IN_PROGRESS")).toBe("In Progress");
      expect(formatTicketStatus("WAITING_CUSTOMER")).toBe("Waiting for Customer");
      expect(formatTicketStatus("RESOLVED")).toBe("Resolved");
      expect(formatTicketStatus("CLOSED")).toBe("Closed");
    });
  });

  describe("formatChatStatus", () => {
    it("should format chat status correctly", () => {
      expect(formatChatStatus("WAITING")).toBe("Waiting for Agent");
      expect(formatChatStatus("ACTIVE")).toBe("Active");
      expect(formatChatStatus("TRANSFERRED")).toBe("Transferred");
      expect(formatChatStatus("ENDED")).toBe("Ended");
    });
  });

  describe("formatCallbackStatus", () => {
    it("should format callback status correctly", () => {
      expect(formatCallbackStatus("PENDING")).toBe("Pending");
      expect(formatCallbackStatus("SCHEDULED")).toBe("Scheduled");
      expect(formatCallbackStatus("IN_PROGRESS")).toBe("In Progress");
      expect(formatCallbackStatus("COMPLETED")).toBe("Completed");
      expect(formatCallbackStatus("CANCELLED")).toBe("Cancelled");
      expect(formatCallbackStatus("NO_ANSWER")).toBe("No Answer");
    });
  });

  describe("getPriorityColorClass", () => {
    it("should return correct color classes", () => {
      expect(getPriorityColorClass("LOW")).toBe("info");
      expect(getPriorityColorClass("NORMAL")).toBe("neutral");
      expect(getPriorityColorClass("HIGH")).toBe("warning");
      expect(getPriorityColorClass("URGENT")).toBe("danger");
    });
  });

  describe("getStatusColorClass", () => {
    it("should return correct color classes for tickets", () => {
      expect(getStatusColorClass("OPEN", "ticket")).toBe("warning");
      expect(getStatusColorClass("RESOLVED", "ticket")).toBe("success");
      expect(getStatusColorClass("CLOSED", "ticket")).toBe("neutral");
    });

    it("should return correct color classes for chat", () => {
      expect(getStatusColorClass("WAITING", "chat")).toBe("warning");
      expect(getStatusColorClass("ACTIVE", "chat")).toBe("success");
      expect(getStatusColorClass("ENDED", "chat")).toBe("neutral");
    });

    it("should return correct color classes for callbacks", () => {
      expect(getStatusColorClass("PENDING", "callback")).toBe("warning");
      expect(getStatusColorClass("COMPLETED", "callback")).toBe("success");
      expect(getStatusColorClass("CANCELLED", "callback")).toBe("danger");
    });
  });

  describe("isAgentAvailable", () => {
    it("should return true for available agent", () => {
      const agent = { currentChats: 1, maxConcurrentChats: 3, isActive: true };
      expect(isAgentAvailable(agent)).toBe(true);
    });

    it("should return false for inactive agent", () => {
      const agent = { currentChats: 0, maxConcurrentChats: 3, isActive: false };
      expect(isAgentAvailable(agent)).toBe(false);
    });

    it("should return false when at max capacity", () => {
      const agent = { currentChats: 3, maxConcurrentChats: 3, isActive: true };
      expect(isAgentAvailable(agent)).toBe(false);
    });
  });

  describe("getNextAvailableAgent", () => {
    it("should return agent with least chats", () => {
      const agents = [
        { id: "1", currentChats: 2, maxConcurrentChats: 3, isActive: true },
        { id: "2", currentChats: 1, maxConcurrentChats: 3, isActive: true },
        { id: "3", currentChats: 3, maxConcurrentChats: 3, isActive: true },
      ];

      expect(getNextAvailableAgent(agents)).toBe("2");
    });

    it("should return null when no agents available", () => {
      const agents = [
        { id: "1", currentChats: 3, maxConcurrentChats: 3, isActive: true },
        { id: "2", currentChats: 0, maxConcurrentChats: 3, isActive: false },
      ];

      expect(getNextAvailableAgent(agents)).toBeNull();
    });
  });
});