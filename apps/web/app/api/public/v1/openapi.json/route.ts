import { publicApiSpecJson } from "@/lib/public-api-spec";

/** GET /api/public/v1/openapi.json — the Public API v1 OpenAPI 3.1 document
 * (generated from lib/public-api-spec.ts, the code-truth registry). */
export async function GET() {
  return new Response(publicApiSpecJson(), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
