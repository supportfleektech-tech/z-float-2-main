import { describe, it, expect } from "vitest";
import {
  computeDocument,
  parseQtyMilli,
  minorToKes,
  buildSalesPayload,
  buildVerificationUrl,
  kraDateTime,
  SandboxEtimsClient,
  OscuHttpClient,
  EtimsError,
  TaxComputationError,
} from "../src/index.js";

describe("eTIMS tax engine", () => {
  it("computes VAT-inclusive 16% lines the KRA way (tax = gross × 16/116)", () => {
    const d = computeDocument([{ description: "Consulting", qtyMilli: 1000n, unitPriceMinor: 11_600_00n, taxType: "B" }], {
      pricesIncludeTax: true,
    });
    expect(d.totalMinor).toBe(11_600_00n);
    expect(d.taxMinor).toBe(1_600_00n);
    expect(d.subtotalMinor).toBe(10_000_00n);
    expect(d.taxSummary.B.taxableMinor).toBe("1160000");
    expect(d.taxSummary.B.taxMinor).toBe("160000");
  });

  it("adds VAT on top for exclusive pricing", () => {
    const d = computeDocument([{ description: "Widgets", qtyMilli: 3000n, unitPriceMinor: 1_000_00n, taxType: "B" }], {
      pricesIncludeTax: false,
    });
    expect(d.subtotalMinor).toBe(3_000_00n);
    expect(d.taxMinor).toBe(480_00n);
    expect(d.totalMinor).toBe(3_480_00n);
  });

  it("mixes categories (exempt, zero-rated, 8%) and applies discounts", () => {
    const d = computeDocument(
      [
        { description: "Maize flour", qtyMilli: 2000n, unitPriceMinor: 200_00n, taxType: "A" },
        { description: "Export service", qtyMilli: 1000n, unitPriceMinor: 5_000_00n, taxType: "C" },
        { description: "Diesel", qtyMilli: 10_500n, unitPriceMinor: 180_00n, discountMinor: 90_00n, taxType: "E" },
      ],
      { pricesIncludeTax: true },
    );
    // diesel: 10.5 × 180 = 1890 − 90 = 1800 incl.; tax = 1800 × 8/108 = 133.33
    expect(d.lines[2]!.totalMinor).toBe("180000");
    expect(d.lines[2]!.taxMinor).toBe("13333");
    expect(d.taxSummary.A.taxMinor).toBe("0");
    expect(d.taxSummary.C.taxableMinor).toBe("500000");
    expect(d.totalMinor).toBe(400_00n + 5_000_00n + 1_800_00n);
    expect(d.taxMinor).toBe(133_33n);
  });

  it("rejects bad input", () => {
    expect(() => computeDocument([], { pricesIncludeTax: true })).toThrow(TaxComputationError);
    expect(() =>
      computeDocument([{ description: "x", qtyMilli: 0n, unitPriceMinor: 1n, taxType: "B" }], { pricesIncludeTax: true }),
    ).toThrow(/quantity/);
    expect(() =>
      computeDocument([{ description: "x", qtyMilli: 1000n, unitPriceMinor: 100n, discountMinor: 200n, taxType: "B" }], {
        pricesIncludeTax: true,
      }),
    ).toThrow(/discount/);
  });

  it("parses quantities without floats", () => {
    expect(parseQtyMilli("2")).toBe(2000n);
    expect(parseQtyMilli("0.5")).toBe(500n);
    expect(parseQtyMilli("1.125")).toBe(1125n);
    expect(() => parseQtyMilli("1.2345")).toThrow();
    expect(minorToKes(1234567n)).toBe(12345.67);
  });
});

describe("OSCU payload", () => {
  const computed = computeDocument(
    [
      { description: "Item 1", qtyMilli: 2000n, unitPriceMinor: 3_500_00n, taxType: "B" },
      { description: "Item 2", qtyMilli: 1000n, unitPriceMinor: 3_500_00n, taxType: "B" },
    ],
    { pricesIncludeTax: true },
  );
  const payload = buildSalesPayload("P051234567Q", "00", {
    invoiceNo: 42,
    traderInvoiceNo: "INV-000042",
    kind: "SALE",
    customerKraPin: "A123456789B",
    customerName: "Jane Wanjiru",
    paymentTypeCode: "06",
    issuedAt: new Date("2026-01-27T18:03:00Z"),
    lines: computed.lines,
    taxSummary: computed.taxSummary,
    totalTaxableMinor: computed.totalMinor,
    totalTaxMinor: computed.taxMinor,
    totalMinor: computed.totalMinor,
    registeredBy: { id: "user-1", name: "Demo Owner" },
  });

  it("follows the TrnsSalesSaveWrReq field set", () => {
    expect(payload).toMatchObject({
      tin: "P051234567Q",
      bhfId: "00",
      invcNo: 42,
      orgInvcNo: 0,
      trdInvcNo: "INV-000042",
      custTin: "A123456789B",
      salesTyCd: "N",
      rcptTyCd: "S",
      pmtTyCd: "06",
      salesSttsCd: "02",
      totItemCnt: 2,
      taxRtB: 16,
      taxblAmtB: 10500,
      totAmt: 10500,
    });
    expect(payload.taxAmtB).toBeCloseTo(1448.28, 2);
    const items = payload.itemList as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ itemSeq: 1, qty: 2, prc: 3500, splyAmt: 7000, taxTyCd: "B", totAmt: 7000 });
  });

  it("stamps KRA local (EAT) timestamps", () => {
    expect(kraDateTime(new Date("2026-01-27T18:03:00Z"))).toBe("20260127210300");
    expect(payload.salesDt).toBe("20260127");
  });

  it("builds the receipt verification link for the QR code", () => {
    expect(buildVerificationUrl("sandbox", "P051234567Q", "00", "ABCD1234EFGH5678")).toBe(
      "https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567Q00ABCD1234EFGH5678",
    );
  });
});

describe("clients", () => {
  it("sandbox signer is deterministic and shaped like KRA output", async () => {
    const c = new SandboxEtimsClient("test-secret");
    const device = { tin: "P051234567Q", bhfId: "00", deviceSerial: "ZF-001" };
    const init = await c.initialise(device);
    expect(init.cmcKey).toMatch(/^SBX-/);
    expect(init.sdcId).toMatch(/^KRACU0\d{9}$/);
    const a = await c.saveSale({ ...device, cmcKey: init.cmcKey }, { invcNo: 1, totAmt: 100, rcptTyCd: "S" });
    const b = await c.saveSale({ ...device, cmcKey: init.cmcKey }, { invcNo: 1, totAmt: 100, rcptTyCd: "S" });
    expect(a.rcptSign).toBe(b.rcptSign);
    expect(a.rcptSign).toHaveLength(16);
    expect(a.intrlData).toHaveLength(26);
    await expect(c.saveSale(device, { invcNo: 1 })).rejects.toBeInstanceOf(EtimsError);
  });

  it("OSCU client is fail-closed without a cmcKey", async () => {
    const c = new OscuHttpClient("oscu", "sandbox", "http://127.0.0.1:1", 500);
    await expect(c.saveSale({ tin: "P051234567Q", bhfId: "00", deviceSerial: "x" }, {})).rejects.toMatchObject({
      code: "DEVICE_NOT_INITIALISED",
      retryable: false,
    });
  });

  it("OSCU client classifies network failures as retryable", async () => {
    const c = new OscuHttpClient("oscu", "sandbox", "http://127.0.0.1:1", 500);
    await expect(c.initialise({ tin: "P051234567Q", bhfId: "00", deviceSerial: "x" })).rejects.toMatchObject({ retryable: true });
  });
});
