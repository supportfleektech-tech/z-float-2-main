import { describe, it, expect } from "vitest";
import { Money, parseMinor, minorToDecimalString, minorToDisplay, minorOrZero } from "../src/index.js";

describe("Money", () => {
  it("stores minor units as bigint and never uses floats", () => {
    const m = Money.fromDecimalString("1234.50");
    expect(m.minor).toBe(123450n);
    expect(m.toDecimalString()).toBe("1234.50");
  });

  it("parses various decimal string formats", () => {
    expect(parseMinor("0")).toBe(0n);
    expect(parseMinor("0.5")).toBe(50n);
    expect(parseMinor("1,234.50")).toBe(123450n);
    expect(parseMinor("1234,5")).toBe(123450n);
    expect(parseMinor("1000000.00")).toBe(100000000n);
  });

  it("rejects invalid amounts", () => {
    expect(() => parseMinor("abc")).toThrow();
    expect(() => parseMinor("1.234")).toThrow(); // more than 2 decimals
    expect(() => parseMinor("1e5")).toThrow();
    expect(() => parseMinor("NaN")).toThrow();
    expect(() => parseMinor("12.345.67")).toThrow();
  });

  it("parses numbers without binary float error", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE754 — must never leak into money
    const a = parseMinor(0.1);
    const b = parseMinor(0.2);
    expect(a + b).toBe(30n);
    expect(parseMinor(10.0)).toBe(1000n);
  });

  it("adds and subtracts exactly", () => {
    const a = Money.fromDecimalString("10.10");
    const b = Money.fromDecimalString("20.20");
    expect(a.add(b).toDecimalString()).toBe("30.30");
    expect(b.sub(a).toDecimalString()).toBe("10.10");
    expect(Money.zero().sub(a).isNegative()).toBe(true);
  });

  it("computes exact percentage fees (floor)", () => {
    const amount = Money.fromDecimalString("1000.00");
    // 1.5% = 150 bps
    const fee = amount.percentFloor(150n);
    expect(fee.toDecimalString()).toBe("15.00");
    // 0.5% of 101 = 0.505 -> floor 0.50
    expect(Money.fromDecimalString("101.00").percentFloor(50n).toDecimalString()).toBe("0.50");
  });

  it("rejects currency mismatches", () => {
    const a = Money.fromMinor(100n, "KES");
    const b = Money.fromMinor(100n, "KES");
    expect(() => a.add(b)).not.toThrow();
  });

  it("sums collections", () => {
    const total = Money.sum([Money.fromDecimalString("1.00"), Money.fromDecimalString("2.50")]);
    expect(total.toDecimalString()).toBe("3.50");
    expect(Money.sum([]).isZero()).toBe(true);
  });

  it("formats for display with thousands separators", () => {
    expect(minorToDisplay(123456789n)).toBe("KES 1,234,567.89");
    expect(minorToDisplay(-50n)).toBe("KES -0.50");
    expect(minorToDecimalString(5n)).toBe("0.05");
  });

  it("minorOrZero coerces garbage to 0n instead of throwing", () => {
    expect(minorOrZero("12345")).toBe(12345n);
    expect(minorOrZero(12345)).toBe(12345n);
    expect(minorOrZero(12345n)).toBe(12345n);
    expect(minorOrZero(undefined)).toBe(0n);
    expect(minorOrZero(null)).toBe(0n);
    expect(minorOrZero("")).toBe(0n);
    expect(minorOrZero("  ")).toBe(0n);
    expect(minorOrZero("12.99")).toBe(12n);
    expect(minorOrZero("not-a-number")).toBe(0n);
    expect(minorOrZero(NaN)).toBe(0n);
    expect(minorOrZero(Infinity)).toBe(0n);
  });
});
