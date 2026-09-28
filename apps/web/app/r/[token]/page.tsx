"use client";
/** Public invoice / receipt view — the link a customer receives (no login). */
import { useEffect, useState } from "react";
import { EtimsDocumentView, type DocView } from "@/components/etims-document";

export default function PublicDocumentPage({ params }: { params: { token: string } }) {
  const [doc, setDoc] = useState<DocView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${encodeURIComponent(params.token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message ?? "Document not found");
        setDoc({ ...d.data, qrSrc: `/api/documents/${encodeURIComponent(params.token)}/qr` });
      })
      .catch((e: Error) => setError(e.message));
  }, [params.token]);

  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      {error ? (
        <p className="mx-auto max-w-md rounded-card bg-white p-8 text-center text-muted">{error}</p>
      ) : !doc ? (
        <p className="text-center text-muted">Loading…</p>
      ) : (
        <>
          <EtimsDocumentView doc={doc} />
          <div className="mx-auto mt-4 flex max-w-2xl justify-end print:hidden">
            <button onClick={() => window.print()} className="rounded-control border border-borderline bg-white px-4 py-2 text-sm hover:bg-surface">
              Print / save PDF
            </button>
          </div>
        </>
      )}
    </main>
  );
}
