import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, schema, eq } from "@zfloat/database";
import { normalizeKenyanPhone, queueNotification, dispatchNotification } from "../src/index.js";
import { resetConfig } from "@zfloat/config";

function setEnv(overrides: Record<string, string>) {
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  resetConfig(); // re-parse env before the next dispatch (config is a per-process singleton)
}

let db: Db;
let pool: ReturnType<typeof createDb>["pool"];
let sinkDir: string;
let TENANT: string;
let USER_ID: string;

async function makeTenantUser(phone: string) {
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Notif Test Co", slug: `nt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "ACTIVE" })
    .returning({ id: schema.tenants.id });
  TENANT = tenant!.id;
  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: TENANT,
      email: `${Math.random().toString(36).slice(2, 10)}@test.co.ke`,
      phone,
      fullName: "Notif Tester",
      status: "ACTIVE",
    })
    .returning({ id: schema.users.id });
  USER_ID = user!.id;
}

beforeEach(async () => {
  sinkDir = mkdtempSync(join(tmpdir(), "zf-mailbox-"));
  ({ db, pool } = createDb());
  await pool.query(`TRUNCATE notifications, users, tenants CASCADE`);
  await makeTenantUser("0712 000 111");
});

afterAll(async () => {
  await pool.query(`TRUNCATE notifications, users, tenants CASCADE`);
  await pool.end();
  rmSync(sinkDir, { recursive: true, force: true });
});

describe("normalizeKenyanPhone", () => {
  it("normalizes local, E.164 and bare forms", () => {
    expect(normalizeKenyanPhone("0712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("+254712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("254712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("712345678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("0712-345-678")).toBe("+254712345678");
    expect(normalizeKenyanPhone("12345")).toBeNull();
  });
});

describe("channel drivers (EMAIL_DRIVER=sink / SMS_DRIVER=http against mock)", () => {
  it("writes EMAIL to the sink directory with recipients", async () => {
    setEnv({ EMAIL_DRIVER: "sink", SMTP_SINK_DIR: sinkDir });
    const id = await queueNotification(db, {
      tenantId: TENANT,
      userId: USER_ID,
      channel: "EMAIL",
      title: "Payment received",
      body: "KES 1,000 credited.",
    });
    const res = await dispatchNotification(db, id);
    expect(res.ok).toBe(true);
    expect(res.driver).toBe("sink");

    const files = readdirSync(sinkDir);
    expect(files.length).toBe(1);
    const mail = JSON.parse(readFileSync(join(sinkDir, files[0]!), "utf8")) as {
      to: string;
      subject: string;
      text: string;
    };
    expect(mail.to).toContain("@test.co.ke");
    expect(mail.subject).toBe("Payment received");
    expect(mail.text).toContain("1,000");

    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id));
    expect(row!.status).toBe("SENT");
    expect(row!.sentAt).toBeTruthy();
  });

  it("uses an explicit data.to override for EMAIL", async () => {
    setEnv({ EMAIL_DRIVER: "sink", SMTP_SINK_DIR: sinkDir });
    const id = await queueNotification(db, {
      tenantId: TENANT,
      channel: "EMAIL",
      title: "Invoice",
      body: "See attachment.",
      data: { to: "billing@acme.co.ke" },
    });
    setEnv({ EMAIL_DRIVER: "sink", SMTP_SINK_DIR: sinkDir });
    await dispatchNotification(db, id);
    const files = readdirSync(sinkDir);
    const mail = JSON.parse(readFileSync(join(sinkDir, files[0]!), "utf8")) as { to: string };
    expect(mail.to).toBe("billing@acme.co.ke");
  });

  it("fails cleanly when the recipient cannot be resolved", async () => {
    setEnv({ EMAIL_DRIVER: "sink", SMTP_SINK_DIR: sinkDir });
    const id = await queueNotification(db, {
      tenantId: TENANT,
      channel: "EMAIL",
      title: "No recipient",
      body: "x",
    });
    await expect(dispatchNotification(db, id)).rejects.toThrow(/No recipient/);
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id));
    expect(row!.status).toBe("FAILED");
    expect(row!.data?.error).toContain("No recipient");
  });

  it("POSTs an Africa's Talking-compatible payload to the SMS gateway", async () => {
    const calls: Array<{ headers: Record<string, string>; body: unknown }> = [];
    const http = (await import("node:http")).default;
    const server = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
      const srv = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          calls.push({
            headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])) as Record<string, string>,
            body: JSON.parse(raw),
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }));
        });
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as { port: number };
        resolve({ port: addr.port, close: () => new Promise((r) => srv.close(() => r())) });
      });
    });
    const port = server.port;

    setEnv({
      SMS_DRIVER: "http",
      SMS_PROVIDER_URL: `http://127.0.0.1:${port}/v1/messages`,
      SMS_API_KEY: "test-key",
      SMS_FROM: "Z-FLOAT",
    });

    const id = await queueNotification(db, {
      tenantId: TENANT,
      userId: USER_ID,
      channel: "SMS",
      body: "Your payment of KES 500 was successful.",
    });
    const res = await dispatchNotification(db, id);
    expect(res.ok).toBe(true);
    expect(res.driver).toBe("http");

    expect(calls.length).toBe(1);
    expect(calls[0]!.headers["authorization"]).toBe("Bearer test-key");
    expect(calls[0]!.headers["content-type"]).toContain("application/json");
    expect(calls[0]!.body).toEqual({
      to: ["+254712000111"],
      from: "Z-FLOAT",
      message: "Your payment of KES 500 was successful.",
    });
    await server.close();
  });

  it("marks the notification FAILED when the gateway rejects", async () => {
    setEnv({ SMS_DRIVER: "http", SMS_PROVIDER_URL: "http://127.0.0.1:1/none" });
    const id = await queueNotification(db, {
      tenantId: TENANT,
      userId: USER_ID,
      channel: "SMS",
      body: "boom",
    });
    await expect(dispatchNotification(db, id)).rejects.toThrow();
    const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id));
    expect(row!.status).toBe("FAILED");
  });
});
