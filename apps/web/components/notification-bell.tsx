"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";

interface NotifItem {
  id: string;
  title: string | null;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.items) return;
        setItems(d.items);
        setUnread(d.unreadCount ?? 0);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 25_000);
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function markRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markRead" }),
    }).catch(() => undefined);
    setUnread(0);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread > 0) markRead();
        }}
        aria-label="Notifications"
        className="focus-ring relative flex h-8 w-8 items-center justify-center rounded-full border border-borderline bg-white text-sm text-ink/70 hover:bg-surface"
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-card border border-borderline bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-borderline px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {items === null ? null : (
              <button onClick={markRead} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items === null ? (
              <div className="flex justify-center py-6">
                <Spinner className="h-5 w-5" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">No notifications yet</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-borderline/60 px-3 py-2.5 ${n.readAt ? "" : "bg-primary/5"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{n.title ?? "Notification"}</p>
                    <span className="shrink-0 text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
                  </div>
                  {n.body ? <p className="mt-0.5 text-xs leading-snug text-muted">{n.body}</p> : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
