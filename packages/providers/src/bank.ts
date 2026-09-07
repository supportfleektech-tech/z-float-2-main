/**
 * Generic bank/PSP adapter — the framework for any contracted bank rail
 * (EAC-bank transfers, PesaLink, RTGS/EFT, PSP APIs).
 *
 * Contracted PSPs expose different payload shapes; this adapter maps Z-float's
 * stable interface onto a conventional bank/PSP HTTP API and must be completed
 * with the partner's exact specification + credentials before use. Without
 * BANK_API_BASE_URL it fails closed.
 */
import { getConfig } from "@zfloat/config";
import { ProviderError, type PaymentProvider, type ProviderPaymentInput, type ProviderPaymentResult, type ProviderReversalInput, type ProviderReversalResult, type ProviderStatusInput, type ProviderStatusResult, type ProviderWebhookRequest, type VerifiedWebhook } from "./types.js";

export class BankProviderAdapter implements PaymentProvider {
  readonly code = "bank-psp";
  readonly providerType = "bank" as const;

  private get baseUrl(): string {
    const url = getConfig().BANK_API_BASE_URL;
    if (!url) {
      throw new ProviderError(
        "BANK_API_BASE_URL not configured. Bank adapter is fail-closed without a contracted PSP.",
        "PROVIDER_UNAVAILABLE",
        this.code,
      );
    }
    return url;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = getConfig();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.BANK_API_KEY ?? ""}`,
        "X-Zfloat-Correlation": String(body.correlationId ?? ""),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new ProviderError(`Bank/PSP ${path} failed with HTTP ${res.status}`, "PROVIDER_UNAVAILABLE", this.code);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult> {
    const res = await this.post("/v1/transfers", {
      reference: input.providerReference,
      amount: Number(input.amountMinor) / 100,
      currency: input.currency,
      beneficiary: {
        name: input.destination.bankAccountName,
        accountNumber: input.destination.bankAccountNumber,
        bankCode: input.destination.bankCode,
      },
      narration: input.reference.slice(0, 140),
      correlationId: input.paymentId,
    });
    const status = String(res.status ?? "pending").toUpperCase();
    return {
      status: status === "COMPLETED" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING",
      providerReference: String(res.transactionId ?? res.reference ?? input.providerReference),
      async: true,
      raw: res,
    };
  }

  async getPaymentStatus(input: ProviderStatusInput): Promise<ProviderStatusResult> {
    const res = await this.post("/v1/transfers/status", { transactionId: input.providerReference });
    const status = String(res.status ?? "unknown").toUpperCase();
    return {
      status:
        status === "COMPLETED" ? "SUCCESS" : status === "FAILED" ? "FAILED" : status === "REVERSED" ? "REVERSED" : "PENDING",
      providerReference: input.providerReference,
      raw: res,
    };
  }

  async reversePayment(input: ProviderReversalInput): Promise<ProviderReversalResult> {
    const res = await this.post("/v1/transfers/reverse", {
      transactionId: input.providerReference,
      reason: input.reason,
      correlationId: input.paymentId,
    });
    const status = String(res.status ?? "pending").toUpperCase();
    return {
      status: status === "COMPLETED" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING",
      providerReference: input.providerReference,
      raw: res,
    };
  }

  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook> {
    const supplied = (request.headers["x-webhook-signature"] ?? "") as string;
    const expected = getConfig().BANK_API_SECRET ?? "";
    if (!expected || supplied !== expected) {
      return { valid: false, reason: "invalid or missing signature" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody);
    } catch {
      return { valid: false, reason: "invalid json" };
    }
    const raw = parsed as Record<string, unknown>;
    const ref = String(raw.transactionId ?? raw.reference ?? "");
    if (!ref) return { valid: false, reason: "missing reference" };
    const status = String(raw.status ?? "UNKNOWN").toUpperCase();
    return {
      valid: true,
      providerEventId: String(raw.eventId ?? ref),
      event: {
        type: status === "COMPLETED" ? "payment.completed" : status === "FAILED" ? "payment.failed" : "payment.pending",
        providerReference: ref,
        status: status === "COMPLETED" ? "SUCCESS" : status === "FAILED" ? "FAILED" : status === "REVERSED" ? "REVERSED" : "UNKNOWN",
        amountMinor: typeof raw.amount === "number" ? BigInt(Math.round(raw.amount * 100)) : undefined,
        occurredAt: new Date().toISOString(),
        raw,
      },
    };
  }
}
