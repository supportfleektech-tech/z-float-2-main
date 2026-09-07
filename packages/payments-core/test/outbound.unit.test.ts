import { describe, it, expect } from "vitest";
import { signPayload, verifyPayloadSignature, normalizeOutboundEvent, OUTBOUND_EVENTS } from "../src/outbound.js";

describe("outbound webhook signing", () => {
  const secret = "test-secret-123";
  const payload = { paymentId: "abc", amountMinor: "1000", status: "SUCCESS" };

  it("produces a deterministic HMAC-SHA256 signature", () => {
    const a = signPayload(secret, payload);
    const b = signPayload(secret, payload);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("verifies a genuine signature and rejects tampering", () => {
    const sig = signPayload(secret, payload);
    expect(verifyPayloadSignature(secret, payload, sig)).toBe(true);
    expect(verifyPayloadSignature("wrong-secret", payload, sig)).toBe(false);
    expect(verifyPayloadSignature(secret, { ...payload, amountMinor: "9999" }, sig)).toBe(false);
    expect(verifyPayloadSignature(secret, payload, "deadbeef")).toBe(false);
  });

  it("signs string payloads canonically", () => {
    const sig = signPayload(secret, '{"a":1}');
    expect(sig).toBe(signPayload(secret, '{"a":1}'));
  });

  it("normalizes internal outbox names to subscription events", () => {
    expect(normalizeOutboundEvent("payment.succeeded")).toBe("payment.completed");
    expect(normalizeOutboundEvent("payment.completed")).toBe("payment.completed");
    expect(normalizeOutboundEvent("payment.failed")).toBe("payment.failed");
    expect(normalizeOutboundEvent("batch.completed")).toBe("batch.completed");
  });

  it("exposes the subscribable event catalog", () => {
    expect(OUTBOUND_EVENTS).toContain("payment.completed");
    expect(OUTBOUND_EVENTS).toContain("payment.failed");
    expect(OUTBOUND_EVENTS).toContain("payment.reversed");
    expect(OUTBOUND_EVENTS).toContain("batch.completed");
  });
});
