/**
 * Biller aggregator adapter — live bill payments for Kenyan billers through a
 * contracted biller aggregator API.
 *
 * Supported billers:
 *  - KPLC (Kenya Power) — electricity
 *  - KRA eSlip — tax payments
 *  - Nairobi Water (NCWSC) — water
 *  - Zuku — internet/TV
 *  - Faiba — internet
 *  - DStv / GOtv — pay-TV
 *  - SHA / NSSF — government statutory
 *
 * The aggregator exposes a REST API for:
 *  - Biller catalog listing (GET /v1/billers)
 *  - Account validation (POST /v1/billers/validate)
 *  - Bill payment (POST /v1/payments)
 *  - Payment status query (GET /v1/payments/:reference)
 *  - Webhook callbacks for payment status updates
 *
 * LIVE CALLS REQUIRE BILLER_API_BASE_URL and BILLER_API_KEY. Without them
 * the adapter refuses to run (fail-closed).
 *
 * Circuit breaker: wraps all outbound calls to prevent cascade failures.
 */
import { getConfig } from "@zfloat/config";
import {
  ProviderError,
  type PaymentProvider,
  type ProviderPaymentInput,
  type ProviderPaymentResult,
  type ProviderReversalInput,
  type ProviderReversalResult,
  type ProviderStatusInput,
  type ProviderStatusResult,
  type ProviderWebhookRequest,
  type VerifiedWebhook,
} from "./types.js";
import { getCircuitBreaker } from "./circuit-breaker.js";

export interface BillerCatalogEntry {
  id: string;
  code: string;
  name: string;
  category: string;
  channel: string;
  accountNumber: string;
  logoUrl?: string;
  requiresValidation: boolean;
}

export interface BillerValidationResult {
  valid: boolean;
  accountName?: string;
  errorMessage?: string;
}

export interface BillerProvider extends PaymentProvider {
  readonly providerType: "biller";
  getBillers(): Promise<BillerCatalogEntry[]>;
  validateAccount(billerCode: string, accountRef: string): Promise<BillerValidationResult>;
}

export class BillerAggregatorProvider implements BillerProvider {
  readonly code = "biller-aggregator";
  readonly providerType = "biller" as const;

  private readonly circuitBreaker = getCircuitBreaker("biller-aggregator");

  private get baseUrl(): string {
    const url = getConfig().BILLER_API_BASE_URL;
    if (!url) {
      throw new ProviderError(
        "BILLER_API_BASE_URL not configured — biller adapter is fail-closed without a contracted aggregator.",
        "PROVIDER_UNAVAILABLE",
        this.code,
      );
    }
    return url.replace(/\/$/, "");
  }

  private get apiKey(): string {
    const key = getConfig().BILLER_API_KEY;
    if (!key) {
      throw new ProviderError(
        "BILLER_API_KEY not configured — biller adapter is fail-closed without API credentials.",
        "PROVIDER_AUTH_FAILED",
        this.code,
      );
    }
    return key;
  }

  private async executeWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.circuitBreaker.canExecute()) {
      throw new ProviderError("Circuit breaker open — biller aggregator unavailable", "PROVIDER_UNAVAILABLE", this.code);
    }
    try {
      const result = await fn();
      this.circuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      this.circuitBreaker.recordFailure();
      throw err;
    }
  }

  private async aggregatorGet<T>(path: string): Promise<T> {
    return this.executeWithCircuitBreaker(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new ProviderError(
          `Biller aggregator GET ${path} failed with HTTP ${res.status}`,
          "PROVIDER_UNAVAILABLE",
          this.code,
        );
      }
      return (await res.json()) as T;
    });
  }

  private async aggregatorPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.executeWithCircuitBreaker(async () => {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new ProviderError(
          `Biller aggregator POST ${path} failed with HTTP ${res.status}`,
          "PROVIDER_UNAVAILABLE",
          this.code,
        );
      }
      return (await res.json()) as T;
    });
  }

  async getBillers(): Promise<BillerCatalogEntry[]> {
    const data = await this.aggregatorGet<{ billers: Array<Record<string, unknown>> }>("/v1/billers");
    return (data.billers ?? []).map((b) => ({
      id: String(b.id ?? b.code ?? ""),
      code: String(b.code ?? ""),
      name: String(b.name ?? ""),
      category: String(b.category ?? "General"),
      channel: String(b.channel ?? "paybill"),
      accountNumber: String(b.accountNumber ?? b.paybillNumber ?? ""),
      logoUrl: b.logoUrl ? String(b.logoUrl) : undefined,
      requiresValidation: Boolean(b.requiresValidation ?? true),
    }));
  }

  async validateAccount(billerCode: string, accountRef: string): Promise<BillerValidationResult> {
    const data = await this.aggregatorPost<{
      valid: boolean;
      accountName?: string;
      errorMessage?: string;
    }>("/v1/billers/validate", {
      billerCode,
      accountRef,
    });
    return {
      valid: Boolean(data.valid),
      accountName: data.accountName ? String(data.accountName) : undefined,
      errorMessage: data.errorMessage ? String(data.errorMessage) : undefined,
    };
  }

  async createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult> {
    const config = getConfig();
    if (!config.BILLER_API_BASE_URL || !config.BILLER_API_KEY) {
      throw new ProviderError(
        "Biller aggregator not configured — set BILLER_API_BASE_URL and BILLER_API_KEY",
        "PROVIDER_UNAVAILABLE",
        this.code,
      );
    }

    const body: Record<string, unknown> = {
      reference: input.providerReference,
      amount: Number(input.amountMinor) / 100,
      currency: input.currency,
      channel: input.destination.channel,
      accountRef: input.destination.paybillAccount ?? input.reference,
    };

    if (input.destination.paybillNumber) {
      body.paybillNumber = input.destination.paybillNumber;
    }
    if (input.destination.tillNumber) {
      body.tillNumber = input.destination.tillNumber;
    }

    const data = await this.aggregatorPost<{
      status: string;
      transactionId?: string;
      errorMessage?: string;
    }>("/v1/payments", body);

    const status = String(data.status ?? "PENDING").toUpperCase();
    return {
      status: status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING",
      providerReference: data.transactionId ?? input.providerReference,
      async: status !== "SUCCESS",
      errorCode: status === "FAILED" ? "BILLER_REJECTED" : undefined,
      errorMessage: data.errorMessage,
      raw: data,
    };
  }

  async getPaymentStatus(input: ProviderStatusInput): Promise<ProviderStatusResult> {
    const data = await this.aggregatorGet<{
      status: string;
      transactionId?: string;
      errorMessage?: string;
    }>(`/v1/payments/${encodeURIComponent(input.providerReference)}`);
    const status = String(data.status ?? "UNKNOWN").toUpperCase();
    return {
      status: status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : status === "PENDING" ? "PENDING" : "UNKNOWN",
      providerReference: data.transactionId ?? input.providerReference,
      errorMessage: data.errorMessage,
      raw: data,
    };
  }

  async reversePayment(_input: ProviderReversalInput): Promise<ProviderReversalResult> {
    return { status: "FAILED", errorMessage: "Bill payments are not reversible through the aggregator." };
  }

  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook> {
    const supplied = (request.headers["x-biller-signature"] ?? "") as string;
    const expected = getConfig().BILLER_API_KEY ?? "";
    if (!expected || supplied !== expected) {
      return { valid: false, reason: "invalid signature" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody);
    } catch {
      return { valid: false, reason: "invalid json" };
    }
    const raw = parsed as Record<string, unknown>;
    const ref = String(raw.transactionId ?? raw.reference ?? "");
    if (!ref) return { valid: false, reason: "missing transaction reference" };
    const status = String(raw.status ?? "SUCCESS").toUpperCase();
    return {
      valid: true,
      providerEventId: String(raw.eventId ?? ref),
      event: {
        type: status === "SUCCESS" ? "payment.completed" : "payment.failed",
        providerReference: ref,
        status: status === "SUCCESS" ? "SUCCESS" : "FAILED",
        raw,
      },
    };
  }
}
