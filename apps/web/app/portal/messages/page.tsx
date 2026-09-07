"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, Card, Button, Badge, TableShell, Skeleton, Spinner } from "@/components/ui";

interface MsgRow {
  id: string;
  channel: string;
  title: string | null;
  body: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  readAt: string | null;
  recipient: string | null;
}

const CHANNEL_LABEL: Record<string, string> = { IN_APP: "In-app", EMAIL: "Email", SMS: "SMS" };
const CHANNEL_TONE: Record<string, "neutral" | "success" | "warning"> = { IN_APP: "neutral", EMAIL: "success", SMS: "warning" };

function statusTone(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "SENT") return "success";
  if (s === "FAILED") return "danger";
  if (s === "DELIVERED") return "success";
  return "neutral";
}

export default function MessagesPage() {
  const [rows, setRows] = useState<MsgRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/notifications?channel=ALL")
      .then((r) => r.json())
      .then((d) => setRows(d.items ?? []))
      .catch(() => setError("Could not load messages"));
  }, []);

  useEffect(load, [load]);

  async function sendTest(channel: string) {
    setSending(channel);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error?.message ?? "Send failed");
        return;
      }
      setNote(`${channel} test queued — the worker delivers it via the configured driver.`);
      setTimeout(load, 2_500);
    } catch {
      setError("Network error — try again");
    } finally {
      setSending(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Message center"
        subtitle="Every notification Z-float sends — in-app, email and SMS — with delivery status per channel driver."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => sendTest("EMAIL")} disabled={sending !== null}>
              {sending === "EMAIL" ? <Spinner className="h-4 w-4" /> : "Test email"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => sendTest("SMS")} disabled={sending !== null}>
              {sending === "SMS" ? <Spinner className="h-4 w-4" /> : "Test SMS"}
            </Button>
          </div>
        }
      />
      {error ? <p className="mb-4 rounded-control border border-danger/20 bg-danger/5 px-4 py-2 text-sm text-danger">{error}</p> : null}
      {note ? <p className="mb-4 rounded-control border border-success/20 bg-success/5 px-4 py-2 text-sm text-success">{note}</p> : null}

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-muted">
          <span className="rounded-full border border-borderline px-2 py-0.5">Driver: from env (EMAIL_DRIVER / SMS_DRIVER)</span>
          <span className="rounded-full border border-borderline px-2 py-0.5">EMAIL_DRIVER=sink writes to the demo mailbox on disk</span>
          <span className="rounded-full border border-borderline px-2 py-0.5">SMS_DRIVER=http POSTs an Africa&apos;s Talking–compatible payload</span>
        </div>
        {!rows ? (
          <Skeleton className="h-40" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No messages yet — pay someone or send a test message.</p>
        ) : (
          <TableShell headers={["Channel", "Message", "Recipient", "Status", "Sent", "Created"]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">
                  <Badge tone={CHANNEL_TONE[r.channel] ?? "neutral"}>{CHANNEL_LABEL[r.channel] ?? r.channel}</Badge>
                </td>
                <td className="max-w-md px-4 py-3">
                  <p className="text-sm font-medium">{r.title ?? r.body ?? ""}</p>
                  {r.channel !== "IN_APP" && r.title ? <p className="mt-0.5 truncate text-xs text-muted">{r.body}</p> : null}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{r.recipient ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>
    </div>
  );
}
