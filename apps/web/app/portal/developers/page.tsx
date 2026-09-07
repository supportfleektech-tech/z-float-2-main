"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, Card, Button, Input, Label, Badge, TableShell, Modal, Skeleton } from "@/components/ui";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const API_BASE = typeof window !== "undefined" ? `${window.location.origin}` : "";

export default function DevelopersPage() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string; keyId: string } | null>(null);

  // Playground state
  const [playKey, setPlayKey] = useState("");
  const [playAmount, setPlayAmount] = useState("1500");
  const [playRecipient, setPlayRecipient] = useState("Jane Wanjiku");
  const [playPhone, setPlayPhone] = useState("0712000002");
  const [playResult, setPlayResult] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(() => {
    fetch("/api/developers/keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.data?.keys ?? []))
      .catch(() => setError("Could not load API keys."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return setError("Give the key a name.");
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/developers/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error?.message ?? "Create failed.");
      setNewSecret({ name: data.data.key.name, secret: data.data.secret, keyId: data.data.key.id });
      setPlayKey(data.data.secret);
      setName("");
      load();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKeyRow) => {
    if (!confirm(`Revoke "${key.name}" (${key.keyPrefix})? Requests with it will fail immediately.`)) return;
    setError(null);
    const res = await fetch(`/api/developers/keys/${key.id}/revoke`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) return setError(data.error?.message ?? "Revoke failed.");
    setNote(`Key ${key.keyPrefix} revoked.`);
    load();
  };

  const playground = async (action: "wallets" | "payments" | "create") => {
    if (!playKey) return setError("Paste an API key (or create one above) first.");
    setPlaying(true);
    setError(null);
    setPlayResult(null);
    try {
      const headers: Record<string, string> = { "x-api-key": playKey.trim() };
      let res: Response;
      if (action === "wallets") {
        res = await fetch(`${API_BASE}/api/public/v1/wallets`, { headers });
      } else if (action === "create") {
        res = await fetch(`${API_BASE}/api/public/v1/payments`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: playAmount,
            channel: "mpesa",
            recipient: { name: playRecipient, phone: playPhone },
            idempotencyKey: `play-${Date.now()}`,
          }),
        });
      } else {
        res = await fetch(`${API_BASE}/api/public/v1/payments?limit=5`, { headers });
      }
      const text = await res.text();
      setPlayResult(`HTTP ${res.status}\n${text.slice(0, 2000)}`);
    } catch (e) {
      setError(`Playground request failed: ${(e as Error).message}`);
    } finally {
      setPlaying(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer API"
        subtitle="Programmatic payments for your business — key-auth, idempotent, rate-limited."
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{note}</div>}

      <Card className="flex items-center justify-between p-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">API reference</h2>
          <p className="mt-1 text-sm text-muted">
            Machine-readable OpenAPI 3.1 document covering every public endpoint — payments and wallets.
          </p>
        </div>
        <a
          href={`${API_BASE}/api/public/v1/openapi.json`}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-strong"
        >
          Open OpenAPI JSON
        </a>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick start</h2>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`# 1) Create an API key in the table below (shown once).
# 2) Create a payment (idempotent — safe to retry):

curl -X POST ${API_BASE}/api/public/v1/payments \\
  -H "Authorization: Bearer zf_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
        "amount": "1500.00",
        "channel": "mpesa",
        "recipient": { "name": "Jane Wanjiku", "phone": "0712000002" },
        "idempotencyKey": "order-1042"
      }'

# 3) Read balances / history:

curl ${API_BASE}/api/public/v1/wallets  -H "x-api-key: zf_live_…"
curl "${API_BASE}/api/public/v1/payments?limit=10" -H "x-api-key: zf_live_…"`}
        </pre>
        <p className="mt-3 text-xs text-slate-500">
          Rate limit: 60 requests/minute per key. Keys are tenant-scoped; revoking takes effect immediately. Full keys
          are stored hashed (SHA-256) and shown exactly once.
        </p>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">API keys</h2>
          <div className="flex gap-2">
            <Input className="w-56" placeholder="e.g. production-server" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={create} disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create key"}</Button>
          </div>
        </div>
        {!keys ? (
          <Skeleton className="h-16 w-full" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-slate-500">No API keys yet — create one to start using the public API.</p>
        ) : (
          <TableShell headers={["Name", "Key", "Status", "Created", "Last used", ""]} empty={<span>No keys.</span>}>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-sm font-medium">{k.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{k.keyPrefix}…</td>
                <td className="px-4 py-2.5">
                  <Badge tone={k.status === "ACTIVE" ? "success" : "neutral"}>{k.status}</Badge>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(k.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td className="px-4 py-2.5 text-right">
                  {k.status === "ACTIVE" && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(k)}>Revoke</Button>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Playground</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="playKey">API key (zf_live_…)</Label>
            <Input id="playKey" value={playKey} onChange={(e) => setPlayKey(e.target.value)} placeholder="zf_live_…" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="playAmount">Amount (KES)</Label>
                <Input id="playAmount" value={playAmount} onChange={(e) => setPlayAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="playPhone">Recipient phone</Label>
                <Input id="playPhone" value={playPhone} onChange={(e) => setPlayPhone(e.target.value)} />
              </div>
            </div>
            <Label htmlFor="playRecipient">Recipient name</Label>
            <Input id="playRecipient" value={playRecipient} onChange={(e) => setPlayRecipient(e.target.value)} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="secondary" disabled={playing} onClick={() => playground("wallets")}>GET wallets</Button>
              <Button size="sm" variant="secondary" disabled={playing} onClick={() => playground("payments")}>GET payments</Button>
              <Button size="sm" disabled={playing} onClick={() => playground("create")}>POST payment</Button>
            </div>
          </div>
          <div>
            <Label>Response</Label>
            <pre className="min-h-[180px] overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-200">
              {playResult ?? "Run a request — the live API response appears here."}
            </pre>
          </div>
        </div>
      </Card>

      {newSecret && (
        <Modal open onClose={() => setNewSecret(null)} title="API key created — copy it now">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              <strong>{newSecret.name}</strong> — this is the only time the full key is shown. Store it in your secret
              manager. The server keeps only its SHA-256 hash.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-all">{newSecret.secret}</div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(newSecret.secret).catch(() => undefined);
                }}
              >
                Copy
              </Button>
              <Button onClick={() => setNewSecret(null)}>I saved it</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
