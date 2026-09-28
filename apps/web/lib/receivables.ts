/**
 * Shared helpers for the receiving side (collections, customers, eTIMS
 * invoices/receipts): amount parsing, BigInt-safe JSON, error mapping.
 */
import { NextResponse } from "next/server";
import { toJsonSafe } from "@zfloat/database";
import { createProviderRegistry, isCollectionProvider, type CollectionProvider, type PaymentProvider } from "@zfloat/providers";
import { CollectionError } from "@zfloat/payments-core";
import { EtimsError, EtimsServiceError, TaxComputationError } from "@zfloat/etims";
import { IdentityValidationError } from "@zfloat/validation";
import { apiError } from "@/lib/api";

/** "1,250.50" → 125050n. Returns null for anything that is not a positive amount with ≤ 2 decimals. */
export function parseKesToMinor(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[,\s]/g, "").replace(/^KES/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const v = BigInt(whole!) * 100n + BigInt((frac + "00").slice(0, 2));
  return v > 0n ? v : null;
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return NextResponse.json(toJsonSafe(data), init);
}

/** The provider that pushes STK prompts: the configured default when it can collect, else the sandbox. */
export function collectionProvider(): PaymentProvider & CollectionProvider {
  const registry = createProviderRegistry();
  const p = registry.default();
  if (isCollectionProvider(p)) return p;
  const sandbox = registry.get("local-sandbox");
  if (!isCollectionProvider(sandbox)) throw new Error("No collection-capable provider configured");
  return sandbox;
}

export function receivablesError(err: unknown, fallback = "Request failed") {
  if (err instanceof IdentityValidationError) return apiError(400, "INVALID_IDENTITY", err.message, { field: err.field });
  if (err instanceof CollectionError) {
    const status = err.code.startsWith("DUPLICATE") ? 409 : err.code.endsWith("NOT_FOUND") ? 404 : 400;
    return apiError(status, err.code, err.message);
  }
  if (err instanceof EtimsServiceError) return apiError(err.code.endsWith("NOT_FOUND") ? 404 : 400, err.code, err.message);
  if (err instanceof TaxComputationError) return apiError(400, "INVALID_LINES", err.message);
  if (err instanceof EtimsError) return apiError(err.retryable ? 503 : 422, `ETIMS_${err.code}`, err.message, { resultCd: err.resultCd });
  return apiError(400, "REQUEST_FAILED", err instanceof Error ? err.message : fallback);
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}
