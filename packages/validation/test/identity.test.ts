import { describe, it, expect } from "vitest";
import {
  normalizeKraPin,
  kraPinKind,
  normalizeIdNumber,
  normalizeIdentity,
  maskIdentifier,
  classifyIdentityQuery,
  IdentityValidationError,
  identityInputSchema,
  recipientInputSchema,
} from "../src/index.js";

describe("KRA PIN", () => {
  it("normalizes case and separators", () => {
    expect(normalizeKraPin("a012345678z")).toBe("A012345678Z");
    expect(normalizeKraPin(" P051 234 567-Q ")).toBe("P051234567Q");
  });
  it("rejects malformed PINs", () => {
    expect(normalizeKraPin("B012345678Z")).toBeNull(); // bad type letter
    expect(normalizeKraPin("A01234567Z")).toBeNull(); // 8 digits
    expect(normalizeKraPin("A0123456789")).toBeNull(); // no check letter
    expect(normalizeKraPin("")).toBeNull();
    expect(normalizeKraPin(undefined)).toBeNull();
  });
  it("classifies individual vs non-individual", () => {
    expect(kraPinKind("A012345678Z")).toBe("INDIVIDUAL");
    expect(kraPinKind("P051234567Q")).toBe("NON_INDIVIDUAL");
    expect(kraPinKind("nope")).toBeNull();
  });
});

describe("ID numbers", () => {
  it("validates per document type", () => {
    expect(normalizeIdNumber("NATIONAL_ID", "12 345 678")).toBe("12345678");
    expect(normalizeIdNumber("NATIONAL_ID", "1234567890")).toBeNull();
    expect(normalizeIdNumber("NATIONAL_ID", "12AB5678")).toBeNull();
    expect(normalizeIdNumber("PASSPORT", "ak1234567")).toBe("AK1234567");
    expect(normalizeIdNumber("PASSPORT", "ABCDEFG")).toBeNull(); // needs a digit
    expect(normalizeIdNumber("ALIEN_ID", "123456789")).toBe("123456789");
    expect(normalizeIdNumber("COMPANY_REG", "cpr/2015/123456")).toBe("CPR/2015/123456");
  });
  it("normalizeIdentity defaults the type to NATIONAL_ID and allows empties", () => {
    expect(normalizeIdentity({})).toEqual({ idType: null, idNumber: null, kraPin: null });
    expect(normalizeIdentity({ idNumber: "23456789", kraPin: "a123456789b" })).toEqual({
      idType: "NATIONAL_ID",
      idNumber: "23456789",
      kraPin: "A123456789B",
    });
  });
  it("normalizeIdentity throws field-scoped errors", () => {
    expect(() => normalizeIdentity({ kraPin: "123" })).toThrow(IdentityValidationError);
    try {
      normalizeIdentity({ idType: "PASSPORT", idNumber: "!!" });
    } catch (e) {
      expect((e as IdentityValidationError).field).toBe("idNumber");
    }
  });
  it("zod schema surfaces identity errors", () => {
    expect(identityInputSchema.safeParse({ idNumber: "23456789" }).success).toBe(true);
    const bad = identityInputSchema.safeParse({ kraPin: "X1" });
    expect(bad.success).toBe(false);
    expect(recipientInputSchema.safeParse({ name: "Jane Doe", idType: "NATIONAL_ID", idNumber: "23456789", kraPin: "A123456789B" }).success).toBe(true);
  });
});

describe("masking + lookup classification", () => {
  it("masks all but the edges", () => {
    expect(maskIdentifier("23456789")).toBe("23••••89");
    expect(maskIdentifier("A123456789B")).toBe("A1•••••••9B");
    expect(maskIdentifier("")).toBe("");
  });
  it("classifies a search query", () => {
    expect(classifyIdentityQuery("A123456789B")).toBe("KRA_PIN");
    expect(classifyIdentityQuery("0712 345 678")).toBe("PHONE");
    expect(classifyIdentityQuery("+254712345678")).toBe("PHONE");
    expect(classifyIdentityQuery("23456789")).toBe("ID_NUMBER");
    expect(classifyIdentityQuery("Wanjiru")).toBe("TEXT");
  });
});
