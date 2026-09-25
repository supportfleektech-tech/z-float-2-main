"use client";
/**
 * ID document + KRA PIN inputs, used wherever we capture a person or business
 * (recipients, customers, payers, team). Phone numbers get recycled and
 * shared; an ID number + KRA PIN make identification unambiguous and the KRA
 * PIN flows onto eTIMS invoices so buyers can claim input VAT.
 */
import { Input, Label } from "@/components/ui";

export interface IdentityValue {
  idType: string;
  idNumber: string;
  kraPin: string;
}

export const EMPTY_IDENTITY: IdentityValue = { idType: "NATIONAL_ID", idNumber: "", kraPin: "" };

export const ID_TYPE_OPTIONS = [
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "ALIEN_ID", label: "Alien ID" },
  { value: "PASSPORT", label: "Passport" },
  { value: "MILITARY_ID", label: "Military ID" },
  { value: "COMPANY_REG", label: "Company reg. no." },
];

const KRA_RE = /^[AP]\d{9}[A-Z]$/;

export function kraPinHint(v: string): string | null {
  const s = v.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!s) return null;
  if (!KRA_RE.test(s)) return "Format: letter A/P + 9 digits + letter, e.g. A012345678Z";
  return s.startsWith("P") ? "Business / non-individual PIN" : "Individual PIN";
}

export function IdentityFields({
  value,
  onChange,
  prefix,
  business,
}: {
  value: IdentityValue;
  onChange: (v: IdentityValue) => void;
  prefix: string;
  business?: boolean;
}) {
  const hint = kraPinHint(value.kraPin);
  const bad = hint?.startsWith("Format");
  return (
    <fieldset className="rounded-control border border-borderline p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Identity (recommended)</legend>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div>
          <Label htmlFor={`${prefix}-idtype`}>ID type</Label>
          <select
            id={`${prefix}-idtype`}
            className="focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm"
            value={value.idType}
            onChange={(e) => onChange({ ...value, idType: e.target.value })}
          >
            {ID_TYPE_OPTIONS.filter((o) => business || o.value !== "COMPANY_REG").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${prefix}-idnumber`}>ID / document number</Label>
          <Input
            id={`${prefix}-idnumber`}
            value={value.idNumber}
            placeholder={value.idType === "PASSPORT" ? "AK1234567" : value.idType === "COMPANY_REG" ? "PVT-AB12CD3" : "12345678"}
            onChange={(e) => onChange({ ...value, idNumber: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor={`${prefix}-kra`}>KRA PIN</Label>
        <Input
          id={`${prefix}-kra`}
          value={value.kraPin}
          maxLength={13}
          placeholder="A012345678Z"
          className="font-mono uppercase"
          onChange={(e) => onChange({ ...value, kraPin: e.target.value.toUpperCase() })}
        />
        {hint ? <p className={`mt-1 text-xs ${bad ? "text-danger" : "text-muted"}`}>{hint}</p> : null}
      </div>
    </fieldset>
  );
}

/** Compact identity cell for tables. */
export function IdentityCell({ idType, idNumber, kraPin }: { idType?: string | null; idNumber?: string | null; kraPin?: string | null }) {
  if (!idNumber && !kraPin) return <span className="text-xs text-muted">—</span>;
  const label = ID_TYPE_OPTIONS.find((o) => o.value === idType)?.label ?? "ID";
  return (
    <div className="space-y-0.5 text-xs">
      {idNumber ? (
        <p>
          <span className="text-muted">{label}:</span> <span className="font-mono">{idNumber}</span>
        </p>
      ) : null}
      {kraPin ? (
        <p>
          <span className="text-muted">KRA:</span> <span className="font-mono">{kraPin}</span>
        </p>
      ) : null}
    </div>
  );
}
