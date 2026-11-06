/**
 * Accounting provider contracts — the stable seam between Z-float business logic
 * and external accounting software (QuickBooks, Xero, Zoho Books, Sage).
 */

export type AccountingProvider = "quickbooks" | "xero" | "zoho" | "sage";
export type AccountingProviderStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR" | "EXPIRED";
export type AccountingSyncStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "PARTIAL";
export type AccountingSyncType = "PAYMENT" | "INVOICE" | "ETIMS" | "JOURNAL_ENTRY" | "FULL";
export type AccountingMappingDirection = "OUTBOUND" | "INBOUND" | "BIDIRECTIONAL";

/** OAuth2 token response */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  realmId?: string; // QuickBooks
  xero_tenant_id?: string; // Xero
}

/** Encrypted token storage */
export interface EncryptedTokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiresAt: Date;
}

/** Accounting connection with decrypted tokens (runtime only) */
export interface AccountingConnection {
  id: string;
  tenantId: string;
  provider: AccountingProvider;
  status: AccountingProviderStatus;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date;
  realmId?: string;
  companyName?: string;
  scopes: string[];
  lastSyncedAt?: Date;
  lastSyncStatus?: AccountingSyncStatus;
  lastSyncError?: string;
}

/** External account from provider */
export interface ExternalAccount {
  id: string;
  name: string;
  code?: string;
  type: string;
  currency?: string;
  status?: string;
}

/** Mapping between Z-float and external account */
export interface AccountMapping {
  id: string;
  tenantId: string;
  connectionId: string;
  chartAccountId?: string;
  ledgerAccountId?: string;
  externalAccountId: string;
  externalAccountName: string;
  externalAccountCode?: string;
  externalAccountType: string;
  direction: AccountingMappingDirection;
  isActive: boolean;
}

/** Sync log entry */
export interface SyncLogEntry {
  id: string;
  tenantId: string;
  connectionId: string;
  syncType: AccountingSyncType;
  status: AccountingSyncStatus;
  entityId?: string;
  entityType?: string;
  providerReference?: string;
  externalId?: string;
  recordsSynced: number;
  recordsFailed: number;
  errors: SyncError[];
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  createdById?: string;
}

export interface SyncError {
  entityId?: string;
  entityType?: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Payment data to sync */
export interface PaymentSyncData {
  id: string;
  paymentNumber: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  channel: string;
  category?: string;
  whtCategory?: string;
  whtRateBps?: number;
  whtAmountMinor?: bigint;
  beneficiary: {
    name: string;
    email?: string;
    phone?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankName?: string;
    bankCode?: string;
    kraPin?: string;
    idType?: string;
    idNumber?: string;
  };
  sourceWallet?: {
    name: string;
    code: string;
  };
  branch?: {
    name: string;
    code: string;
  };
  department?: {
    name: string;
    code: string;
  };
  remark?: string;
  createdAt: Date;
  executedAt?: Date;
  providerReference?: string;
  providerStatus?: string;
}

/** Invoice data to sync */
export interface InvoiceSyncData {
  id: string;
  number: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  dueAt?: Date;
  etimsInvoiceNumber?: string;
  etimsSignedAt?: Date;
  etimsQrCode?: string;
  beneficiary: {
    name: string;
    email?: string;
    phone?: string;
    kraPin?: string;
    idType?: string;
    idNumber?: string;
  };
  items: Array<{
    description: string;
    amountMinor: bigint;
    category?: string;
    quantity?: number;
    unitPriceMinor?: bigint;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

/** eTIMS data to sync */
export interface EtimsSyncData {
  id: string;
  invoiceNumber: string;
  etimsInvoiceNumber: string;
  etimsSignedAt: Date;
  etimsQrCode?: string;
  etimsCuin?: string;
  amountMinor: bigint;
  currency: string;
  beneficiary: {
    name: string;
    kraPin?: string;
    idType?: string;
    idNumber?: string;
  };
  createdAt: Date;
}

/** Journal entry data to sync */
export interface JournalEntrySyncData {
  id: string;
  referenceType: string;
  referenceId: string;
  description: string;
  postedAt: Date;
  status: string;
  entries: Array<{
    ledgerAccountId: string;
    ledgerAccountCode: string;
    ledgerAccountName: string;
    debitMinor: bigint;
    creditMinor: bigint;
    memo?: string;
  }>;
}

/** Provider adapter interface */
export interface AccountingProviderAdapter {
  readonly code: string;
  readonly providerType: AccountingProvider;

  /** Get authorization URL for OAuth2 flow */
  getAuthUrl(params: {
    tenantId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopes: string[];
  }): string;

  /** Exchange authorization code for tokens */
  exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse>;

  /** Refresh access token */
  refreshToken(refreshToken: string): Promise<TokenResponse>;

  /** Revoke tokens (disconnect) */
  revokeToken(accessToken: string): Promise<void>;

  /** Get valid access token (handles refresh) */
  getValidAccessToken(connectionId: string): Promise<string>;

  /** Get company info */
  getCompanyInfo(accessToken: string): Promise<{ realmId: string; companyName: string }>;

  /** Get chart of accounts from provider */
  getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]>;

  /** Create journal entry */
  createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Create invoice */
  createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Create payment/bill payment */
  createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Update existing entity */
  updateEntity(params: {
    accessToken: string;
    realmId: string | undefined;
    entityType: "invoice" | "payment" | "journal";
    externalId: string;
    data: InvoiceSyncData | PaymentSyncData | JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }>;

  /** Verify webhook signature */
  verifyWebhook(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | undefined>;
  }): Promise<{ valid: boolean; eventType?: string; providerEventId?: string; data?: Record<string, unknown> }>;
}

/** OAuth2 PKCE utilities */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString("base64url");
}

/** Generate PKCE code challenge from verifier (async) */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash).toString("base64url");
}

export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString("base64url");
}

/** Provider-specific scopes */
export const PROVIDER_SCOPES: Record<AccountingProvider, string[]> = {
  quickbooks: ["com.intuit.quickbooks.accounting"],
  xero: [
    "accounting.transactions",
    "accounting.contacts",
    "accounting.settings",
    "offline_access",
  ],
  zoho: ["ZohoBooks.fullaccess.all"],
  sage: [
    "accounting:transactions",
    "accounting:contacts",
    "accounting:settings",
  ],
};

/** Provider endpoints */
export const PROVIDER_ENDPOINTS: Record<AccountingProvider, {
  authUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  revokeUrl?: string;
}> = {
  quickbooks: {
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    apiBaseUrl: "https://sandbox-quickbooks.api.intuit.com",
    revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  },
  xero: {
    authUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    apiBaseUrl: "https://api.xero.com/api.xro/2.0",
  },
  zoho: {
    authUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    apiBaseUrl: "https://www.zohoapis.com/books/v3",
  },
  sage: {
    authUrl: "https://www.sageone.com/oauth2/auth/central",
    tokenUrl: "https://api.sage.com/oauth2/token",
    apiBaseUrl: "https://api.sage.com/accounting/v3.1",
  },
};