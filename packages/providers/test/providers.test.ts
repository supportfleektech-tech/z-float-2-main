import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetConfig, getConfig } from "@zfloat/config";
import { MockProvider, createProviderRegistry } from "../src/index.js";
import { MpesaProviderAdapter } from "../src/index.js";
import type { ProviderPaymentInput } from "../src/index.js";

function mockInput(overrides: Partial<ProviderPaymentInput> = {}): ProviderPaymentInput {
  return {
    paymentId: "11111111-1111-1111-1111-111111111111",
    reference: "ZF-TEST-123",
    amountMinor: 5000n,
    currency: "KES",
    destination: { channel: "mpesa", phone: "+254712345678" },
    providerReference: "ref-001",
    ...overrides,
  };
}

beforeEach(() => {
  resetConfig();
  getConfig({
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://localhost/x",
      MOCK_PROVIDER_BEHAVIOUR: "success",
      MOCK_PROVIDER_LATENCY_MS: "0",
      PROVIDER_DEFAULT: "local-sandbox",
    },
    lenient: true,
  });
});

afterEach(() => resetConfig());

describe("MockProvider", () => {
  it("succeeds deterministically in success mode", async () => {
    const provider = new MockProvider("success");
    const result = await provider.createPayment(mockInput());
    expect(result.status).toBe("SUCCESS");
    expect(result.providerReference).toBe("MOCK-ref-001");
  });

  it("fails deterministically in fail mode", async () => {
    const provider = new MockProvider("fail");
    const result = await provider.createPayment(mockInput());
    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBeDefined();
  });

  it("pends in pending mode and requires async completion", async () => {
    const provider = new MockProvider("pending");
    const result = await provider.createPayment(mockInput());
    expect(result.status).toBe("PENDING");
    expect(result.async).toBe(true);
  });

  it("verifies webhooks with the shared secret", async () => {
    const provider = new MockProvider("success");
    const verified = await provider.verifyWebhook({
      rawBody: JSON.stringify({
        eventId: "evt-1",
        providerReference: "ref-001",
        status: "SUCCESS",
        amountMinor: "5000",
      }),
      headers: { "x-mock-signature": "mock-provider-dev-secret" },
    });
    expect(verified.valid).toBe(true);
    expect(verified.event?.providerReference).toBe("ref-001");
    expect(verified.event?.amountMinor).toBe(5000n);
  });

  it("rejects webhooks with a wrong signature", async () => {
    const provider = new MockProvider("success");
    const verified = await provider.verifyWebhook({
      rawBody: JSON.stringify({ providerReference: "ref-001" }),
      headers: { "x-mock-signature": "nope" },
    });
    expect(verified.valid).toBe(false);
  });

  it("supports reversals", async () => {
    const provider = new MockProvider("success");
    const result = await provider.reversePayment({
      providerReference: "ref-001",
      amountMinor: 5000n,
      currency: "KES",
      reason: "duplicate",
    });
    expect(result.status).toBe("SUCCESS");
  });
});

describe("registry", () => {
  it("resolves the default sandbox provider", () => {
    const registry = createProviderRegistry();
    expect(registry.default().code).toBe("local-sandbox");
  });

  it("throws on unknown providers", () => {
    const registry = createProviderRegistry();
    expect(() => registry.get("does-not-exist")).toThrow();
  });
});

describe("MpesaProviderAdapter", () => {
  it("is fail-closed without credentials", async () => {
    const adapter = new MpesaProviderAdapter("sandbox");
    await expect(adapter.createPayment(mockInput())).rejects.toThrow(/MPESA_CONSUMER_KEY/);
  });

  it("rejects unsupported channels before any network call", async () => {
    const adapter = new MpesaProviderAdapter("sandbox");
    // supply fake creds so we pass the credential guard, then channel check must trip first
    resetConfig();
    getConfig({
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/x",
        MPESA_CONSUMER_KEY: "k",
        MPESA_CONSUMER_SECRET: "s",
        MPESA_PASSKEY: "p",
        MPESA_SHORTCODE: "174379",
        MPESA_CALLBACK_BASE_URL: "https://example.com",
      },
      lenient: true,
    });
    await expect(
      adapter.createPayment(mockInput({ destination: { channel: "bank", bankAccountNumber: "x", bankAccountName: "Y", bankCode: "01" } })),
    ).rejects.toThrow(/Unsupported M-Pesa channel/);
  });
});
