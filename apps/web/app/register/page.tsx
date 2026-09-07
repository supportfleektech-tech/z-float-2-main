"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { Button, Input, Label, Card, Spinner } from "@/components/ui";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          password,
          inviteToken: params.get("invite") ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Registration failed");
        setLoading(false);
        return;
      }
      router.push("/portal");
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
        <h1 className="text-center text-xl font-semibold">Join your workspace</h1>
        <p className="mt-1 text-center text-sm text-muted">Registration is invite-based — you need an invitation link from your workspace owner.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Password (min 10 characters)</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
          </div>
          {!params.get("invite") ? (
            <p role="alert" className="rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
              No invitation link detected. Use the demo login instead, or ask your workspace owner for an invite.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-control border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Spinner className="h-4 w-4 text-white" /> : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already registered? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
