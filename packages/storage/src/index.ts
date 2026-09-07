/**
 * Object storage — provider-agnostic driver over local disk or S3-compatible
 * endpoints (AWS S3, MinIO). Used for KYC/AML evidence files, report exports
 * and any other tenant artifact.
 *
 * Selection: `STORAGE_DRIVER` (`local` | `s3`). S3 config is read from env
 * (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
 * The S3 driver is exercised against a real MinIO server in the contract
 * tests (`test/s3.minio.contract.test.ts`) so the wire protocol is verified,
 * not just mocked.
 */
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getConfig } from "@zfloat/config";

export interface StoredObject {
  key: string;
  etag?: string;
  sizeBytes?: number;
}

export interface ObjectStore {
  readonly driver: "local" | "s3";
  put(input: { key: string; body: Buffer; contentType?: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<{ key: string; sizeBytes: number } | null>;
  delete(key: string): Promise<void>;
  /** HTTP URL for a temporary GET (local: file path; s3: presigned URL). */
  urlFor(key: string, opts?: { expiresInSeconds?: number }): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Local driver                                                        */
/* ------------------------------------------------------------------ */

export class LocalObjectStore implements ObjectStore {
  readonly driver = "local" as const;
  constructor(private readonly rootDir: string) {}

  /** Resolve a key inside the root; refuse traversal. */
  private resolve(key: string): string {
    const clean = key.replace(/^\/+/, "");
    const absolute = path.resolve(this.rootDir, clean);
    const root = path.resolve(this.rootDir);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error("storage: refusing path outside the storage root");
    }
    return absolute;
  }

  async put(input: { key: string; body: Buffer; contentType?: string }): Promise<StoredObject> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body, { flag: "wx" });
    return { key: input.key, sizeBytes: input.body.length };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async head(key: string): Promise<{ key: string; sizeBytes: number } | null> {
    try {
      const s = await stat(this.resolve(key));
      return { key, sizeBytes: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async urlFor(key: string): Promise<string> {
    return `file://${this.resolve(key)}`;
  }
}

/* ------------------------------------------------------------------ */
/* S3 driver (AWS S3 / MinIO)                                          */
/* ------------------------------------------------------------------ */

export class S3ObjectStore implements ObjectStore {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(opts: {
    endpoint: string;
    region?: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
    keyPrefix?: string;
  }) {
    this.bucket = opts.bucket;
    this.keyPrefix = opts.keyPrefix ?? "";
    this.client = new S3Client({
      region: opts.region ?? "us-east-1",
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle ?? true, // required for MinIO
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  private fullKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}/${key}` : key;
  }

  async put(input: { key: string; body: Buffer; contentType?: string }): Promise<StoredObject> {
    const out = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(input.key),
        Body: input.body,
        ContentType: input.contentType ?? "application/octet-stream",
      }),
    );
    return { key: input.key, etag: out.ETag, sizeBytes: input.body.length };
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
    );
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) throw new Error(`storage: empty body for ${key}`);
    return Buffer.from(bytes);
  }

  async head(key: string): Promise<{ key: string; sizeBytes: number } | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
      return { key, sizeBytes: out.ContentLength ?? 0 };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
  }

  async urlFor(key: string, opts: { expiresInSeconds?: number } = {}): Promise<string> {
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresInSeconds ?? 900 });
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

let cached: ObjectStore | null = null;

/** Build (and cache) the configured object store from env/config. */
export function getObjectStore(opts?: { refresh?: boolean }): ObjectStore {
  if (cached && !opts?.refresh) return cached;
  const config = getConfig();
  if (config.STORAGE_DRIVER === "s3") {
    if (!config.S3_BUCKET || !config.S3_ENDPOINT || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "storage: S3_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
      );
    }
    cached = new S3ObjectStore({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      keyPrefix: config.S3_KEY_PREFIX,
    });
    return cached;
  }
  cached = new LocalObjectStore(config.STORAGE_LOCAL_DIR);
  return cached;
}

/** Test helper: drop the cached store so env changes take effect. */
export function resetObjectStore(): void {
  cached = null;
}
