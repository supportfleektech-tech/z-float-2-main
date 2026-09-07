"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Button, Input, Label, Card, Spinner } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("demo@zfloat.app");
  const [password, setPassword] = useState("Demo@12345");
  const [otp, setOtp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, otpCode: otp || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Login failed");
        setLoading(false);
        return;
      }
      if (data.mfaRequired) {
        setMfaRequired(true);
        setLoading(false);
        return;
      }
      const next = params.get("next") ?? (email.includes("admin") ? "/admin" : "/portal");
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error — try again");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <div className="mb-8 flex justify-center">
          <Link href="/"><Logo /></Link>
        </div>
        <h1 className="text-center text-xl font-semibold">{mfaRequired ? "Enter verification code" : "Sign in"}</h1>
        <p className="mt-1 text-center text-sm text-muted">
          {mfaRequired ? "Enter the 6-digit code from your authenticator app" : "Use the demo credentials or your account"}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {!mfaRequired ? (
            <>
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="otp">6-digit code</Label>
              <Input id="otp" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} placeholder="000000" required autoFocus />
            </div>
          )}

          {error ? (
            <p role="alert" className="rounded-control border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Spinner className="h-4 w-4 text-white" /> : mfaRequired ? "Verify" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 rounded-control border border-borderline bg-surface p-4 text-xs text-muted">
          <p className="font-semibold text-ink">Demo workspace</p>
          <p className="mt-1">demo@zfloat.app / Demo@12345 — business owner (Acme Traders Ltd)</p>
          <p>admin@zfloat.app / Demo@12345 — platform administrator</p>
        </div>

        {params.get("register") ? (
          <p className="mt-6 text-center text-sm text-muted">
            Registration is invite-based. <Link href="/contact" className="text-primary hover:underline">Request an invite</Link> or use the demo login.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
