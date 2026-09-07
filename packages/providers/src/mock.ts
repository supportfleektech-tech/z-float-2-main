/**
 * Sandbox/Mock provider — deterministic, no real funds.
 *
 * Behaviour is driven by MOCK_PROVIDER_BEHAVIOUR (success | pending | random | fail)
 * so developers can reproduce every provider outcome locally:
 *   - success : every payment succeeds after a short latency
 *   - pending : payments enter PROVIDER_PENDING; the worker schedules a
 *               simulated callback (see services/worker simulate-callback job)
 *   - random  : ~80% success, ~10% pending, ~10% fail — good for QA chaos
 *   - fail    : every payment fails with a provider error
 */
import { getConfig } from "@zfloat/config";
import {
  PaymentProvider,
  ProviderPaymentInput,
  ProviderPaymentResult,
  ProviderReversalInput,
  ProviderReversalResult,
  ProviderStatusInput,
  ProviderStatusResult,
  ProviderWebhookRequest,
  VerifiedWebhook,
} from "./types.js";

export type MockBehaviour = "success" | "pending" | "random" | "fail";

export class MockProvider implements PaymentProvider {
  readonly code = "local-sandbox";
  readonly providerType = "sandbox" as const;

  constructor(private readonly behaviour: MockBehaviour = getConfig().MOCK_PROVIDER_BEHAVIOUR) {}

  private get mockSecret(): string {
    return getConfig().MOCK_PROVIDER_SECRET;
  }

  private async latency(): Promise<void> {
    const ms = getConfig().MOCK_PROVIDER_LATENCY_MS;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private decide(): ProviderPaymentResult["status"] {
    if (this.behaviour === "success") return "SUCCESS";
    if (this.behaviour === "fail") return "FAILED";
    if (this.behaviour === "pending") return "PENDING";
    const roll = Math.random();
    if (roll < 0.8) return "SUCCESS";
    if (roll < 0.9) return "PENDING";
    return "FAILED";
  }

  async createPayment(input: ProviderPaymentInput): Promise<ProviderPaymentResult> {
    await this.latency();
    const status = this.decide();
    return {
      status,
      providerReference: status === "FAILED" ? undefined : `MOCK-${input.providerReference}`,
      async: status === "PENDING",
      raw: { behaviour: this.behaviour, sandbox: true },
      ...(status === "FAILED" ? { errorCode: "MOCK_ERR_001", errorMessage: "Mock provider rejected the payment (fail behaviour)." } : {}),
    };
  }

  async getPaymentStatus(input: ProviderStatusInput): Promise<ProviderStatusResult> {
    await this.latency();
    return {
      status: this.decide(),
      providerReference: input.providerReference,
      raw: { behaviour: this.behaviour, sandbox: true },
    };
  }

  async reversePayment(input: ProviderReversalInput): Promise<ProviderReversalResult> {
    await this.latency();
    return {
      status: "SUCCESS",
      providerReference: input.providerReference,
      raw: { reversed: true, sandbox: true },
    };
  }

  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody || "{}");
    } catch {
      return { valid: false, reason: "invalid json" };
    }
    const raw = parsed as Record<string, unknown>;
    const body = (raw.body ?? raw) as Record<string, unknown>;
    // Simple shared-secret check: header X-Mock-Signature must equal the secret.
    const expected = this.mockSecret;
    const supplied = (request.headers["x-mock-signature"] ?? "") as string;
    if (supplied !== expected) {
      return { valid: false, reason: "invalid signature" };
    }
    const ref = String(body.providerReference ?? "");
    if (!ref) return { valid: false, reason: "missing providerReference" };
    const status = String(body.status ?? "SUCCESS") as
      | "SUCCESS"
      | "PENDING"
      | "FAILED"
      | "REVERSED"
      | "UNKNOWN";
    return {
      valid: true,
      providerEventId: String(body.eventId ?? ref),
      event: {
        type: String(body.type ?? "payment.completed"),
        providerReference: ref,
        status,
        amountMinor: typeof body.amountMinor === "string" ? BigInt(body.amountMinor) : undefined,
        raw: body,
      },
    };
  }
}
