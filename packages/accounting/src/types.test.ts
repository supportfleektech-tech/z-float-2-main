import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  PROVIDER_SCOPES,
  PROVIDER_ENDPOINTS,
  type AccountingProvider,
  type TokenResponse,
  type AccountingConnection,
  type ExternalAccount,
  type AccountMapping,
  type SyncLogEntry,
  type PaymentSyncData,
  type InvoiceSyncData,
} from "./types";

describe("Accounting Types and Utilities", () => {
  describe("generateCodeVerifier", () => {
    it("should generate a valid base64url string", () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toBeDefined();
      expect(typeof verifier).toBe("string");
      expect(verifier.length).toBeGreaterThan(0);
      // base64url should not contain +, /, or =
      expect(verifier).not.toMatch(/[+/=]/);
    });

    it("should generate different verifiers on each call", () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });

    it("should generate 43-character base64url string (32 bytes = 43 chars base64url)", () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBe(43);
    });
  });

  describe("generateCodeChallenge", () => {
    it("should generate a valid base64url challenge from verifier", async () => {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe("string");
      expect(challenge.length).toBeGreaterThan(0);
      expect(challenge).not.toMatch(/[+/=]/);
    });

    it("should generate consistent challenge for same verifier", async () => {
      const verifier = "test-verifier-12345678901234567890123456789012"; // 43 chars
      const challenge1 = await generateCodeChallenge(verifier);
      const challenge2 = await generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });

    it("should generate different challenges for different verifiers", async () => {
      const challenge1 = await generateCodeChallenge("verifier-one-12345678901234567890123456789012");
      const challenge2 = await generateCodeChallenge("verifier-two-12345678901234567890123456789012");
      expect(challenge1).not.toBe(challenge2);
    });
  });

  describe("generateState", () => {
    it("should generate a valid base64url string", () => {
      const state = generateState();
      expect(state).toBeDefined();
      expect(typeof state).toBe("string");
      expect(state.length).toBeGreaterThan(0);
      expect(state).not.toMatch(/[+/=]/);
    });

    it("should generate different states on each call", () => {
      const s1 = generateState();
      const s2 = generateState();
      expect(s1).not.toBe(s2);
    });

    it("should generate 22-character base64url string (16 bytes = 22 chars base64url)", () => {
      const state = generateState();
      expect(state.length).toBe(22);
    });
  });

  describe("PROVIDER_SCOPES", () => {
    it("should have scopes for all providers", () => {
      const providers: AccountingProvider[] = ["quickbooks", "xero", "zoho", "sage"];
      for (const provider of providers) {
        expect(PROVIDER_SCOPES[provider]).toBeDefined();
        expect(Array.isArray(PROVIDER_SCOPES[provider])).toBe(true);
        expect(PROVIDER_SCOPES[provider].length).toBeGreaterThan(0);
      }
    });

    it("should have correct QuickBooks scope", () => {
      expect(PROVIDER_SCOPES.quickbooks).toContain("com.intuit.quickbooks.accounting");
    });

    it("should have correct Xero scopes", () => {
      expect(PROVIDER_SCOPES.xero).toContain("accounting.transactions");
      expect(PROVIDER_SCOPES.xero).toContain("offline_access");
    });

    it("should have correct Zoho scope", () => {
      expect(PROVIDER_SCOPES.zoho).toContain("ZohoBooks.fullaccess.all");
    });

    it("should have correct Sage scopes", () => {
      expect(PROVIDER_SCOPES.sage).toContain("accounting:transactions");
    });
  });

  describe("PROVIDER_ENDPOINTS", () => {
    it("should have endpoints for all providers", () => {
      const providers: AccountingProvider[] = ["quickbooks", "xero", "zoho", "sage"];
      for (const provider of providers) {
        const endpoints = PROVIDER_ENDPOINTS[provider];
        expect(endpoints).toBeDefined();
        expect(endpoints.authUrl).toBeDefined();
        expect(endpoints.tokenUrl).toBeDefined();
        expect(endpoints.apiBaseUrl).toBeDefined();
      }
    });

    it("should have correct QuickBooks endpoints", () => {
      const endpoints = PROVIDER_ENDPOINTS.quickbooks;
      expect(endpoints.authUrl).toContain("intuit.com");
      expect(endpoints.tokenUrl).toContain("intuit.com");
      expect(endpoints.apiBaseUrl).toContain("intuit.com");
      expect(endpoints.revokeUrl).toBeDefined();
    });

    it("should have correct Xero endpoints", () => {
      const endpoints = PROVIDER_ENDPOINTS.xero;
      expect(endpoints.authUrl).toContain("xero.com");
      expect(endpoints.tokenUrl).toContain("xero.com");
      expect(endpoints.apiBaseUrl).toContain("xero.com");
    });

    it("should have correct Zoho endpoints", () => {
      const endpoints = PROVIDER_ENDPOINTS.zoho;
      expect(endpoints.authUrl).toContain("zoho.com");
      expect(endpoints.tokenUrl).toContain("zoho.com");
      expect(endpoints.apiBaseUrl).toContain("zohoapis.com");
    });

    it("should have correct Sage endpoints", () => {
      const endpoints = PROVIDER_ENDPOINTS.sage;
      expect(endpoints.authUrl).toContain("sageone.com");
      expect(endpoints.tokenUrl).toContain("sage.com");
      expect(endpoints.apiBaseUrl).toContain("sage.com");
    });
  });

  describe("Type definitions", () => {
    it("should allow valid TokenResponse", () => {
      const token: TokenResponse = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "accounting",
        realmId: "12345",
      };
      expect(token.access_token).toBe("test-access-token");
      expect(token.expires_in).toBe(3600);
    });

    it("should allow TokenResponse without optional fields", () => {
      const token: TokenResponse = {
        access_token: "test-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      };
      expect(token.refresh_token).toBeUndefined();
      expect(token.realmId).toBeUndefined();
    });

    it("should allow valid AccountingConnection", () => {
      const conn: AccountingConnection = {
        id: "conn-123",
        tenantId: "tenant-456",
        provider: "quickbooks",
        status: "CONNECTED",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiresAt: new Date("2024-12-31"),
        realmId: "realm-123",
        companyName: "Test Company",
        scopes: ["accounting"],
        lastSyncedAt: new Date(),
        lastSyncStatus: "COMPLETED",
      };
      expect(conn.provider).toBe("quickbooks");
      expect(conn.status).toBe("CONNECTED");
    });

    it("should allow valid ExternalAccount", () => {
      const account: ExternalAccount = {
        id: "ext-123",
        name: "Test Account",
        code: "1000",
        type: "Asset",
        currency: "USD",
        status: "Active",
      };
      expect(account.id).toBe("ext-123");
      expect(account.type).toBe("Asset");
    });

    it("should allow valid AccountMapping", () => {
      const mapping: AccountMapping = {
        id: "mapping-123",
        tenantId: "tenant-456",
        connectionId: "conn-789",
        externalAccountId: "ext-123",
        externalAccountName: "Test Account",
        externalAccountCode: "1000",
        externalAccountType: "Asset",
        direction: "OUTBOUND",
        isActive: true,
      };
      expect(mapping.direction).toBe("OUTBOUND");
      expect(mapping.isActive).toBe(true);
    });

    it("should allow valid SyncLogEntry", () => {
      const syncLog: SyncLogEntry = {
        id: "sync-123",
        tenantId: "tenant-456",
        connectionId: "conn-789",
        syncType: "PAYMENT",
        status: "COMPLETED",
        recordsSynced: 10,
        recordsFailed: 0,
        errors: [],
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 5000,
      };
      expect(syncLog.syncType).toBe("PAYMENT");
      expect(syncLog.status).toBe("COMPLETED");
    });

    it("should allow valid PaymentSyncData", () => {
      const payment: PaymentSyncData = {
        id: "pay-123",
        paymentNumber: "PAY-001",
        amountMinor: 100000n,
        currency: "KES",
        status: "SUCCESS",
        channel: "mpesa",
        beneficiary: {
          name: "John Doe",
          email: "john@example.com",
          phone: "+254700000000",
        },
        createdAt: new Date(),
      };
      expect(payment.amountMinor).toBe(100000n);
      expect(payment.beneficiary.name).toBe("John Doe");
    });

    it("should allow valid InvoiceSyncData", () => {
      const invoice: InvoiceSyncData = {
        id: "inv-123",
        number: "INV-001",
        amountMinor: 50000n,
        currency: "KES",
        status: "SENT",
        beneficiary: {
          name: "Jane Smith",
          email: "jane@example.com",
        },
        items: [
          {
            description: "Service A",
            amountMinor: 25000n,
            category: "Consulting",
          },
          {
            description: "Service B",
            amountMinor: 25000n,
            category: "Development",
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(invoice.items.length).toBe(2);
      expect(invoice.items[0].amountMinor).toBe(25000n);
    });
  });
});