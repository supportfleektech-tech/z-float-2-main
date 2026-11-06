/**
 * OAuth2 callback handler for accounting providers
 * GET /api/accounting/callback?code=...&state=...&realmId=...
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@zfloat/database";
import { schema } from "@zfloat/database";
import { accountingProviderRegistry } from "@zfloat/accounting";
import { decryptToken, encryptTokens } from "@zfloat/accounting";
import { eq } from "drizzle-orm";
import { secretsReady } from "@/lib/secret-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await secretsReady();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const realmId = searchParams.get("realmId") ?? searchParams.get("organization_id") ?? searchParams.get("business_id");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const { db } = getDb();

  if (error) {
    // Update connection with error
    if (state) {
      await db
        .update(schema.accountingConnections)
        .set({
          status: "ERROR",
          lastSyncError: errorDescription ?? error,
          updatedAt: new Date(),
        })
        .where(eq(schema.accountingConnections.oauthState, state));
    }
    return NextResponse.redirect(
      `${process.env.APP_URL}/settings/accounting?error=${encodeURIComponent(errorDescription ?? error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/settings/accounting?error=${encodeURIComponent("Missing code or state")}`,
    );
  }

  // Find connection by state
  const [connection] = await db
    .select()
    .from(schema.accountingConnections)
    .where(eq(schema.accountingConnections.oauthState, state))
    .limit(1);

  if (!connection) {
    return NextResponse.redirect(
      `${process.env.APP_URL}/settings/accounting?error=${encodeURIComponent("Invalid state")}`,
    );
  }

  try {
    const adapter = accountingProviderRegistry.get(connection.provider as any);
    const pkceVerifier = await decryptToken(connection.pkceVerifier!);
    const redirectUri = `${process.env.APP_URL}/api/accounting/callback`;

    // Exchange code for tokens
    const tokens = await adapter.exchangeCode({
      code,
      redirectUri,
      codeVerifier: pkceVerifier,
    });

    // Encrypt tokens for storage
    const encrypted = await encryptTokens(tokens.access_token, tokens.refresh_token);

    // Get company info
    const companyInfo = await adapter.getCompanyInfo(tokens.access_token);

    // Update connection with tokens and company info
    await db
      .update(schema.accountingConnections)
      .set({
        status: "CONNECTED",
        accessTokenEncrypted: encrypted.accessTokenEncrypted,
        refreshTokenEncrypted: encrypted.refreshTokenEncrypted,
        tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000),
        realmId: realmId ?? companyInfo.realmId,
        companyName: companyInfo.companyName,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        oauthState: null,
        pkceVerifier: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.accountingConnections.id, connection.id));

    return NextResponse.redirect(`${process.env.APP_URL}/settings/accounting?connected=${connection.provider}`);
  } catch (err) {
    await db
      .update(schema.accountingConnections)
      .set({
        status: "ERROR",
        lastSyncError: err instanceof Error ? err.message : "Token exchange failed",
        updatedAt: new Date(),
      })
      .where(eq(schema.accountingConnections.id, connection.id));

    return NextResponse.redirect(
      `${process.env.APP_URL}/settings/accounting?error=${encodeURIComponent(err instanceof Error ? err.message : "Connection failed")}`,
    );
  }
}