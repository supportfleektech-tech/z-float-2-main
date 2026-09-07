/**
 * Contract tests: MpesaProviderAdapter against a LOCAL Daraja emulator that
 * speaks the documented Daraja wire protocol (OAuth client credentials, B2C
 * payment request, STK push, transaction status). Verifies the adapter's real
 * HTTP behaviour (auth headers, payload shapes, response mapping, token
 * caching, timeouts, fail-closed) without a Safaricom account.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resetConfig, getConfig } from "@zfloat/config";
import { MpesaProviderAdapter } from "../src/index.js";
import type { ProviderPaymentInput, ProviderReversalInput, ProviderStatusInput } from "../src/index.js";

/* ------------------------------------------------------------------ */
/* Daraja emulator                                                     */
/* ------------------------------------------------------------------ */

interface EmulatorStats {
  oauthCalls: number;
  b2cCalls: number;
  stkCalls: number;
  statusCalls: number;
  reversalCalls: number;
  lastAuth: string | null;
  lastBody: Record<string, unknown> | null;
}

function makeEmulator(opts: { oauthDelayMs?: number } = {}): Promise<{ port: number; stats: EmulatorStats; close: () => Promise<void> }> {
  const stats: EmulatorStats = {
    oauthCalls: 0,
    b2cCalls: 0,
    stkCalls: 0,
    statusCalls: 0,
    reversalCalls: 0,
    lastAuth: null,
    lastBody: null,
  };
  return new Promise((resolve) => {
    const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const auth = req.headers.authorization ?? null;
      const url = new URL(req.url ?? "/", "http://x");
      const send = (code: number, body: Record<string, unknown>) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      // Emulate Daraja latency for the timeout test.
      if (opts.oauthDelayMs) {
        await new Promise((r) => setTimeout(r, opts.oauthDelayMs));
      }

      const readBody = () =>
        new Promise<Record<string, unknown>>((resolveBody) => {
          let raw = "";
          req.on("data", (c) => (raw += c));
          req.on("end", () => resolveBody(raw ? JSON.parse(raw) : {}));
        });

      if (url.pathname === "/oauth/v1/generate" && url.searchParams.get("grant_type") === "client_credentials") {
        stats.oauthCalls += 1;
        if (!auth?.startsWith("Basic ")) return send(401, { error: "missing basic auth" });
        // Contract: key:secret base64. Accept the test pair.
        const [key, secret] = Buffer.from(auth.slice(6), "base64").toString().split(":");
        if (key !== "test-key" || secret !== "test-secret") return send(401, { error: "bad credentials" });
        return send(200, { access_token: "emulator-token-1", expires_in: 3599 });
      }

      const body = await readBody();
      stats.lastAuth = auth;
      stats.lastBody = body;

      if (url.pathname === "/mpesa/b2c/v1/paymentrequest") {
        stats.b2cCalls += 1;
        if (auth !== "Bearer emulator-token-1") return send(401, { error: "bad bearer" });
        if (body.CommandID !== "BusinessPayment") return send(400, { ResponseCode: "1", ResponseDescription: "bad command" });
        return send(200, {
          ResponseCode: "0",
          ResponseDescription: "Accept the service request successfully.",
          OriginatorConversationID: "ORG-1",
          ConversationID: "CONV-1",
        });
      }

      if (url.pathname === "/mpesa/stkpush/v1/processrequest") {
        stats.stkCalls += 1;
        if (auth !== "Bearer emulator-token-1") return send(401, { error: "bad bearer" });
        return send(200, {
          ResponseCode: "0",
          ResponseDescription: "Success. Request accepted for processing",
          CheckoutRequestID: "ws_CO_123",
          MerchantRequestID: "MR-1",
        });
      }

      if (url.pathname === "/mpesa/transactionstatus/v1/query") {
        stats.statusCalls += 1;
        if (body.CommandID !== "TransactionStatusQuery") return send(400, { ResponseCode: "1", ResponseDescription: "bad command" });
        return send(200, { ResponseCode: "0", ResponseDescription: "Request processed", ConversationID: "CONV-Q" });
      }

      if (url.pathname === "/mpesa/reversal/v1/request") {
        stats.reversalCalls += 1;
        return send(200, { ResponseCode: "0", ResponseDescription: "Reversal request accepted", ConversationID: "CONV-R" });
      }

      return send(404, { error: "unknown route" });
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      resolve({ port: addr.port, stats, close: () => new Promise((r) => srv.close(() => r())) });
    });
  });
}

function input(overrides: Partial<ProviderPaymentInput> = {}): ProviderPaymentInput {
  return {
    paymentId: "11111111-1111-1111-1111-111111111111",
    reference: "ZF-TEST-123",
    amountMinor: 5000n,
    currency: "KES",
    destination: { channel: "mpesa", phone: "+254712345678" },
    providerReference: "ref-001",
    ...overrides,
  };
}

let emulator: { port: number; stats: EmulatorStats; close: () => Promise<void> } | null = null;

function cfg(port: number, extra: Record<string, string> = {}) {
  resetConfig();
  return getConfig(
    {
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://localhost/x",
        MPESA_ENVIRONMENT: "sandbox",
        MPESA_API_BASE_URL: `http://127.0.0.1:${port}`,
        MPESA_CONSUMER_KEY: "test-key",
        MPESA_CONSUMER_SECRET: "test-secret",
        MPESA_SHORTCODE: "174379",
        MPESA_PASSKEY: "passkey",
        MPESA_B2C_INITIATOR_NAME: "testapi",
        MPESA_B2C_SECURITY_CREDENTIAL: "securitycred",
        MPESA_CALLBACK_BASE_URL: "http://localhost",
        MPESA_TIMEOUT_MS: "5000",
        ...extra,
      },
      lenient: true,
    },
  );
}

beforeEach(async () => {
  emulator = await makeEmulator();
});

afterEach(() => {
  resetConfig();
  if (emulator) {
    emulator.close();
    emulator = null;
  }
});

afterAll(async () => {
  if (emulator) await emulator.close();
});

describe("MpesaProviderAdapter — Daraja contract", () => {
  it("is fail-closed without credentials (no network calls)", async () => {
    resetConfig();
    getConfig({
      env: { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/x", MPESA_ENVIRONMENT: "sandbox" },
      lenient: true,
    });
    const adapter = new MpesaProviderAdapter("sandbox");
    await expect(adapter.createPayment(input())).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
    });
    expect(emulator!.stats.oauthCalls).toBe(0);
  });

  it("B2C: authenticates, posts the documented payload, maps PENDING + reference", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    const result = await adapter.createPayment(input());
    expect(result.status).toBe("PENDING"); // outcomes arrive via ResultURL callback
    expect(result.async).toBe(true);
    expect(result.providerReference).toBe("CONV-1");
    expect(emulator!.stats.oauthCalls).toBe(1);
    expect(emulator!.stats.b2cCalls).toBe(1);
    expect(emulator!.stats.lastAuth).toBe("Bearer emulator-token-1");
    expect(emulator!.stats.lastBody).toMatchObject({
      CommandID: "BusinessPayment",
      Amount: 50, // 5000 minor / 100
      PartyA: "174379",
      PartyB: "254712345678", // E.164 phone → 254…
      InitiatorName: "testapi",
      ResultURL: "http://localhost/api/v1/webhooks/mpesa",
      QueueTimeOutURL: "http://localhost/api/v1/webhooks/mpesa",
    });
  });

  it("caches the OAuth token across payments", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    await adapter.createPayment(input());
    await adapter.createPayment(input({ providerReference: "ref-002" }));
    expect(emulator!.stats.oauthCalls).toBe(1);
    expect(emulator!.stats.b2cCalls).toBe(2);
  });

  it("STK push (till): posts CustomerPayBillOnline with phone + shortcode", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    const result = await adapter.createPayment(
      input({ destination: { channel: "till", phone: "+254700111222", tillNumber: "123456" } }),
    );
    expect(result.status).toBe("PENDING");
    expect(emulator!.stats.stkCalls).toBe(1);
    expect(emulator!.stats.lastBody).toMatchObject({
      TransactionType: "CustomerPayBillOnline",
      BusinessShortCode: "174379",
      PartyA: "254700111222",
      PhoneNumber: "254700111222",
      AccountReference: "Z-FLOAT",
    });
  });

  it("maps Daraja rejection codes to FAILED", async () => {
    // Emulator rejects when CommandID is wrong — simulate by overriding body? Instead:
    // the emulator returns ResponseCode 1 when CommandID !== BusinessPayment; we
    // cannot change the adapter's body, so use a dedicated refusal route via passkey.
    const srv = createServer(async (req, res) => {
      await new Promise<void>((r) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          if (req.url?.includes("oauth")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ access_token: "t", expires_in: 3600 }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ResponseCode: "1", ResponseDescription: "Rejected by Daraja" }));
          }
          r();
        });
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      cfg(port);
      const adapter = new MpesaProviderAdapter("sandbox");
      const result = await adapter.createPayment(input());
      expect(result.status).toBe("FAILED");
      expect(result.errorCode).toBe("DARAJAC_1");
      expect(result.errorMessage).toContain("Rejected by Daraja");
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("status query maps response code 0 → PENDING", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    const statusInput: ProviderStatusInput = {
      paymentId: "p-1",
      providerReference: "CONV-1",
      amountMinor: 5000n,
      currency: "KES",
    };
    const result = await adapter.getPaymentStatus(statusInput);
    expect(result.status).toBe("PENDING");
    expect(emulator!.stats.statusCalls).toBe(1);
  });

  it("reversePayment posts to the documented reversal endpoint", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    const revInput: ProviderReversalInput = {
      paymentId: "p-1",
      providerReference: "CONV-1",
      amountMinor: 5000n,
      currency: "KES",
      reason: "duplicate",
    };
    const result = await adapter.reversePayment(revInput);
    expect(result.status).toBe("PENDING");
    expect(emulator!.stats.reversalCalls).toBe(1);
  });

  it("times out rather than hanging when Daraja is slow (timeout ≠ failure semantics)", async () => {
    const slow = await makeEmulator({ oauthDelayMs: 3_000 });
    try {
      cfg(slow.port, { MPESA_TIMEOUT_MS: "400" });
      const adapter = new MpesaProviderAdapter("sandbox");
      const started = Date.now();
      await expect(adapter.createPayment(input())).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_500); // aborted, not hung
    } finally {
      await slow.close();
    }
  });

  it("refuses the base-URL override when the environment is production", async () => {
    cfg(emulator!.port, { MPESA_ENVIRONMENT: "production" });
    const adapter = new MpesaProviderAdapter("production");
    await expect(adapter.createPayment(input())).rejects.toThrow(/override is refused/);
  });

  it("throws a typed ProviderError for unsupported channels", async () => {
    cfg(emulator!.port);
    const adapter = new MpesaProviderAdapter("sandbox");
    await expect(adapter.createPayment(input({ destination: { channel: "bank", bankCode: "01" } }))).rejects.toMatchObject({
      code: "PROVIDER_INVALID_REQUEST",
    });
  });
});
