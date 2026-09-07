/**
 * Public API v1 — OpenAPI 3.1 document (GAP-ANALYSIS Phase 8).
 *
 * This module is the single source of truth for the public surface and is
 * served at /api/public/v1/openapi.json. It mirrors the handlers in
 * app/api/public/v1/{payments,wallets}/route.ts; scripts/verify-openapi.ts
 * proves every documented path against the LIVE API (curl matrix).
 */
import { getConfig } from "@zfloat/config";

export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Z-float Public API v1",
      version: "1.0.0",
      description:
        "Programmatic business payments and wallet balances for tenants. " +
        "Authenticate with an API key from the developer portal (/portal/developers): " +
        "`Authorization: Bearer zf_live_…` or `x-api-key: zf_live_…`. " +
        "Idempotency: POST /payments accepts an `idempotencyKey`; replays return the " +
        "existing payment with `replayed: true` and never double-execute.",
    },
    servers: [{ url: baseUrl }],
    security: [{ apiKey: [] }],
    paths: {
      "/api/public/v1/payments": {
        post: {
          summary: "Create and submit a payment",
          operationId: "createPayment",
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentCreate" } } },
          },
          responses: {
            "201": {
              description: "Created (or queued for approval)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentCreated" } } },
            },
            "200": {
              description: "Idempotent replay — original payment, current state",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentCreated" } } },
            },
            "400": { description: "Invalid body / payment refused", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "401": { description: "Missing/invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "409": { description: "State conflict (no wallet, approval policy, etc.)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "429": { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
        get: {
          summary: "List tenant payments (newest first)",
          operationId: "listPayments",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: {
            "200": {
              description: "Payments",
              content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Payment" } } } } } },
            },
            "401": { description: "Missing/invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/public/v1/wallets": {
        get: {
          summary: "List tenant wallets with balances",
          operationId: "listWallets",
          responses: {
            "200": {
              description: "Wallets",
              content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Wallet" } } } } } },
            },
            "401": { description: "Missing/invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/public/v1/openapi.json": {
        get: {
          summary: "This OpenAPI document",
          operationId: "getOpenApi",
          responses: { "200": { description: "OpenAPI 3.1 JSON" } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Tenant API key (zf_live_…) issued from /portal/developers. Also accepted as the x-api-key header.",
        },
      },
      schemas: {
        PaymentCreate: {
          type: "object",
          required: ["amount", "recipient"],
          properties: {
            amount: { type: "string", description: "KES amount as a decimal string, e.g. \"1500.00\"" },
            channel: { type: "string", enum: ["mpesa", "till", "paybill", "bank"], default: "mpesa" },
            recipient: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                phone: { type: "string", description: "E.164, e.g. +254712345678" },
                email: { type: "string" },
              },
            },
            remark: { type: "string" },
            idempotencyKey: { type: "string", description: "Replays return the original payment (replayed: true)" },
          },
        },
        PaymentCreated: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                paymentId: { type: "string" },
                status: { type: "string", description: "e.g. QUEUED, PROCESSING, SUCCESS, PENDING_APPROVAL" },
                approvalRequired: { type: "boolean" },
                amount: { type: "string" },
                currency: { type: "string" },
                replayed: { type: "boolean" },
              },
            },
          },
        },
        Payment: {
          type: "object",
          properties: {
            id: { type: "string" },
            paymentNumber: { type: "string" },
            amountMinor: { type: "string", description: "Minor units as a string (BigInt-safe)" },
            amountDisplay: { type: "string" },
            channel: { type: "string" },
            status: { type: "string" },
            providerReference: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Wallet: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            currency: { type: "string" },
            status: { type: "string" },
            availableMinor: { type: "string" },
            availableDisplay: { type: "string" },
            reservedMinor: { type: "string" },
          },
        },
        ErrorBody: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

export function publicApiSpecJson() {
  const base = getConfig().APP_URL;
  return JSON.stringify(buildOpenApiSpec(base), null, 2);
}
