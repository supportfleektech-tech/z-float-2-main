"use client";
import { useEffect, useState } from "react";
import {
  PageHeader,
  Button,
  Input,
  Label,
  Textarea,
  Badge,
  TableShell,
  Skeleton,
  Modal,
  Spinner,
} from "@/components/ui";
interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: string;
  priority: string;
  tenantId: string | null;
  createdAt: string;
}
export default function SupportPage() {
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  function load() {
    fetch("/api/support")
      .then((r) => r.json())
      .then((d) =>
        setRows((d.data ?? []).filter((t: Ticket) => t.tenantId !== null)),
      )
      .catch(() => setRows([]));
  }
  useEffect(load, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    setOpen(false);
    setForm({ subject: "", body: "" });
    load();
  }
  return (
    <div>
      {" "}
      <PageHeader
        title="Support"
        subtitle="Raise a ticket and track it here. Platform support responds within one business day."
        actions={<Button onClick={() => setOpen(true)}>+ New ticket</Button>}
      />{" "}
      {!rows ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <TableShell headers={["Subject", "Priority", "Status", "Opened"]}>
          {" "}
          {rows.map((t) => (
            <tr key={t.id} className="hover:bg-surface/60">
              {" "}
              <td className="px-4 py-3">
                {" "}
                <p className="font-medium">{t.subject}</p>{" "}
                <p className="max-w-md truncate text-xs text-muted">
                  {t.body}
                </p>{" "}
              </td>{" "}
              <td className="px-4 py-3">
                <Badge tone={t.priority === "HIGH" ? "danger" : "neutral"}>
                  {t.priority}
                </Badge>
              </td>{" "}
              <td className="px-4 py-3">
                <Badge tone={t.status === "OPEN" ? "warning" : "success"}>
                  {t.status}
                </Badge>
              </td>{" "}
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(t.createdAt).toLocaleString()}
              </td>{" "}
            </tr>
          ))}{" "}
        </TableShell>
      )}{" "}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New support ticket"
      >
        {" "}
        <form onSubmit={create} className="space-y-4">
          {" "}
          <div>
            {" "}
            <Label>Subject</Label>{" "}
            <Input
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="What's going on?"
            />{" "}
          </div>{" "}
          <div>
            {" "}
            <Label>Describe the issue</Label>{" "}
            <Textarea
              required
              rows={5}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />{" "}
          </div>{" "}
          <div className="flex justify-end gap-2">
            {" "}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>{" "}
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                "Submit ticket"
              )}
            </Button>{" "}
          </div>{" "}
        </form>{" "}
      </Modal>{" "}
    </div>
  );
}
