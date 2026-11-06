/**
 * Initiate accounting provider OAuth2 connection
 * POST /api/accounting/connect
 * Body: { provider: "quickbooks" | "xero" | "zoho" | "sage", redirectUri?: string }
 */
import { NextRequest } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { accountingProviderRegistry } from "@zfloat/accounting";
import { generateState, generateCodeVerifier, generateCodeChallenge } from "@zfloat/accounting";
import { encryptToken } from "@zfloat/accounting";
import { eq } from "drizzle-orm";
import { requireUser, apiError, apiOk } from "@/lib/api";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await secretsReady();

  const { user, response } = await requireUser();
  if (response) return response;

  const { db } = getDb();
  const userId = user!.userId;
  const tenantId = user!.tenantId!;

  try {
    const body = await request.json();
    const { provider, redirectUri } = body as {
      provider: "quickbooks" | "xero" | "zoho" | "sage";
      redirectUri?: string;
    };

    if (!provider) {
      return apiError(400, "BAD_REQUEST", "Provider required");
    }

    const adapter = accountingProviderRegistry.get(provider);
    const scopes = accountingProviderRegistry.getScopes(provider);

    // Generate PKCE params
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Encrypt PKCE verifier for storage
    const pkceVerifierEncrypted = await encryptToken(codeVerifier);

    // Store connection in CONNECTING state
    const [connection] = await db
      .insert(schema.accountingConnections)
      .values({
        tenantId,
        provider,
        status: "CONNECTING",
        oauthState: state,
        pkceVerifier: pkceVerifierEncrypted,
        createdById: userId,
      })
      .returning();

    if (!connection) {
      return apiError(500, "INTERNAL_ERROR", "Failed to create connection");
    }

    const finalRedirectUri = redirectUri ?? `${process.env.APP_URL}/api/accounting/callback`;
    const authUrl = adapter.getAuthUrl({
      tenantId,
      redirectUri: finalRedirectUri,
      state,
      codeChallenge,
      scopes,
    });

    return apiOk({
      connectionId: connection.id,
      authUrl,
      state,
    });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to initiate connection");
  }
}