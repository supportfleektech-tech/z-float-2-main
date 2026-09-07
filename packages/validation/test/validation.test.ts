import { describe, it, expect } from "vitest";
import { normalizeKenyanPhone, isSafaricomNumber, formatKenyanPhone } from "../src/index.js";

describe("Kenyan phone normalization", () => {
  it("normalizes local formats", () => {
    expect(normalizeKenyanPhone("0712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("0712 345 678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("0712-345-678")).toBe("+254712345678");
  });

  it("normalizes country-code formats", () => {
    expect(normalizeKenyanPhone("254712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("+254712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("+254 712 345678")).toBe("+254712345678");
  });

  it("rejects invalid numbers", () => {
    expect(normalizeKenyanPhone("12345")).toBeNull();
    expect(normalizeKenyanPhone("+15551234567")).toBeNull();
    expect(normalizeKenyanPhone("")).toBeNull();
    expect(normalizeKenyanPhone("071234567")).toBeNull(); // too short
  });

  it("detects Safaricom numbers", () => {
    expect(isSafaricomNumber("+254712345678")).toBe(true); // 712 = Safaricom
    expect(isSafaricomNumber("+254751234567")).toBe(false); // 751 = Airtel prefix range
  });

  it("formats for display", () => {
    expect(formatKenyanPhone("+254712345678")).toBe("+254 712 345 678");
  });
});
