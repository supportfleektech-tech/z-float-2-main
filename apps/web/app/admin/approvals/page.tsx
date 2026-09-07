"use client";

/**
 * Config approvals centre — the second-person gate for platform config
 * changes (billers/airtime catalogs, and approval policies/pricing/flags as
 * they are migrated to staged writes). A maker's change stays PENDING until a
 * DIFFERENT platform admin approves; approval executes the change under the
 * approver's authority (API: /api/admin/config-requests).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, Spinner } from "@/components/ui";

interface Actor { id: string; email: string; fullName: string }
interface Action { decision: string; comment: string | null; createdAt: string; actor: Actor | null }
interface Change { kind: string; op: string; targetId?: string | null; label: string; summary: string; payload: Record<string, unknown>; beforeSnapshot?: Record<string, unknown> | null }
interface Row {
  id: string; status: string; createdAt: string; updatedAt: string | null;
  executedAt: string | null; executionError: string | null;
  change: Change | null; creator: Actor | null; actions: Action[];
}

type Tab = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

function pretty(v: unknown): string {
  try { return JSON.stringify(v, null, 1); } catch { return String(v); }
}
function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function AdminConfigApprovalsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<Tab>("PENDING");
  const [me, setMe] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/config-requests")
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/admin/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user?.email ?? null))
      .catch(() => setMe(null));
  }, [load]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => (tab === "ALL" ? true : r.status === tab)),
    [rows, tab],
  );

  async function decide(row: Row, decision: "approve" | "reject") {
    const comment = window.prompt(decision === "approve" ? "Approval comment (optional)" : "Rejection reason (optional)") ?? undefined;
    setBusyId(row.id);
    setFlash(null);
    try {
      const res = await fetch(`/api/admin/config-requests/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comment || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash(`${d.error?.message ?? "Decision failed"} — a second, different platform admin is required.`);
      } else {
        const out = d.data as { status?: string; applied?: boolean; error?: string };
        setFlash(
          out.status === "REJECTED"
            ? "Change rejected — nothing was applied."
            : out.applied === false
              ? `Approved, but applying failed: ${out.error ?? "unknown error"} (visible on the request).`
              : "Change approved and applied.",
        );
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  const tabs: Tab[] = ["PENDING", "ALL", "APPROVED", "REJECTED"];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Config approvals</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Maker-checker for platform configuration. The admin who submits a change can never approve it — a second
        platform admin signs off here, and only then is the change executed (with an audit trail on the approver).
      </p>

      {flash ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{flash}</div>
      ) : null}

      <div className="mt-5 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${tab === t ? "bg-primary text-white" : "border border-line bg-white text-muted hover:text-ink"}`}
          >
            {t === "ALL" ? "All" : t.charAt(0) + t.slice(1).toLowerCase()}
            {t === "PENDING" && rows ? ` (${rows.filter((r) => r.status === "PENDING").length})` : ""}
          </button>
        ))}
      </div>

      {!rows ? (
        <div className="mt-6"><Spinner className="h-5 w-5 text-primary" /></div>
      ) : visible.length === 0 ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted">
          {tab === "PENDING" ? "No changes are waiting for a second admin right now." : "Nothing here yet."}
        </Card>
      ) : (
        <div className="mt-6 space-y-4">
          {visible.map((row) => {
            const mine = row.creator?.email === me;
            const actionable = row.status === "PENDING" && !mine;
            const failedApply = row.status === "APPROVED" && row.executionError;
            return (
              <Card key={row.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.change?.label ?? row.id.slice(0, 8)}</span>
                      <Badge tone={row.status === "PENDING" ? "warning" : row.status === "APPROVED" ? "success" : row.status === "REJECTED" ? "danger" : "neutral"}>{row.status}</Badge>
                      <Badge tone="neutral">{row.change?.kind ?? "?"} · {row.change?.op ?? "?"}</Badge>
                      {mine && row.status === "PENDING" ? <Badge tone="info">made by you — another admin must approve</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">{row.change?.summary ?? ""}</p>
                    <p className="mt-1 text-xs text-muted">
                      Requested by {row.creator?.email ?? row.creator?.fullName ?? "unknown"} · {fmt(row.createdAt)}
                      {row.executedAt ? ` · executed ${fmt(row.executedAt)}` : ""}
                    </p>
                  </div>
                  {actionable ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busyId === row.id} onClick={() => void decide(row, "approve")}>
                        {busyId === row.id ? <Spinner className="h-4 w-4 text-white" /> : "Approve"}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busyId === row.id} onClick={() => void decide(row, "reject")}>
                        Reject
                      </Button>
                    </div>
                  ) : row.status === "PENDING" ? (
                    <span className="text-xs text-muted">Awaiting a different platform admin…</span>
                  ) : null}
                </div>

                {failedApply ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Approved but application failed: {row.executionError}
                  </div>
                ) : null}

                {row.change?.beforeSnapshot && Object.keys(row.change.beforeSnapshot).length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-primary">Current state (at submission)</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface p-3 text-[11px] leading-relaxed">{pretty(row.change.beforeSnapshot)}</pre>
                  </details>
                ) : null}
                {row.change && Object.keys(row.change.payload).length > 0 ? (
                  <details className="mt-2" open={row.status === "PENDING"}>
                    <summary className="cursor-pointer text-xs font-medium text-primary">Proposed change</summary>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface p-3 text-[11px] leading-relaxed">{pretty(row.change.payload)}</pre>
                  </details>
                ) : null}

                {row.actions.length > 0 ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold text-muted">Decision history</p>
                    {row.actions.map((a) => (
                      <p key={`${a.createdAt}-${a.decision}`} className="mt-1 text-xs text-muted">
                        {a.decision === "APPROVE" ? "✓" : "✗"} <span className="font-medium">{a.actor?.email ?? "unknown"}</span>
                        {" · "}{a.decision === "APPROVE" ? "approved" : "rejected"} · {fmt(a.createdAt)}
                        {a.comment ? ` — “${a.comment}”` : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
