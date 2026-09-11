/**
 * Guarded KES formatters for client components. API payloads carry minor
 * units as strings that can be missing after a shape change — these degrade
 * to zero instead of throwing `Cannot convert undefined to a BigInt` and
 * unmounting the page (use `minorOrZero` directly for arithmetic).
 */
import { minorOrZero } from "@zfloat/money";

/** Whole units: "KES 1,234". */
export function formatKES(minor: string | number | bigint | undefined | null): string {
  return `KES ${(minorOrZero(minor) / 100n).toLocaleString()}`;
}

/** Exact two-decimal display without currency prefix: "1,234.56". */
export function formatKESExact(minor: string | number | bigint | undefined | null): string {
  const n = minorOrZero(minor);
  return `${(n / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(n % 100n).toString().padStart(2, "0")}`;
}
