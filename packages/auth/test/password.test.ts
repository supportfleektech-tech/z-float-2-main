import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordIssues } from "../src/index.js";

describe("password hashing", () => {
  it("hashes and verifies correctly", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple1!");
    expect(hash).not.toContain("CorrectHorseBatteryStaple1!");
    expect(await verifyPassword("CorrectHorseBatteryStaple1!", hash)).toBe(true);
    expect(await verifyPassword("WrongPassword1!", hash)).toBe(false);
  });

  it("uses unique salts", async () => {
    const a = await hashPassword("SamePassword1!");
    const b = await hashPassword("SamePassword1!");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("enforces password policy", () => {
    expect(passwordIssues("short1!A")).not.toHaveLength(0);
    expect(passwordIssues("ValidPassword123!")).toHaveLength(0);
  });
});
