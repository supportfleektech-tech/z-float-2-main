/**
 * Money value object — the only way Z-float represents money.
 *
 * Rules (from instructions.md):
 *  - Never use floating-point arithmetic for KES amounts.
 *  - Store monetary values as integer minor units (cents).
 *  - No `number` arithmetic for settlement-critical amounts.
 *
 * All arithmetic is bigint on minor units. Parsing of decimal strings is done
 * with string manipulation (never parseFloat).
 */
export type Currency = "KES";
export const MINOR_UNITS_PER_UNIT = 100n; // 1 KES = 100 cents

export interface MoneyInput {
  currency: Currency;
  /** Amount in minor units (cents). Must be an integer. */
  minor: bigint;
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

/** Match "1234", "1,234.50", "1234.5", "-50.05". No exponent notation, no NaN. */
function stripGrouping(raw: string): string {
  return raw.replace(/\s/g, "");
}

/**
 * Parse a decimal string into minor units without floating point.
 * Accepts "1234.50", "1,234.50", "1234", "0.5" (50 cents), "1234,5".
 * Max 2 decimal places; throws on anything else.
 */
export function parseMinor(raw: string | number | bigint, currency: Currency = "KES"): bigint {
  if (typeof raw === "bigint") {
    if (raw < 0n) {
      // negative minor units are rejected at parse time; use Money.sub for arithmetic
      throw new MoneyParseError("Minor units must be non-negative");
    }
    return raw;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new MoneyParseError("Amount must be finite");
    // Numbers like 1234.5 are exact; but 0.1+0.2 style errors must never occur,
    // so convert via string with a fixed 2-digit precision guard.
    const asString = raw.toFixed(2);
    return parseMinor(asString, currency);
  }

  const cleaned = stripGrouping(String(raw).trim());
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  // Resolve the decimal separator without ambiguity:
  //  - thousands groups of 3 + optional decimal => that is the decimal mark
  //  - otherwise, a single trailing separator is the decimal mark
  // Ambiguous forms (e.g. "1.234" = 1.234 or 1,234?) are REJECTED rather than
  // guessed — money must never be silently misread. European dot-grouping is
  // only accepted with a comma decimal or with 2+ groups.
  let decimalSep: string | null = null;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(unsigned)) decimalSep = ".";
  else if (/^(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})|\d{1,3}(?:\.\d{3}){2,})$/.test(unsigned)) decimalSep = ",";
  else if (/^\d+(\.\d{1,2})?$/.test(unsigned)) decimalSep = ".";
  else if (/^\d+(,\d{1,2})?$/.test(unsigned)) decimalSep = ",";
  else {
    throw new MoneyParseError(`Invalid amount: "${raw}"`);
  }

  const [wholeRaw = "0", fraction = ""] = unsigned.split(decimalSep);
  // Remove the *other* character when it was used as a thousands separator.
  const whole = decimalSep === "." ? wholeRaw.replace(/,/g, "") : wholeRaw.replace(/\./g, "");
  const fracPadded = fraction.padEnd(2, "0").slice(0, 2);
  const minor = BigInt(whole) * MINOR_UNITS_PER_UNIT + BigInt(fracPadded);
  return negative ? -minor : minor;
}

/** Format minor units as a decimal string ("1234.50") without float math. */
export function minorToDecimalString(minor: bigint, _currency: Currency = "KES"): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / MINOR_UNITS_PER_UNIT;
  const frac = abs % MINOR_UNITS_PER_UNIT;
  const fracStr = frac.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
}

/** Format minor units with thousands separators for display. */
export function minorToDisplay(minor: bigint, currency: Currency = "KES"): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / MINOR_UNITS_PER_UNIT;
  const frac = abs % MINOR_UNITS_PER_UNIT;
  const wholeStr = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return `${currency === "KES" ? "KES " : ""}${sign}${wholeStr}.${frac
    .toString()
    .padStart(2, "0")}`;
}

export class Money {
  readonly currency: Currency;
  readonly minor: bigint;

  constructor(minor: bigint | number | string, currency: Currency = "KES") {
    this.currency = currency;
    this.minor = typeof minor === "bigint" ? minor : parseMinor(minor, currency);
  }

  static fromMinor(minor: bigint, currency: Currency = "KES"): Money {
    return new Money(minor, currency);
  }
  static fromDecimalString(value: string, currency: Currency = "KES"): Money {
    return new Money(parseMinor(value, currency), currency);
  }
  static zero(currency: Currency = "KES"): Money {
    return new Money(0n, currency);
  }
  static sum(items: Array<Money | { minor: bigint; currency?: Currency }>): Money {
    if (items.length === 0) return Money.zero();
    const currency = items[0]!.currency ?? "KES";
    const total = items.reduce((acc, item) => {
      const m = item instanceof Money ? item : Money.fromMinor(item.minor, item.currency ?? "KES");
      if (m.currency !== currency) {
        throw new Error(`Currency mismatch in sum: ${m.currency} vs ${currency}`);
      }
      return acc + m.minor;
    }, 0n);
    return Money.fromMinor(total, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinor(this.minor + other.minor, this.currency);
  }
  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinor(this.minor - other.minor, this.currency);
  }
  neg(): Money {
    return Money.fromMinor(-this.minor, this.currency);
  }
  /** Exact percentage of this amount in minor units, rounded down (floor). */
  percentFloor(percentBps: bigint): Money {
    // percentBps is in basis points (100 bps = 1%)
    return Money.fromMinor((this.minor * percentBps) / 10_000n, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }
  isNegative(): boolean {
    return this.minor < 0n;
  }
  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor > other.minor;
  }
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor < other.minor;
  }
  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor >= other.minor;
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  /** Decimal string, e.g. "1234.50" — safe for wire formats and DB bigint-agnostic contexts. */
  toDecimalString(): string {
    return minorToDecimalString(this.minor, this.currency);
  }
  /** Display string, e.g. "KES 1,234.50". */
  toDisplay(): string {
    return minorToDisplay(this.minor, this.currency);
  }
  toJSON(): { currency: Currency; minor: string } {
    return { currency: this.currency, minor: this.minor.toString() };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}

/** Serialize for DB storage as a string of minor units. */
export function toDbMinor(minor: bigint): string {
  return minor.toString();
}
/** Parse from DB. */
export function fromDbMinor(value: string | bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}
