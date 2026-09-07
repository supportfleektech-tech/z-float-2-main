import { NextRequest } from "next/server";
import { getDb, schema } from "@zfloat/database";
import { requireUser, apiOk, apiError } from "@/lib/api";
import { enqueue } from "@zfloat/queue";
import { attachDocument, listDocuments, getProfile, KYC_DOC_TYPES, type KycDocType } from "@zfloat/kyc";
import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "@zfloat/config";
import { secretsReady as requireSecrets } from "@/lib/secret-guard";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB untrusted uploads
const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/**
 * GET /api/kyc/documents — the signed-in tenant's KYC profile + documents.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");
  const { db } = getDb();
  const profile = await getProfile(db, user!.tenantId);
  const docs = await listDocuments(db, user!.tenantId);
  return apiOk({ data: { profile, documents: docs } });
}

/**
 * POST /api/kyc/documents — multipart upload of an untrusted KYC document.
 * The file is stored on local disk (never executed), checksummed, queued for
 * the malware scan (files.scan) and attached to the tenant's KYC profile.
 * Documents only become usable after the worker marks them CLEAN.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user!.tenantId) return apiError(403, "NO_TENANT", "Your account is not bound to a workspace.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const docTypeRaw = String(form?.get("docType") ?? "");
  if (!file || typeof file === "string") return apiError(400, "NO_FILE", "Attach a PDF or image document.");
  if (!KYC_DOC_TYPES.includes(docTypeRaw as KycDocType)) {
    return apiError(400, "BAD_DOC_TYPE", `docType must be one of: ${KYC_DOC_TYPES.join(", ")}`);
  }

  const buf = Buffer.from(await (file as File).arrayBuffer());
  if (buf.length === 0) return apiError(400, "EMPTY_FILE", "The uploaded file is empty.");
  if (buf.length > MAX_BYTES) return apiError(413, "FILE_TOO_LARGE", "Documents are limited to 15 MB.");
  const mime = (file as File).type.toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) return apiError(415, "UNSUPPORTED_TYPE", "Only PDF, PNG and JPEG documents are accepted.");

  await requireSecrets();
  const config = getConfig();
  const { db } = getDb();
  const storageKey = `kyc/${user!.tenantId}/${randomUUID()}.${ext}`;
  // Object storage is driver-abstracted: local disk (dev) or S3 (prod);
  // keys are tenant-prefixed and never user-controlled.
  const { getObjectStore } = await import("@zfloat/storage");
  const store = getObjectStore();
  await store.put({ key: storageKey, body: buf, contentType: mime });

  const checksum = createHash("sha256").update(buf).digest("hex");
  const filename = String((file as File).name ?? "document").slice(0, 240);

  try {
    const [f] = await db
      .insert(schema.fileObjects)
      .values({
        tenantId: user!.tenantId,
        ref: `kyc-${Date.now()}`,
        filename,
        mimeType: mime,
        sizeBytes: buf.length,
        checksumSha256: checksum,
        storageDriver: config.STORAGE_DRIVER,
        storageKey,
        scanStatus: "PENDING",
        uploadedById: user!.userId,
      })
      .returning();
    const fileId = f!.id;
    const docId = await attachDocument(db, {
      tenantId: user!.tenantId,
      docType: docTypeRaw as KycDocType,
      fileId,
      uploadedById: user!.userId,
    });
    await enqueue("files.scan", { correlationId: `kyc-upload-${docId}`, fileId }, { jobId: `file-${fileId}` });
    return apiOk({ data: { docId, fileId, scanStatus: "PENDING", note: "Queued for malware scanning." } });
  } catch (err) {
    return apiError(500, "UPLOAD_FAILED", `Could not register the upload: ${(err as Error).message}`);
  }
}
