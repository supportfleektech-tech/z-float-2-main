"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, Card, Button, Input, Select, Label, Badge, TableShell, Skeleton } from "@/components/ui";

interface DocRow {
  id: string;
  docType: string;
  status: string;
  notes: string | null;
  createdAt: string;
  filename: string | null;
  mimeType: string | null;
  scanStatus: string | null;
}

interface Profile {
  id: string;
  businessName: string | null;
  registrationNumber: string | null;
  verificationLevel: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

const DOC_LABEL: Record<string, string> = {
  CR12: "Certificate of Incorporation (CR12)",
  KRA_PIN: "KRA PIN certificate",
  ID_PASSPORT: "ID / Passport of signatory",
  DIRECTORS: "Directors register",
  UTILITY: "Utility bill (proof of address)",
  BANK_STATEMENT: "Bank statement",
};

function profileTone(s: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (s === "APPROVED") return "success";
  if (s === "REJECTED") return "danger";
  if (s === "PENDING") return "warning";
  return "neutral";
}

export default function CompliancePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState("CR12");
  const [businessName, setBusinessName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/kyc/documents")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.data?.profile ?? null);
        setDocs(d.data?.documents ?? []);
      })
      .catch(() => setError("Could not load your KYC status."));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // refresh while scans run
    return () => clearInterval(t);
  }, [load]);

  const onUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return setError("Choose a file first.");
    setUploading(true);
    setError(null);
    setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      const res = await fetch("/api/kyc/documents", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Upload failed.");
        return;
      }
      setNote("Document uploaded — malware scan queued. You can submit for review once it shows CLEAN.");
      form.reset();
      load();
    } catch {
      setError("Upload failed — is the server running?");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kyc/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, registrationNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Submission failed.");
        return;
      }
      setNote("Profile submitted for review — a compliance officer will verify your documents.");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const status = profile?.status ?? "NOT_SUBMITTED";
  const level = profile?.verificationLevel ?? "NONE";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance & KYC"
        subtitle="Verify your business so you can send larger, risk-free payments."
        actions={
          status === "APPROVED" ? (
            <Badge tone="success">Verified · {level === "FULL" ? "Full (KYB)" : "Basic"}</Badge>
          ) : (
            <Badge tone={profileTone(status)}>{status.replace("_", " ")}</Badge>
          )
        }
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{note}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Business details</h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="bizName">Registered business name</Label>
              <Input
                id="bizName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Wanjiku Traders Ltd"
                disabled={status === "PENDING" || status === "APPROVED"}
              />
            </div>
            <div>
              <Label htmlFor="regNo">Registration / KRA PIN</Label>
              <Input
                id="regNo"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. PVT-ABC12345X or P051234567K"
                disabled={status === "PENDING" || status === "APPROVED"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Verification level</div>
                <div className="font-medium">{level === "NONE" ? "Not verified" : level}</div>
              </div>
              <div>
                <div className="text-slate-500">Submitted</div>
                <div className="font-medium">{profile?.submittedAt ? new Date(profile.submittedAt).toLocaleString() : "—"}</div>
              </div>
            </div>
            {status === "REJECTED" && profile?.reviewNote && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <strong>Reviewer note:</strong> {profile.reviewNote}
              </div>
            )}
            <Button onClick={onSubmit} disabled={submitting || status === "PENDING" || status === "APPROVED"} variant={status === "REJECTED" ? "danger" : undefined}>
              {submitting ? "Submitting…" : status === "REJECTED" ? "Re-submit for review" : "Submit for review"}
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Upload documents</h2>
          <form onSubmit={onUpload} className="space-y-3">
            <div>
              <Label htmlFor="docType">Document type</Label>
              <Select id="docType" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {Object.entries(DOC_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="file">File (PDF / PNG / JPG, max 15 MB)</Label>
              <Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" />
            </div>
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload document"}
            </Button>
          </form>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Uploaded documents</h2>
        {!docs ? (
          <Skeleton className="h-16 w-full" />
        ) : docs.length === 0 ? (
          <p className="text-sm text-slate-500">No documents yet — upload a CR12 or KRA PIN certificate to get started.</p>
        ) : (
          <TableShell
            headers={["Document", "Type", "Malware scan", "Uploaded"]}
            empty={<span className="text-sm text-slate-500">No documents.</span>}
          >
            {docs.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-sm font-medium">{d.filename ?? "document"}</td>
                <td className="px-4 py-2.5 text-sm">{DOC_LABEL[d.docType] ?? d.docType}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={d.scanStatus === "CLEAN" ? "success" : d.scanStatus === "INFECTED" ? "danger" : "warning"}>
                    {d.scanStatus === "PENDING" || !d.scanStatus ? "Scanning…" : d.scanStatus}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-sm text-slate-500">{new Date(d.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </TableShell>
        )}
        {docs !== null && docs.length > 0 && docs.every((d) => d.scanStatus === "CLEAN") && status !== "PENDING" && status !== "APPROVED" && (
          <p className="mt-3 text-xs text-slate-500">
            All documents scanned CLEAN — you can submit for review. Documents containing malware are rejected automatically.
          </p>
        )}
      </Card>
    </div>
  );
}
