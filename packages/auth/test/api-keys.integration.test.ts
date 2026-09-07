/**
 * API-key service integration tests (real PostgreSQL): create → authenticate,
 * raw secret never stored, revoke kills the credential, expiry honoured,
 * tenant isolation.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@zfloat/database";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  authenticateApiKey,
  extractApiCredential,
  hashApiKey,
  ApiKeyError,
} from "../src/index.js";

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let TENANT_A = "";
let TENANT_B = "";

async function clean() {
  await pool.query(`TRUNCATE api_keys, tenants CASCADE`);
}

beforeEach(async () => {
  ({ db, pool } = createDb());
  await clean();
  for (const [name, slug] of [["Tenant A", "keya"], ["Tenant B", "keyb"]]) {
    const [t] = await db
      .insert(schema.tenants)
      .values({ name, slug: `${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`, status: "ACTIVE" })
      .returning();
    if (name === "Tenant A") TENANT_A = t!.id;
    else TENANT_B = t!.id;
  }
});

afterAll(async () => {
  await pool.end();
});

describe("api key lifecycle", () => {
  it("creates a key with zf_live_ credential; only the hash is stored", async () => {
    const { key, secret } = await createApiKey(db, { tenantId: TENANT_A, name: "Prod server" });
    expect(secret).toMatch(/^zf_live_[A-Za-z0-9]{6}_/);
    expect(key.keyPrefix).toMatch(/^zf_live_/);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(row!.keyHash).toBe(hashApiKey(secret));
    expect(row!.keyHash).not.toContain(secret.slice(10)); // raw never stored anywhere in the row
    expect(row!.name).toBe("Prod server");
  });

  it("authenticates the credential and returns tenant context", async () => {
    const { secret } = await createApiKey(db, { tenantId: TENANT_A, name: "svc" });
    const auth = await authenticateApiKey(db, secret);
    expect(auth?.tenantId).toBe(TENANT_A);
    expect(auth?.name).toBe("svc");
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, hashApiKey(secret)));
    expect(row!.lastUsedAt).toBeTruthy();
  });

  it("rejects unknown, tampered and revoked credentials", async () => {
    const { secret } = await createApiKey(db, { tenantId: TENANT_A, name: "svc" });
    expect(await authenticateApiKey(db, "zf_live_wrong_00000000000000000000000000000000")).toBeNull();
    expect(await authenticateApiKey(db, secret.slice(0, -2) + "xx")).toBeNull();
    const keys = await listApiKeys(db, TENANT_A);
    await revokeApiKey(db, { keyId: keys[0]!.id, tenantId: TENANT_A });
    expect(await authenticateApiKey(db, secret)).toBeNull();
  });

  it("honours expiry", async () => {
    const { secret } = await createApiKey(db, {
      tenantId: TENANT_A,
      name: "expiring",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await authenticateApiKey(db, secret)).toBeNull();
  });

  it("is tenant-scoped: B cannot revoke or see A's keys", async () => {
    const { key } = await createApiKey(db, { tenantId: TENANT_A, name: "A-only" });
    const bKeys = await listApiKeys(db, TENANT_B);
    expect(bKeys).toHaveLength(0);
    expect(await revokeApiKey(db, { keyId: key.id, tenantId: TENANT_B })).toBe(false);
    const aKeys = await listApiKeys(db, TENANT_A);
    expect(aKeys[0]!.status).toBe("ACTIVE");
  });

  it("rejects empty names", async () => {
    await expect(createApiKey(db, { tenantId: TENANT_A, name: "" })).rejects.toThrow(ApiKeyError);
  });
});

describe("header extraction", () => {
  it("parses Bearer and x-api-key", () => {
    const h = new Headers({ authorization: "Bearer zf_live_abc123_xyz" });
    expect(extractApiCredential(h)).toBe("zf_live_abc123_xyz");
    const h2 = new Headers({ "x-api-key": "zf_live_abc123_xyz" });
    expect(extractApiCredential(h2)).toBe("zf_live_abc123_xyz");
    expect(extractApiCredential(new Headers())).toBeNull();
  });
});
