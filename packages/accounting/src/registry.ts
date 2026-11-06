/**
 * Accounting Provider Registry
 * Central registry for all accounting provider adapters
 */
import { QuickBooksAdapter } from "./quickbooks.js";
import { XeroAdapter } from "./xero.js";
import { ZohoBooksAdapter } from "./zoho.js";
import { SageAdapter } from "./sage.js";
import {
  AccountingProvider,
  AccountingProviderAdapter,
  PROVIDER_SCOPES,
  PROVIDER_ENDPOINTS,
} from "./types.js";

export class AccountingProviderRegistry {
  private adapters = new Map<AccountingProvider, AccountingProviderAdapter>();

  constructor() {
    this.adapters.set("quickbooks", new QuickBooksAdapter());
    this.adapters.set("xero", new XeroAdapter());
    this.adapters.set("zoho", new ZohoBooksAdapter());
    this.adapters.set("sage", new SageAdapter());
  }

  get(provider: AccountingProvider): AccountingProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Accounting provider "${provider}" not found`);
    }
    return adapter;
  }

  getAll(): AccountingProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  getSupportedProviders(): AccountingProvider[] {
    return Array.from(this.adapters.keys());
  }

  getScopes(provider: AccountingProvider): string[] {
    return PROVIDER_SCOPES[provider];
  }

  getAuthUrl(provider: AccountingProvider): string {
    return PROVIDER_ENDPOINTS[provider].authUrl;
  }

  getTokenUrl(provider: AccountingProvider): string {
    return PROVIDER_ENDPOINTS[provider].tokenUrl;
  }
}

export const accountingProviderRegistry = new AccountingProviderRegistry();