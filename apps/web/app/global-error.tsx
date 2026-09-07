"use client";

export default function GlobalError({ _error, reset }: { _error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">500</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Fatal error</h1>
        <p className="mt-4 max-w-md text-muted">
          The application hit an unrecoverable error. Reload to continue — the ledger
          is immutable, so no state was lost.
        </p>
        <button
          onClick={reset}
          className="mt-8 rounded-control bg-ink px-6 py-2.5 text-sm font-medium text-white hover:bg-ink/90"
        >
          Reload
        </button>
      </body>
    </html>
  );
}
