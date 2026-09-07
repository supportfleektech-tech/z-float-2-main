"use client";

import { useState } from "react";
import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Card, Input, Label, Textarea, Button, Spinner } from "@/components/ui";

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), message: fd.get("message") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Could not send");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto max-w-xl px-4 py-20 sm:px-6 lg:px-8">
        <h1 className="text-center text-4xl font-bold tracking-tight">Talk to us</h1>
        <p className="mt-3 text-center text-muted">Questions about the platform, onboarding, or a demo — we respond within one business day.</p>
        {sent ? (
          <Card className="mt-10 p-8 text-center">
            <p className="text-2xl">✓</p>
            <h2 className="mt-2 font-semibold">Message sent</h2>
            <p className="mt-1 text-sm text-muted">Thanks for reaching out — we&apos;ll be in touch shortly.</p>
          </Card>
        ) : (
          <Card className="mt-10 p-8">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="Jane Wanjiku" />
              </div>
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input id="email" name="email" type="email" required placeholder="jane@company.co.ke" />
              </div>
              <div>
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" name="message" rows={5} required placeholder="How can we help?" />
              </div>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Spinner className="h-4 w-4 text-white" /> : "Send message"}
              </Button>
            </form>
          </Card>
        )}
      </section>
      <MarketingFooter />
    </div>
  );
}
