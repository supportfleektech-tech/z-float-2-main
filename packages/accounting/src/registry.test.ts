import { describe, it, expect } from "vitest";
import { AccountingProviderRegistry } from "./registry";
import { PROVIDER_SCOPES, PROVIDER_ENDPOINTS, type AccountingProvider } from "./types";

describe("Accounting Provider Registry", () => {
  let registry: AccountingProviderRegistry;

  beforeEach(() => {
    registry = new AccountingProviderRegistry();
  });

  describe("get", () => {
    it("should return adapter for quickbooks", () => {
      const adapter = registry.get("quickbooks");
      expect(adapter).toBeDefined();
      expect(typeof adapter.getAuthUrl).toBe("function");
      expect(typeof adapter.exchangeCode).toBe("function");
      expect(typeof adapter.refreshToken).toBe("function");
      expect(typeof adapter.createPayment).toBe("function");
      expect(typeof adapter.createInvoice).toBe("function");
    });

    it("should return adapter for xero", () => {
      const adapter = registry.get("xero");
      expect(adapter).toBeDefined();
    });

    it("should return adapter for zoho", () => {
      const adapter = registry.get("zoho");
      expect(adapter).toBeDefined();
    });

    it("should return adapter for sage", () => {
      const adapter = registry.get("sage");
      expect(adapter).toBeDefined();
    });

    it("should throw for unknown provider", () => {
      expect(() => registry.get("unknown" as AccountingProvider)).toThrow(
        'Accounting provider "unknown" not found',
      );
    });
  });

  describe("getAll", () => {
    it("should return all adapters", () => {
      const adapters = registry.getAll();
      expect(adapters).toHaveLength(4);
    });
  });

  describe("getSupportedProviders", () => {
    it("should return all supported provider names", () => {
      const providers = registry.getSupportedProviders();
      expect(providers).toEqual(["quickbooks", "xero", "zoho", "sage"]);
    });
  });

  describe("getScopes", () => {
    it("should return scopes for quickbooks", () => {
      const scopes = registry.getScopes("quickbooks");
      expect(scopes).toEqual(PROVIDER_SCOPES.quickbooks);
      expect(scopes).toContain("com.intuit.quickbooks.accounting");
    });

    it("should return scopes for xero", () => {
      const scopes = registry.getScopes("xero");
      expect(scopes).toEqual(PROVIDER_SCOPES.xero);
    });

    it("should return scopes for zoho", () => {
      const scopes = registry.getScopes("zoho");
      expect(scopes).toEqual(PROVIDER_SCOPES.zoho);
    });

    it("should return scopes for sage", () => {
      const scopes = registry.getScopes("sage");
      expect(scopes).toEqual(PROVIDER_SCOPES.sage);
    });
  });

  describe("getAuthUrl", () => {
    it("should return auth URL for quickbooks", () => {
      const url = registry.getAuthUrl("quickbooks");
      expect(url).toBe(PROVIDER_ENDPOINTS.quickbooks.authUrl);
      expect(url).toContain("intuit.com");
    });

    it("should return auth URL for xero", () => {
      const url = registry.getAuthUrl("xero");
      expect(url).toBe(PROVIDER_ENDPOINTS.xero.authUrl);
      expect(url).toContain("xero.com");
    });
  });

  describe("getTokenUrl", () => {
    it("should return token URL for quickbooks", () => {
      const url = registry.getTokenUrl("quickbooks");
      expect(url).toBe(PROVIDER_ENDPOINTS.quickbooks.tokenUrl);
      expect(url).toContain("intuit.com");
    });

    it("should return token URL for xero", () => {
      const url = registry.getTokenUrl("xero");
      expect(url).toBe(PROVIDER_ENDPOINTS.xero.tokenUrl);
      expect(url).toContain("xero.com");
    });
  });

  describe("singleton export", () => {
    it("should export a singleton instance", async () => {
      const { accountingProviderRegistry } = await import("./registry");
      expect(accountingProviderRegistry).toBeInstanceOf(AccountingProviderRegistry);
      expect(accountingProviderRegistry.getSupportedProviders()).toEqual([
        "quickbooks",
        "xero",
        "zoho",
        "sage",
      ]);
    });
  });
});