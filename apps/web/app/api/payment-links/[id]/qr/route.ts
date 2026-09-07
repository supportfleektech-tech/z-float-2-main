import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { getDb, schema, eq } from "@zfloat/database";
import { requireUser } from "@/lib/api";

/**
 * GET /api/payment-links/:id/qr — tenant-scoped QR code (PNG) for a hosted
 * payment link. Renders the canonical public pay URL as a QR the merchant
 * can print or send on paper/in-store.
 */
export async function GET(_request: NextRequest, ctx: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { db } = getDb();

  const [link] = await db.select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, ctx.params.id)).limit(1);
  if (!link || link.tenantId !== user!.tenantId) {
    return new Response("Not found", { status: 404 });
  }
  if (link.status !== "ACTIVE" && link.status !== "PAUSED") {
    return new Response("Link closed", { status: 410 });
  }

  const baseUrl = process.env.APP_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/pay/${link.token}`;
  const png = await QRCode.toBuffer(url, { type: "png", width: 512, margin: 2, color: { dark: "#0F2233", light: "#FFFFFF" } });

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": `inline; filename="payment-link-${link.token}.png"`,
    },
  });
}
