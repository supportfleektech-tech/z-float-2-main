/**
 * Base Accounting Provider Adapter
 * Implements common OAuth2 flow with PKCE, token management, and HTTP client
 * Database operations are stubbed - actual implementation in worker service
 */
import { getConfig } from "@zfloat/config";
import {
  AccountingProvider,
  AccountingProviderAdapter,
  TokenResponse,
  ExternalAccount,
  AccountMapping,
  PaymentSyncData,
  InvoiceSyncData,
  JournalEntrySyncData,
  PROVIDER_ENDPOINTS,
  PROVIDER_SCOPES,
} from "./types.js";
import { decryptTokens, encryptTokens } from "./encryption.js";

export abstract class BaseAccountingAdapter implements AccountingProviderAdapter {
  abstract readonly code: string;
  abstract readonly providerType: AccountingProvider;

  protected get endpoints() {
    return PROVIDER_ENDPOINTS[this.providerType];
  }

  protected get scopes() {
    return PROVIDER_SCOPES[this.providerType];
  }

  /** Get authorization URL for OAuth2 flow with PKCE */
  getAuthUrl(params: {
    tenantId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopes: string[];
  }): string {
    const url = new URL(this.endpoints.authUrl);
    url.searchParams.set("client_id", this.getClientId());
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", params.scopes.join(" "));
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    if (this.providerType === "quickbooks") {
      url.searchParams.set("access_type", "offline");
    }
    if (this.providerType === "xero") {
      url.searchParams.set("access_type", "offline");
    }

    return url.toString();
  }

  /** Exchange authorization code for tokens */
  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", params.code);
    body.set("redirect_uri", params.redirectUri);
    body.set("code_verifier", params.codeVerifier);
    body.set("client_id", this.getClientId());
    body.set("client_secret", this.getClientSecret());

    const res = await fetch(this.endpoints.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${error}`);
    }

    return (await res.json()) as TokenResponse;
  }

  /** Refresh access token */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("client_id", this.getClientId());
    body.set("client_secret", this.getClientSecret());

    const res = await fetch(this.endpoints.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Token refresh failed: ${res.status} ${error}`);
    }

    return (await res.json()) as TokenResponse;
  }

  /** Revoke tokens (disconnect) */
  async revokeToken(accessToken: string): Promise<void> {
    if (!this.endpoints.revokeUrl) {
      return;
    }

    const body = new URLSearchParams();
    body.set("token", accessToken);
    body.set("client_id", this.getClientId());
    body.set("client_secret", this.getClientSecret());

    await fetch(this.endpoints.revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  }

  /** Get company info after connection */
  async getCompanyInfo(accessToken: string): Promise<{ realmId: string; companyName: string }> {
    const info = await this.makeAuthenticatedRequest(accessToken, "/companyinfo", {});
    return this.parseCompanyInfo(info);
  }

  /** Get chart of accounts from provider */
  abstract getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]>;

  /** Create journal entry */
  abstract createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Create invoice */
  abstract createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Create payment/bill payment */
  abstract createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Update existing entity */
  abstract updateEntity(params: {
    accessToken: string;
    realmId: string | undefined;
    entityType: "invoice" | "payment" | "journal";
    externalId: string;
    data: InvoiceSyncData | PaymentSyncData | JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Verify webhook signature */
  abstract verifyWebhook(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | undefined>;
  }): Promise<{ valid: boolean; eventType?: string; providerEventId?: string; data?: Record<string, unknown> }>;

  /** Get valid access token (handles refresh) - stub, implemented in worker */
  async getValidAccessToken(_connectionId: string): Promise<string> {
    throw new Error("getValidAccessToken must be implemented in worker service");
  }

  /** Make authenticated API request */
  protected async makeAuthenticatedRequest(
    accessToken: string,
    path: string,
    options: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const baseUrl = this.getApiBaseUrl();
    const url = `${baseUrl}${path}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`API request failed: ${res.status} ${error}`);
    }

    return (await res.json()) as Record<string, unknown>;
  }

  /** Load and decrypt tokens from database - stub, implemented in worker */
  protected async _loadAndDecryptTokens(_connectionId: string): Promise<{
    accessToken: string;
    refreshToken?: string;
  }> {
    throw new Error("_loadAndDecryptTokens must be implemented in worker service");
  }

  /** Store encrypted tokens in database - stub, implemented in worker */
  protected async _storeEncryptedTokens(
    _connectionId: string,
    _tokens: { accessTokenEncrypted: string; refreshTokenEncrypted?: string },
  ): Promise<void> {
    // Implemented in worker service
  }

  /** Map Z-float account to external account ID */
  protected getMappedAccountId(
    mappings: AccountMapping[],
    _chartAccountId?: string,
    ledgerAccountId?: string,
  ): string | undefined {
    const mapping = mappings.find(
      (m) =>
        m.ledgerAccountId === ledgerAccountId,
    );
    return mapping?.externalAccountId;
  }

  /** Get client ID from config */
  protected abstract getClientId(): string;

  /** Get client secret from config */
  protected abstract getClientSecret(): string;

  /** Get API base URL (handles sandbox vs production) */
  protected getApiBaseUrl(): string {
    const config = getConfig();

    if (this.providerType === "quickbooks") {
      return config.QUICKBOOKS_ENVIRONMENT === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";
    }

    return this.endpoints.apiBaseUrl;
  }

  /** Parse company info from provider response */
  protected abstract parseCompanyInfo(data: Record<string, unknown>): {
    realmId: string;
    companyName: string;
  };
}