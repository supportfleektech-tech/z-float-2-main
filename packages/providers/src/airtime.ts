/**
 * Airtime/data adapter — catalogue-driven purchases for Safaricom, Airtel and
 * Telkom Kenya networks. The live provider is a contracted airtime aggregator;
 * the mock catalog ships with the seed (see packages/database seed) so the
 * whole flow works end-to-end in sandbox mode without real funds.
 */
import { getConfig } from "@zfloat/config";
import {
  AirtimeCatalogEntry,
  AirtimeProvider,
  ProviderError,
  type ProviderPaymentInput,
  type ProviderPaymentResult,
  type ProviderReversalInput,
  type ProviderReversalResult,
  type ProviderStatusInput,
  type ProviderStatusResult,
  type ProviderWebhookRequest,
  type VerifiedWebhook,
} from "./types.js";

export class AirtimeProviderAdapter implements AirtimeProvider {
  readonly code = "airtime-aggregator";
  readonly providerType = "airtime" as const;

  async getCatalog(): Promise<AirtimeCatalogEntry[]> {
    // In sandbox mode the catalog is served by the platform's airtime_catalog
    // table (seeded). A live aggregator would expose an API here.
    return [
      { network: "SAFARICOM", productCode: "SAF-10", name: "Safaricom Airtime 10", type: "AIRTIME", denominationMinor: 1000n, currency: "KES" },
      { network: "SAFARICOM", productCode: "SAF-20", name: "Safaricom Airtime 20", type: "AIRTIME", denominationMinor: 2000n, currency: "KES" },
      { network: "SAFARICOM", productCode: "SAF-1GB", name: "Safaricom Data 1GB", type: "DATA", denominationMinor: 10000n, currency: "KES" },
      { network: "AIRTEL", productCode: "AIRT-10", name: "Airtel Airtime 10", type: "AIRTIME", denominationMinor: 1000n, currency: "KES" },
      { network: "TELKOM", productCode: "TELK-10", name: "Telkom Airtime 10", type: "AIRTIME", denominationMinor: 1000n, currency: "KES" },
    ];
  }

  async createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult> {
    const baseUrl = getConfig().AIRTIME_API_BASE_URL;
    if (!baseUrl) {
      throw new ProviderError(
        "AIRTIME_API_BASE_URL not configured — airtime adapter is fail-closed without a contracted aggregator.",
        "PROVIDER_UNAVAILABLE",
        this.code,
      );
    }
    const res = await fetch(`${baseUrl}/v1/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getConfig().AIRTIME_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        reference: input.providerReference,
        phone: input.destination.phone,
        productCode: input.destination.airtimeProductCode,
        network: input.destination.airtimeNetwork,
        amount: Number(input.amountMinor) / 100,
        currency: input.currency,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new ProviderError(`Airtime topup failed with HTTP ${res.status}`, "PROVIDER_UNAVAILABLE", this.code);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const status = String(data.status ?? "PENDING").toUpperCase();
    return {
      status: status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "PENDING",
      providerReference: String(data.transactionId ?? input.providerReference),
      async: status !== "SUCCESS",
      raw: data,
    };
  }

  async getPaymentStatus(input: ProviderStatusInput): Promise<ProviderStatusResult> {
    return { status: "UNKNOWN", providerReference: input.providerReference };
  }

  async reversePayment(_input: ProviderReversalInput): Promise<ProviderReversalResult> {
    return { status: "FAILED", errorMessage: "Airtime/data topups are not reversible once delivered." };
  }

  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook> {
    const supplied = (request.headers["x-airtime-signature"] ?? "") as string;
    const expected = getConfig().AIRTIME_API_KEY ?? "";
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
    const ref = String(raw.transactionId ?? "");
    if (!ref) return { valid: false, reason: "missing transactionId" };
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
