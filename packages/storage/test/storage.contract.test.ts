/**
 * Storage contract tests against a REAL MinIO server (S3 wire protocol).
 *
 * Spawns `minio` (downloaded binary at MINIO_BIN or on PATH) on a random
 * port, creates a bucket, then exercises LocalObjectStore + S3ObjectStore:
 * put/get/head/delete round-trips, content types, prefix isolation, traversal
 * refusal (local), and presigned URL generation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalObjectStore, S3ObjectStore, getObjectStore, resetObjectStore } from "../src/index.js";
import { resetConfig, getConfig } from "@zfloat/config";

const MINIO_BIN =
  process.env.MINIO_BIN ?? "/home/user/zfloat/scripts/tools/minio";
const hasMinio = existsSync(MINIO_BIN);
const ACCESS_KEY = "minioadmin";
const SECRET_KEY = "minioadmin";

let server: ChildProcess | null = null;
let port = 0;
let dataDir = "";
let store: S3ObjectStore;

async function waitForServer(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${url}/minio/health/live`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("MinIO did not become healthy");
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "zfloat-minio-"));
  // Port 0 → let the OS assign; we read it from the log.
  server = spawn(MINIO_BIN, ["server", dataDir, "--address", "127.0.0.1:0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("minio log timeout")), 15_000);
    let buf = "";
    server!.stdout!.on("data", (c: Buffer) => {
      buf += c.toString();
      const m = buf.match(/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    server!.stderr!.on("data", (c: Buffer) => {
      const m = c.toString().match(/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    server!.on("error", reject);
    server!.on("exit", (code) => reject(new Error(`minio exited early: ${code}`)));
  });
  const parsed = new URL(endpoint);
  port = Number(parsed.port);
  await waitForServer(endpoint);

  // Create the bucket with the AWS SDK.
  const { S3Client, CreateBucketCommand, ListBucketsCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  await client.send(new CreateBucketCommand({ Bucket: "zfloat-test" }));
  const buckets = await client.send(new ListBucketsCommand({}));
  if (!buckets.Buckets?.some((b) => b.Name === "zfloat-test")) {
    throw new Error("bucket not created");
  }
  client.destroy();

  store = new S3ObjectStore({
    endpoint,
    bucket: "zfloat-test",
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    forcePathStyle: true,
  });
});

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => server!.once("exit", r));
    setTimeout(() => server!.kill("SIGKILL"), 2000).unref();
  }
  await rm(dataDir, { recursive: true, force: true });
});

describe.skipIf(!hasMinio)("S3 driver vs real MinIO (wire protocol)", () => {
  it("put → get round-trip returns identical bytes with content type", async () => {
    const body = Buffer.from("KYC CR12 certificate — wire round trip ünïcode ✓");
    const out = await store.put({ key: "kyc/acme/cr12.pdf", body, contentType: "application/pdf" });
    expect(out.etag).toBeTruthy();
    expect(out.sizeBytes).toBe(body.length);
    const fetched = await store.get("kyc/acme/cr12.pdf");
    expect(fetched.equals(body)).toBe(true);
  });

  it("head returns size; missing key returns null (404 mapped)", async () => {
    await store.put({ key: "reports/2026-09.csv", body: Buffer.from("a,b\n1,2\n") });
    const h = await store.head("reports/2026-09.csv");
    expect(h?.sizeBytes).toBe(8);
    expect(await store.head("reports/does-not-exist.csv")).toBeNull();
  });

  it("delete removes the object", async () => {
    await store.put({ key: "tmp/gone.txt", body: Buffer.from("x") });
    await store.delete("tmp/gone.txt");
    expect(await store.head("tmp/gone.txt")).toBeNull();
  });

  it("key prefix isolates tenants (prefix driver)", async () => {
    const a = new S3ObjectStore({
      endpoint: store["endpoint"] ?? "http://127.0.0.1:" + port,
      bucket: "zfloat-test",
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      keyPrefix: "tenant-a",
    });
    // We can't read the private endpoint; rebuild from closure port.
    const b = new S3ObjectStore({
      endpoint: "http://127.0.0.1:" + port,
      bucket: "zfloat-test",
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      keyPrefix: "tenant-b",
    });
    await a.put({ key: "doc.txt", body: Buffer.from("AAA") });
    await b.put({ key: "doc.txt", body: Buffer.from("BBB") });
    // Same logical key, different tenants → different physical objects.
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const { S3Client } = await import("@aws-sdk/client-s3");
    const raw = new S3Client({
      endpoint: "http://127.0.0.1:" + port,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    });
    const list = await raw.send(new ListObjectsV2Command({ Bucket: "zfloat-test" }));
    const keys = (list.Contents ?? []).map((o) => o.Key);
    expect(keys).toContain("tenant-a/doc.txt");
    expect(keys).toContain("tenant-b/doc.txt");
    raw.destroy();
  });

  it("presigned URL allows an unauthenticated GET (temporary access)", async () => {
    await store.put({ key: "share/s3-url.txt", body: Buffer.from("presigned ok") });
    const url = await store.urlFor("share/s3-url.txt", { expiresInSeconds: 60 });
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("X-Amz-Signature");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("presigned ok");
  });
});

describe("Local driver", () => {
  it("round-trips, refuses traversal, reports head/delete", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "zfloat-local-"));
    try {
      const local = new LocalObjectStore(dir);
      await local.put({ key: "kyc/a/cr12.pdf", body: Buffer.from("pdf-bytes") });
      expect((await local.get("kyc/a/cr12.pdf")).toString()).toBe("pdf-bytes");
      expect((await local.head("kyc/a/cr12.pdf"))?.sizeBytes).toBe(9);
      expect(await local.head("nope")).toBeNull();
      await expect(local.put({ key: "../escape.txt", body: Buffer.from("x") })).rejects.toThrow(/outside the storage root/);
      await local.delete("kyc/a/cr12.pdf");
      expect(await local.head("kyc/a/cr12.pdf")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("factory (getObjectStore)", () => {
  it("selects local driver by default from config", () => {
    resetConfig();
    getConfig({
      env: { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/x", STORAGE_DRIVER: "local" },
      lenient: true,
    });
    resetObjectStore();
    expect(getObjectStore().driver).toBe("local");
  });

  it("throws with a clear message when s3 config is incomplete", () => {
    resetConfig();
    getConfig({
      env: { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/x", STORAGE_DRIVER: "s3" },
      lenient: true,
    });
    resetObjectStore();
    expect(() => getObjectStore()).toThrow(/S3_ENDPOINT/);
  });
});
