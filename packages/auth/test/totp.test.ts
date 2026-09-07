import { describe, it, expect } from "vitest";
import { generateTOTPSecret, totpCode, verifyTOTP, totpUri } from "../src/totp.js";

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B test vectors (SHA-1). The RFC uses the ASCII secret
  // "12345678901234567890"; Z-float secrets are base32 (authenticator-app
  // interop), so the test key is the base32 encoding of those same bytes —
  // decoding yields the RFC key and the expected codes must match.
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("matches RFC 6238 vectors (6-digit) across the documented timestamps", () => {
    // T=59 → 287082; T=1111111109 → 081804; T=1111111111 → 050471;
    // T=1234567890 → 005924; T=2000000000 → 279037
    const cases: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [t, expected] of cases) {
      expect(totpCode(SECRET, t * 1000)).toBe(expected);
    }
  });

  it("verifies within the ±1 window (clock drift)", () => {
    const secret = generateTOTPSecret();
    const now = Date.now();
    const code = totpCode(secret, now);
    expect(verifyTOTP(secret, code, now)).toBe(true);
    // 29s late / 31s early still valid (adjacent windows)
    const late = totpCode(secret, now - 29_000);
    expect(verifyTOTP(secret, late, now)).toBe(true);
    const early = totpCode(secret, now + 29_000);
    expect(verifyTOTP(secret, early, now)).toBe(true);
    // beyond ±1 window → invalid
    const far = totpCode(secret, now - 90_000);
    expect(verifyTOTP(secret, far, now)).toBe(false);
  });

  it("rejects malformed codes and wrong secrets", () => {
    const secret = generateTOTPSecret();
    expect(verifyTOTP(secret, "abc123", Date.now())).toBe(false);
    expect(verifyTOTP(secret, "12345", Date.now())).toBe(false);
    expect(verifyTOTP(generateTOTPSecret(), totpCode(secret), Date.now())).toBe(false);
  });

  it("produces distinct codes across time windows", () => {
    const secret = generateTOTPSecret();
    const codes = new Set<string>();
    for (let w = 0; w < 5; w++) codes.add(totpCode(secret, Date.now() - w * 30_000));
    expect(codes.size).toBe(5);
  });

  it("emits a standards-compliant otpauth URI", () => {
    const secret = generateTOTPSecret();
    const uri = totpUri(secret, "demo@zfloat.app", "Z-float");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Z-float:demo%40zfloat\.app\?secret=[A-Z2-7]+&issuer=Z-float&period=30&digits=6$/);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(26); // 160-bit secret → 32 base32 chars
  });
});
