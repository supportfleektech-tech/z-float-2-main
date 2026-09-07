/**
 * Kenyan phone number normalization.
 *
 * Accepts local (0712 345 678), country-code (254712345678, +254712345678) and
 * a few common spacings. Normalizes to E.164: +254712345678.
 * Returns null when not a valid Kenyan mobile number.
 */

export const KENYA_COUNTRY_CODE = "254";
export const SAFARICOM_PREFIXES = ["701", "702", "703", "704", "705", "706", "707", "708", "709", "710", "711", "712", "713", "714", "715", "716", "717", "718", "719", "720", "721", "722", "723", "724", "725", "726", "727", "728", "729", "740", "741", "742", "743", "744", "745", "746", "747", "748", "749", "790", "791", "792", "793", "794", "795", "796", "797", "798", "799"];

export function normalizeKenyanPhone(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = KENYA_COUNTRY_CODE + digits.slice(1);
  if (digits.length !== 12 || !digits.startsWith(KENYA_COUNTRY_CODE)) return null;
  return `+${digits}`;
}

/** True when the number belongs to the Safaricom network (M-Pesa capable). */
export function isSafaricomNumber(e164: string): boolean {
  const national = e164.replace(/^\+/, "");
  if (!national.startsWith(KENYA_COUNTRY_CODE)) return false;
  const rest = national.slice(3);
  return SAFARICOM_PREFIXES.some((p) => rest.startsWith(p));
}

/** Format for display: +254 712 345 678 */
export function formatKenyanPhone(e164: string): string {
  const national = e164.replace(/^\+/, "");
  if (national.startsWith(KENYA_COUNTRY_CODE)) {
    const rest = national.slice(3);
    return `+254 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  }
  return e164;
}
