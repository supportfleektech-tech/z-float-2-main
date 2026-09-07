"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, Card, Button, Textarea, Badge, TableShell, Tabs, Skeleton, Modal } from "@/components/ui";

interface CaseRow {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  kind: string;
  status: string;
  riskLevel: string;
  note: string | null;
  paymentId: string | null;
  subjectName: string | null;
  subjectRef: string | null;
  score: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface TenantDetail {
  profile: {
    id: string;
    businessName: string | null;
    registrationNumber: string | null;
    verificationLevel: string;
    status: string;
    submittedAt: string | null;
    reviewNote: string | null;
  } | null;
  documents: Array<{
    id: string;
    docType: string;
    status: string;
    createdAt: string;
    filename: string | null;
    scanStatus: string | null;
  }>;
}

const KIND_LABEL: Record<string, string> = {
  SANCTION_HIT: "Sanctions match",
  PEP_HIT: "PEP match",
  ADVERSE_HIT: "Adverse media match",
  DOC_REVIEW: "Document review",
};

const RISK_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "warning",
  CRITICAL: "danger",
};

export default function AdminKycPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [tab, setTab] = useState("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [detailTenant, setDetailTenant] = useState<string | null>(null);
  const [tenantDetail, setTenantDetail] = useState<TenantDetail | null>(null);
  const [deciding, setDeciding] = useState<CaseRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/kyc/cases?status=${tab}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.data) throw new Error(d.error?.message ?? "load failed");
        setCases(d.data.cases ?? []);
      })
      .catch((e) => setError(String(e.message ?? "Could not load cases")));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detailTenant) return;
    fetch(`/api/admin/kyc/tenant?tenantId=${detailTenant}`)
      .then((r) => r.json())
      .then((d) => setTenantDetail(d.data ?? null))
      .catch(() => setTenantDetail(null));
  }, [detailTenant]);

  const decide = async (kase: CaseRow, decision: "APPROVED" | "REJECTED" | "CLOSED") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kyc/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: kase.id, decision, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Decision failed");
      setFlash(`Case ${decision.toLowerCase()} — action recorded and audited.`);
      setDeciding(null);
      setNote("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decideProfile = async (decision: "APPROVED" | "REJECTED") => {
    if (!detailTenant) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kyc/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: detailTenant,
          decision,
          level: decision === "APPROVED" ? "FULL" : "BASIC",
          note: note || "Reviewed by compliance.",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Decision failed");
      setFlash(`Profile ${decision.toLowerCase()} — verification level updated.`);
      setTenantDetail(null);
      setDetailTenant(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="KYC & AML cases"
        subtitle="Watchlist screening hits and document review queue."
        actions={<Badge tone="info">admin.kyc</Badge>}
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {flash && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{flash}</div>}

      <Tabs tabs={["OPEN", "ALL", "APPROVED", "REJECTED", "CLOSED"]} active={tab === "ALL" ? "ALL" : tab} onChange={(t) => setTab(t)} />

      <Card className="p-5">
        {!cases ? (
          <Skeleton className="h-24 w-full" />
        ) : cases.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No {tab === "ALL" ? "" : `${tab.toLowerCase()} `}cases.</p>
        ) : (
          <TableShell
            headers={["Case", "Tenant", "Subject", "Risk", "Status", "Raised", ""]}
            empty={<span>No cases.</span>}
          >
            {cases.map((k) => (
              <tr key={k.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-sm">
                  <div className="font-medium">{KIND_LABEL[k.kind] ?? k.kind}</div>
                  <div className="text-xs text-slate-500">{k.note}</div>
                </td>
                <td className="px-4 py-2.5 text-sm">{k.tenantName ?? "—"}</td>
                <td className="px-4 py-2.5 text-sm">
                  {k.subjectName ?? "—"}
                  {k.subjectRef ? <div className="text-xs text-slate-500">{k.subjectRef}</div> : null}
                  {k.score ? <div className="text-xs text-amber-600">match {k.score}%</div> : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={RISK_TONE[k.riskLevel] ?? "neutral"}>{k.riskLevel}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={k.status === "OPEN" ? "warning" : k.status === "REJECTED" ? "danger" : k.status === "APPROVED" ? "success" : "neutral"}>
                    {k.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(k.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right">
                  {k.status === "OPEN" && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDeciding(k)}>Decide</Button>
                      {k.tenantId && (
                        <Button size="sm" variant="ghost" onClick={() => setDetailTenant(k.tenantId!)}>
                          Profile
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      {deciding && (
        <Modal open onClose={() => setDeciding(null)} title={`Decide case — ${KIND_LABEL[deciding.kind] ?? deciding.kind}`}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              <strong>{deciding.subjectName}</strong> matched the watchlist at {deciding.score}% ({deciding.riskLevel} risk).
              A sanctions-match payment remains blocked until a compliance officer signs off.
            </p>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (recorded in the audit log)…" rows={3} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setDeciding(null)} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={() => decide(deciding, "REJECTED")} disabled={busy}>Reject payment</Button>
              <Button variant="secondary" onClick={() => decide(deciding, "CLOSED")} disabled={busy}>Close (false positive)</Button>
              <Button onClick={() => decide(deciding, "APPROVED")} disabled={busy}>Clear & approve</Button>
            </div>
          </div>
        </Modal>
      )}

      {detailTenant && (
        <Modal open onClose={() => { setDetailTenant(null); setTenantDetail(null); }} title="Tenant KYC evidence">
          {!tenantDetail ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-medium">{tenantDetail.profile?.businessName ?? "Business"}</div>
                <div className="text-slate-500">
                  {tenantDetail.profile?.registrationNumber ?? "—"} · {tenantDetail.profile?.verificationLevel} ·{" "}
                  {tenantDetail.profile?.status}
                </div>
                {tenantDetail.profile?.reviewNote && <div className="mt-1 text-xs text-slate-500">Last note: {tenantDetail.profile.reviewNote}</div>}
              </div>
              <div className="space-y-1.5 text-sm">
                {tenantDetail.documents.length === 0 && <p className="text-slate-500">No documents uploaded.</p>}
                {tenantDetail.documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                    <span>
                      <span className="font-medium">{d.filename ?? d.docType}</span>
                      <span className="ml-2 text-xs text-slate-500">{d.docType} · {new Date(d.createdAt).toLocaleDateString()}</span>
                    </span>
                    <Badge tone={d.scanStatus === "CLEAN" ? "success" : d.scanStatus === "INFECTED" ? "danger" : "warning"}>
                      {d.scanStatus ?? "—"}
                    </Badge>
                  </div>
                ))}
              </div>
              {tenantDetail.profile?.status === "PENDING" && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note…" rows={2} />
                  <div className="flex justify-end gap-2">
                    <Button variant="danger" size="sm" onClick={() => decideProfile("REJECTED")} disabled={busy}>Reject profile</Button>
                    <Button size="sm" onClick={() => decideProfile("APPROVED")} disabled={busy}>Approve (FULL)</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
