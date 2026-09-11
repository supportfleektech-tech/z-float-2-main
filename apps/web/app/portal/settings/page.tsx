"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card, Badge, TableShell, Skeleton, Button, Input, Label, Spinner, Select, Switch } from "@/components/ui";
import { formatKES } from "@/lib/money";
import { minorOrZero } from "@zfloat/money";

interface FeeRule {
  id: string;
  product: string;
  channel: string;
  provider: string;
  flatFeeMinor: string;
  percentBps: string;
  minFeeMinor: string;
  maxFeeMinor: string;
  version: number;
}

type Theme = "light" | "dark" | "system";

interface UserPreferences {
  theme: Theme;
  soundEnabled: boolean;
  soundVolume: number;
  toastEnabled: boolean;
  toastDuration: number;
  compactMode: boolean;
  autoRefresh: boolean;
}

const defaultPreferences: UserPreferences = {
  theme: "system",
  soundEnabled: true,
  soundVolume: 0.5,
  toastEnabled: true,
  toastDuration: 3000,
  compactMode: false,
  autoRefresh: true,
};

export default function SettingsPage() {
  const [rules, setRules] = useState<FeeRule[] | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/fees")
      .then((r) => r.json())
      .then((d) => setRules(d.data?.rules ?? []))
      .catch(() => setRules([]));
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMfaEnabled(Boolean(d.user?.mfaEnabled)))
      .catch(() => setMfaEnabled(false));
    try {
      const stored = localStorage.getItem("zfloat-preferences");
      if (stored) {
        setPreferences({ ...defaultPreferences, ...JSON.parse(stored) });
      }
    } catch {
      // ignore
    }
    setPrefsLoaded(true);
  }, []);

  const savePreferences = (updates: Partial<UserPreferences>) => {
    const newPrefs = { ...preferences, ...updates };
    setPreferences(newPrefs);
    try {
      localStorage.setItem("zfloat-preferences", JSON.stringify(newPrefs));
    } catch {
      // ignore
    }
    if (updates.theme) {
      applyTheme(updates.theme);
    }
  };

  const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  };

  useEffect(() => {
    if (prefsLoaded) {
      applyTheme(preferences.theme);
    }
  }, [preferences.theme, prefsLoaded]);

  async function startEnroll() {
    setEnrolling(true);
    setMfaError(null);
    setMfaMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/enroll", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setMfaError(d.error?.message ?? "Enrollment failed");
        return;
      }
      setQrDataUrl(d.data.qrDataUrl);
      setSecret(d.data.secret);
    } catch {
      setMfaError("Network error — try again");
    } finally {
      setEnrolling(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    setMfaError(null);
    setMfaMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMfaError(d.error?.message ?? "Verification failed");
        return;
      }
      setMfaEnabled(true);
      setBackupCodes(d.data.backupCodes);
      setQrDataUrl(null);
      setSecret(null);
      setCode("");
    } catch {
      setMfaError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    setBusy(true);
    setMfaError(null);
    setMfaMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMfaError(d.error?.message ?? "Could not disable MFA");
        return;
      }
      setMfaEnabled(false);
      setCode("");
      setMfaMessage("Two-factor authentication disabled.");
    } catch {
      setMfaError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Effective fee schedule, workspace limits and preferences." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Workspace</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Currency</dt><dd className="font-medium">KES (Kenyan Shilling)</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Country</dt><dd className="font-medium">Kenya 🇰🇪</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Payment channels</dt><dd className="font-medium">M-Pesa · Till · Paybill · Bank</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Environment</dt><dd><Badge tone="warning">Sandbox</Badge></dd></div>
          </dl>
          <p className="mt-5 rounded-control bg-surface p-3 text-xs leading-relaxed text-muted">
            Fee rules below are managed by the platform administrator and are versioned — every change is audited and
            snapshotted onto payments at creation time.
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Approval policy (demo)</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between rounded-control bg-surface px-3 py-2.5"><span>Any approver</span><span className="text-muted">KES 0 – 10,000</span></li>
            <li className="flex justify-between rounded-control bg-surface px-3 py-2.5"><span>Sequential — 3 approvers</span><span className="text-muted">KES 10,000.01+</span></li>
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Appearance</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Theme</p>
                <p className="text-sm text-muted">Choose your preferred color scheme</p>
              </div>
              <Select value={preferences.theme} onChange={(e) => savePreferences({ theme: e.target.value as Theme })}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Compact mode</p>
                <p className="text-sm text-muted">Reduce spacing for denser layouts</p>
              </div>
              <Switch checked={preferences.compactMode} onCheckedChange={(checked) => savePreferences({ compactMode: checked })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-refresh data</p>
                <p className="text-sm text-muted">Automatically reload lists and tables</p>
              </div>
              <Switch checked={preferences.autoRefresh} onCheckedChange={(checked) => savePreferences({ autoRefresh: checked })} />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Notifications</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Toast notifications</p>
                <p className="text-sm text-muted">Show slide-up notifications for actions</p>
              </div>
              <Switch checked={preferences.toastEnabled} onCheckedChange={(checked) => savePreferences({ toastEnabled: checked })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Notification sounds</p>
                <p className="text-sm text-muted">Play sounds for success, error, and warning notifications</p>
              </div>
              <Switch checked={preferences.soundEnabled} onCheckedChange={(checked) => savePreferences({ soundEnabled: checked })} />
            </div>
            {preferences.soundEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Sound volume</p>
                    <p className="text-sm text-muted">Adjust notification sound volume</p>
                  </div>
                  <Input type="range" min="0" max="1" step="0.1" value={preferences.soundVolume} onChange={(e) => savePreferences({ soundVolume: Number(e.target.value) })} className="w-48" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Test sound</p>
                    <p className="text-sm text-muted">Play a sample notification sound</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => import("@/lib/sounds").then(({ playNotificationSound }) => playNotificationSound("success"))}>Test</Button>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Toast duration</p>
                <p className="text-sm text-muted">How long notifications stay visible (ms)</p>
              </div>
              <Select value={preferences.toastDuration} onChange={(e) => savePreferences({ toastDuration: Number(e.target.value) })}>
                <option value={2000}>2 seconds</option>
                <option value={3000}>3 seconds</option>
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
              </Select>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="mb-4 font-semibold">Two-factor authentication (TOTP)</h2>
        {mfaEnabled === null ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                {mfaEnabled
                  ? "Enabled — a 6-digit code from your authenticator app is required at sign-in."
                  : "Add an extra layer of security with an authenticator app (Google Authenticator, 1Password, Authy…)."}
              </p>
              <Badge tone={mfaEnabled ? "success" : "neutral"}>{mfaEnabled ? "ON" : "OFF"}</Badge>
            </div>

            {!mfaEnabled && !qrDataUrl ? (
              <Button onClick={startEnroll} disabled={enrolling}>
                {enrolling ? <Spinner className="h-4 w-4 text-white" /> : "Set up authenticator app"}
              </Button>
            ) : null}

            {qrDataUrl && secret ? (
              <div className="rounded-control border border-borderline p-4">
                <img src={qrDataUrl} alt="TOTP QR code" className="mx-auto h-40 w-40" />
                <p className="mt-3 text-center text-xs text-muted">
                  Scan with your authenticator app, then enter the 6-digit code.
                </p>
                <div>
                  <Label htmlFor="mfa-code">Authenticator code</Label>
                  <div className="mt-1 flex gap-2">
                    <Input id="mfa-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                    <Button onClick={confirmEnroll} disabled={busy || code.length !== 6}>
                      {busy ? <Spinner className="h-4 w-4 text-white" /> : "Confirm & enable"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {backupCodes ? (
              <div className="rounded-control border border-success/30 bg-success/5 p-4">
                <p className="mb-2 text-sm font-medium text-success">Backup codes — save these now (shown once)</p>
                <div className="grid grid-cols-4 gap-2 font-mono text-sm">
                  {backupCodes.map((c) => (
                    <span key={c} className="rounded bg-white px-2 py-1 text-center">{c}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {mfaEnabled ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="mfa-disable-code">Current code to disable</Label>
                  <Input id="mfa-disable-code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                </div>
                <Button variant="secondary" onClick={disableMfa} disabled={busy || code.length !== 6}>
                  {busy ? <Spinner className="h-4 w-4 text-white" /> : "Disable MFA"}
                </Button>
              </div>
            ) : null}

            {mfaError ? <p className="text-sm text-danger">{mfaError}</p> : null}
            {mfaMessage ? <p className="text-sm text-success">{mfaMessage}</p> : null}
          </div>
        )}
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 font-semibold">Effective fee schedule</h2>
        {!rules ? (
          <Skeleton className="h-40" />
        ) : (
          <TableShell headers={["Product", "Channel", "Fee", "Min / Max", "Version"]}>
            {rules.map((r) => (
              <tr key={r.id} className="hover:bg-surface/60">
                <td className="px-4 py-3">{r.product}</td>
                <td className="px-4 py-3 text-xs uppercase">{r.channel}</td>
                <td className="px-4 py-3">
                  {formatKES(r.flatFeeMinor)}
                  {minorOrZero(r.percentBps) > 0n ? ` + ${minorOrZero(r.percentBps) / 100n}%` : ""}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {minorOrZero(r.minFeeMinor) > 0n ? formatKES(r.minFeeMinor) : "—"} / {minorOrZero(r.maxFeeMinor) > 0n ? formatKES(r.maxFeeMinor) : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted">v{r.version}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>
    </div>
  );
}