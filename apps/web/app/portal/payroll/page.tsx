"use client";
import { useState } from "react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Label,
  Select,
  Badge,
  Spinner,
} from "@/components/ui";
const PAYROLL_TEMPLATE =
  "employee_name,phone,amount,reference\nJane Wanjiku,0712345678,45000.00,EMP-001\nJohn Kamau,0722111222,38000.00,EMP-002\n";
interface PayrollRow {
  rowNumber: number;
  recipientName: string;
  phone: string;
  amount: string;
  reference: string;
}
export default function PayrollPage() {
  const [name, setName] = useState(
    `Payroll — ${new Date().toLocaleDateString("en-KE", { month: "short", year: "numeric" })}`,
  );
  const [rows, setRows] = useState<PayrollRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    batchId: string;
    status: string;
    validRowCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const parsed: PayrollRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!.split(",").map((c) => c.trim());
        if (cols.length < 3) continue;
        parsed.push({
          rowNumber: i,
          recipientName: cols[0]!,
          phone: cols[1]!,
          amount: cols[2]!,
          reference: cols[3] ?? "",
        });
      }
      setRows(parsed);
    };
    reader.readAsText(file);
  }
  async function submit() {
    if (!rows?.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          channel: "mpesa",
          product: "payroll",
          rows: rows.map((r) => ({
            rowNumber: r.rowNumber,
            recipientName: r.recipientName,
            phone: r.phone,
            amount: r.amount,
            reference: r.reference,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error?.message ?? "Payroll batch failed");
      setResult(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payroll batch failed");
    } finally {
      setSubmitting(false);
    }
  }
  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        {" "}
        <Card className="p-8 text-center">
          {" "}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-2xl">
            ✓
          </div>{" "}
          <h2 className="text-xl font-semibold">Payroll submitted</h2>{" "}
          <p className="mt-2 text-sm text-muted">
            {result.validRowCount} employees · batch status: {result.status}
          </p>{" "}
          <div className="mt-6">
            <Button variant="secondary" onClick={() => setResult(null)}>
              Run another payroll
            </Button>
          </div>{" "}
        </Card>{" "}
      </div>
    );
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Payroll"
        subtitle="Upload the month's payroll — every employee row is validated, approved and executed as its own payment."
      />{" "}
      <div className="grid gap-6 lg:grid-cols-3">
        {" "}
        <div className="space-y-5 lg:col-span-2">
          {" "}
          <Card className="space-y-4 p-6">
            {" "}
            <div className="grid gap-4 sm:grid-cols-2">
              {" "}
              <div>
                {" "}
                <Label>Payroll name</Label>{" "}
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />{" "}
              </div>{" "}
              <div>
                {" "}
                <Label>Channel</Label>{" "}
                <Select defaultValue="mpesa">
                  {" "}
                  <option value="mpesa">M-Pesa (mobile money)</option>{" "}
                  <option value="bank" disabled>
                    Bank (coming soon)
                  </option>{" "}
                </Select>{" "}
              </div>{" "}
            </div>{" "}
            <div>
              {" "}
              <Label>Payroll file</Label>{" "}
              <label className="focus-ring flex cursor-pointer flex-col items-center rounded-control border-2 border-dashed border-borderline bg-surface px-6 py-10 text-center hover:border-primary/40">
                {" "}
                <span className="text-2xl">👥</span>{" "}
                <span className="mt-2 text-sm font-medium">
                  {fileName || "Choose payroll CSV / XLSX"}
                </span>{" "}
                <span className="mt-1 text-xs text-muted">
                  Columns: employee_name, phone, amount, reference
                </span>{" "}
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={onFile}
                />{" "}
              </label>{" "}
            </div>{" "}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(
                  new Blob([PAYROLL_TEMPLATE], { type: "text/csv" }),
                );
                a.download = "payroll-template.csv";
                a.click();
              }}
            >
              {" "}
              Download template{" "}
            </Button>{" "}
          </Card>{" "}
          {error ? (
            <p
              role="alert"
              className="rounded-control border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}{" "}
          {rows && rows.length > 0 ? (
            <Card className="overflow-hidden">
              {" "}
              <div className="flex items-center justify-between border-b border-borderline px-4 py-3">
                {" "}
                <p className="text-sm font-semibold">
                  {rows.length} employees
                </p>{" "}
                <Badge tone="info">
                  Total: KES{" "}
                  {rows
                    .reduce((s, r) => s + Number(r.amount), 0)
                    .toLocaleString()}
                </Badge>{" "}
              </div>{" "}
              <div className="max-h-80 overflow-auto">
                {" "}
                <table className="w-full text-left text-sm">
                  {" "}
                  <thead className="sticky top-0 bg-surface text-xs uppercase text-muted">
                    {" "}
                    <tr>
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Employee</th>
                      <th className="px-4 py-2">Phone</th>
                      <th className="px-4 py-2">Net pay</th>
                    </tr>{" "}
                  </thead>{" "}
                  <tbody className="divide-y divide-borderline">
                    {" "}
                    {rows.map((r) => (
                      <tr key={r.rowNumber}>
                        {" "}
                        <td className="px-4 py-2 text-xs text-muted">
                          {r.rowNumber}
                        </td>{" "}
                        <td className="px-4 py-2">{r.recipientName}</td>{" "}
                        <td className="px-4 py-2 font-mono text-xs">
                          {r.phone}
                        </td>{" "}
                        <td className="px-4 py-2 font-medium">
                          KES {r.amount}
                        </td>{" "}
                      </tr>
                    ))}{" "}
                  </tbody>{" "}
                </table>{" "}
              </div>{" "}
              <div className="border-t border-borderline p-4">
                {" "}
                <Button onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <Spinner className="h-4 w-4 text-white" />
                  ) : (
                    `Submit payroll (${rows.length} employees)`
                  )}
                </Button>{" "}
              </div>{" "}
            </Card>
          ) : null}{" "}
        </div>{" "}
        <Card className="h-fit p-6 text-sm text-muted">
          {" "}
          <h2 className="mb-3 font-semibold text-ink">
            Payroll safety rails
          </h2>{" "}
          <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed">
            {" "}
            <li>
              Every row becomes an individual, immutable payment record.
            </li>{" "}
            <li>Duplicate phones in one run are flagged and rejected.</li>{" "}
            <li>Approval policy applies to the payroll total.</li>{" "}
            <li>
              Each employee gets their own provider reference and journal entry.
            </li>{" "}
          </ul>{" "}
        </Card>{" "}
      </div>{" "}
    </div>
  );
}
