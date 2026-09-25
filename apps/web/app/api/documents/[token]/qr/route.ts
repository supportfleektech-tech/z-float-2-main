import QRCode from "qrcode";
import { getDb } from "@zfloat/database";
import { getDocumentByToken } from "@zfloat/etims";

/**
 * GET /api/documents/:token/qr — QR for a printed invoice/receipt. For
 * KRA-signed documents it encodes the KRA verification URL (what eTIMS
 * requires on the printout); otherwise the public document link.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!/^doc_[A-Za-z0-9_-]{10,40}$/.test(params.token)) return new Response("Not found", { status: 404 });
  const { db } = getDb();
  const doc = await getDocumentByToken(db, params.token);
  if (!doc) return new Response("Not found", { status: 404 });
  const base = process.env.APP_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const target = doc.status === "SIGNED" && doc.verificationUrl ? doc.verificationUrl : `${base}/r/${doc.publicToken}`;
  const png = await QRCode.toBuffer(target, { type: "png", width: 384, margin: 1, color: { dark: "#0F2233", light: "#FFFFFF" } });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": doc.status === "SIGNED" ? "public, max-age=86400" : "no-store" },
  });
}
