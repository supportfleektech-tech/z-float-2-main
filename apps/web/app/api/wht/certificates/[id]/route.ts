import { NextRequest } from "next/server";
import { getDb, schema, eq, and } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { writeAuditEvent } from "@zfloat/audit";
import { getWhtCertificate, buildCertificateData, generateWhtCertificatePdf, issueWhtCertificate, voidWhtCertificate } from "@zfloat/etims";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();
  const download = request.nextUrl.searchParams.get("download") === "true";

  const cert = await getWhtCertificate(db, user!.tenantId!, id);
  if (!cert) return apiError(404, "NOT_FOUND", "WHT certificate not found");

  if (download) {
    // Generate PDF
    const certData = await buildCertificateData(db, id);
    if (!certData) return apiError(404, "NOT_FOUND", "Certificate data not found");

    const pdfBuffer = await generateWhtCertificatePdf(certData);

    // Update certificate status
    if (cert.status === "GENERATED" || cert.status === "ISSUED") {
      await issueWhtCertificate(db, id, `generated-${Date.now()}`);
    }

    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "wht_certificate.downloaded",
      resourceType: "wht_certificate",
      resourceId: id,
    });

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="WHT-Certificate-${cert.certificateNumber}.pdf"`,
      },
    });
  }

  return apiOk({
    data: {
      ...cert,
      grossAmountMinor: cert.grossAmountMinor.toString(),
      whtAmountMinor: cert.whtAmountMinor.toString(),
      netAmountMinor: cert.netAmountMinor.toString(),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const { db } = getDb();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? "");

  const cert = await getWhtCertificate(db, user!.tenantId!, id);
  if (!cert) return apiError(404, "NOT_FOUND", "WHT certificate not found");

  if (action === "void") {
    const reason = String(b.reason ?? "Voided via API");
    await voidWhtCertificate(db, id, reason, user!.userId);

    await writeAuditEvent(db, {
      tenantId: user!.tenantId!,
      actorId: user!.userId,
      action: "wht_certificate.voided",
      resourceType: "wht_certificate",
      resourceId: id,
      after: { status: "VOIDED", voidReason: reason },
    });

    return apiOk({ data: { success: true, status: "VOIDED" } });
  }

  return apiError(400, "INVALID_ACTION", "Supported actions: void");
}