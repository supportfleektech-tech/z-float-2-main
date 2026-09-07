/**
 * Provider adapter contracts — the stable seam between Z-float business logic
 * and external payment rails. Business services consume these interfaces only;
 * they never import provider SDKs directly (instructions.md §7).
 */

export type ProviderType = "mpesa" | "bank" | "airtime" | "sandbox";
export type ProviderEnvironment = "sandbox" | "production";

/** How a provider outcome is interpreted. UNKNOWN means "in doubt — keep checking". */
export type ProviderResultStatus = "SUCCESS" | "PENDING" | "FAILED" | "REVERSED" | "UNKNOWN";

export interface ProviderPaymentInput {
  /** Z-float payment id (for provider ref mapping where supported). */
  paymentId: string;
  /** Human reference shown to the recipient where the rail supports it. */
  reference: string;
  amountMinor: bigint;
  currency: "KES";
  /** Destination details, normalized per channel. */
  destination: {
    channel: "mpesa" | "till" | "paybill" | "bank" | "airtime";
    phone?: string; // E.164
    tillNumber?: string;
    paybillNumber?: string;
    paybillAccount?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankCode?: string;
    airtimeNetwork?: string;
    airtimeProductCode?: string;
  };
  /** Provider-side idempotency reference we send (safe to reuse on retries). */
  providerReference: string;
  meta?: Record<string, unknown>;
}

export interface ProviderPaymentResult {
  status: ProviderResultStatus;
  /** Provider-side transaction reference for reconciliation. */
  providerReference?: string;
  /** Raw provider response (sanitized — never includes secrets). */
  raw?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  /** When true, a callback/status poll is required to reach a final state. */
  async: boolean;
}

export interface ProviderStatusInput {
  providerReference: string;
  paymentId?: string;
}

export interface ProviderStatusResult {
  status: ProviderResultStatus;
  providerReference?: string;
  raw?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ProviderReversalInput {
  providerReference: string;
  amountMinor: bigint;
  currency: "KES";
  reason: string;
  paymentId?: string;
}

export interface ProviderReversalResult {
  status: ProviderResultStatus;
  providerReference?: string;
  raw?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ProviderWebhookRequest {
  /** Raw request body as received. */
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | undefined>;
}

export interface VerifiedWebhook {
  /** true when the signature/credentials check out. */
  valid: boolean;
  /** Provider event id used for deduplication. */
  providerEventId?: string;
  /** Structured event (provider-agnostic) when verified. */
  event?: {
    type: string; // e.g. "payment.completed" | "payment.failed" | "payment.reversed" | "airtime.delivered"
    providerReference: string;
    status: ProviderResultStatus;
    amountMinor?: bigint;
    occurredAt?: string;
    raw?: Record<string, unknown>;
  };
  reason?: string;
}

export interface PaymentProvider {
  readonly code: string;
  readonly providerType: ProviderType;
  createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult>;
  getPaymentStatus(input: ProviderStatusInput): Promise<ProviderStatusResult>;
  reversePayment(input: ProviderReversalInput): Promise<ProviderReversalResult>;
  verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook>;
}

/** Airtime-specific query surface (extends the base contract). */
export interface AirtimeCatalogEntry {
  network: string;
  productCode: string;
  name: string;
  type: "AIRTIME" | "DATA";
  denominationMinor: bigint;
  currency: "KES";
}

export interface AirtimeProvider extends PaymentProvider {
  readonly providerType: "airtime";
  getCatalog(): Promise<AirtimeCatalogEntry[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "PROVIDER_TIMEOUT"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_REJECTED"
      | "PROVIDER_INVALID_REQUEST"
      | "PROVIDER_AUTH_FAILED"
      | "PROVIDER_UNKNOWN_RESPONSE",
    readonly providerCode: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
