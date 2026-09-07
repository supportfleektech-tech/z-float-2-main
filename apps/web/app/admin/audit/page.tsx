"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { TableShell, Badge, Skeleton, Input, Select, Button } from "@/components/ui";

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorEmail: string;
  actorRole: string | null;
  ipAddress?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

interface Filters {
  action: string;
  resourceType: string;
  actor: string;
}

/** Compare two JSON snapshots and render only the changed top-level paths. */
function DiffView({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  if (keys.size === 0) return <p className="text-xs text-muted">No structured payload recorded for this event.</p>;

  const lines: Array<{ key: string; kind: "added" | "removed" | "changed"; oldV: string; newV: string }> = [];
  for (const key of keys) {
    const oldV = before?.[key];
    const newV = after?.[key];
    const oldS = oldV === undefined ? null : JSON.stringify(oldV);
    const newS = newV === undefined ? null : JSON.stringify(newV);
    if (oldS === newS) continue; // unchanged
    if (oldS === null) lines.push({ key, kind: "added", oldV: "∅", newV: newS ?? "∅" });
    else if (newS === null) lines.push({ key, kind: "removed", oldV: oldS ?? "∅", newV: "∅" });
    else lines.push({ key, kind: "changed", oldV: oldS, newV: newS });
  }
  if (lines.length === 0) {
    return <p className="text-xs text-muted">No field-level changes in the recorded snapshot.</p>;
  }

  const trunc = (v: string) => (v.length > 240 ? `${v.slice(0, 240)}…` : v);

  return (
    <div className="space-y-1.5">
      {lines.map((l) => (
        <div key={l.key} className="rounded-control bg-surface/60 px-3 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-600">{l.key}</span>
            <Badge tone={l.kind === "added" ? "success" : l.kind === "removed" ? "danger" : "warning"}>
              {l.kind === "added" ? "ADDED" : l.kind === "removed" ? "REMOVED" : "CHANGED"}
            </Badge>
          </div>
          {l.kind === "added" || l.kind === "changed" ? (
            <p className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">
              {trunc(l.newV)}
            </p>
          ) : null}
          {l.kind === "removed" || l.kind === "changed" ? (
            <p className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-400 line-through">
              {trunc(l.oldV)}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [filters, setFilters] = useState<Filters>({ action: "", resourceType: "", actor: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);

  const load = useCallback((f: Filters) => {
    setRows(null);
    const p = new URLSearchParams();
    if (f.action) p.set("action", f.action);
    if (f.resourceType) p.set("resourceType", f.resourceType);
    if (f.actor) p.set("actor", f.actor);
    fetch(`/api/admin/audit?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data ?? []) as AuditRow[];
        setRows(list);
        setResourceTypes((prev) => {
          const types = [...prev, ...new Set(list.map((r) => r.resourceType))];
          return [...new Set(types)].sort();
        });
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    void load(filters);
    // Intentionally keyed on the primitive filter fields, not the filters object identity.
  }, [filters.action, filters.resourceType, filters.actor, load]);

  const total = rows?.length ?? 0;
  const changed = rows?.filter((r) => r.before || r.after).length ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-muted">
        Immutable record of who did what, when — expand a row to see the before/after diff.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          placeholder="Action… e.g. payment.update"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <Select
          className="w-44"
          value={filters.resourceType}
          onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
        >
          <option value="">All resource types</option>
          {resourceTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Input
          className="w-52"
          placeholder="Actor email…"
          value={filters.actor}
          onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
        />
        {(filters.action || filters.resourceType || filters.actor) ? (
          <Button variant="secondary" size="sm" onClick={() => setFilters({ action: "", resourceType: "", actor: "" })}>
            Clear
          </Button>
        ) : null}
        {rows ? (
          <span className="ml-auto text-xs text-muted">
            {total} event{total === 1 ? "" : "s"} · {changed} with change payloads
          </span>
        ) : null}
      </div>

      {!rows ? (
        <div className="mt-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <div className="mt-4">
          <TableShell headers={["When", "Action", "Resource", "Actor", "Role", ""]}>
            {rows.slice(0, 100).map((r) => {
              const hasDiff = Boolean(r.before || r.after);
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={`cursor-pointer hover:bg-surface/60 ${open ? "bg-surface/50" : ""}`} onClick={() => setExpanded(open ? null : r.id)}>
                    <td className="px-4 py-2.5 text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {r.resourceType}
                      {r.resourceId ? <span className="text-muted"> · {r.resourceId.slice(0, 8)}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-sm">{r.actorEmail}</td>
                    <td className="px-4 py-2.5"><Badge tone="neutral">{r.actorRole ?? "user"}</Badge></td>
                    <td className="px-4 py-2.5 text-right text-xs text-primary">{hasDiff ? (open ? "▾ close" : "▸ diff") : "—"}</td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6} className="px-4 pb-4">
                        <div className="rounded-control border border-slate-200 bg-white p-3">
                          <p className="mb-2 text-[11px] text-muted">
                            {r.before === null && r.after !== null
                              ? "Resource created with:"
                              : r.after === null && r.before !== null
                                ? "Resource deleted — last state was:"
                                : "Field-level changes:"}
                          </p>
                          <DiffView before={r.before} after={r.after} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </TableShell>
          {rows.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">No audit events match the filters.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
