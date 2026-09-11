"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PageHeader,
  StatusBadge,
  Input,
  Select,
  TableShell,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { formatKESExact as fmt } from "@/lib/money";
interface Tx {
  id: string;
  paymentNumber: string;
  status: string;
  amountMinor: string;
  beneficiaryName: string;
  channel: string;
  product: string;
  createdAt: string;
}
export default function TransactionsPage() {
  const [rows, setRows] = useState<Tx[] | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  function load() {
    setRows(null);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    fetch(`/api/payments?${params}`)
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch(() => setRows([]));
  }
  useEffect(load, [status]);
  const filtered = (rows ?? []).filter(
    (r) =>
      !q ||
      r.paymentNumber.toLowerCase().includes(q.toLowerCase()) ||
      r.beneficiaryName.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div>
      {" "}
      <PageHeader
        title="Transactions"
        subtitle="Every payment, batch row and outcome — immutable and auditable."
      />{" "}
      <div className="mb-4 flex flex-wrap gap-3">
        {" "}
        <Input
          className="max-w-xs"
          placeholder="Search payment number or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />{" "}
        <Select
          className="max-w-52"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {" "}
          <option value="">All statuses</option> <option>DRAFT</option>{" "}
          <option>PENDING_APPROVAL</option> <option>QUEUED</option>{" "}
          <option>PROCESSING</option> <option>PROVIDER_PENDING</option>{" "}
          <option>SUCCESS</option> <option>FAILED</option>{" "}
          <option>REVERSED</option> <option>CANCELLED</option>{" "}
        </Select>{" "}
      </div>{" "}
      {!rows ? (
        <div className="space-y-3">
          {" "}
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}{" "}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No transactions found"
          description="Try a different filter, or create your first payment."
        />
      ) : (
        <TableShell
          headers={[
            "Payment",
            "Beneficiary",
            "Channel",
            "Amount",
            "Status",
            "Created",
            "",
          ]}
        >
          {" "}
          {filtered.map((t) => (
            <tr key={t.id} className="hover:bg-surface/60">
              {" "}
              <td className="px-4 py-3 font-mono text-xs">
                {t.paymentNumber}
              </td>{" "}
              <td className="px-4 py-3">{t.beneficiaryName}</td>{" "}
              <td className="px-4 py-3 text-xs uppercase text-muted">
                {t.channel}
              </td>{" "}
              <td className="px-4 py-3 font-medium">
                KES {fmt(t.amountMinor)}
              </td>{" "}
              <td className="px-4 py-3">
                <StatusBadge status={t.status} />
              </td>{" "}
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(t.createdAt).toLocaleString()}
              </td>{" "}
              <td className="px-4 py-3 text-right">
                {" "}
                <Link
                  href={`/portal/transactions/${t.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Open
                </Link>{" "}
              </td>{" "}
            </tr>
          ))}{" "}
        </TableShell>
      )}{" "}
    </div>
  );
}
