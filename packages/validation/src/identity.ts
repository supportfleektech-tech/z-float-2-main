/**
 * Kenyan identity helpers — National ID / Alien ID / Passport numbers and
 * KRA PINs, so people and businesses can be identified by more than a phone
 * number (phones get recycled, shared and SIM-swapped).
 *
 * KRA PIN format (iTax): 11 characters — a type letter, 9 digits, a check
 * letter. "A" = individual (resident person), "P" = non-individual
 * (company, partnership, trust …). e.g. A012345678Z, P051234567Q.
 */
import { z } from "zod";

export const ID_DOCUMENT_TYPES = ["NATIONAL_ID", "ALIEN_ID", "PASSPORT", "MILITARY_ID", "COMPANY_REG"] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  NATIONAL_ID: "National ID",
  ALIEN_ID: "Alien / Foreigner ID",
  PASSPORT: "Passport",
  MILITARY_ID: "Military ID",
  COMPANY_REG: "Business reg. no.",
};

const KRA_PIN_RE = /^[AP]\d{9}[A-Z]$/;

/** Uppercase + strip separators. Returns null when not a valid KRA PIN. */
export function normalizeKraPin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).toUpperCase().replace(/[\s-]/g, "");
  return KRA_PIN_RE.test(v) ? v : null;
}

export function isValidKraPin(raw: string | null | undefined): boolean {
  return normalizeKraPin(raw) !== null;
}

/** "INDIVIDUAL" for A-PINs, "NON_INDIVIDUAL" for P-PINs. */
export function kraPinKind(pin: string): "INDIVIDUAL" | "NON_INDIVIDUAL" | null {
  const v = normalizeKraPin(pin);
  if (!v) return null;
  return v.startsWith("A") ? "INDIVIDUAL" : "NON_INDIVIDUAL";
}

/**
 * Normalize an identity-document number for its type. Returns null when the
 * value is not plausible for that document type.
 *  - NATIONAL_ID: 6–8 digits (older IDs are shorter)
 *  - ALIEN_ID:    6–9 digits
 *  - MILITARY_ID: 5–10 digits
 *  - PASSPORT:    6–9 alphanumerics (Kenyan: 1–2 letters + digits)
 *  - COMPANY_REG: 4–30 chars, letters/digits and / - (e.g. PVT-AB12CD3, CPR/2015/123456)
 */
export function normalizeIdNumber(type: IdDocumentType, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = String(raw).toUpperCase().replace(/\s+/g, "");
  switch (type) {
    case "NATIONAL_ID":
      return /^\d{6,8}$/.test(compact) ? compact : null;
    case "ALIEN_ID":
      return /^\d{6,9}$/.test(compact) ? compact : null;
    case "MILITARY_ID":
      return /^\d{5,10}$/.test(compact) ? compact : null;
    case "PASSPORT":
      return /^[A-Z0-9]{6,9}$/.test(compact) && /\d/.test(compact) ? compact : null;
    case "COMPANY_REG":
      return /^[A-Z0-9/-]{4,30}$/.test(compact) ? compact : null;
    default:
      return null;
  }
}

/** Mask all but the first 2 and last 2 characters (PII-safe display). */
export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return `${value.slice(0, 2)}${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

export interface IdentityInput {
  idType?: string | null;
  idNumber?: string | null;
  kraPin?: string | null;
}

export interface NormalizedIdentity {
  idType: IdDocumentType | null;
  idNumber: string | null;
  kraPin: string | null;
}

export class IdentityValidationError extends Error {
  constructor(message: string, readonly field: "idType" | "idNumber" | "kraPin") {
    super(message);
    this.name = "IdentityValidationError";
  }
}

/**
 * Validate + normalize optional identity fields in one place (APIs, bulk
 * uploads, seed). Empty values are allowed; malformed ones throw.
 */
export function normalizeIdentity(input: IdentityInput): NormalizedIdentity {
  const rawNumber = input.idNumber ? String(input.idNumber).trim() : "";
  const rawType = input.idType ? String(input.idType).trim().toUpperCase() : "";
  const rawPin = input.kraPin ? String(input.kraPin).trim() : "";

  let idType: IdDocumentType | null = null;
  let idNumber: string | null = null;
  if (rawNumber) {
    const type = (rawType || "NATIONAL_ID") as IdDocumentType;
    if (!(ID_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw new IdentityValidationError(`Unknown ID type "${rawType}"`, "idType");
    }
    idNumber = normalizeIdNumber(type, rawNumber);
    if (!idNumber) {
      throw new IdentityValidationError(`"${rawNumber}" is not a valid ${ID_DOCUMENT_LABELS[type]} number`, "idNumber");
    }
    idType = type;
  }
  let kraPin: string | null = null;
  if (rawPin) {
    kraPin = normalizeKraPin(rawPin);
    if (!kraPin) {
      throw new IdentityValidationError(
        `"${rawPin}" is not a valid KRA PIN (expected e.g. A012345678Z for individuals or P051234567Q for companies)`,
        "kraPin",
      );
    }
  }
  return { idType, idNumber, kraPin };
}

export const kraPinSchema = z
  .string()
  .transform((v, ctx) => {
    const n = normalizeKraPin(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a valid KRA PIN (e.g. A012345678Z)" });
      return z.NEVER;
    }
    return n;
  });

export const identityInputSchema = z
  .object({
    idType: z.enum(ID_DOCUMENT_TYPES).optional(),
    idNumber: z.string().trim().max(30).optional().or(z.literal("")),
    kraPin: z.string().trim().max(15).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    try {
      normalizeIdentity(v);
    } catch (err) {
      if (err instanceof IdentityValidationError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err.message, path: [err.field] });
      }
    }
  });

/**
 * Classify a free-text lookup query so a single search box can find a person
 * by phone, ID number or KRA PIN.
 */
export function classifyIdentityQuery(q: string): "KRA_PIN" | "PHONE" | "ID_NUMBER" | "TEXT" {
  const v = q.trim().toUpperCase().replace(/[\s-]/g, "");
  if (KRA_PIN_RE.test(v)) return "KRA_PIN";
  if (/^(\+?254|0)[17]\d{8}$/.test(v)) return "PHONE";
  if (/^[A-Z]{0,2}\d{5,9}$/.test(v)) return "ID_NUMBER";
  return "TEXT";
}
